// Rule-based finance Q&A engine for the condor.ai chat assistant.
// Strictly rejects non-finance questions.

export interface QAContext {
  strategyName: string;
  strategyCategory: string;
  entry: number;          // per-contract (positive = credit, negative = debit)
  maxProfit: number | null;
  maxLoss: number | null;
  breakEvens: number[];
  probProfit: number;
  expectedPnl: number;
  var95: number;
  cvar95: number;
  spot: number;
  ticker: string;
  dte: number;
  sigma: number;
  delta: number;
  theta: number;
  vega: number;
  contracts: number;
}

export interface QAResponse {
  text: string;
  followUps?: string[];
}

const NON_FINANCE_REJECTION = "I'm condor.ai — finance and options only. Try asking about the strategy, Greeks, P/L, breakevens, or when to close. I won't help with non-finance topics.";

const FINANCE_KEYWORDS = new Set([
  'option','options','call','calls','put','puts','strike','strikes','premium','premiums',
  'volatility','vol','iv','implied','realized','hv',
  'delta','gamma','theta','vega','rho','greeks',
  'iron','condor','butterfly','straddle','strangle','straddles','strangles',
  'spread','spreads','bull','bear','bullish','bearish','long','short',
  'profit','loss','pl','p/l','risk','reward','rr',
  'breakeven','break-even','break','even','be',
  'stock','stocks','price','prices','spot','share','shares','equity','equities',
  'strategy','strategies','position','positions','trade','trades','trading',
  'simulate','simulation','monte','carlo','monte carlo','paths',
  'paper','portfolio','open','close','hold','held','holding',
  'contract','contracts','expiry','expiration','dte',
  'trend','support','resistance','mean','reversion','drift','mu',
  'var','cvar','sharpe','vol',
  'fill','slippage','liquidity','bid','ask','spread','mid',
  'hedge','hedging','adjust','adjusting','roll','rolling',
  'earnings','dividend','dividends','split','splits',
  'rate','rates','fed','fomc','interest',
  'bull market','bear market','recession','crash','correction',
  'risk','reward','max','min','worst','best','ceiling','floor',
  'price','chart','candle','candles','technical','fundamental',
  'expire','expires','expiring','assignment','assign','assigned',
  'margin','leverage','leverage','notional',
  'pop','p(profit)','probability','chance','likelihood',
  'advice','recommend','recommendation','verdict','opinion','should','take','skip',
  'invest','investing','investor','day','week','month','year','time',
  'analysis','analyze','analyzing','compare','comparison',
  'good','bad','better','worse','best','worst','okay','fine',
  'vol','volume','oi','open interest',
]);

const CASUAL_CHAT = /^(hi|hello|hey|sup|yo|what.?s up|how are you|thanks|thank you|thx|ty|bye|goodbye|cya|ok|okay|k|cool|nice|great|awesome|sure|yes|no|yeah|nah)\b/i;

export function answer(question: string, ctx: QAContext | null): QAResponse {
  const q = question.toLowerCase().trim();
  if (!q) return { text: 'Ask me something about your trade.' };

  const isCasual = CASUAL_CHAT.test(q);
  const tokens = q.split(/\W+/).filter(Boolean);
  const hasFinanceToken = tokens.some(t => FINANCE_KEYWORDS.has(t));

  if (!hasFinanceToken && !isCasual) {
    return {
      text: NON_FINANCE_REJECTION,
      followUps: ctx ? ["What's my max loss?", "Should I take this trade?", "Explain the Greeks"] : ["Take me to /trade"],
    };
  }

  if (isCasual && !hasFinanceToken) {
    return {
      text: ctx
        ? `Hey! I'm watching your ${ctx.strategyName} on ${ctx.ticker}. P(profit) is ${(ctx.probProfit*100).toFixed(0)}%. What do you want to know?`
        : `Hey! I'm condor.ai — your options co-pilot. Load a strategy on /trade and I'll be ready to chat.`,
      followUps: ctx ? ["What's my max loss?", "Should I take this trade?", "Explain the Greeks"] : ["Take me to /trade"],
    };
  }

  if (!ctx) {
    return {
      text: 'No strategy is loaded yet. Go to /trade, pick a strategy, run the simulation, then come back and ask me anything finance-related.',
      followUps: ['Take me to /trade'],
    };
  }

  // ───── Intent matching ─────

  if (/max\s*loss|worst\s*case|downside|capped.*loss|lose\s*how\s*much/.test(q)) {
    const ml = Math.abs(ctx.maxLoss ?? 0);
    const total = ml * ctx.contracts;
    return {
      text: `Max loss on this **${ctx.strategyName}** is **$${ml.toFixed(0)}/contract** (×${ctx.contracts} = $${total.toFixed(0)}). That's ${(ml / ctx.spot * 100).toFixed(1)}% of ${ctx.ticker}'s $${ctx.spot.toFixed(0)} spot. Hit if price breaches the long strikes at expiry.`,
      followUps: ['How should I size this?', "What's the breakeven?", 'When should I close?'],
    };
  }

  if (/max\s*profit|upside|best\s*case|ceiling|capped.*profit|how\s*much.*make/.test(q)) {
    if (ctx.maxProfit == null) {
      return {
        text: `Max profit is **unlimited** for this ${ctx.strategyName} — one leg keeps growing as ${ctx.ticker} moves. In practice, take profit at 50–80% of theoretical max to avoid round-trip risk.`,
        followUps: ['When should I take profit?', "What's the probability?", 'Should I take this trade?'],
      };
    }
    return {
      text: `Max profit is **$${ctx.maxProfit.toFixed(0)}/contract** (×${ctx.contracts} = $${(ctx.maxProfit * ctx.contracts).toFixed(0)}). Achieved if ${ctx.ticker} closes between the short strikes at expiry.`,
      followUps: ['Should I take profit early?', "What's the probability?"],
    };
  }

  if (/probability|chance|likelihood|\bpop\b|p\s*\(\s*profit/.test(q)) {
    const pct = (ctx.probProfit * 100).toFixed(1);
    const rating = ctx.probProfit > 0.65 ? 'solid' : ctx.probProfit > 0.5 ? 'moderate' : 'low';
    return {
      text: `P(profit) is **${pct}%** — ${rating} for this setup. Based on Monte Carlo under GBM at σ=${(ctx.sigma*100).toFixed(0)}%, ${ctx.dte} DTE, drift=0.`,
      followUps: ['Should I take this trade?', 'What improves probability?', "What's VaR?"],
    };
  }

  if (/should\s*i\s*(take|enter|do|trade)|recommend|verdict|opinion|take\s*it/.test(q)) {
    if (ctx.probProfit > 0.6 && ctx.expectedPnl > 0 && ctx.maxLoss != null) {
      const rr = ctx.maxProfit != null ? ctx.maxProfit / Math.abs(ctx.maxLoss) : 0;
      return {
        text: `**Take it.** PoP ${(ctx.probProfit*100).toFixed(0)}%, EV +$${ctx.expectedPnl.toFixed(2)}/share, R/R ${rr.toFixed(2)}. Just confirm CVaR ($${ctx.cvar95.toFixed(0)}) fits your risk budget.`,
        followUps: ['How should I size?', 'When should I close?'],
      };
    }
    if (ctx.probProfit > 0.45) {
      return {
        text: `**Marginal.** PoP ${(ctx.probProfit*100).toFixed(0)}% is coin-flip territory. Consider widening strikes (lower Δ) for more breathing room, or skip if EV ($${ctx.expectedPnl.toFixed(2)}) doesn't justify the max loss.`,
        followUps: ['How do I widen strikes?', 'What if vol drops?'],
      };
    }
    return {
      text: `**Skip.** PoP ${(ctx.probProfit*100).toFixed(0)}% is below the 50% threshold. Strikes are too tight for σ=${(ctx.sigma*100).toFixed(0)}%. Try Δ 0.10 instead of 0.16 for safer strikes.`,
        followUps: ['How do I make it safer?', 'What about a different strategy?'],
    };
  }

  if (/breakeven|break\s*even|\bbe\b/.test(q)) {
    if (ctx.breakEvens.length === 0) {
      return { text: 'No breakevens — this strategy has unbounded P/L.' };
    }
    const moves = ctx.breakEvens.map(b => ((b - ctx.spot) / ctx.spot * 100).toFixed(1));
    if (ctx.breakEvens.length === 1) {
      return {
        text: `Breakeven: **$${ctx.breakEvens[0].toFixed(2)}**. ${ctx.ticker} needs to move ${moves[0]}% from $${ctx.spot.toFixed(2)} to break even at expiry.`,
        followUps: ["What's the expected move?", 'Is the buffer wide enough?'],
      };
    }
    const lo = Math.min(...ctx.breakEvens), hi = Math.max(...ctx.breakEvens);
    return {
      text: `Breakevens: **$${lo.toFixed(0)} and $${hi.toFixed(0)}**. Profit zone between them. Buffer = ${((hi-lo)/ctx.spot*100).toFixed(1)}% of spot.`,
      followUps: ["What's the expected move?", 'Is the buffer wide enough?'],
    };
  }

  if (/expected\s*move|\bem\b|1.?sigma|one\s*sigma|straddle\s*price/.test(q)) {
    const em = ctx.sigma * ctx.spot * Math.sqrt(ctx.dte / 365);
    return {
      text: `Expected 1-σ move by expiry: **$${em.toFixed(2)}** (${(em/ctx.spot*100).toFixed(1)}% of spot). That's the typical wiggle. Short strikes should comfortably bracket this.`,
      followUps: ['Are my strikes wide enough?'],
    };
  }

  if (/vol\s*(expensive|cheap|high|low)|iv\s*rank|implied.*high|implied.*low/.test(q)) {
    const v = ctx.sigma * 100;
    const tier = v > 30 ? 'elevated — good for selling premium' : v > 18 ? 'normal' : v > 12 ? 'compressed — be careful selling' : 'very low — premiums are cheap';
    return {
      text: `Realized vol on ${ctx.ticker}: **${v.toFixed(1)}%** — ${tier}. Historical median for large-caps is ~18-22%. IV rank >50% historically = sell premium.`,
      followUps: ['Should I sell premium here?', 'Compare to historical'],
    };
  }

  if (/risk.*reward|\br:r\b|\brr\b/.test(q)) {
    const rr = ctx.maxProfit != null && ctx.maxLoss != null && ctx.maxLoss !== 0
      ? (ctx.maxProfit / Math.abs(ctx.maxLoss)).toFixed(2)
      : '∞';
    return {
      text: `R/R: **${rr}**. Risk $${Math.abs(ctx.maxLoss ?? 0).toFixed(0)} to make $${ctx.maxProfit?.toFixed(0) ?? '∞'}. Credit strategies: >0.25 = good, >0.40 = excellent.`,
      followUps: ['Is this R/R good?', 'Compare to a butterfly'],
    };
  }

  if (/when.*close|exit\s*plan|manage|stop\s*loss|take\s*profit/.test(q)) {
    if (ctx.entry > 0) {
      const halfCredit = ctx.maxProfit! * 0.5;
      const doubleCredit = ctx.maxProfit! * 2;
      return {
        text: `For credit: take profit at **50% of max** (lock in $${halfCredit.toFixed(0)}) OR stop at **2× credit as loss** (cut at -$${doubleCredit.toFixed(0)}). Also exit if short Δ breaches 0.30 — that's the danger zone.`,
        followUps: ["What's a good take-profit?", 'When does Δ get dangerous?'],
      };
    }
    return {
      text: `For debit: take profit when position is worth 2-3× what you paid. Stop loss at 50% of debit. Roll forward/up if the move stalls.`,
      followUps: ['Should I roll the position?'],
    };
  }

  if (/what\s*if.*move|scenario|stock\s*(drops|rises|moves)|down\s*\d|up\s*\d/.test(q)) {
    return {
      text: `Use the **payoff** tab to see P/L at any price at expiry. Yellow lines mark breakevens. The **paths** tab shows the simulated price trajectories — click "show all paths" to see every Monte Carlo scenario.`,
      followUps: ['How do I read the payoff curve?'],
    };
  }

  if (/delta/.test(q)) {
    return {
      text: `**Delta** = $ change in option value per $1 move in ${ctx.ticker}. Net delta on this position: **${ctx.delta.toFixed(0)}**. ${Math.abs(ctx.delta) < 10 ? 'Roughly delta-neutral.' : Math.abs(ctx.delta) > 50 ? 'Significant directional exposure — consider hedging.' : 'Moderate directional exposure.'} ATM option = 0.5Δ.`,
      followUps: ['How do I hedge delta?', 'What about gamma?'],
    };
  }

  if (/gamma/.test(q)) {
    return {
      text: `**Gamma** = how fast delta changes per $1 stock move. For ${ctx.strategyName}, you're ${ctx.delta >= 0 ? 'long' : 'short'} gamma. Short-gamma setups bleed on whipsaws; long-gamma setups profit from movement in either direction.`,
      followUps: ['How does theta offset gamma?'],
    };
  }

  if (/theta/.test(q)) {
    return {
      text: `**Theta** = $ change per day from time passing. Net theta: **$${ctx.theta.toFixed(2)}/contract/day**. ${ctx.theta > 0 ? 'You COLLECT theta — time works for you.' : 'You PAY theta — time works against you.'} Theta accelerates as expiry approaches.`,
      followUps: ['When does theta peak?', 'Is the theta enough to overcome vega?'],
    };
  }

  if (/vega/.test(q)) {
    return {
      text: `**Vega** = $ change per 1% move in IV. Net vega: **${ctx.vega.toFixed(1)}**. ${ctx.vega < 0 ? "You're SHORT vega — an IV spike hurts. Watch earnings, FOMC, and other catalysts." : "You're LONG vega — benefit from IV expansion."}`,
      followUps: ['Should I hedge vega?'],
    };
  }

  if (/greek/.test(q)) {
    return {
      text: `**Greeks** measure sensitivity to risk dimensions:
• **Δ Delta** — $1 stock move
• **Γ Gamma** — how fast Δ changes (convexity)
• **Θ Theta** — 1 day of time
• **ν Vega** — 1% IV move
• **ρ Rho** — 1% rate move (usually ignored)

Your position: Δ ${ctx.delta.toFixed(0)} · Θ $${ctx.theta.toFixed(2)}/day · ν ${ctx.vega.toFixed(1)}.`,
      followUps: ['Tell me more about delta', 'How do I hedge?'],
    };
  }

  if (/open\s*paper|save|track|portfolio/.test(q)) {
    return {
      text: `Click **"📒 open paper position"** in the strategy panel — it saves to your browser's localStorage. Track it with live mark-to-market in **/portfolio**.`,
      followUps: ['Take me to /portfolio'],
    };
  }

  if (/size|position\s*size|how\s*many/.test(q)) {
    const perContractLoss = ctx.maxLoss != null ? Math.abs(ctx.maxLoss) : 0;
    const onePctExample = 10000; // $10k portfolio as a concrete example
    const onePctBudget = onePctExample * 0.01;
    const onePctContracts = perContractLoss > 0 ? Math.floor(onePctBudget / perContractLoss) : 0;
    const rule = perContractLoss > 0
      ? `Max loss per contract here is $${perContractLoss.toFixed(0)}. Rule of thumb: risk ≤ 1% of portfolio per trade.
• On a $10k portfolio → budget $${onePctBudget.toFixed(0)}/trade → ~${onePctContracts} contract(s).
• On a $25k portfolio → budget $250/trade → ~${Math.floor(250 / perContractLoss)} contract(s).
• On a $100k portfolio → budget $1,000/trade → ~${Math.floor(1000 / perContractLoss)} contract(s).
Adjust for your own risk tolerance.`
      : `Define a max-loss target first (e.g. risk ≤ 1% of portfolio per trade) — once we know that number I can convert it to a contract count.`;
    return {
      text: rule,
      followUps: ['How risky is this strategy?', 'What if it goes wrong?'],
    };
  }

  if (/compare|vs\.?|versus|better/.test(q)) {
    return {
      text: `Compare by R/R, PoP, max loss, and capital efficiency. Iron butterflies are tighter but riskier than iron condors. Bull call spreads are cheaper than long calls. Run two sims side-by-side by changing the strategy pill and comparing the metrics.`,
      followUps: ['Show iron butterfly', 'Show bull call spread'],
    };
  }

  if (/hedge|protect|insurance/.test(q)) {
    return {
      text: `For credit setups, you can hedge by buying a further-OTM option (making it a wider spread) or buying the opposite side (e.g., long put to hedge a short call). For directional risk, buy/sell stock to neutralize delta.`,
      followUps: ['How do I hedge delta?'],
    };
  }

  return {
    text: `I can help with: max profit/loss, P(profit), breakevens, expected move, vol, Greeks (Δ Γ Θ ν), when to close, sizing, or "should I take this trade?".`,
    followUps: ['Should I take this trade?', "What's my max loss?", 'Explain the Greeks'],
  };
}

export const QUICK_QUESTIONS = [
  'Should I take this trade?',
  "What's my max loss?",
  "What's P(profit)?",
  'Explain the Greeks',
  'When should I close?',
  'Is vol expensive?',
  'How should I size?',
];