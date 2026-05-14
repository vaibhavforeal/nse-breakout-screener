# NSE Breakout Screener v2.3

Automated stock breakout screener with **12 technical signals**, **market context gate**, **trade plan calculator**, and **direct NSE India data** via [`stock-nse-india`](https://github.com/hi-imcodeman/stock-nse-india).

## Quick Start

```bash
npm install
node screener.mjs                            # Scan NIFTY 200 (default)
node screener.mjs --index "NIFTY 50"         # Scan specific index
node screener.mjs --symbols RELIANCE,TCS     # Custom watchlist
node screener.mjs --no-oi                    # Skip OI (faster)
node screener.mjs --force                    # Scan even in bearish market
```

## What's New in v2.3

### 🚦 Market Context Gate
Before scanning, the screener checks the broader market health:
- **India VIX** — fear gauge (low < 14 / moderate / high > 20)
- **Nifty 50 vs 200 EMA** — trend health (using NIFTYBEES ETF as proxy)

Result is a traffic light:
- 🟢 **Bullish** — ideal breakout environment
- 🟡 **Neutral** — proceed with caution
- 🔴 **Bearish** — most breakouts will fail; pauses with warning (use `--force` to override)

### 📐 Signal 12: Block Deal Clustering
Fetches NSE's bulk deal history for the last 15 days and counts how often each stock appears. Stocks with 2+ bulk deals show clustering — institutions are repeatedly transacting in them. 3+ deals = strong cluster.

### 💼 Trade Plan Per Stock
Every candidate now gets:
- **Entry**: Consolidation high + 0.2% buffer
- **Stop-Loss**: ATR-based (or swing-low / EMA-based — configurable), capped at 5% risk
- **Take-Profit**: TP1 (1.5R) / TP2 (2.5R) / TP3 (4R)
- **Position Sizing**: Suggested shares based on 1% capital risk

## All 12 Signals

| # | Signal | What It Detects | Weight |
|---|---|---|---|
| 1 | **Bollinger Squeeze** | Volatility compression | 16% |
| 2 | **Volume Surge** | Unusual volume in last 3 days | 12% |
| 3 | **ADX Trending** | Trend forming, +DI > -DI | 12% |
| 4 | **Near 52W High** | Within 5% of yearly high | 12% |
| 5 | **Delivery %** | Institutional accumulation (>50%) | 10% |
| 6 | **OI Overlay** *(F&O)* | Smart money positioning | 10% |
| 7 | **RSI Sweet Spot** | Momentum 50-75 | 7% |
| 8 | **EMA Alignment** | Price > EMA20 > EMA50 > EMA200 | 7% |
| 9 | **Relative Strength** | Outperforming Nifty 50 (30d) | 7% |
| 10 | **Volume Rising** | Accumulation trend | 7% |
| 11 | **Block Deals** *(NEW)* | Bulk deal clustering | 7% |
| 12 | **Consolidation** | Tight price range | 3% |

## CLI Flags

| Flag | What It Does |
|---|---|
| `--index <name>` | Scan a specific index (e.g. "NIFTY 50", "NIFTY 500") |
| `--symbols A,B,C` | Scan custom watchlist |
| `--no-oi` | Skip option chain fetch (faster but no Signal 6) |
| `--force` | Scan even if market context is bearish |

## Data Flow

```
NSE India API
    │
    ├── getAllIndices()                     →  India VIX
    ├── getEquityHistoricalData(NIFTYBEES)  →  Nifty 200 EMA proxy
    │         └── Market Context Gate (🟢/🟡/🔴)
    │
    ├── getEquityStockIndices("NIFTY 50")   →  RS benchmark
    ├── getDataByEndpoint(/bulk_deals)      →  Bulk deal map (Signal 11)
    │
    ├── getEquityStockIndices("NIFTY 200")  →  Stock list
    │
    └── PER STOCK:
        ├── getEquityHistoricalData         →  10 technical signals
        ├── getEquityTradeInfo              →  Delivery %
        └── getEquityOptionChain            →  OI signal (F&O only)
                │
                └── 12-signal score + trade plan → JSON + ranked output
```

## Configuration

All in `CONFIG` object at top of `screener.mjs`:

```javascript
// Market context
marketContext: {
  enabled: true,
  vixLowThreshold: 14,
  vixHighThreshold: 20,
  niftyEmaPeriod: 200,
  blockScanOnBearish: false,    // true = refuse to scan in bearish market
}

// Block deals
blockDeals: {
  enabled: true,
  lookbackDays: 15,
  minDealsForSignal: 2,
  minDealsForStrong: 3,
}

// Trade plan
tradePlan: {
  slMethod: "atr",              // "atr" | "swing" | "ema"
  slAtrMultiplier: 1.5,
  slMaxPct: 5,                  // Cap risk at 5%
  tpRatios: [1.5, 2.5, 4],     // TP1, TP2, TP3 as R-multiples
}
```

## Output

**Terminal**:
- Market context (🟢/🟡/🔴) at startup
- Ranked table with all key metrics
- Detailed top-5 breakdown with full trade plan
- Quick-reference trade plan table for top 25
- Summary stats

**JSON** (`breakout_results.json`):
```json
{
  "metadata": {
    "scanTime": "2026-05-14T10:30:00.000Z",
    "marketContext": {
      "condition": "bullish",
      "vix": 12.4,
      "vixLevel": "low",
      "niftyPrice": 24150,
      "nifty200EMA": 23100,
      "niftyAbove200EMA": true
    },
    "totalScanned": 195,
    "bulkDealStocksAcrossNSE": 47
  },
  "candidates": [
    {
      "symbol": "RELIANCE",
      "score": 78.2,
      "deliveryPct": 58.3,
      "bulkDealCount": 2,
      "isFnO": true,
      "tradePlan": {
        "entry": 2870.50,
        "stopLoss": 2785.25,
        "riskPct": 3.0,
        "tp1": 2998.40,
        "tp2": 3083.65,
        "tp3": 3211.55,
        "positionSizing": { "shares": 12, "maxLoss": 1023 }
      }
    }
  ]
}
```

## npm Scripts

```bash
npm run scan              # NIFTY 200 with all 12 signals + market gate
npm run scan:fast         # NIFTY 200 without OI
npm run scan:nifty50      # Nifty 50 (~3 min)
npm run scan:nifty500     # Nifty 500 (~20 min)
npm run scan:midcap       # Midcap 150
npm run scan:smallcap     # Smallcap 250
```

## Requirements

- Node.js 18+
- Best during market hours (9:15 AM – 3:30 PM IST)
- Trade plan and market context update each scan

## Disclaimer

Technical screening tool only, not financial advice.
