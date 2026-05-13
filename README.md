# NSE Breakout Screener v2.2

Automated stock breakout screener with **11 technical signals** pulling data **directly from NSE India** using [`stock-nse-india`](https://github.com/hi-imcodeman/stock-nse-india). Includes **Option Chain OI**, **Delivery % tracking**, and **Relative Strength vs Nifty 50**.

## Quick Start

```bash
npm install
node screener.mjs                            # Scan NIFTY 200 (default)
node screener.mjs --index "NIFTY 50"         # Scan specific index
node screener.mjs --symbols RELIANCE,TCS     # Custom watchlist
node screener.mjs --no-oi                    # Skip OI (faster)
```

## 11 Signals

| # | Signal | What It Detects | Weight | NSE API |
|---|---|---|---|---|
| 1 | **Bollinger Squeeze** | Volatility compression | 18% | Historical OHLCV |
| 2 | **Volume Surge** | Unusual volume spike (last 3 days) | 12% | Historical OHLCV |
| 3 | **ADX Trending** | Trend forming, +DI > -DI | 12% | Historical OHLCV |
| 4 | **Near 52W High** | Within 5% of yearly high | 12% | `ch52WeekHighPrice` |
| 5 | **Delivery %** ⭐ | Institutional accumulation (>50%) | 10% | `getEquityTradeInfo()` |
| 6 | **RSI Sweet Spot** | Momentum 50-75 | 8% | Historical OHLCV |
| 7 | **EMA Alignment** | Price > EMA20 > EMA50 > EMA200 | 8% | Historical OHLCV |
| 8 | **Relative Strength** ⭐ | Outperforming Nifty 50 (30d) | 8% | `getEquityStockIndices()` |
| 9 | **Volume Rising** | Accumulation trend | 8% | Historical OHLCV |
| 10 | **Consolidation** | Tight price range | 4% | Historical OHLCV |
| 11 | **OI Overlay** | Smart money positioning (F&O only) | 10% | `getEquityOptionChain()` |

Signals 1-10 apply to all stocks. Signal 11 only applies to F&O stocks; non-F&O stocks are scored fairly out of their applicable signals.

### Delivery % — Why It Matters

NSE uniquely provides `deliveryToTradedQuantity` — the % of volume actually delivered vs squared off intraday. When delivery % climbs above 50-65% during consolidation, institutional buyers are accumulating. No international data provider gives you this.

### Relative Strength — Why It Matters

Stocks outperforming Nifty 50 by ≥2% over 30 days show independent strength. When the broader market recovers, these break out first. Fetched once at startup from NSE index data.

### OI Signal — How It Works

Fires when at least 2 of 3 sub-signals are bullish:
- **Short Covering**: Call OI declining ≥5% at ATM + above (sellers retreating)
- **Put Writing**: Put OI increasing ≥5% at ATM + below (floor established)
- **PCR Bullish**: Near-ATM PCR between 0.7-1.5

## Data Flow

```
NSE India API
    ├── getEquityStockIndices("NIFTY 50")   →  Benchmark (once)
    ├── getEquityStockIndices("NIFTY 200")  →  Stock list
    ├── getEquityHistoricalData(symbol)     →  1yr OHLCV → BB, RSI, ADX, EMA
    ├── getEquityTradeInfo(symbol)          →  Delivery % + bulk deals
    └── getEquityOptionChain(symbol)        →  OI data (F&O only)
            └── 11-signal weighted score → Ranked output + JSON
```

## Configuration

All tuneable in the `CONFIG` object at the top of `screener.mjs`:

```javascript
deliveryPctThreshold: 50,    // Delivery % signal fires above this
deliveryPctHighBar: 65,      // "Strong accumulation" label
rsMinOutperformance: 2,      // Must beat Nifty by ≥2% over 30d
squeezePercentile: 20,       // BB bandwidth in bottom X% = squeeze
rsiMin: 50, rsiMax: 75,      // RSI sweet spot range
delayBetweenRequests: 1500,  // Rate limit (ms) between stocks
```

## Output

**Terminal**: Ranked table (Symbol, Price, Score, Signals, RSI, ADX, 52W%, DEL%, OI) + top 5 detailed breakdown.

**JSON**: `breakout_results.json` with all metrics including `deliveryPct`, `oiMetrics`, and `isFnO`.

## npm Scripts

```bash
npm run scan              # NIFTY 200 with all 11 signals
npm run scan:fast         # NIFTY 200 without OI
npm run scan:nifty50      # Nifty 50 (~3 min)
npm run scan:nifty500     # Nifty 500 (~20 min)
npm run scan:midcap       # Midcap 150
npm run scan:smallcap     # Smallcap 250
```

## Requirements

- Node.js 18+
- Best during market hours (9:15 AM – 3:30 PM IST) for live delivery data

## Disclaimer

Technical screening tool only, not financial advice.
