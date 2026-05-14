/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║        NSE BREAKOUT SCREENER v2.2 (Node.js)                ║
 * ║   Direct NSE India data · No Yahoo Finance dependency      ║
 * ║   Powered by stock-nse-india npm package                   ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * This screener pulls data directly from NSE India's servers,
 * giving you access to:
 *   - Real-time OHLCV + delivery % + trade info
 *   - 52-week high/low from NSE (not computed)
 *   - Index constituents (auto-fetch Nifty 50/500 etc.)
 *   - Option chain data for OI-based signals
 *
 * Signals:
 *   1.  Bollinger Band Squeeze     — volatility compression
 *   2.  Volume Surge               — unusual volume spike
 *   3.  Volume Accumulation Trend  — rising volume
 *   4.  RSI Sweet Spot             — strong but not overbought
 *   5.  ADX Trend Formation        — directional movement
 *   6.  52-Week High Proximity     — near breakout zone
 *   7.  EMA Bullish Alignment      — healthy trend structure
 *   8.  Tight Consolidation        — coiled price range
 *   9.  Option Chain OI Overlay    — smart money positioning (F&O only)
 *   10. Delivery % Spike           — institutional accumulation footprint
 *   11. Relative Strength vs Nifty — outperforming the benchmark
 *   12. Block Deal Clustering      — repeated bulk deals = institutional activity
 *
 * Plus Market Context Gate:
 *   - India VIX level (low/moderate/high)
 *   - Nifty 50 vs 200 EMA (bullish/bearish trend)
 *
 * Plus Trade Plan for each candidate:
 *   - Entry, Stop-Loss (ATR/swing/EMA), Take-Profit (1.5R/2.5R/4R)
 *   - Position sizing based on % risk of capital
 *
 * Usage:
 *   node screener.mjs                              # Scan Nifty 200
 *   node screener.mjs --index "NIFTY 50"           # Scan specific index
 *   node screener.mjs --symbols RELIANCE,TCS,INFY  # Scan specific stocks
 *   node screener.mjs --no-oi                      # Skip OI (faster)
 */

import { NseIndia } from "stock-nse-india";
import {
  BollingerBands,
  RSI,
  ADX,
  EMA,
  SMA,
  ATR,
} from "technicalindicators";
import { writeFileSync } from "fs";

// ──────────────────────────────────────────────────────────────
// CONFIGURATION — All tuneable parameters in one place
// ──────────────────────────────────────────────────────────────

const CONFIG = {
  // ── Data Filters ──
  minPrice: 50,            // Skip stocks below ₹50
  maxPrice: 50000,         // Upper price cap
  minAvgVolume: 100_000,   // Minimum 20-day avg volume

  // ── Bollinger Band Squeeze ──
  bbPeriod: 20,
  bbStdDev: 2,
  squeezePercentile: 20,   // Bandwidth in bottom X% of its history

  // ── RSI ──
  rsiPeriod: 14,
  rsiMin: 50,              // Not weak
  rsiMax: 75,              // Not overbought

  // ── ADX ──
  adxPeriod: 14,
  adxThreshold: 20,        // Trend forming above this

  // ── Volume ──
  volumeSurgeMultiplier: 1.5,  // Recent vol vs 20-day avg
  volumeTrendDays: 10,         // Window for accumulation check

  // ── 52-Week High Proximity ──
  highProximityPct: 5,     // Within X% of 52-week high

  // ── Consolidation ──
  consolidationDays: 15,
  consolidationRangePct: 8,

  // ── EMAs ──
  emaShort: 20,
  emaMedium: 50,
  emaLong: 200,

  // ── Option Chain OI (F&O stocks only) ──
  oiEnabled: true,               // Set false to skip OI fetch entirely (faster scans)
  oiStrikesAboveATM: 3,          // How many strikes above ATM to check for call OI
  oiStrikesBelowATM: 3,          // How many strikes below ATM to check for put OI
  oiCallOIDeclineThreshold: -5,  // % change in call OI at resistance = short covering
  oiPutOIRiseThreshold: 5,       // % change in put OI at support = put writing support
  oiPCRBullishMin: 0.7,          // PCR above this near ATM = bullish positioning
  oiPCRBullishMax: 1.5,          // PCR above this = too bearish (panic puts)

  // ── Delivery % (institutional footprint) ──
  deliveryPctThreshold: 50,      // Delivery % above this = institutional interest
  deliveryPctHighBar: 65,        // Above this = strong institutional accumulation

  // ── Relative Strength vs Nifty 50 ──
  rsLookbackDays: 20,            // Compare RS ratio now vs N days ago
  rsMinOutperformance: 2,        // Stock must outperform Nifty by at least X% over lookback

  // ── ATR (for trade plan calculations) ──
  atrPeriod: 14,

  // ── Trade Plan ──
  // How entry, stop-loss, and take-profit levels are computed
  tradePlan: {
    // Entry: triggered when price closes above the N-day consolidation high
    entryBufferPct: 0.2,          // Add 0.2% above consolidation high as entry trigger

    // Stop-Loss methods — picks the tightest sensible stop
    slMethod: "atr",              // "atr" | "swing" | "ema"
    slAtrMultiplier: 1.5,         // SL = entry - (ATR × multiplier)
    slSwingLookback: 10,          // Look back N days for swing low
    slMaxPct: 5,                  // Never risk more than 5% on a single trade

    // Take-Profit: based on risk-reward ratios
    tpRatios: [1.5, 2.5, 4],     // TP1 = 1.5R, TP2 = 2.5R, TP3 = 4R
    // R = distance from entry to stop-loss (your risk per share)

    // Trailing stop guidance
    trailAfterTP1: true,          // After TP1 hit, trail SL to breakeven
  },

  // ── Market Context Gate (NEW) ──
  // Filters the entire scan based on broader market health
  marketContext: {
    enabled: true,                // Set false to skip context check
    vixLowThreshold: 14,          // VIX below this = ideal breakout environment
    vixHighThreshold: 20,         // VIX above this = elevated fear, breakouts risky
    niftyEmaPeriod: 200,          // EMA period for Nifty trend check
    niftyProxySymbol: "NIFTYBEES", // ETF that tracks Nifty 50 (for historical EMA)
    blockScanOnBearish: false,    // If true, refuse to scan in bearish conditions (use --force to override)
  },

  // ── Block Deal Clustering (Signal 12) ──
  blockDeals: {
    enabled: true,                // Set false to skip bulk deal fetch
    lookbackDays: 15,             // Calendar days to look back (~10 trading days)
    minDealsForSignal: 2,         // Minimum deals to fire signal
    minDealsForStrong: 3,         // Minimum deals for "strong" label
  },

  // ── Scoring Weights ──
  // Core signals (always active): sum to base weight pool
  // OI signal: only for F&O stocks; excluded from denominator for non-F&O
  weights: {
    bbSqueeze:       16,
    volumeSurge:     12,
    volumeRising:     7,
    rsiStrength:      7,
    adxTrending:     12,
    near52wHigh:     12,
    emaAlignment:     7,
    consolidation:    3,
    deliveryPct:     10,    // Signal 10: institutional accumulation
    relStrength:      7,    // Signal 11: outperforming Nifty 50
    blockDeals:       7,    // Signal 12: institutional block deal clustering
    oiSignal:        10,    // Signal 9:  F&O only; excluded for non-F&O
  },

  // ── Output ──
  topN: 25,

  // ── Rate Limiting ──
  // NSE blocks rapid requests; this delay (ms) is between each stock fetch
  delayBetweenRequests: 1500,

  // ── Default index to scan when no args given ──
  defaultIndex: "NIFTY 200",
};


// ──────────────────────────────────────────────────────────────
// NSE CLIENT — Single instance, reuses cookies/session
// ──────────────────────────────────────────────────────────────

const nse = new NseIndia();


// ──────────────────────────────────────────────────────────────
// HELPER: Sleep for rate limiting
// ──────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


// ──────────────────────────────────────────────────────────────
// HELPER: Parse CLI arguments
// ──────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { index: null, symbols: null, noOi: false, force: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--index" && args[i + 1]) {
      result.index = args[i + 1];
      i++;
    } else if (args[i] === "--symbols" && args[i + 1]) {
      result.symbols = args[i + 1].split(",").map((s) => s.trim().toUpperCase());
      i++;
    } else if (args[i] === "--no-oi") {
      result.noOi = true;
    } else if (args[i] === "--force") {
      result.force = true;
    }
  }

  return result;
}


// ──────────────────────────────────────────────────────────────
// STEP 1: Get stock list from NSE index
// ──────────────────────────────────────────────────────────────

async function getStockList(indexName) {
  console.log(`  📡 Fetching constituents of ${indexName}...`);

  try {
    const indexData = await nse.getEquityStockIndices(indexName);

    if (!indexData || !indexData.data) {
      throw new Error("No data returned from NSE");
    }

    // indexData.data is an array of stocks in the index
    // First item is usually the index itself, rest are constituents
    const stocks = indexData.data
      .filter((item) => item.symbol && item.symbol !== indexName)
      .map((item) => item.symbol);

    console.log(`  ✅ Found ${stocks.length} stocks in ${indexName}\n`);
    return stocks;
  } catch (err) {
    console.error(`  ❌ Failed to fetch index: ${err.message}`);
    console.log("  ℹ️  Falling back to Nifty 50...\n");

    // Fallback: try Nifty 50
    try {
      const fallback = await nse.getEquityStockIndices("NIFTY 50");
      return fallback.data
        .filter((item) => item.symbol && item.symbol !== "NIFTY 50")
        .map((item) => item.symbol);
    } catch {
      console.error("  ❌ Fallback also failed. Check your network connection.");
      process.exit(1);
    }
  }
}


// ──────────────────────────────────────────────────────────────
// STEP 2: Fetch historical data for a stock
// ──────────────────────────────────────────────────────────────

async function fetchHistoricalData(symbol) {
  /**
   * NSE's historical API returns data for the specified date range.
   * We fetch ~1 year to have enough data for 200 EMA + other indicators.
   *
   * Response shape (EquityHistoricalInfo):
   *   chSymbol, chOpeningPrice, chTradeHighPrice, chTradeLowPrice,
   *   chClosingPrice, chTotTradedQty, ch52WeekHighPrice, ch52WeekLowPrice,
   *   vwap, mtimestamp
   */
  const end = new Date();
  const start = new Date();
  start.setFullYear(end.getFullYear() - 1);

  try {
    const chunks = await nse.getEquityHistoricalData(symbol, {
      start,
      end,
    });

    // getEquityHistoricalData returns EquityHistoricalData[] — an array of
    // date-range chunks, each with a .data array of EquityHistoricalInfo.
    // Flatten all chunks into a single array.
    if (!chunks || !Array.isArray(chunks) || chunks.length === 0) {
      return null;
    }

    const allData = chunks.flatMap((chunk) => chunk.data || []);

    if (allData.length < 100) {
      return null;
    }

    // Sort by date ascending (oldest first) for indicator calculation
    // Accept EQ/BE series, or rows where chSeries is missing
    const sorted = allData
      .filter((d) => !d.chSeries || d.chSeries === "EQ" || d.chSeries === "BE")
      .sort(
        (a, b) =>
          new Date(a.mtimestamp).getTime() - new Date(b.mtimestamp).getTime()
      );

    if (sorted.length < 100) return null;

    return sorted;
  } catch {
    return null;
  }
}


// ──────────────────────────────────────────────────────────────
// STEP 2b: Fetch & analyze option chain OI for F&O stocks
// ──────────────────────────────────────────────────────────────

async function fetchOptionChain(symbol) {
  /**
   * Fetches option chain from NSE for F&O-eligible stocks.
   * Returns null for non-F&O stocks (API will error out).
   *
   * Response shape (EquityOptionChainData):
   *   data: EquityOptionChainItem[]
   *   Each item: { strikePrice, optionType (CE/PE), openInterest,
   *     changeinOpenInterest, pchangeinOpenInterest, underlyingValue, ... }
   */
  if (!CONFIG.oiEnabled) return null;

  try {
    const result = await nse.getEquityOptionChain(symbol);

    if (!result || !result.data || result.data.length === 0) {
      return null;
    }

    return result;
  } catch {
    // Non-F&O stocks will throw; that's expected
    return null;
  }
}


function analyzeOI(optionChainData, currentPrice) {
  /**
   * Analyze option chain OI data for breakout signals.
   *
   * Three sub-signals combined:
   *   A) Short covering at resistance — call OI declining above ATM
   *   B) Put writing support          — put OI increasing at/below ATM
   *   C) PCR near ATM                 — bullish positioning ratio
   *
   * Returns: { hit, detail, subSignals: { shortCovering, putWriting, pcrBullish } }
   */
  const items = optionChainData.data;

  // Get underlying value from the data (spot price)
  const spot = items[0]?.underlyingValue || currentPrice;

  // Get nearest expiry only (front-month has most meaningful OI)
  const allExpiries = [...new Set(items.map((i) => i.expiryDate))].sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime()
  );
  const nearestExpiry = allExpiries[0];

  if (!nearestExpiry) {
    return { hit: false, detail: "No expiry data", subSignals: {} };
  }

  // Filter to nearest expiry
  const frontMonth = items.filter((i) => i.expiryDate === nearestExpiry);

  // Separate calls and puts
  const calls = frontMonth.filter((i) => i.optionType === "CE");
  const puts = frontMonth.filter((i) => i.optionType === "PE");

  if (calls.length === 0 || puts.length === 0) {
    return { hit: false, detail: "Incomplete chain", subSignals: {} };
  }

  // Find ATM strike (closest to spot)
  const allStrikes = [...new Set(frontMonth.map((i) => parseFloat(i.strikePrice)))].sort(
    (a, b) => a - b
  );
  const atmStrike = allStrikes.reduce((prev, curr) =>
    Math.abs(curr - spot) < Math.abs(prev - spot) ? curr : prev
  );
  const atmIndex = allStrikes.indexOf(atmStrike);

  // ── Sub-signal A: Short Covering at Resistance ──
  // Check call OI change at ATM and strikes above ATM
  // Negative changeinOpenInterest on calls = shorts are covering
  const strikesAbove = allStrikes.slice(
    atmIndex,
    atmIndex + CONFIG.oiStrikesAboveATM + 1
  );
  const callsAboveATM = calls.filter((c) =>
    strikesAbove.includes(parseFloat(c.strikePrice))
  );

  let callOIChangeSum = 0;
  let callOITotalAbove = 0;
  for (const c of callsAboveATM) {
    callOIChangeSum += c.changeinOpenInterest || 0;
    callOITotalAbove += c.openInterest || 0;
  }
  const callOIChangePct =
    callOITotalAbove > 0 ? (callOIChangeSum / callOITotalAbove) * 100 : 0;
  const shortCovering = callOIChangePct <= CONFIG.oiCallOIDeclineThreshold;

  // ── Sub-signal B: Put Writing Support ──
  // Check put OI change at ATM and strikes below ATM
  // Positive changeinOpenInterest on puts = writers selling puts = support floor
  const strikesBelow = allStrikes.slice(
    Math.max(0, atmIndex - CONFIG.oiStrikesBelowATM),
    atmIndex + 1
  );
  const putsBelowATM = puts.filter((p) =>
    strikesBelow.includes(parseFloat(p.strikePrice))
  );

  let putOIChangeSum = 0;
  let putOITotalBelow = 0;
  for (const p of putsBelowATM) {
    putOIChangeSum += p.changeinOpenInterest || 0;
    putOITotalBelow += p.openInterest || 0;
  }
  const putOIChangePct =
    putOITotalBelow > 0 ? (putOIChangeSum / putOITotalBelow) * 100 : 0;
  const putWriting = putOIChangePct >= CONFIG.oiPutOIRiseThreshold;

  // ── Sub-signal C: PCR near ATM ──
  // PCR = Total Put OI / Total Call OI (near ATM strikes)
  // Healthy bullish PCR: 0.7 - 1.5
  const nearATMStrikes = allStrikes.slice(
    Math.max(0, atmIndex - CONFIG.oiStrikesBelowATM),
    atmIndex + CONFIG.oiStrikesAboveATM + 1
  );
  const nearCalls = calls.filter((c) =>
    nearATMStrikes.includes(parseFloat(c.strikePrice))
  );
  const nearPuts = puts.filter((p) =>
    nearATMStrikes.includes(parseFloat(p.strikePrice))
  );

  const totalCallOI = nearCalls.reduce((sum, c) => sum + (c.openInterest || 0), 0);
  const totalPutOI = nearPuts.reduce((sum, p) => sum + (p.openInterest || 0), 0);
  const pcr = totalCallOI > 0 ? totalPutOI / totalCallOI : 0;
  const pcrBullish =
    pcr >= CONFIG.oiPCRBullishMin && pcr <= CONFIG.oiPCRBullishMax;

  // ── Combine: signal hits if at least 2 of 3 sub-signals fire ──
  const subHits = [shortCovering, putWriting, pcrBullish].filter(Boolean).length;
  const hit = subHits >= 2;

  const detailParts = [];
  detailParts.push(
    `Call OI Δ: ${callOIChangePct >= 0 ? "+" : ""}${callOIChangePct.toFixed(1)}%${shortCovering ? " (covering)" : ""}`
  );
  detailParts.push(
    `Put OI Δ: ${putOIChangePct >= 0 ? "+" : ""}${putOIChangePct.toFixed(1)}%${putWriting ? " (writing)" : ""}`
  );
  detailParts.push(
    `PCR: ${pcr.toFixed(2)}${pcrBullish ? " (bullish)" : ""}`
  );
  detailParts.push(`[${subHits}/3 sub-signals]`);

  return {
    hit,
    detail: detailParts.join(" | "),
    subSignals: { shortCovering, putWriting, pcrBullish },
    metrics: { callOIChangePct, putOIChangePct, pcr, atmStrike },
  };
}


// ──────────────────────────────────────────────────────────────
// STEP 2c: Fetch Nifty 50 historical data (once, for RS calc)
// ──────────────────────────────────────────────────────────────

async function fetchNiftyHistorical() {
  /**
   * Fetches ~1 year of Nifty 50 index historical data.
   * Called once at startup and shared across all stock analyses
   * to compute Relative Strength ratios.
   *
   * Uses getEquityHistoricalData with "NIFTY 50" symbol —
   * but Nifty is an index, not equity. So we use index intraday
   * or fall back to fetching the index constituents' aggregate data.
   *
   * Approach: fetch historical data via getIndexIntradayData for
   * recent data, but for RS we actually need multi-day closes.
   * Simplest reliable path: fetch Nifty Bees (NIFTYBEES) ETF as proxy,
   * OR use the NIFTY 50 index data from getEquityStockIndices.
   *
   * Best approach: use perChange30d and perChange365d from the
   * index constituents response — the index's own row has these fields.
   */
  console.log("  📡 Fetching Nifty 50 benchmark data...");

  try {
    const indexData = await nse.getEquityStockIndices("NIFTY 50");

    if (!indexData || !indexData.data) {
      console.log("  ⚠️  Could not fetch Nifty 50 data. RS signal will be skipped.\n");
      return null;
    }

    // First item is usually the index itself
    // It has: lastPrice, previousClose, pChange, perChange30d, perChange365d
    const indexRow = indexData.data.find(
      (d) => d.symbol === "NIFTY 50" || d.priority === 0
    ) || indexData.data[0];

    // Also build a map of stock → perChange30d for all constituents
    const stockChanges = {};
    for (const item of indexData.data) {
      if (item.symbol && item.symbol !== "NIFTY 50") {
        stockChanges[item.symbol] = {
          pChange: item.pChange,           // Today's % change
          perChange30d: item.perChange30d, // 30-day % change
        };
      }
    }

    const result = {
      indexPChange: indexRow.pChange,          // Nifty's today % change
      indexPerChange30d: indexRow.perChange30d, // Nifty's 30-day % change
      stockChanges,                            // Per-stock 30d changes (for constituents)
    };

    console.log(
      `  ✅ Nifty 50: ${indexRow.lastPrice} (${indexRow.pChange >= 0 ? "+" : ""}${indexRow.pChange}% today, ${indexRow.perChange30d >= 0 ? "+" : ""}${indexRow.perChange30d}% 30d)\n`
    );

    return result;
  } catch (err) {
    console.log(`  ⚠️  Nifty 50 fetch failed: ${err.message}. RS signal will be skipped.\n`);
    return null;
  }
}


// ──────────────────────────────────────────────────────────────
// STEP 2d: Fetch trade info for delivery % data
// ──────────────────────────────────────────────────────────────

async function fetchTradeInfo(symbol) {
  /**
   * Fetches current trade info including delivery percentage.
   *
   * Response shape (EquityTradeInfo):
   *   securityWiseDP: {
   *     deliveryQuantity, deliveryToTradedQuantity,
   *     quantityTraded, secWiseDelPosDate
   *   }
   *   bulkBlockDeals: [{ name }]
   *   noBlockDeals: boolean
   */
  try {
    const result = await nse.getEquityTradeInfo(symbol);
    if (!result || !result.securityWiseDP) return null;
    return result;
  } catch {
    return null;
  }
}


// ──────────────────────────────────────────────────────────────
// STEP 2e: Fetch Market Context (India VIX + Nifty 200 EMA)
// ──────────────────────────────────────────────────────────────

async function fetchMarketContext() {
  /**
   * Fetches broader market health indicators to gate the entire scan.
   *
   * Two checks:
   *   A) India VIX level — fear gauge
   *      - Below 14: ideal breakout environment
   *      - 14-20: moderate, breakouts possible
   *      - Above 20: elevated fear, breakouts often fail
   *
   *   B) Nifty 50 vs 200 EMA — trend health
   *      - Above 200 EMA: bullish trend, breakouts have tailwind
   *      - Below 200 EMA: bearish trend, breakouts have headwind
   *
   * Uses NIFTYBEES ETF (tracks Nifty 50 with 99%+ correlation) as
   * proxy for historical EMA calculation since direct index history
   * requires a different API endpoint.
   */
  console.log("  📡 Fetching market context (VIX + Nifty 200 EMA)...");

  const context = {
    vix: null,
    vixLevel: "unknown",
    niftyPrice: null,
    nifty200EMA: null,
    niftyAbove200EMA: null,
    marketCondition: "unknown",
    allowScan: true,
  };

  // ── A) Fetch India VIX ──
  try {
    const allIndices = await nse.getAllIndices();

    if (allIndices && allIndices.data) {
      const vixEntry = allIndices.data.find(
        (idx) =>
          idx.index === "INDIA VIX" ||
          idx.indexSymbol === "INDIA VIX" ||
          idx.symbol === "INDIA VIX"
      );

      if (vixEntry) {
        context.vix = vixEntry.last || vixEntry.lastPrice;
        const c = CONFIG.marketContext;
        if (context.vix <= c.vixLowThreshold) context.vixLevel = "low";
        else if (context.vix >= c.vixHighThreshold) context.vixLevel = "high";
        else context.vixLevel = "moderate";
      }
    }
  } catch (err) {
    console.log(`  ⚠️  VIX fetch failed: ${err.message}`);
  }

  // ── B) Fetch NIFTYBEES historical for 200 EMA proxy ──
  try {
    await sleep(800);
    const niftyHistoryData = await fetchHistoricalData(
      CONFIG.marketContext.niftyProxySymbol
    );

    if (niftyHistoryData && niftyHistoryData.length >= CONFIG.marketContext.niftyEmaPeriod) {
      const closes = niftyHistoryData.map((d) => d.chClosingPrice);
      const ema200Array = EMA.calculate({
        values: closes,
        period: CONFIG.marketContext.niftyEmaPeriod,
      });

      context.niftyPrice = closes[closes.length - 1];
      context.nifty200EMA = ema200Array[ema200Array.length - 1];
      context.niftyAbove200EMA = context.niftyPrice > context.nifty200EMA;
    }
  } catch (err) {
    console.log(`  ⚠️  Nifty EMA fetch failed: ${err.message}`);
  }

  // ── Determine overall market condition ──
  const vixOk = context.vixLevel === "low" || context.vixLevel === "moderate";
  const trendOk = context.niftyAbove200EMA === true;

  if (vixOk && trendOk) {
    context.marketCondition = "bullish";
  } else if (!vixOk && !trendOk) {
    context.marketCondition = "bearish";
    context.allowScan = !CONFIG.marketContext.blockScanOnBearish;
  } else if (context.vixLevel === "unknown" || context.niftyAbove200EMA === null) {
    context.marketCondition = "unknown";
  } else {
    context.marketCondition = "neutral";
  }

  // ── Display traffic-light status ──
  const lightEmoji = {
    bullish: "🟢",
    neutral: "🟡",
    bearish: "🔴",
    unknown: "⚪",
  };

  console.log(`  ${lightEmoji[context.marketCondition]} Market: ${context.marketCondition.toUpperCase()}`);
  if (context.vix != null) {
    console.log(`     India VIX: ${context.vix.toFixed(2)} (${context.vixLevel})`);
  }
  if (context.niftyAbove200EMA !== null) {
    const direction = context.niftyAbove200EMA ? "above" : "below";
    console.log(
      `     Nifty: ${context.niftyPrice.toFixed(0)} ${direction} 200 EMA (${context.nifty200EMA.toFixed(0)})`
    );
  }
  console.log();

  return context;
}


// ──────────────────────────────────────────────────────────────
// STEP 2f: Fetch Bulk/Block Deal history for Signal 12
// ──────────────────────────────────────────────────────────────

async function fetchBulkDealHistory() {
  /**
   * Fetches NSE's historical bulk deals for the last N days.
   * Returns a Map<symbol, count> showing how many bulk deals
   * each stock has had in the lookback window.
   *
   * Bulk deals (>0.5% of total shares in one transaction) are
   * a strong institutional accumulation signal when clustered.
   *
   * NSE endpoint: /api/historical/cm/bulk_deals?from=DD-MM-YYYY&to=DD-MM-YYYY
   */
  if (!CONFIG.blockDeals.enabled) {
    return new Map();
  }

  console.log(`  📡 Fetching bulk deal history (last ${CONFIG.blockDeals.lookbackDays} days)...`);

  const dealMap = new Map();

  try {
    const today = new Date();
    const fromDate = new Date(today);
    fromDate.setDate(fromDate.getDate() - CONFIG.blockDeals.lookbackDays);

    const formatDate = (d) =>
      `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;

    const endpoint = `/api/historical/cm/bulk_deals?from=${formatDate(fromDate)}&to=${formatDate(today)}`;

    const result = await nse.getDataByEndpoint(endpoint);

    if (result && result.data && Array.isArray(result.data)) {
      for (const deal of result.data) {
        const symbol = deal.symbol || deal.BD_SYMBOL || deal.SYMBOL;
        if (symbol) {
          dealMap.set(symbol, (dealMap.get(symbol) || 0) + 1);
        }
      }
    }

    console.log(`  ✅ Found bulk deals across ${dealMap.size} unique stocks\n`);
  } catch (err) {
    console.log(`  ⚠️  Bulk deal fetch failed: ${err.message}. Signal 12 will be skipped.\n`);
  }

  return dealMap;
}


function computeIndicators(data) {
  /**
   * Extract OHLCV arrays from NSE historical data,
   * then compute all technical indicators locally.
   */
  const close = data.map((d) => d.chClosingPrice);
  const high = data.map((d) => d.chTradeHighPrice);
  const low = data.map((d) => d.chTradeLowPrice);
  const volume = data.map((d) => d.chTotTradedQty);

  // ── Bollinger Bands ──
  const bb = BollingerBands.calculate({
    period: CONFIG.bbPeriod,
    values: close,
    stdDev: CONFIG.bbStdDev,
  });

  // Compute bandwidth (upper - lower) / middle for each BB point
  const bbBandwidth = bb.map((b) => (b.upper - b.lower) / b.middle);

  // ── RSI ──
  const rsi = RSI.calculate({
    values: close,
    period: CONFIG.rsiPeriod,
  });

  // ── ADX ──
  const adx = ADX.calculate({
    close,
    high,
    low,
    period: CONFIG.adxPeriod,
  });

  // ── EMAs ──
  const emaShort = EMA.calculate({ values: close, period: CONFIG.emaShort });
  const emaMedium = EMA.calculate({ values: close, period: CONFIG.emaMedium });
  const emaLong = EMA.calculate({ values: close, period: CONFIG.emaLong });

  // ── Volume SMA ──
  const volSma20 = SMA.calculate({ values: volume, period: 20 });

  // ── ATR (Average True Range) — for trade plan stop-loss ──
  const atr = ATR.calculate({
    close,
    high,
    low,
    period: CONFIG.atrPeriod,
  });

  return {
    close,
    high,
    low,
    volume,
    bb,
    bbBandwidth,
    rsi,
    adx,
    emaShort,
    emaMedium,
    emaLong,
    volSma20,
    atr,
  };
}


// ──────────────────────────────────────────────────────────────
// TRADE PLAN: Compute entry, stop-loss, and take-profit levels
// ──────────────────────────────────────────────────────────────

function computeTradePlan(data, ind) {
  /**
   * Generates actionable trade levels for each breakout candidate.
   *
   * Entry:
   *   The consolidation high (recent N-day high) + a small buffer.
   *   This is where you place a buy order or watch for a close above.
   *
   * Stop-Loss (3 methods, configurable):
   *   - ATR-based:  Entry - (ATR × multiplier). Adapts to volatility.
   *   - Swing low:  Recent N-day low. Below the consolidation floor.
   *   - EMA-based:  Below the nearest supporting EMA (20 or 50).
   *
   * Take-Profit (risk-reward based):
   *   TP1 = Entry + (risk × 1.5)  — partial exit, move SL to breakeven
   *   TP2 = Entry + (risk × 2.5)  — primary target
   *   TP3 = Entry + (risk × 4.0)  — runner / trend continuation target
   *
   * Returns: { entry, stopLoss, risk, riskPct, tp1, tp2, tp3, rrDescription }
   */
  const tp = CONFIG.tradePlan;
  const n = CONFIG.consolidationDays;
  const close = ind.close;
  const currentPrice = close[close.length - 1];

  // ── Entry: consolidation high + buffer ──
  const recentHigh = Math.max(...ind.high.slice(-n));
  const entryBuffer = recentHigh * (tp.entryBufferPct / 100);
  const entry = Math.round((recentHigh + entryBuffer) * 100) / 100;

  // ── Stop-Loss ──
  let stopLoss;
  let slLabel;

  if (tp.slMethod === "atr" && ind.atr.length > 0) {
    // ATR-based: entry minus ATR × multiplier
    const currentATR = ind.atr[ind.atr.length - 1];
    stopLoss = entry - (currentATR * tp.slAtrMultiplier);
    slLabel = `ATR(${CONFIG.atrPeriod}) × ${tp.slAtrMultiplier}`;

  } else if (tp.slMethod === "ema") {
    // EMA-based: below the nearest supporting EMA
    const ema20 = ind.emaShort.length > 0 ? ind.emaShort[ind.emaShort.length - 1] : null;
    const ema50 = ind.emaMedium.length > 0 ? ind.emaMedium[ind.emaMedium.length - 1] : null;
    // Use the higher EMA that's still below entry (tighter stop)
    if (ema20 && ema20 < entry) {
      stopLoss = ema20 * 0.995; // Just below EMA20
      slLabel = "Below EMA20";
    } else if (ema50 && ema50 < entry) {
      stopLoss = ema50 * 0.995;
      slLabel = "Below EMA50";
    } else {
      // Fallback to swing low
      stopLoss = Math.min(...ind.low.slice(-tp.slSwingLookback));
      slLabel = `${tp.slSwingLookback}d swing low`;
    }

  } else {
    // Swing low: recent N-day low
    stopLoss = Math.min(...ind.low.slice(-tp.slSwingLookback));
    slLabel = `${tp.slSwingLookback}d swing low`;
  }

  stopLoss = Math.round(stopLoss * 100) / 100;

  // ── Sanity check: cap max risk ──
  const riskPct = ((entry - stopLoss) / entry) * 100;
  if (riskPct > tp.slMaxPct) {
    // If risk exceeds max %, tighten the stop
    stopLoss = Math.round(entry * (1 - tp.slMaxPct / 100) * 100) / 100;
    slLabel += ` (capped at ${tp.slMaxPct}%)`;
  }

  // ── Risk per share ──
  const risk = Math.round((entry - stopLoss) * 100) / 100;
  const finalRiskPct = Math.round(((risk / entry) * 100) * 10) / 10;

  // ── Take-Profit levels (R-multiple based) ──
  const targets = tp.tpRatios.map((ratio) => ({
    label: `TP${tp.tpRatios.indexOf(ratio) + 1} (${ratio}R)`,
    price: Math.round((entry + risk * ratio) * 100) / 100,
    pctFromEntry: Math.round((risk * ratio / entry) * 100 * 10) / 10,
  }));

  // ── Position sizing suggestion ──
  // Based on risking 1% of capital
  const capitalExample = 100000; // ₹1,00,000 as example
  const riskAmount = capitalExample * 0.01; // 1% of capital
  const shares = risk > 0 ? Math.floor(riskAmount / risk) : 0;

  return {
    entry,
    stopLoss,
    slLabel,
    risk,
    riskPct: finalRiskPct,
    targets,
    tp1: targets[0]?.price || null,
    tp2: targets[1]?.price || null,
    tp3: targets[2]?.price || null,
    currentPrice,
    distanceToEntry: Math.round(((entry - currentPrice) / currentPrice) * 100 * 10) / 10,
    positionSizing: {
      capitalExample,
      riskPercent: 1,
      shares,
      investmentAmount: shares * entry,
      maxLoss: shares * risk,
    },
    // ATR value for reference
    atr: ind.atr.length > 0 ? Math.round(ind.atr[ind.atr.length - 1] * 100) / 100 : null,
  };
}


// ──────────────────────────────────────────────────────────────
// STEP 4: Signal checks — each returns { hit, detail }
// ──────────────────────────────────────────────────────────────

function checkBBSqueeze(ind) {
  if (ind.bbBandwidth.length < 50) return { hit: false, detail: "Insufficient data" };

  const current = ind.bbBandwidth[ind.bbBandwidth.length - 1];
  const belowCount = ind.bbBandwidth.filter((bw) => bw < current).length;
  const percentile = (belowCount / ind.bbBandwidth.length) * 100;

  return {
    hit: percentile <= CONFIG.squeezePercentile,
    detail: `BW pctl: ${percentile.toFixed(0)}%`,
  };
}

function checkVolumeSurge(ind) {
  if (ind.volSma20.length < 3) return { hit: false, detail: "Insufficient data" };

  // Compare last 3 days' volume to 20-SMA of volume
  const recentVols = ind.volume.slice(-3);
  const avgVol = ind.volSma20[ind.volSma20.length - 1];
  const maxRatio = Math.max(...recentVols.map((v) => v / avgVol));

  return {
    hit: maxRatio >= CONFIG.volumeSurgeMultiplier,
    detail: `Vol ratio: ${maxRatio.toFixed(1)}x`,
  };
}

function checkVolumeRising(ind) {
  const n = CONFIG.volumeTrendDays;
  if (ind.volume.length < n * 2) return { hit: false, detail: "Insufficient data" };

  const recent = ind.volume.slice(-n);
  const prior = ind.volume.slice(-2 * n, -n);
  const recentAvg = recent.reduce((a, b) => a + b, 0) / n;
  const priorAvg = prior.reduce((a, b) => a + b, 0) / n;
  const ratio = priorAvg > 0 ? recentAvg / priorAvg : 0;

  return {
    hit: ratio > 1.15,
    detail: `Vol trend: ${ratio.toFixed(2)}x`,
  };
}

function checkRSI(ind) {
  if (ind.rsi.length === 0) return { hit: false, detail: "No RSI" };

  const current = ind.rsi[ind.rsi.length - 1];
  return {
    hit: current >= CONFIG.rsiMin && current <= CONFIG.rsiMax,
    detail: `RSI: ${current.toFixed(1)}`,
  };
}

function checkADX(ind) {
  if (ind.adx.length === 0) return { hit: false, detail: "No ADX" };

  const latest = ind.adx[ind.adx.length - 1];
  // ADX object has: adx, ppiDI, mdi
  const adxVal = latest.adx;
  const pdi = latest.pdi;
  const mdi = latest.mdi;

  return {
    hit: adxVal >= CONFIG.adxThreshold && pdi > mdi,
    detail: `ADX: ${adxVal.toFixed(1)}, +DI: ${pdi.toFixed(1)}, -DI: ${mdi.toFixed(1)}`,
  };
}

function checkNear52wHigh(data) {
  // NSE historical data includes ch52WeekHighPrice per row
  const latest = data[data.length - 1];
  const close = latest.chClosingPrice;
  const high52w = latest.ch52WeekHighPrice;

  if (!high52w || high52w === 0) return { hit: false, detail: "No 52W data" };

  const pctBelow = ((high52w - close) / high52w) * 100;

  return {
    hit: pctBelow <= CONFIG.highProximityPct,
    detail: `${pctBelow.toFixed(1)}% below 52W high (₹${high52w})`,
  };
}

function checkEMAAlignment(ind) {
  // Check: close > EMA20 > EMA50 > EMA200
  if (
    ind.emaShort.length === 0 ||
    ind.emaMedium.length === 0 ||
    ind.emaLong.length === 0
  )
    return { hit: false, detail: "Insufficient EMA data" };

  const c = ind.close[ind.close.length - 1];
  const es = ind.emaShort[ind.emaShort.length - 1];
  const em = ind.emaMedium[ind.emaMedium.length - 1];
  const el = ind.emaLong[ind.emaLong.length - 1];

  const aligned = c > es && es > em && em > el;

  return {
    hit: aligned,
    detail: `C:${c.toFixed(0)} > E20:${es.toFixed(0)} > E50:${em.toFixed(0)} > E200:${el.toFixed(0)}`,
  };
}

function checkConsolidation(ind) {
  const n = CONFIG.consolidationDays;
  if (ind.high.length < n) return { hit: false, detail: "Insufficient data" };

  const recentHigh = Math.max(...ind.high.slice(-n));
  const recentLow = Math.min(...ind.low.slice(-n));
  const current = ind.close[ind.close.length - 1];
  const rangePct = ((recentHigh - recentLow) / current) * 100;

  return {
    hit: rangePct <= CONFIG.consolidationRangePct,
    detail: `Range: ${rangePct.toFixed(1)}% over ${n}d`,
  };
}


// ──────────────────────────────────────────────────────────────
// SIGNAL 10: Delivery % — institutional accumulation
// ──────────────────────────────────────────────────────────────

function checkDeliveryPct(tradeInfo) {
  /**
   * High delivery % means buyers are taking stock for delivery
   * (not squaring off intraday). Indicates institutional interest.
   *
   * securityWiseDP.deliveryToTradedQuantity is the delivery %
   * directly from NSE (e.g., 62.45 means 62.45%).
   *
   * Above 50%  = notable institutional interest
   * Above 65%  = strong institutional accumulation
   */
  if (!tradeInfo || !tradeInfo.securityWiseDP) {
    return { hit: false, detail: "No delivery data" };
  }

  const dp = tradeInfo.securityWiseDP;
  const deliveryPct = dp.deliveryToTradedQuantity;

  if (deliveryPct == null || isNaN(deliveryPct)) {
    return { hit: false, detail: "No delivery data" };
  }

  const isHigh = deliveryPct >= CONFIG.deliveryPctThreshold;
  const isVeryHigh = deliveryPct >= CONFIG.deliveryPctHighBar;

  const label = isVeryHigh
    ? " (strong accumulation)"
    : isHigh
      ? " (institutional interest)"
      : "";

  return {
    hit: isHigh,
    detail: `Delivery: ${deliveryPct.toFixed(1)}%${label} | Qty: ${(dp.deliveryQuantity || 0).toLocaleString("en-IN")}`,
  };
}


// ──────────────────────────────────────────────────────────────
// SIGNAL 11: Relative Strength vs Nifty 50
// ──────────────────────────────────────────────────────────────

function checkRelativeStrength(stockData, niftyData) {
  /**
   * Compares the stock's 30-day performance against Nifty 50's
   * 30-day performance. If the stock has outperformed by at least
   * rsMinOutperformance %, the signal fires.
   *
   * Why 30d? Short enough to capture recent momentum shift,
   * long enough to filter out 1-2 day noise.
   *
   * Uses data from getEquityStockIndices which provides
   * perChange30d for both the index and its constituents.
   *
   * For stocks NOT in the Nifty 50 constituents list, we compute
   * RS from historical close data instead.
   */
  if (!niftyData) {
    return { hit: false, detail: "No benchmark data" };
  }

  const symbol = stockData[stockData.length - 1].chSymbol;
  const nifty30d = niftyData.indexPerChange30d || 0;

  // First: check if this stock is in Nifty 50 constituents (direct data)
  if (niftyData.stockChanges && niftyData.stockChanges[symbol]) {
    const stock30d = niftyData.stockChanges[symbol].perChange30d || 0;
    const outperformance = stock30d - nifty30d;

    return {
      hit: outperformance >= CONFIG.rsMinOutperformance,
      detail: `Stock 30d: ${stock30d >= 0 ? "+" : ""}${stock30d.toFixed(1)}% vs Nifty: ${nifty30d >= 0 ? "+" : ""}${nifty30d.toFixed(1)}% → ${outperformance >= 0 ? "+" : ""}${outperformance.toFixed(1)}% RS`,
    };
  }

  // Fallback: compute from historical close data
  // Compare stock's N-day return vs Nifty's N-day return
  const n = CONFIG.rsLookbackDays;
  if (stockData.length < n + 1) {
    return { hit: false, detail: "Insufficient data for RS" };
  }

  const closeNow = stockData[stockData.length - 1].chClosingPrice;
  const closeNAgo = stockData[stockData.length - 1 - n].chClosingPrice;

  if (closeNAgo === 0) return { hit: false, detail: "Invalid price data" };

  const stockReturn = ((closeNow - closeNAgo) / closeNAgo) * 100;
  const outperformance = stockReturn - nifty30d;

  return {
    hit: outperformance >= CONFIG.rsMinOutperformance,
    detail: `Stock ${n}d: ${stockReturn >= 0 ? "+" : ""}${stockReturn.toFixed(1)}% vs Nifty 30d: ${nifty30d >= 0 ? "+" : ""}${nifty30d.toFixed(1)}% → ${outperformance >= 0 ? "+" : ""}${outperformance.toFixed(1)}% RS`,
  };
}


// ──────────────────────────────────────────────────────────────
// SIGNAL 12: Block Deal Clustering — institutional fingerprint
// ──────────────────────────────────────────────────────────────

function checkBlockDealClustering(symbol, bulkDealMap) {
  /**
   * Counts how many bulk deals (>0.5% of total shares in one trade)
   * have occurred for this symbol in the lookback window.
   *
   * Clustering = multiple deals in short window = institutions
   * are repeatedly transacting in this stock = strong accumulation.
   *
   *   2+ deals → signal fires
   *   3+ deals → "strong" label
   */
  if (!bulkDealMap || bulkDealMap.size === 0) {
    return { hit: false, detail: "No bulk deal data" };
  }

  const dealCount = bulkDealMap.get(symbol) || 0;
  const config = CONFIG.blockDeals;

  const isHit = dealCount >= config.minDealsForSignal;
  const isStrong = dealCount >= config.minDealsForStrong;

  let label;
  if (dealCount === 0) {
    label = "No bulk deals";
  } else if (isStrong) {
    label = `${dealCount} bulk deals (strong cluster)`;
  } else if (isHit) {
    label = `${dealCount} bulk deals (cluster forming)`;
  } else {
    label = `${dealCount} bulk deal (isolated)`;
  }

  return {
    hit: isHit,
    detail: `${label} in last ${config.lookbackDays}d`,
  };
}


// ──────────────────────────────────────────────────────────────
// STEP 5: Score a stock — combine all signals
// ──────────────────────────────────────────────────────────────

function scoreStock(symbol, data, ind, oiResult, tradeInfo, niftyData, bulkDealMap) {
  /**
   * @param oiResult    — from analyzeOI(), or null for non-F&O stocks.
   * @param tradeInfo   — from fetchTradeInfo(), has delivery % data.
   * @param niftyData   — Nifty 50 benchmark data for RS calculation.
   * @param bulkDealMap — Map<symbol, count> of bulk deals (Signal 12).
   *
   * OI weight excluded from denominator for non-F&O stocks.
   * All other signals always apply.
   */
  const latest = data[data.length - 1];
  const close = latest.chClosingPrice;
  const avgVol =
    ind.volSma20.length > 0 ? ind.volSma20[ind.volSma20.length - 1] : 0;

  // Run all 11 core signal checks (always active)
  const checks = {
    bbSqueeze: checkBBSqueeze(ind),
    volumeSurge: checkVolumeSurge(ind),
    volumeRising: checkVolumeRising(ind),
    rsiStrength: checkRSI(ind),
    adxTrending: checkADX(ind),
    near52wHigh: checkNear52wHigh(data),
    emaAlignment: checkEMAAlignment(ind),
    consolidation: checkConsolidation(ind),
    deliveryPct: checkDeliveryPct(tradeInfo),
    relStrength: checkRelativeStrength(data, niftyData),
    blockDeals: checkBlockDealClustering(symbol, bulkDealMap),
  };

  // Add OI signal if available (F&O stocks only)
  const isFnO = oiResult !== null;
  if (isFnO) {
    checks.oiSignal = oiResult;
  }

  // Compute weighted score
  // For non-F&O stocks, oiSignal weight is excluded from denominator
  let totalWeight = 0;
  let earnedWeight = 0;
  const signalDetails = [];

  for (const [key, result] of Object.entries(checks)) {
    const weight = CONFIG.weights[key] || 0;
    totalWeight += weight;

    if (result.hit) {
      earnedWeight += weight;
      signalDetails.push(`  ✅ ${key}: ${result.detail}`);
    } else {
      signalDetails.push(`  ❌ ${key}: ${result.detail}`);
    }
  }

  // If non-F&O, add a note (not a penalty)
  if (!isFnO) {
    signalDetails.push(`  ⬜ oiSignal: N/A (not F&O eligible)`);
  }

  const score = totalWeight > 0 ? (earnedWeight / totalWeight) * 100 : 0;
  const signalsHit = Object.values(checks).filter((c) => c.hit).length;

  // Extract key metrics for display
  const rsiVal =
    ind.rsi.length > 0 ? ind.rsi[ind.rsi.length - 1] : 0;
  const adxVal =
    ind.adx.length > 0 ? ind.adx[ind.adx.length - 1].adx : 0;
  const pctFrom52w =
    latest.ch52WeekHighPrice > 0
      ? ((latest.ch52WeekHighPrice - close) / latest.ch52WeekHighPrice) * 100
      : 0;

  // Compute trade plan (entry, SL, TP levels)
  const tradePlan = computeTradePlan(data, ind);

  return {
    symbol,
    price: Math.round(close * 100) / 100,
    score: Math.round(score * 10) / 10,
    signalsHit,
    totalSignals: Object.keys(checks).length,
    avgVolume: Math.round(avgVol),
    rsi: Math.round(rsiVal * 10) / 10,
    adx: Math.round(adxVal * 10) / 10,
    pctFrom52w: Math.round(pctFrom52w * 10) / 10,
    high52w: latest.ch52WeekHighPrice,
    low52w: latest.ch52WeekLowPrice,
    vwap: latest.vwap,
    deliveryPct: tradeInfo?.securityWiseDP?.deliveryToTradedQuantity ?? null,
    isFnO,
    oiMetrics: isFnO && oiResult.metrics ? oiResult.metrics : null,
    tradePlan,
    details: signalDetails,
  };
}


// ──────────────────────────────────────────────────────────────
// STEP 6: Analyze one stock end-to-end
// ──────────────────────────────────────────────────────────────

async function analyzeStock(symbol, niftyData, bulkDealMap) {
  // 1. Fetch historical data
  const data = await fetchHistoricalData(symbol);
  if (!data) return null;

  // 2. Basic price/volume filters
  const latest = data[data.length - 1];
  const close = latest.chClosingPrice;
  const avgVol =
    data.slice(-20).reduce((sum, d) => sum + d.chTotTradedQty, 0) / 20;

  if (close < CONFIG.minPrice || close > CONFIG.maxPrice) return null;
  if (avgVol < CONFIG.minAvgVolume) return null;

  // 3. Compute technical indicators
  const indicators = computeIndicators(data);

  // 4. Fetch trade info for delivery % (1 API call)
  await sleep(500);
  const tradeInfo = await fetchTradeInfo(symbol);

  // 5. Fetch option chain OI (returns null for non-F&O stocks)
  let oiResult = null;
  if (CONFIG.oiEnabled) {
    await sleep(500);
    const optionChain = await fetchOptionChain(symbol);
    if (optionChain) {
      oiResult = analyzeOI(optionChain, close);
    }
  }

  // 6. Score with all 12 signals
  return scoreStock(symbol, data, indicators, oiResult, tradeInfo, niftyData, bulkDealMap);
}


// ──────────────────────────────────────────────────────────────
// MAIN — Run the screener
// ──────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  // Apply --no-oi flag
  if (args.noOi) {
    CONFIG.oiEnabled = false;
  }

  console.log();
  console.log("═".repeat(70));
  console.log("  🔍 NSE BREAKOUT SCREENER v2.3 (12 signals + market gate)");
  console.log(`  📅 ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`);
  console.log("  📡 Data source: NSE India (direct)");
  console.log(`  🔗 OI overlay: ${CONFIG.oiEnabled ? "ON (F&O stocks)" : "OFF (--no-oi)"}`);
  console.log("═".repeat(70));
  console.log();

  // ── Fetch Market Context (VIX + Nifty 200 EMA) ──
  let marketContext = null;
  if (CONFIG.marketContext.enabled) {
    marketContext = await fetchMarketContext();
    await sleep(CONFIG.delayBetweenRequests);

    // Block scan if market is bearish and --force not used
    if (marketContext.marketCondition === "bearish" && !args.force) {
      console.log("  ⚠️  MARKET WARNING:");
      console.log("     Conditions are BEARISH (high VIX + Nifty below 200 EMA).");
      console.log("     Most breakouts fail in this environment.");
      console.log();
      console.log("     If you want to scan anyway, use: --force");
      console.log("     To disable this gate entirely, set CONFIG.marketContext.enabled = false");
      console.log();
      if (CONFIG.marketContext.blockScanOnBearish) {
        console.log("  ❌ Scan blocked. Exiting.");
        process.exit(0);
      } else {
        console.log("  ℹ️  Continuing scan, but expect lower win rate.\n");
      }
    } else if (marketContext.marketCondition === "neutral") {
      console.log("  ℹ️  Market is NEUTRAL — proceed with caution.\n");
    }
  }

  // ── Fetch Nifty 50 benchmark (once, for Relative Strength) ──
  const niftyData = await fetchNiftyHistorical();
  await sleep(CONFIG.delayBetweenRequests);

  // ── Fetch bulk deal history (once, for Signal 12) ──
  const bulkDealMap = await fetchBulkDealHistory();
  await sleep(CONFIG.delayBetweenRequests);

  // ── Determine stock universe ──
  let symbols;

  if (args.symbols) {
    symbols = args.symbols;
    console.log(`  📋 Custom watchlist: ${symbols.length} stocks\n`);
  } else {
    const indexName = args.index || CONFIG.defaultIndex;
    symbols = await getStockList(indexName);
  }

  if (!symbols || symbols.length === 0) {
    console.error("  ❌ No stocks to scan.");
    process.exit(1);
  }

  // ── Sequential scan with rate limiting ──
  // (NSE will block/throttle parallel requests)
  const results = [];
  const failed = [];

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    const progress = `[${i + 1}/${symbols.length}]`;

    process.stdout.write(`  ${progress} Analyzing ${symbol}...`);

    try {
      const result = await analyzeStock(symbol, niftyData, bulkDealMap);

      if (result) {
        results.push(result);
        const fnoTag = result.isFnO ? " [F&O]" : "";
        process.stdout.write(` Score: ${result.score}%${fnoTag}\n`);
      } else {
        process.stdout.write(` Skipped (filters)\n`);
      }
    } catch (err) {
      failed.push(symbol);
      process.stdout.write(` ❌ Error: ${err.message?.slice(0, 40)}\n`);
    }

    // Rate limit: pause between requests to avoid NSE blocking
    if (i < symbols.length - 1) {
      await sleep(CONFIG.delayBetweenRequests);
    }
  }

  if (results.length === 0) {
    console.log("\n  ❌ No results. NSE may be down or market is closed.");
    console.log("  💡 Try: node screener.mjs --index \"NIFTY 50\"");
    return;
  }

  // ── Sort by score ──
  results.sort((a, b) => b.score - a.score);

  // ── Display ranked results ──
  const topN = Math.min(CONFIG.topN, results.length);

  console.log();
  console.log("═".repeat(75));
  console.log(`  🏆 TOP ${topN} BREAKOUT CANDIDATES`);
  console.log("═".repeat(75));
  console.log();
  console.log(
    `  ${"#".padEnd(4)} ${"SYMBOL".padEnd(15)} ${"PRICE".padStart(8)} ${"SCORE".padStart(7)} ${"SIGNALS".padStart(9)} ${"RSI".padStart(6)} ${"ADX".padStart(6)} ${"52W%".padStart(6)} ${"DEL%".padStart(6)} ${"OI".padStart(5)}`
  );
  console.log("  " + "─".repeat(72));

  for (let i = 0; i < topN; i++) {
    const r = results[i];
    const oiTag = r.isFnO
      ? r.oiMetrics
        ? `${r.oiMetrics.pcr.toFixed(1)}`
        : "—"
      : "n/a";
    const delTag = r.deliveryPct != null
      ? `${r.deliveryPct.toFixed(0)}%`
      : "—";
    console.log(
      `  ${String(i + 1).padEnd(4)} ${r.symbol.padEnd(15)} ` +
        `₹${String(r.price.toLocaleString("en-IN")).padStart(7)} ` +
        `${String(r.score + "%").padStart(6)} ` +
        `${String(r.signalsHit + "/" + r.totalSignals).padStart(7)} ` +
        `${String(r.rsi).padStart(6)} ` +
        `${String(r.adx).padStart(6)} ` +
        `${String(r.pctFrom52w + "%").padStart(6)} ` +
        `${delTag.padStart(6)} ` +
        `${oiTag.padStart(5)}`
    );
  }

  // ── Detailed breakdown: Top 5 ──
  console.log();
  console.log("═".repeat(75));
  console.log("  📋 DETAILED BREAKDOWN — TOP 5");
  console.log("═".repeat(75));

  for (const r of results.slice(0, 5)) {
    const tp = r.tradePlan;
    console.log();
    const fnoLabel = r.isFnO ? " 🔗 F&O" : "";
    console.log(
      `  ┌─ ${r.symbol} | ₹${r.price.toLocaleString("en-IN")} | Score: ${r.score}%${fnoLabel}`
    );
    console.log(
      `  │  52W High: ₹${r.high52w} | 52W Low: ₹${r.low52w} | VWAP: ₹${r.vwap}`
    );
    const delLabel = r.deliveryPct != null ? ` | Delivery: ${r.deliveryPct.toFixed(1)}%` : "";
    console.log(`  │  Avg Volume: ${r.avgVolume.toLocaleString("en-IN")}${delLabel}`);
    if (r.isFnO && r.oiMetrics) {
      console.log(
        `  │  OI Metrics: ATM ₹${r.oiMetrics.atmStrike} | PCR: ${r.oiMetrics.pcr.toFixed(2)} | Call OI Δ: ${r.oiMetrics.callOIChangePct >= 0 ? "+" : ""}${r.oiMetrics.callOIChangePct.toFixed(1)}% | Put OI Δ: ${r.oiMetrics.putOIChangePct >= 0 ? "+" : ""}${r.oiMetrics.putOIChangePct.toFixed(1)}%`
      );
    }

    // ── Trade Plan ──
    if (tp) {
      console.log(`  │`);
      console.log(`  │  📐 TRADE PLAN (ATR: ₹${tp.atr || "—"})`);
      console.log(`  │  ┌───────────────────────────────────────────────`);

      // Entry
      const entryNote = tp.distanceToEntry > 0
        ? `${tp.distanceToEntry}% above CMP`
        : `${Math.abs(tp.distanceToEntry)}% below CMP — already above entry`;
      console.log(`  │  │  🟢 ENTRY:     ₹${tp.entry.toLocaleString("en-IN")}  (${entryNote})`);

      // Stop-Loss
      console.log(`  │  │  🔴 STOP-LOSS: ₹${tp.stopLoss.toLocaleString("en-IN")}  (Risk: ${tp.riskPct}% | ₹${tp.risk} per share | ${tp.slLabel})`);

      // Take-Profits
      for (const t of tp.targets) {
        console.log(`  │  │  🎯 ${t.label.padEnd(9)}: ₹${t.price.toLocaleString("en-IN")}  (+${t.pctFromEntry}% from entry)`);
      }

      // Position sizing
      const ps = tp.positionSizing;
      console.log(`  │  │`);
      console.log(`  │  │  📊 Position (₹${(ps.capitalExample/1000).toFixed(0)}K capital, ${ps.riskPercent}% risk):`);
      console.log(`  │  │     Shares: ${ps.shares} | Investment: ₹${ps.investmentAmount.toLocaleString("en-IN")} | Max loss: ₹${ps.maxLoss.toLocaleString("en-IN")}`);
      console.log(`  │  └───────────────────────────────────────────────`);
    }

    // Signal details
    console.log(`  │`);
    for (const detail of r.details) {
      console.log(`  │ ${detail}`);
    }
    console.log("  └" + "─".repeat(55));
  }

  // ── Trade Plan Quick Reference: Top 25 ──
  console.log();
  console.log("═".repeat(75));
  console.log("  📐 TRADE PLAN — QUICK REFERENCE (All candidates)");
  console.log("═".repeat(75));
  console.log();
  console.log(
    `  ${"SYMBOL".padEnd(15)} ${"CMP".padStart(8)} ${"ENTRY".padStart(8)} ${"SL".padStart(8)} ${"TP1".padStart(8)} ${"TP2".padStart(8)} ${"RISK%".padStart(7)}`
  );
  console.log("  " + "─".repeat(62));

  for (const r of results.slice(0, topN)) {
    const tp = r.tradePlan;
    if (!tp) continue;
    console.log(
      `  ${r.symbol.padEnd(15)} ` +
        `₹${String(r.price).padStart(7)} ` +
        `₹${String(tp.entry).padStart(7)} ` +
        `₹${String(tp.stopLoss).padStart(7)} ` +
        `₹${String(tp.tp1 || "—").padStart(7)} ` +
        `₹${String(tp.tp2 || "—").padStart(7)} ` +
        `${String(tp.riskPct + "%").padStart(6)}`
    );
  }

  // ── Summary ──
  const strong = results.filter((r) => r.score >= 60);
  const moderate = results.filter((r) => r.score >= 40 && r.score < 60);
  const fnoCount = results.filter((r) => r.isFnO).length;
  const highDelivery = results.filter((r) => r.deliveryPct != null && r.deliveryPct >= CONFIG.deliveryPctHighBar);
  const blockDealStocks = bulkDealMap ? bulkDealMap.size : 0;

  console.log();
  console.log("═".repeat(75));
  console.log("  📊 SUMMARY");
  console.log("═".repeat(75));
  if (marketContext) {
    const lightEmoji = { bullish: "🟢", neutral: "🟡", bearish: "🔴", unknown: "⚪" };
    console.log(`  Market context:         ${lightEmoji[marketContext.marketCondition]} ${marketContext.marketCondition.toUpperCase()}`);
  }
  console.log(`  Stocks scanned:         ${results.length}`);
  console.log(`  F&O eligible (OI):      ${fnoCount}`);
  console.log(`  High delivery (≥${CONFIG.deliveryPctHighBar}%):  ${highDelivery.length}`);
  console.log(`  Bulk deal stocks:       ${blockDealStocks} (across NSE in last ${CONFIG.blockDeals.lookbackDays}d)`);
  console.log(`  Strong (≥60%):          ${strong.length}`);
  console.log(`  Moderate (40-60%):      ${moderate.length}`);
  console.log(`  Failed downloads:       ${failed.length}`);

  // ── Export JSON (with market context wrapper) ──
  const exportPayload = {
    metadata: {
      scanTime: new Date().toISOString(),
      marketContext: marketContext ? {
        condition: marketContext.marketCondition,
        vix: marketContext.vix,
        vixLevel: marketContext.vixLevel,
        niftyPrice: marketContext.niftyPrice,
        nifty200EMA: marketContext.nifty200EMA,
        niftyAbove200EMA: marketContext.niftyAbove200EMA,
      } : null,
      totalScanned: results.length,
      bulkDealStocksAcrossNSE: blockDealStocks,
    },
    candidates: results.slice(0, topN).map((r) => ({
      symbol: r.symbol,
      price: r.price,
      score: r.score,
      signalsHit: r.signalsHit,
      totalSignals: r.totalSignals,
      rsi: r.rsi,
      adx: r.adx,
      pctFrom52wHigh: r.pctFrom52w,
      high52w: r.high52w,
      avgVolume: r.avgVolume,
      deliveryPct: r.deliveryPct,
      bulkDealCount: bulkDealMap ? (bulkDealMap.get(r.symbol) || 0) : 0,
      isFnO: r.isFnO,
      oiMetrics: r.oiMetrics,
      tradePlan: r.tradePlan ? {
        entry: r.tradePlan.entry,
        stopLoss: r.tradePlan.stopLoss,
        riskPct: r.tradePlan.riskPct,
        riskPerShare: r.tradePlan.risk,
        tp1: r.tradePlan.tp1,
        tp2: r.tradePlan.tp2,
        tp3: r.tradePlan.tp3,
        atr: r.tradePlan.atr,
        distanceToEntry: r.tradePlan.distanceToEntry,
        positionSizing: r.tradePlan.positionSizing,
      } : null,
    })),
  };

  const outputFile = "breakout_results.json";
  writeFileSync(outputFile, JSON.stringify(exportPayload, null, 2));

  console.log();
  console.log(`  💾 Results saved: ${outputFile}`);
  console.log();
  console.log("  ⚠️  DISCLAIMER: Technical screener only, not financial advice.");
  console.log("  Always validate with your own chart analysis before trading.");
  console.log();
}


// ── Run ──
main().catch((err) => {
  console.error("\n  ❌ Fatal error:", err.message);
  process.exit(1);
});
