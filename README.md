# condor.io — Options Workbench

A terminal-themed (green/grey, monospace) options analyzer + paper-trading workbench built with Next.js 15, TypeScript, Tailwind, and Recharts.

## Run it

> ⚠️ **First time only:** you MUST run `npm install` before `npm run dev`. This downloads Next.js, React, Tailwind, Recharts, etc. into `node_modules/`. If you skip it you'll get `'next' is not recognized` errors.

```bash
# 1. Install dependencies (first time only, takes ~30s)
npm install

# 2. Start dev server
npm run dev

# 3. Open in browser
# → http://localhost:3000
```

### After extracting a fresh zip

```powershell
# PowerShell on Windows
cd C:\Users\madal_6nw9u1i\Desktop
Remove-Item -Recurse -Force options-trader
Expand-Archive C:\Users\madal_6nw9u1i\Downloads\options-trader.zip -DestinationPath .
cd options-trader
npm install              # <-- this is the step people forget!
npm run dev
```

No API keys required — quote data comes from Yahoo Finance (direct fetch) with Stooq CSV fallback.

## Pages

- **`/`** — home / quickstart
- **`/trade`** — strategy selector + live quote + Monte Carlo simulation + paper-trade button
- **`/learn`** — interactive lessons on all 10 strategies with live payoff diagrams
- **`/portfolio`** — paper positions with live mark-to-market P/L
- **`/about`** — the math, the strategies, and the limitations

## Strategies (10)

| Strategy | Category | Risk | Bias |
|----------|----------|------|------|
| Long Call | bullish | defined | unlimited upside, capped loss |
| Long Put | bearish | defined | capped loss, big profit on drop |
| Short Put (Cash-Secured) | bullish | defined | premium income, can be assigned |
| Covered Call | income | defined | stock + short call, capped upside |
| Bull Call Spread | bullish | defined | cheaper long call, capped profit |
| Bear Put Spread | bearish | defined | cheaper long put, capped profit |
| Iron Condor | neutral | defined | range-bound premium collection |
| Iron Butterfly | neutral | defined | tight-range, higher credit |
| Long Straddle | volatility | defined | profit from big move either way |
| Long Strangle | volatility | defined | cheaper straddle, wider BE |

## Code structure

```
lib/
  blackScholes.ts       # BSM pricing + greeks + inverse normal CDF
  strategies.ts         # Generic Leg/Strategy types + builder for each of 10 strategies
  monteCarlo.ts         # GBM simulation + histogram + percentile fan + insights
  paperTrading.ts       # localStorage-backed position store + MTM helpers

app/
  layout.tsx            # Root layout with nav + status bar
  page.tsx              # Home
  trade/page.tsx        # Strategy selector + analysis + paper-trade button
  learn/page.tsx        # Strategy lessons with live payoff diagrams
  portfolio/page.tsx    # Paper positions list + close modal
  about/page.tsx        # Math + limitations
  api/
    quote/[symbol]/     # Yahoo → Stooq fallback
    simulate/           # Builds strategy + runs MC + returns insights

components/
  Nav.tsx               # Top nav (home / trade / learn / portfolio / about)
  Panels.tsx            # Panel / Stat / Tag primitives
  StatusBar.tsx         # Bottom status strip
```

## Math

**Black-Scholes:**
```
d₁ = [ln(S/K) + (r + ½σ²)T] / (σ√T)
d₂ = d₁ − σ√T
C = S·N(d₁) − K·e^(−rT)·N(d₂)
P = K·e^(−rT)·N(−d₂) − S·N(−d₁)
```

**Geometric Brownian Motion:**
```
S_{t+dt} = S_t · exp((μ − ½σ²)dt + σ·√dt · Z),   Z ~ N(0,1)
```

N daily-stepped paths → payoff at expiry → distribution → P(profit), E[P/L], VaR 95%, CVaR 95%.

## Paper trading

Positions stored in browser `localStorage` under key `condor.paper.positions.v1`. Live mark-to-market uses Black-Scholes on the live spot + remaining DTE. No backend, no signup, no data leaves your machine.

## Theme

CSS variables in `app/globals.css`:
```
--bg:    #0a0d0c   --border: #232b28
--fg:    #e8ede9   --green:  #4ade80
--green-2: #22c55e  --red:    #f87171
```

Rounded panels (14px), soft shadows, green glow on CTAs, glass-blur nav.

## License

MIT.
