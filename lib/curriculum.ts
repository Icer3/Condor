// The 10-lesson options curriculum.
// Synthesizes the "econ-major in 20 paragraphs" content into a structured course.

import { StrategyId } from './strategies';

export interface Lesson {
  slug: string;
  number: number;
  title: string;
  subtitle: string;
  estimatedMinutes: number;
  paragraphs: { heading?: string; body: string }[];
  keyTakeaways: string[];
  relatedStrategy?: StrategyId;
  relatedLesson?: string;
}

export const COURSE: Lesson[] = [
  {
    slug: 'what-is-an-option',
    number: 1,
    title: 'What is an Option?',
    subtitle: 'Contracts, calls, puts, strikes, and expiry.',
    estimatedMinutes: 5,
    paragraphs: [
      {
        body: 'An option is a contract that gives you the right (but not the obligation) to buy or sell something at a fixed price on or before some future date. A call is the right to buy. A put is the right to sell. The fixed price is the strike K. The future date is expiry T. You pay an upfront fee — the premium — for this right. If you never exercise it, the most you lose is that premium. That asymmetry is what makes options interesting: bounded downside, sometimes-unbounded upside.',
      },
      {
        heading: 'Intrinsic value vs time value',
        body: 'At any moment, an option is worth two things stacked: intrinsic value (what you would get exercising now: max(0, S−K) for calls, max(0, K−S) for puts) plus time value (the extra premium the market pays for the possibility things move your way before expiry). Premium = Intrinsic + Time. Deep OTM options can still cost real money because they have zero intrinsic but lots of time. This split drives why ATM short-dated options decay fastest.',
      },
    ],
    keyTakeaways: [
      'Call = right to buy, put = right to sell.',
      'Strike K = the price you have the right to transact at.',
      'Premium = intrinsic value + time value.',
      'Max loss = premium paid (for long options).',
    ],
  },
  {
    slug: 'moneyness-and-payoffs',
    number: 2,
    title: 'Moneyness & Payoffs',
    subtitle: 'ITM, ATM, OTM, and the hockey-stick diagram.',
    estimatedMinutes: 6,
    paragraphs: [
      {
        body: 'Moneyness describes how an option\'s strike relates to the current stock price. ITM (in-the-money) options have positive intrinsic value — exercising immediately is profitable. OTM options have zero intrinsic value but still trade at non-zero prices because of time value. ATM sits at the boundary. Moneyness drives the Greeks heavily: ATM options have the highest time value and gamma; deep ITM options behave almost like stock itself.',
      },
      {
        heading: 'Payoff diagrams',
        body: 'A payoff diagram plots what your position is worth at expiry for every possible terminal stock price S_T. A long call payoff is max(0, S_T − K) − premium — a hockey stick that rises linearly past the strike. A short call is the negative. A spread (buy one strike, sell another) creates a plateau between the strikes with two breakeven points. The iron condor in this app is two spreads stacked — call credit spread above, put credit spread below — making a flat-topped tent with cliffs on either side.',
      },
    ],
    keyTakeaways: [
      'ITM = positive intrinsic, OTM = zero intrinsic + time value.',
      'ATM options have the highest gamma and time value.',
      'Spreads create plateaus; condors create tents.',
      'Read a payoff diagram from left to right at expiry.',
    ],
    relatedStrategy: 'iron_condor',
  },
  {
    slug: 'no-arbitrage-and-replication',
    number: 3,
    title: 'No-Arbitrage & Replication',
    subtitle: 'Why options prices are what they are.',
    estimatedMinutes: 7,
    paragraphs: [
      {
        body: 'Before any math, one principle anchors all of options pricing: arbitrage-free markets. If two portfolios have identical future payoffs in every possible world, they must cost the same today. Otherwise, buy the cheap one, sell the expensive one, pocket risk-free money. This is the engine that derives Black-Scholes. You don\'t assume the formula — you back it out by constructing a "replicating portfolio" of stock and bonds that pays off exactly like the option.',
      },
      {
        body: 'In a frictionless world with continuous trading, an option is just a clever combination of stock and cash. Its price is whatever makes that combination cost the same as the option. The replication argument gives you delta (the hedge ratio) for free. It also gives you put-call parity: a call minus a put equals the stock minus a discounted strike. If this identity breaks, you have an arbitrage — and the market will close it within milliseconds.',
      },
    ],
    keyTakeaways: [
      'Same payoff = same price. Always.',
      'Options can be replicated with stock + cash.',
      'Put-call parity: C − P = S − K·e^(−rT).',
      'Arbitrage opportunities are short-lived.',
    ],
  },
  {
    slug: 'random-walks-and-gbm',
    number: 4,
    title: 'Random Walks & GBM',
    subtitle: 'Why stock prices follow a stochastic differential equation.',
    estimatedMinutes: 8,
    paragraphs: [
      {
        body: 'A stock price S over time is a random walk. In discrete steps: S_{t+1} = S_t · (1 + μ·dt + σ·√dt · Z), where μ is the average growth (drift), σ is the typical wiggle size (volatility), and Z is a standard normal random variable. In the continuous limit, this becomes Brownian motion — the same equation physicists use for diffusion. The √t is critical: doubling time horizon doesn\'t double wiggles, it increases them by √2. That\'s why a 30-day option has more time value than a 1-day option, but only about √30 ≈ 5.5× more.',
      },
      {
        heading: 'Geometric Brownian Motion',
        body: 'The model your Monte Carlo uses: dS = μ·S·dt + σ·S·dW. Two key features: randomness scales with S (a $200 stock moves more in absolute terms than a $20 stock), and μ and σ are constants in this model — real markets have neither. The explicit solution is S_T = S_0 · exp((μ − ½σ²)T + σ√T · Z). The ½σ² is Ito\'s correction — a fudge factor from the math of continuous randomness. Looks weird, but it\'s correct.',
      },
    ],
    keyTakeaways: [
      'Brownian motion is the foundation of price dynamics.',
      'Wiggles scale with √time, not time.',
      'GBM: dS = μS·dt + σS·dW.',
      'The ½σ² in the explicit solution is Ito correction.',
    ],
  },
  {
    slug: 'black-scholes',
    number: 5,
    title: 'Black-Scholes',
    subtitle: 'The formula and what each term means.',
    estimatedMinutes: 10,
    paragraphs: [
      {
        body: 'The Black-Scholes formula for a European call: C = S·N(d₁) − K·e^(−rT)·N(d₂), where d₁ = [ln(S/K) + (r + ½σ²)T] / (σ√T) and d₂ = d₁ − σ√T. N(·) is the standard normal CDF. The intuition: N(d₂) is the probability the call finishes in the money (under the risk-neutral measure). N(d₁) is a related probability. The price is "what you\'d pay for the stock, but only on the chance you actually get it, minus what you\'d pay back at expiry, also only on the chance you have to."',
      },
      {
        body: 'The discounted strike K·e^(−rT) accounts for the time value of money — you don\'t pay K until T, so its present value is smaller. The volatility σ is annualized and constant — the model\'s biggest simplification. Real markets have a volatility smile (deep OTM options trade richer than BS predicts). When you see traders say "options are expensive," they usually mean implied vol is high relative to historical levels — not that BS gives the wrong number mechanically.',
      },
    ],
    keyTakeaways: [
      'C = S·N(d₁) − K·e^(−rT)·N(d₂)',
      'N(d₂) ≈ risk-neutral probability of finishing ITM.',
      'Implied vol is what the market charges; realized vol is what actually happened.',
      'When implied > realized, options are expensive. Sell premium.',
    ],
    relatedLesson: 'no-arbitrage-and-replication',
  },
  {
    slug: 'the-greeks',
    number: 6,
    title: 'The Greeks',
    subtitle: 'Delta, Gamma, Theta, Vega — your risk dimensions.',
    estimatedMinutes: 12,
    paragraphs: [
      {
        body: 'The Greeks are partial derivatives of option price with respect to inputs. Each one measures sensitivity to a different dimension of risk. They are not theoretical — every market maker hedges them in real time, and every retail options trader should know what they\'re exposed to.',
      },
      {
        heading: 'Delta (Δ)',
        body: 'Δ = ∂C/∂S — how much your option\'s price moves per $1 move in the stock. For a call, Δ = N(d₁), always between 0 and 1. ATM ≈ 0.5. Delta is also the hedge ratio: to be delta-neutral, hold Δ shares of stock per option you\'ve sold. For a put, Δ_put = Δ_call − 1, between -1 and 0.',
      },
      {
        heading: 'Gamma (Γ)',
        body: 'Γ = ∂Δ/∂S — how fast delta changes. Always positive for long options (you want more delta when winning, less when losing — that\'s convexity). ATM near expiry has the highest gamma. Iron condors are short gamma — they bleed when the stock whipsaws. Long gamma = you like volatility; short gamma = volatility hurts you.',
      },
      {
        heading: 'Theta (Θ)',
        body: 'Θ = ∂C/∂t — daily P/L from time passing. Almost always negative for long options. Theta accelerates as expiry approaches — a 30-day option might decay $0.05/day; a 1-day option decays $1.50/day. Iron condors are long theta — they profit from time decay. Sellers love theta; it\'s called "the silent assassin" because it works against you even when nothing happens.',
      },
      {
        heading: 'Vega (ν)',
        body: 'ν = ∂C/∂σ — sensitivity to implied vol changes. Always positive for long options. Per 1.00 move in vol (e.g., 20% → 21%). If vol jumps 5 points on a straddle you\'ve sold, you can lose a lot even if the stock doesn\'t move. Iron condors are short vega — watch for earnings, FOMC, and other scheduled catalysts that spike implied vol.',
      },
    ],
    keyTakeaways: [
      'Δ = hedge ratio = sensitivity to stock moves.',
      'Γ = how fast delta changes = sensitivity to volatility of stock.',
      'Θ = time decay. Sellers collect it; buyers pay it.',
      'ν = sensitivity to implied vol. Spike = pain for short vega.',
      'Long gamma = convex = you like vol. Short gamma = concave = vol hurts.',
    ],
  },
  {
    slug: 'volatility',
    number: 7,
    title: 'Volatility Real & Implied',
    subtitle: 'The smile, the skew, and where the alpha hides.',
    estimatedMinutes: 10,
    paragraphs: [
      {
        body: 'Two flavors. Realized vol = what actually happened. Computed from log-returns: σ = std(ln(S_i / S_{i-1})) · √252. Implied vol = what the option market is expecting. Back it out by inverting Black-Scholes: given the market price, what σ makes the formula match? When implied > realized, options are "expensive" — sell premium. When implied < realized, options are "cheap" — buy premium. IV rank = (current IV − 52w low) / (52w high − 52w low) × 100. Rank > 50% = sell premium; < 25% = buy premium.',
      },
      {
        heading: 'The smile and skew',
        body: 'Black-Scholes assumes constant vol. Reality has a smile: OTM puts trade at higher implied vol than ATM, and so do OTM calls. The market knows big moves are more likely than a normal distribution predicts (fat tails). Deep ITM puts have especially high implied vol — the market pays up for crash protection. This skew is why simply selling ATM iron condors without adjusting leaves you exposed to sudden crashes. Local vol models (Dupire) and stochastic vol models (Heston) capture this — BS does not.',
      },
    ],
    keyTakeaways: [
      'Realized vol is past. Implied vol is the market\'s forecast.',
      'IV rank > 50% = sell premium. < 25% = buy premium.',
      'OTM puts trade at higher IV than ATM — the crash premium.',
      'Constant-vol BS misses the smile. Local/stoch vol fixes it.',
    ],
    relatedStrategy: 'iron_condor',
  },
  {
    slug: 'monte-carlo',
    number: 8,
    title: 'Monte Carlo Simulation',
    subtitle: 'When the formula is too hard, just simulate it.',
    estimatedMinutes: 7,
    paragraphs: [
      {
        body: 'When the formula gets complex (multi-leg strategies, American-style exercise, path-dependent features), you simulate. Generate N random terminal prices S_T from the GBM distribution. For each path, compute the strategy\'s P/L at expiry. Histogram those P/Ls. Report: P(profit), expected P/L, VaR, CVaR. No fancy formulas needed — the price you pay is computational. 10,000 paths × 21 daily steps × payoff calc = a few hundred thousand ops. Trivial on modern hardware.',
      },
      {
        body: 'The seeded RNG makes runs reproducible. Same seed = same paths, useful for debugging and consistent UI. Drift μ in Monte Carlo is the wild card — the honest answer is nobody knows the true drift. Historical drift is biased by survivorship; risk-neutral drift is the risk-free rate. In practice, traders often set μ = r or μ = 0 because the shape of the P/L distribution is dominated by vol, not drift. Drift affects expected P/L but barely affects PoP or tail metrics.',
      },
    ],
    keyTakeaways: [
      'MC = simulate many futures, compute P/L on each.',
      'P(profit), E[P/L], VaR 95%, CVaR 95% are the key outputs.',
      'Drift μ barely affects the distribution shape; vol does.',
      'Use a seeded RNG so runs are reproducible.',
    ],
    relatedStrategy: 'iron_butterfly',
  },
  {
    slug: 'risk-metrics',
    number: 9,
    title: 'Risk Metrics: VaR & CVaR',
    subtitle: 'How to quantify the bad outcomes.',
    estimatedMinutes: 6,
    paragraphs: [
      {
        body: 'VaR 95% = "the loss you shouldn\'t exceed 95% of the time." Computed by sorting P/Ls, taking the 5th percentile, flipping the sign. If VaR 95% = $200, that means: in 95% of paths you lose less than $200. CVaR 95% (Expected Shortfall) = "given that you ARE in the worst 5%, what\'s your average loss?" CVaR is more honest because VaR hides what happens in the tail. For an iron condor on a high-vol stock, VaR might be $180 but CVaR could be $450 — the tail is fat.',
      },
      {
        body: 'Other useful metrics: Sharpe-like ratio = E[P/L] / std(P/L). Higher = better risk-adjusted return. Max drawdown (peak to trough). Win rate vs. profit factor (sum of wins / sum of losses). For a strategy to be worth trading, its Sharpe should be positive AND its CVaR should fit your risk budget (CVaR × contracts × 100 ≤ 1% of portfolio). Most retail traders focus on win rate. Most professionals focus on profit factor and CVaR.',
      },
    ],
    keyTakeaways: [
      'VaR = threshold of bad outcomes. CVaR = average of the worst.',
      'CVaR is more honest about tail risk than VaR.',
      'Sharpe = E[P/L] / std(P/L). Higher is better.',
      'Size positions so CVaR × contracts × 100 ≤ 1% of portfolio.',
    ],
  },
  {
    slug: 'strategies-and-limits',
    number: 10,
    title: 'Strategies as Risk Bundles & Model Limits',
    subtitle: 'Reading a position in Greek-space, and where BS breaks.',
    estimatedMinutes: 8,
    paragraphs: [
      {
        body: 'Every option strategy is a package of Greek exposures. Long call: long delta, long gamma, long vega, short theta. Bullish, leveraged, time-decaying. Bull call spread: long delta (small), long gamma (small), long vega (small), short theta (big). Defined-risk bullish. Iron condor: roughly delta-neutral, short gamma, short vega, long theta. Profits from time passing in a range with low vol. The art of options is constructing positions whose Greek exposures match your view.',
      },
      {
        heading: 'Where the model breaks',
        body: 'Black-Scholes + GBM assumes: constant volatility, continuous paths, no transaction costs, European-style exercise, lognormal returns. Reality has: a vol smile/skew, overnight gaps and jumps, bid-ask spreads, American-style early exercise on most equity options, and fat-tailed return distributions (black swans happen more than BS predicts). For paper trading and learning, BS is fine. For real money, you\'d add a vol surface, use stochastic vol, model pin risk near expiry, and respect bid-ask spreads (which can be 50% of mid on illiquid strikes).',
      },
    ],
    keyTakeaways: [
      'Every strategy is a bundle of Greek risks.',
      'Match your Greek exposures to your market view.',
      'BS misses: smile, gaps, frictions, early exercise, fat tails.',
      'Model as a first approximation. Respect the gaps when sizing.',
    ],
  },
];

export function getLesson(slug: string): Lesson | undefined {
  return COURSE.find(l => l.slug === slug);
}

export function getNextLesson(slug: string): Lesson | undefined {
  const idx = COURSE.findIndex(l => l.slug === slug);
  return idx >= 0 ? COURSE[idx + 1] : undefined;
}

export function getPrevLesson(slug: string): Lesson | undefined {
  const idx = COURSE.findIndex(l => l.slug === slug);
  return idx > 0 ? COURSE[idx - 1] : undefined;
}