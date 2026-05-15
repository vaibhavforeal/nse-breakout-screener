import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { join, extname } from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = 3000;
const DASHBOARD_DIR = join(__dirname, 'dashboard');
const RESULTS_FILE = join(__dirname, 'breakout_results.json');

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

// ===== SCAN STATE =====
let scanProcess = null;
let scanLogs = [];
let sseClients = [];

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(res => { try { res.write(msg); } catch {} });
}

async function serveStatic(res, filePath) {
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not Found');
  }
}

function jsonResponse(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function runScan(args = []) {
  return new Promise((resolve, reject) => {
    if (scanProcess) return reject(new Error('Scan already in progress'));

    scanLogs = [];
    const cmdStr = `node screener.mjs ${args.join(' ')}`;
    const startMsg = `▶ Starting: ${cmdStr}`;
    scanLogs.push({ text: startMsg, type: 'system', ts: Date.now() });
    broadcast('log', scanLogs.at(-1));
    broadcast('status', { scanning: true, startTime: Date.now() });
    console.log(`\n🔍 ${startMsg}`);

    scanProcess = spawn('node', ['screener.mjs', ...args], { cwd: __dirname, shell: true });

    scanProcess.stdout.on('data', d => {
      const raw = d.toString();
      process.stdout.write(raw);
      // Split into lines but keep non-empty ones
      const lines = raw.split(/\r?\n/).filter(l => l.trim());
      lines.forEach(line => {
        const entry = { text: line, type: 'stdout', ts: Date.now() };
        scanLogs.push(entry);
        broadcast('log', entry);
      });
    });

    scanProcess.stderr.on('data', d => {
      const raw = d.toString();
      process.stderr.write(raw);
      const lines = raw.split(/\r?\n/).filter(l => l.trim());
      lines.forEach(line => {
        const entry = { text: line, type: 'stderr', ts: Date.now() };
        scanLogs.push(entry);
        broadcast('log', entry);
      });
    });

    scanProcess.on('close', async code => {
      scanProcess = null;
      const endMsg = code === 0 ? '✅ Scan completed successfully' : `❌ Scan failed (exit code ${code})`;
      scanLogs.push({ text: endMsg, type: 'system', ts: Date.now() });
      broadcast('log', scanLogs.at(-1));

      if (code === 0) {
        try {
          const data = JSON.parse(await readFile(RESULTS_FILE, 'utf-8'));
          broadcast('complete', { success: true, candidateCount: data.candidates.length });
          resolve(data);
        } catch (e) {
          broadcast('complete', { success: false, error: 'Failed to read results' });
          reject(e);
        }
      } else {
        broadcast('complete', { success: false, error: `Exit code ${code}` });
        reject(new Error(`Scan exited with code ${code}`));
      }
    });

    scanProcess.on('error', err => {
      scanProcess = null;
      const entry = { text: `❌ Error: ${err.message}`, type: 'stderr', ts: Date.now() };
      scanLogs.push(entry);
      broadcast('log', entry);
      broadcast('complete', { success: false, error: err.message });
      reject(err);
    });
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // --- SSE Stream ---
  if (path === '/api/scan/stream' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    // Send all existing logs so late joiners see history
    scanLogs.forEach(entry => {
      res.write(`event: log\ndata: ${JSON.stringify(entry)}\n\n`);
    });
    // Send current status
    res.write(`event: status\ndata: ${JSON.stringify({ scanning: scanProcess !== null })}\n\n`);

    sseClients.push(res);
    req.on('close', () => { sseClients = sseClients.filter(c => c !== res); });
    return;
  }

  // --- GET /api/data ---
  if (path === '/api/data' && req.method === 'GET') {
    try {
      const data = await readFile(RESULTS_FILE, 'utf-8');
      jsonResponse(res, 200, JSON.parse(data));
    } catch { jsonResponse(res, 404, { error: 'No scan results found.' }); }
    return;
  }

  // --- POST /api/scan ---
  if (path === '/api/scan' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      if (scanProcess) return jsonResponse(res, 409, { error: 'Scan already in progress' });
      try {
        const opts = body ? JSON.parse(body) : {};
        const args = [];
        if (opts.fast) args.push('--no-oi');
        if (opts.index) args.push('--index', opts.index);
        if (opts.symbols) args.push('--symbols', opts.symbols);
        if (opts.force) args.push('--force');
        // Don't await — respond immediately, stream logs via SSE
        runScan(args).catch(() => {});
        jsonResponse(res, 202, { started: true, message: 'Scan started. Connect to /api/scan/stream for live updates.' });
      } catch (err) { jsonResponse(res, 500, { error: err.message }); }
    });
    return;
  }

  // --- GET /api/status ---
  if (path === '/api/status' && req.method === 'GET') {
    jsonResponse(res, 200, { scanning: scanProcess !== null, logCount: scanLogs.length });
    return;
  }

  // --- Static files ---
  if (path === '/' || path === '') { res.writeHead(302, { Location: '/dashboard/' }); res.end(); return; }
  if (path.startsWith('/dashboard')) {
    let fp = path.replace('/dashboard', '') || '/';
    if (fp === '/' || fp === '') fp = '/index.html';
    await serveStatic(res, join(DASHBOARD_DIR, fp));
    return;
  }

  res.writeHead(404); res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║  NSE Breakout Screener — Dashboard Server    ║`);
  console.log(`║  http://localhost:${PORT}/dashboard/              ║`);
  console.log(`╠══════════════════════════════════════════════╣`);
  console.log(`║  POST /api/scan        → Start live scan     ║`);
  console.log(`║  GET  /api/scan/stream  → SSE log stream     ║`);
  console.log(`║  GET  /api/data        → Current results     ║`);
  console.log(`╚══════════════════════════════════════════════╝\n`);
});
