// ===== UTILITIES =====
const fmt = (n, d=2) => Number(n).toFixed(d);
const fmtINR = n => '₹' + Number(n).toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2});
const fmtInt = n => Number(n).toLocaleString('en-IN');
const fmtTime = iso => {
  const d = new Date(iso);
  const day = d.getDate(), mon = d.toLocaleString('en',{month:'short'}), yr = d.getFullYear();
  let h = d.getHours(), m = d.getMinutes(), ap = h>=12?'PM':'AM';
  h = h%12||12;
  return `${day} ${mon} ${yr}, ${h}:${String(m).padStart(2,'0')} ${ap} IST`;
};
function scoreColor(s) { return s>=70?'var(--secondary)':s>=35?'var(--tertiary)':'var(--error)'; }
function scoreClass(s) { return s>=70?'secondary':s>=35?'tertiary':'error'; }
function rsiInfo(r) {
  if(r>=50&&r<=75) return {cls:'active',color:'var(--secondary)',label:'Sweet Spot'};
  if(r>75) return {cls:'warn',color:'var(--tertiary)',label:'Overbought'};
  if(r<30) return {cls:'warn',color:'var(--error)',label:'Oversold'};
  return {cls:'inactive',color:'var(--on-surface-variant)',label:'Neutral'};
}
function regimeInfo(c) {
  if(c==='bullish') return {icon:'trending_up',color:'var(--secondary)',badge:'STRONG',badgeBg:'rgba(125,255,162,0.1)',badgeBorder:'rgba(125,255,162,0.2)'};
  if(c==='bearish') return {icon:'trending_down',color:'var(--error)',badge:'WEAK',badgeBg:'rgba(255,180,171,0.1)',badgeBorder:'rgba(255,180,171,0.2)'};
  return {icon:'balance',color:'var(--tertiary)',badge:'STABLE',badgeBg:'rgba(255,184,123,0.1)',badgeBorder:'rgba(255,184,123,0.2)'};
}
function vixInfo(l) {
  if(l==='low') return {color:'var(--secondary)',bg:'rgba(125,255,162,0.15)',border:'rgba(125,255,162,0.3)',note:'Low Volatility'};
  if(l==='high') return {color:'var(--error)',bg:'rgba(255,180,171,0.15)',border:'rgba(255,180,171,0.3)',note:'High Volatility'};
  return {color:'var(--tertiary)',bg:'rgba(255,184,123,0.15)',border:'rgba(255,184,123,0.3)',note:'Volatility Normalizing'};
}

// ===== STATE =====
let DATA = null, expanded = null, sortField = 'score', sortDir = 'desc', filterText = '';
const PAGE_SIZE = 10;
let currentPage = 1;
let isScanning = false;
let scanStartTime = 0;
let timerInterval = null;
let evtSource = null;

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch('/api/data');
    if(!res.ok) throw new Error('No previous scan data found');
    DATA = await res.json();
    render();
  } catch(e) {
    document.querySelector('.loading-text').textContent = 'No data yet — click RUN SCAN to fetch live NSE data';
  }
  document.getElementById('loading-overlay').classList.add('fade-out');
  setTimeout(()=>document.getElementById('loading-overlay').classList.add('hidden'),500);
  document.getElementById('btn-scan').onclick = () => runScan({});
  document.getElementById('btn-scan-fast').onclick = () => runScan({ fast: true });
  document.getElementById('fab-top').onclick = () => window.scrollTo({top:0,behavior:'smooth'});
  document.getElementById('sidebar-close').onclick = closeSidebar;
  document.getElementById('sidebar-overlay').onclick = closeSidebar;
  document.getElementById('sidebar-clear').onclick = () => {
    document.getElementById('sidebar-logs').innerHTML =
      '<div class="log-empty"><span class="material-symbols-outlined" style="font-size:40px;opacity:0.3">radar</span><p>Logs cleared.</p></div>';
  };
});

// ===== SIDEBAR =====
function openSidebar() {
  document.getElementById('scan-sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').classList.add('active');
}
function closeSidebar() {
  document.getElementById('scan-sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('active');
}
function appendLog(entry) {
  const container = document.getElementById('sidebar-logs');
  // Remove empty state if present
  const empty = container.querySelector('.log-empty');
  if (empty) empty.remove();
  const div = document.createElement('div');
  div.className = `log-line ${entry.type || 'stdout'}`;
  div.textContent = entry.text;
  container.appendChild(div);
  // Auto-scroll to bottom
  container.scrollTop = container.scrollHeight;
}
function setStatus(state, text) {
  const dot = document.getElementById('status-dot');
  const txt = document.getElementById('status-text');
  dot.className = 'status-dot ' + state;
  txt.textContent = text;
}
function startTimer() {
  scanStartTime = Date.now();
  const el = document.getElementById('status-timer');
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const s = Math.floor((Date.now() - scanStartTime) / 1000);
    const m = Math.floor(s / 60);
    el.textContent = m > 0 ? `${m}m ${s%60}s` : `${s}s`;
  }, 1000);
}
function stopTimer() { clearInterval(timerInterval); }

// ===== SCAN =====
async function runScan(opts = {}) {
  if (isScanning) return showToast('Scan already in progress...');
  isScanning = true;

  // Update buttons
  const btn = document.getElementById('btn-scan');
  const btnFast = document.getElementById('btn-scan-fast');
  btn.innerHTML = '<span class="material-symbols-outlined btn-icon spinning">progress_activity</span>SCANNING...';
  btn.disabled = true; btnFast.disabled = true; btnFast.style.opacity = '0.5';

  // Open sidebar & reset
  document.getElementById('sidebar-logs').innerHTML = '';
  openSidebar();
  setStatus('scanning', opts.fast ? 'Fast Scan (no OI)...' : 'Scanning NSE...');
  startTimer();

  // Start the scan (fire & forget — server returns 202 immediately)
  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    });
    if (res.status === 409) { showToast('Scan already running'); resetButtons(); return; }
    if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
  } catch (e) {
    setStatus('error', 'Failed to start scan');
    appendLog({ text: '❌ ' + e.message, type: 'stderr' });
    stopTimer(); resetButtons(); return;
  }

  // Connect SSE for live logs
  if (evtSource) evtSource.close();
  evtSource = new EventSource('/api/scan/stream');

  evtSource.addEventListener('log', e => {
    const entry = JSON.parse(e.data);
    appendLog(entry);
  });

  evtSource.addEventListener('status', e => {
    const data = JSON.parse(e.data);
    if (data.scanning) setStatus('scanning', 'Scanning...');
  });

  evtSource.addEventListener('complete', async e => {
    const data = JSON.parse(e.data);
    evtSource.close(); evtSource = null;
    stopTimer();

    if (data.success) {
      setStatus('done', `Complete — ${data.candidateCount} candidates`);
      appendLog({ text: `\n✅ Found ${data.candidateCount} breakout candidates`, type: 'system' });
      // Reload data
      try {
        const res = await fetch('/api/data');
        DATA = await res.json();
        expanded = null; currentPage = 1;
        render();
        showToast('✅ Scan complete — dashboard updated');
      } catch {}
    } else {
      setStatus('error', 'Scan failed');
      appendLog({ text: '❌ ' + (data.error || 'Unknown error'), type: 'stderr' });
    }
    resetButtons();
  });

  evtSource.onerror = () => {
    setStatus('error', 'Connection lost');
    evtSource.close(); evtSource = null;
    stopTimer(); resetButtons();
  };
}

function resetButtons() {
  isScanning = false;
  const btn = document.getElementById('btn-scan');
  const btnFast = document.getElementById('btn-scan-fast');
  btn.innerHTML = '<span class="material-symbols-outlined btn-icon">radar</span>RUN SCAN';
  btn.disabled = false; btnFast.disabled = false; btnFast.style.opacity = '1';
}

function showToast(msg) {
  const t = document.getElementById('toast'); t.textContent=msg; t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(()=>t.classList.add('hidden'), 4000);
}

// ===== RENDER =====
function render() {
  if(!DATA) return;
  renderScanTime(); renderMarketContext(); renderSummaryStats(); renderSpotlight(); renderTable();
}

function renderScanTime() {
  document.getElementById('last-scan-time').textContent = fmtTime(DATA.metadata.scanTime);
}

function renderMarketContext() {
  const mc = DATA.metadata.marketContext;
  const ri = regimeInfo(mc.condition);
  const vi = vixInfo(mc.vixLevel);
  const above = mc.niftyAbove200EMA;
  document.getElementById('market-context').innerHTML = `
    <div class="glass-card context-card regime-card">
      <div class="regime-icon" style="background:${ri.color};box-shadow:0 0 30px ${ri.color}40">
        <span class="material-symbols-outlined filled" style="color:var(--bg);font-size:28px">${ri.icon}</span>
        <div class="pulse-ring" style="border-color:${ri.color}"></div>
      </div>
      <div>
        <h3 class="label-caps text-muted card-label">MARKET REGIME</h3>
        <div class="regime-value">
          <span class="headline-md" style="color:${ri.color}">${mc.condition.toUpperCase()}</span>
          <span class="regime-badge" style="background:${ri.badgeBg};color:${ri.color};border:1px solid ${ri.badgeBorder}">${ri.badge}</span>
        </div>
      </div>
      <span class="material-symbols-outlined bg-icon">trending_flat</span>
    </div>
    <div class="glass-card context-card vix-card">
      <div>
        <h3 class="label-caps text-muted card-label">INDIA VIX</h3>
        <span class="data-lg">${fmt(mc.vix,2)}</span>
      </div>
      <div style="text-align:right">
        <span class="vix-badge" style="background:${vi.bg};color:${vi.color};border:1px solid ${vi.border}">${mc.vixLevel.toUpperCase()}</span>
        <p class="vix-note">${vi.note}</p>
      </div>
    </div>
    <div class="glass-card context-card ema-card">
      <div class="ema-header">
        <h3 class="label-caps text-muted">NIFTY vs 200 EMA</h3>
        <span class="ema-direction data-sm" style="color:${above?'var(--secondary)':'var(--error)'}">${above?'ABOVE ↑':'BELOW ↓'}</span>
      </div>
      <div class="ema-values">
        <div><p>Current</p><span class="data-md">${fmtINR(mc.niftyPrice)}</span></div>
        <div class="ema-divider"></div>
        <div><p>200 EMA</p><span class="data-md text-muted">${fmtINR(mc.nifty200EMA)}</span></div>
      </div>
    </div>`;
}

function renderSummaryStats() {
  const m = DATA.metadata, cands = DATA.candidates;
  const fno = cands.filter(c=>c.isFnO).length;
  const bulk = cands.filter(c=>c.bulkDealCount>0).length;
  const items = [
    {label:'SCANNED',value:m.totalScanned,color:'var(--primary)'},
    {label:'CANDIDATES',value:cands.length,color:'var(--secondary)'},
    {label:'F&O ACTIVE',value:fno,color:'var(--primary-container)'},
    {label:'BULK DEALS',value:m.bulkDealStocksAcrossNSE||bulk,color:'var(--on-surface-variant)'}
  ];
  document.getElementById('summary-stats').innerHTML = items.map(i=>`
    <div class="glass-card stat-card" style="border-left-color:${i.color}">
      <p class="label-caps text-muted stat-label">${i.label}</p>
      <p class="stat-value">${i.value}</p>
    </div>`).join('');
}

function renderSpotlight() {
  const top = DATA.candidates.slice(0,2);
  document.getElementById('spotlight').innerHTML = top.map(c => {
    const sc = scoreClass(c.score);
    const clr = scoreColor(c.score);
    const chg = c.tradePlan ? ((c.tradePlan.entry-c.price)/c.price*100) : 0;
    return `
    <div class="glass-card spot-card" style="border-top-color:${clr}" onclick="scrollToSymbol('${c.symbol}')">
      <div class="spot-header">
        <div class="spot-symbol-group">
          <div class="spot-avatar">${c.symbol[0]}</div>
          <div><h4 class="title-sm">${c.symbol}</h4><p class="spot-name">${c.symbol}</p></div>
        </div>
        <div class="spot-price-group">
          <span class="data-lg">${fmtINR(c.price)}</span>
          <p class="spot-change" style="color:${chg>=0?'var(--secondary)':'var(--error)'}">
            ${chg>=0?'+':''}${fmt(chg,1)}% to Entry</p>
        </div>
      </div>
      <div class="score-section">
        <div class="score-header">
          <span class="label-caps text-muted">BREAKOUT SCORE</span>
          <span class="data-md" style="color:${clr}">${fmt(c.score,1)}</span>
        </div>
        <div class="score-track"><div class="score-fill" style="width:${c.score}%;background:linear-gradient(90deg,${clr}80,${clr})"></div></div>
      </div>
      <div class="spot-footer">
        <span class="signal-badge">${c.signalsHit}/${c.totalSignals} SIGNALS</span>
        <span class="details-link">DETAILS <span class="material-symbols-outlined" style="font-size:16px">arrow_forward</span></span>
      </div>
    </div>`;
  }).join('') + `
    <div class="glass-card promo-card" style="border-radius:var(--r-md)">
      <h4>PRO TERMINAL</h4>
      <p class="body-md">Get real-time execution alerts and deep liquidity analysis.</p>
      <button class="btn-promo">UPGRADE NOW</button>
    </div>`;
}

function scrollToSymbol(sym) {
  expanded = sym; renderTable();
  const row = document.querySelector(`[data-symbol="${sym}"]`);
  if(row) row.scrollIntoView({behavior:'smooth', block:'center'});
}

function getFilteredSorted() {
  let list = [...DATA.candidates];
  if(filterText) list = list.filter(c=>c.symbol.toLowerCase().includes(filterText.toLowerCase()));
  list.sort((a,b)=>{
    let va=a[sortField], vb=b[sortField];
    if(sortField==='symbol') return sortDir==='asc'?va.localeCompare(vb):vb.localeCompare(va);
    return sortDir==='asc'?(va-vb):(vb-va);
  });
  return list;
}

function renderTable() {
  const allFiltered = getFilteredSorted();
  const totalPages = Math.ceil(allFiltered.length/PAGE_SIZE);
  if(currentPage>totalPages) currentPage=totalPages||1;
  const paged = allFiltered.slice((currentPage-1)*PAGE_SIZE, currentPage*PAGE_SIZE);

  const cols = [
    {key:'rank',label:'RANK',sortable:false},
    {key:'symbol',label:'SYMBOL',sortable:true},
    {key:'price',label:'PRICE',sortable:true},
    {key:'score',label:'SCORE',sortable:true},
    {key:'signalsHit',label:'SIGNALS',sortable:true},
    {key:'rsi',label:'RSI',sortable:true,center:true},
    {key:'adx',label:'ADX',sortable:true,center:true},
    {key:'deliveryPct',label:'DEL %',sortable:true,center:true},
    {key:'pcr',label:'PCR',sortable:true,center:true},
    {key:'expand',label:'',sortable:false}
  ];

  let html = `
    <div class="table-header">
      <h2 class="title-sm">Candidate Screening Table</h2>
      <div class="table-controls">
        <div class="search-wrapper">
          <span class="material-symbols-outlined">search</span>
          <input class="search-input" id="table-search" placeholder="Quick Filter..." value="${filterText}">
        </div>
      </div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr>${cols.map(c=>{
        const sorted = c.key===sortField;
        const arrow = sorted?(sortDir==='asc'?'↑':'↓'):'';
        return `<th class="${sorted?'sorted':''} ${c.center?'center':''}" ${c.sortable?`onclick="handleSort('${c.key}')"`:''}>${c.label}${arrow?`<span class="sort-arrow">${arrow}</span>`:''}</th>`;
      }).join('')}</tr></thead>
      <tbody>`;

  const startRank = (currentPage-1)*PAGE_SIZE;
  paged.forEach((c,i) => {
    const rank = startRank+i+1;
    const isExp = expanded===c.symbol;
    const clr = scoreColor(c.score);
    const ri = rsiInfo(c.rsi);
    const pcr = c.isFnO&&c.oiMetrics ? fmt(c.oiMetrics.pcr,2) : '—';
    html += `<tr class="${isExp?'expanded-parent':''}" data-symbol="${c.symbol}" onclick="toggleExpand('${c.symbol}')">
      <td class="data-md">${String(rank).padStart(2,'0')}</td>
      <td><div class="symbol-cell"><span class="symbol-name">${c.symbol}</span>${c.isFnO?'<div class="fno-dot" title="F&O Active"></div>':''}</div></td>
      <td class="data-md">${fmtINR(c.price)}</td>
      <td><div class="score-bar-cell"><div class="mini-bar"><div class="mini-bar-fill" style="width:${c.score}%;background:${clr}"></div></div><span class="data-sm" style="color:${clr}">${fmt(c.score,1)}</span></div></td>
      <td class="data-sm">${c.signalsHit}/${c.totalSignals}</td>
      <td style="text-align:center"><span class="rsi-badge" style="background:${ri.cls==='active'?'rgba(125,255,162,0.1)':ri.cls==='warn'?'rgba(255,184,123,0.1)':'rgba(255,255,255,0.05)'};color:${ri.color}">${fmt(c.rsi,1)}</span></td>
      <td class="data-sm" style="text-align:center">${fmt(c.adx,1)}</td>
      <td class="data-sm" style="text-align:center">${fmt(c.deliveryPct,1)}%</td>
      <td class="data-sm" style="text-align:center">${pcr}</td>
      <td style="text-align:right"><span class="material-symbols-outlined expand-icon">${isExp?'keyboard_arrow_up':'keyboard_arrow_down'}</span></td>
    </tr>`;
    if(isExp) html += renderExpandedRow(c);
  });

  html += `</tbody></table></div>
    <div class="table-footer">
      <p class="table-footer-info">Showing ${paged.length} of ${allFiltered.length} candidates from ${DATA.metadata.totalScanned} scanned equities</p>
      <div class="pagination">${renderPagination(totalPages)}</div>
    </div>`;

  document.getElementById('screening-table').innerHTML = html;
  document.getElementById('table-search').addEventListener('input', e=>{filterText=e.target.value;currentPage=1;renderTable();});
}

function renderPagination(total) {
  if(total<=1) return '';
  let h='';
  if(currentPage>1) h+=`<button class="page-btn" onclick="event.stopPropagation();goPage(${currentPage-1})">Prev</button>`;
  for(let i=1;i<=total;i++) h+=`<button class="page-btn ${i===currentPage?'active':''}" onclick="event.stopPropagation();goPage(${i})">${i}</button>`;
  if(currentPage<total) h+=`<button class="page-btn" onclick="event.stopPropagation();goPage(${currentPage+1})">Next</button>`;
  return h;
}
function goPage(p){currentPage=p;renderTable();}
function handleSort(field){
  if(sortField===field) sortDir=sortDir==='asc'?'desc':'asc';
  else{sortField=field;sortDir=field==='symbol'?'asc':'desc';}
  currentPage=1;renderTable();
}
function toggleExpand(sym){expanded=expanded===sym?null:sym;renderTable();}

function renderExpandedRow(c) {
  const tp = c.tradePlan;
  const pctFromCurrent = p => ((p-c.price)/c.price*100);
  const metrics = getMetrics(c);
  const calcId = 'calc-'+c.symbol;

  return `<tr class="expanded-row"><td colspan="10"><div class="expanded-content"><div class="expanded-grid">
    <div>
      <h5 class="expanded-section-title">TARGET LADDER</h5>
      <div class="ladder">
        <div class="ladder-step"><div class="ladder-dot" style="background:var(--secondary)">T3</div><span class="ladder-price">${fmtINR(tp.tp3)}</span><span class="ladder-pct" style="color:var(--secondary)">+${fmt(pctFromCurrent(tp.tp3),1)}%</span></div>
        <div class="ladder-step"><div class="ladder-dot" style="background:rgba(125,255,162,0.6)">T2</div><span class="ladder-price">${fmtINR(tp.tp2)}</span><span class="ladder-pct" style="color:var(--secondary)">+${fmt(pctFromCurrent(tp.tp2),1)}%</span></div>
        <div class="ladder-step"><div class="ladder-dot" style="background:rgba(125,255,162,0.35)">T1</div><span class="ladder-price">${fmtINR(tp.tp1)}</span><span class="ladder-pct" style="color:var(--secondary)">+${fmt(pctFromCurrent(tp.tp1),1)}%</span></div>
        <div class="ladder-step"><div class="ladder-dot" style="background:var(--primary)">EN</div><span class="ladder-price" style="color:var(--primary)">${fmtINR(tp.entry)}</span><span class="ladder-pct text-muted">+${fmt(pctFromCurrent(tp.entry),1)}%</span></div>
        <div class="ladder-step"><div class="ladder-dot" style="background:var(--error)">SL</div><span class="ladder-price" style="color:var(--error)">${fmtINR(tp.stopLoss)}</span><span class="ladder-pct" style="color:var(--error)">${fmt(pctFromCurrent(tp.stopLoss),1)}%</span></div>
      </div>
    </div>
    <div>
      <h5 class="expanded-section-title">KEY METRICS</h5>
      <div class="metrics-grid">${metrics.map(m=>`
        <div class="metric-chip ${m.cls}">
          <div class="chip-header">
            <span class="chip-label"><span class="material-symbols-outlined" style="font-size:12px;color:${m.iconColor}">${m.icon}</span>${m.label}</span>
            <span class="chip-value" style="color:${m.valColor}">${m.value}</span>
          </div>
          <div class="chip-sub" style="color:${m.subColor}">${m.sub}</div>
        </div>`).join('')}
      </div>
      <div class="ai-summary">"${generateSummary(c)}"</div>
    </div>
    <div>
      <h5 class="expanded-section-title text-primary">SMART SIZING CALCULATOR</h5>
      <div class="calc-card">
        <div class="calc-row"><label>Capital</label><input class="calc-input" id="${calcId}-cap" value="1,00,000" onchange="recalc('${c.symbol}')"></div>
        <div class="calc-row"><label>Risk (1%)</label><span class="data-md text-error" id="${calcId}-risk">${fmtINR(1000)}</span></div>
        <div class="calc-divider"></div>
        <div class="calc-row"><label style="font-weight:700">RECOMMENDED QTY</label><span class="calc-result" id="${calcId}-qty">${Math.floor(1000/tp.riskPerShare)} Shares</span></div>
        <button class="btn-execute" onclick="event.stopPropagation()">EXECUTE TRADE</button>
      </div>
    </div>
  </div></div></td></tr>`;
}

function recalc(sym) {
  const c = DATA.candidates.find(x=>x.symbol===sym);
  if(!c) return;
  const calcId='calc-'+sym;
  const raw = document.getElementById(calcId+'-cap').value.replace(/[^0-9]/g,'');
  const cap = parseInt(raw)||100000;
  const risk = cap*0.01;
  const qty = Math.floor(risk/c.tradePlan.riskPerShare);
  document.getElementById(calcId+'-risk').textContent = fmtINR(risk);
  document.getElementById(calcId+'-qty').textContent = qty+' Shares';
}

function getMetrics(c) {
  const rsi = rsiInfo(c.rsi);
  const adxOk = c.adx>=25;
  const nearHigh = c.pctFrom52wHigh<=5;
  const highDel = c.deliveryPct>=40;
  const hasOI = c.isFnO && c.oiMetrics;
  const oiBullish = hasOI && c.oiMetrics.putOIChangePct > c.oiMetrics.callOIChangePct;
  return [
    {label:'RSI',value:fmt(c.rsi,1),cls:rsi.cls,icon:rsi.cls==='active'?'check':'remove',iconColor:rsi.color,valColor:rsi.color,sub:rsi.label,subColor:rsi.color},
    {label:'ADX',value:fmt(c.adx,1),cls:adxOk?'active':'inactive',icon:adxOk?'check':'remove',iconColor:adxOk?'var(--secondary)':'var(--on-surface-variant)',valColor:adxOk?'var(--secondary)':'var(--on-surface-variant)',sub:adxOk?'Trending':'Weak Trend',subColor:adxOk?'var(--secondary)':'var(--on-surface-variant)'},
    {label:'52W High',value:fmt(c.pctFrom52wHigh,1)+'%',cls:nearHigh?'active':'inactive',icon:nearHigh?'check':'remove',iconColor:nearHigh?'var(--secondary)':'var(--on-surface-variant)',valColor:nearHigh?'var(--secondary)':'var(--on-surface-variant)',sub:nearHigh?'Near High':'Far From High',subColor:nearHigh?'var(--secondary)':'var(--on-surface-variant)'},
    {label:'Delivery',value:fmt(c.deliveryPct,1)+'%',cls:highDel?'active':'inactive',icon:highDel?'check':'remove',iconColor:highDel?'var(--secondary)':'var(--on-surface-variant)',valColor:highDel?'var(--secondary)':'var(--on-surface-variant)',sub:highDel?'Institutional':'Low Delivery',subColor:highDel?'var(--secondary)':'var(--on-surface-variant)'},
    {label:'OI Data',value:hasOI?fmt(c.oiMetrics.pcr,2):'N/A',cls:hasOI?(oiBullish?'active':'warn'):'inactive',icon:hasOI?(oiBullish?'check':'warning'):'remove',iconColor:hasOI?(oiBullish?'var(--secondary)':'var(--tertiary)'):'var(--on-surface-variant)',valColor:hasOI?(oiBullish?'var(--secondary)':'var(--tertiary)'):'var(--on-surface-variant)',sub:hasOI?(oiBullish?'Put Writing':'Call Writing'):'No F&O',subColor:hasOI?(oiBullish?'var(--secondary)':'var(--tertiary)'):'var(--on-surface-variant)'},
    {label:'ATR',value:fmt(c.tradePlan.atr,2),cls:'inactive',icon:'show_chart',iconColor:'var(--on-surface-variant)',valColor:'var(--on-surface)',sub:'Volatility',subColor:'var(--on-surface-variant)'},
  ];
}

function generateSummary(c) {
  const near52 = c.pctFrom52wHigh<=5;
  const strongAdx = c.adx>=30;
  const rsiSweet = c.rsi>=50&&c.rsi<=75;
  let parts = [];
  if(near52) parts.push(`within ${fmt(c.pctFrom52wHigh,1)}% of 52-week high (₹${fmtInt(c.high52w)})`);
  if(strongAdx) parts.push(`ADX at ${fmt(c.adx,1)} indicates strong trending momentum`);
  if(rsiSweet) parts.push(`RSI in sweet spot at ${fmt(c.rsi,1)}`);
  if(c.deliveryPct>=45) parts.push(`delivery at ${fmt(c.deliveryPct,1)}% suggests institutional interest`);
  if(c.isFnO&&c.oiMetrics&&c.oiMetrics.putOIChangePct>c.oiMetrics.callOIChangePct) parts.push('put OI build-up signals bullish undertone');
  if(!parts.length) parts.push(`Score ${fmt(c.score,1)} with ${c.signalsHit}/${c.totalSignals} signals. Entry at ${fmtINR(c.tradePlan.entry)}`);
  return `${c.symbol}: ${parts.join('. ')}. Risk/reward favors ${fmt(c.tradePlan.tp1-c.tradePlan.entry,0)}pt upside vs ${fmt(c.tradePlan.entry-c.tradePlan.stopLoss,0)}pt downside.`;
}
