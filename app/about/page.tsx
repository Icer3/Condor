import { Panel } from '@/components/Panels';
import Link from 'next/link';

export default function About() {
  return (
    <div className="space-y-4 max-w-[980px]">
      <Panel title="about/condor.io">
        <h1 className="text-3xl text-[var(--green)] mb-3 font-extrabold glow">Options Workbench</h1>
        <p className="text-[var(--fg)] leading-relaxed">
          condor.io is a paper-trading workbench for anyone learning or thinking about options — built
          first for the &ldquo;what actually happens if I hold this to expiration&rdquo; question. Pick a
          strategy, set your parameters, and the app prices it via Black-Scholes, plots the
          expiration P/L curve, runs a Monte Carlo simulation under Geometric Brownian Motion to
          estimate probability of profit and tail risk, and surfaces plain-English insights about
          the position. Open a paper position to track it in <code className="text-[var(--green)]">/portfolio</code> with
          live mark-to-market, run it through <code className="text-[var(--green)]">/backtest</code>, or study
          each strategy in the <code className="text-[var(--green)]">/learn</code> curriculum.
        </p>
        <p className="text-[var(--fg-dim)] leading-relaxed mt-3">
          Ten strategies cover both sides of the option book — long directional bets, defined-risk
          verticals, and short-premium income plays. Each has its own ruleset, its own P/L shape,
          and its own opinion about where the underlying is going to land by expiration.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-5 text-xs">
          {[
            ['/', 'home · terminal'],
            ['/trade', 'trade · analyze one position'],
            ['/compare', 'compare · two strategies side-by-side'],
            ['/portfolio', 'portfolio · live paper positions'],
            ['/backtest', 'backtest · sweep historical chains'],
            ['/learn', 'learn · strategy curriculum'],
          ].map(([href, label]) => (
            <Link key={href} href={href} className="rounded-[var(--radius-sm)] border border-[var(--border)] hover:border-[var(--green-dim)] bg-[var(--bg-3)]/40 hover:bg-[var(--green-faint)]/20 px-3 py-2 transition flex justify-between">
              <span className="text-[var(--green)] font-bold">{href}</span>
              <span className="text-[var(--fg-dim)]">{label.split(' · ')[1]}</span>
            </Link>
          ))}
        </div>
      </Panel>

      <Panel title="about/vision">
        <h2 className="text-[var(--green)] mb-3 font-semibold">Vision</h2>
        <p className="text-[var(--fg-dim)] leading-relaxed">
          Most &ldquo;options education&rdquo; on the internet either sells you a course before teaching
          you the payoff diagram, or hands you a brokerage form and tells you to &ldquo;paper trade and
          find out.&rdquo; condor.io sits between those: enough theory to know <em>why</em> an iron condor
          profits when the underlying sits still, enough simulation to know <em>how often</em> that
          actually happens, and a paper portfolio that closes the loop without risking a dollar.
        </p>
        <p className="text-[var(--fg-dim)] leading-relaxed mt-3">
          Everything runs <span className="text-[var(--green)] font-bold">pure sim, no broker-by-default</span>.
          No IBKR account, no OAuth, no real-money rail. You can&rsquo;t accidentally make or lose money
          here. When (and if) you want to graduate to a live broker, the simulations you&rsquo;ve
          already logged give you a calibrated baseline for what to expect.
        </p>
        <p className="text-[var(--fg-dim)] leading-relaxed mt-3">
          We are deliberately <span className="text-[var(--green)] font-bold">not</span> a signal service. We
          do not have a &ldquo;best trade for tomorrow&rdquo; newsletter, we do not auto-place trades,
          and we will not cold-message you about an &ldquo;alpha indicator.&rdquo; condor.io is a
          workbench, not a recommendation engine. The math is open, the assumptions are listed,
          and the assumptions you change are visible to you.
        </p>
      </Panel>

      <Panel title="about/curriculum">
        <h2 className="text-[var(--green)] mb-3 font-semibold">Curriculum overview</h2>
        <p className="text-[var(--fg-dim)] leading-relaxed">
          The <Link href="/learn" className="text-[var(--green)] underline">/learn</Link> tab walks all
          ten strategies in roughly the order a beginner should tackle them. Each lesson is
          ten minutes long and ends with a one-line mnemonic.
        </p>
        <ol className="text-[var(--fg-dim)] text-sm mt-4 space-y-2 list-decimal list-inside marker:text-[var(--green)] marker:font-bold">
          {[
            ['Long call', 'simplest directional play · pays when underlying rallies above strike + premium. Capped upside = premium paid; unlimited downside.'],
            ['Long put', 'mirror of long call · pays when underlying drops. Hedge / insurance use-case.'],
            ['Covered call', 'own the stock, sell upside. The first short-premium strategy · converts a long position to "income with capped exit."'],
            ['Short put', 'bullish income · "I want to own this stock cheaper" · max loss = strike − credit, only triggers if the underlying really crashes.'],
            ['Bull call spread', 'bullish, defined risk · pay debit, get capped upside, cheaper than a naked call. The textbook "I think it goes up modestly" trade.'],
            ['Long straddle', 'big-move play · long call + long put at same strike · profits when the underlying moves a lot, either way. Long volatility.'],
            ['Long strangle', 'cheaper straddle · strikes further OTM · needs an even larger move to pay.'],
            ['Iron butterfly', 'short volatility · sell ATM straddle, buy wings · max profit if underlying pins the center strike. The theta-on-theta classic.'],
            ['Iron condor', 'the headline strategy · two credit spreads · max profit if underlying stays between the short strikes. Income with a defined loss ceiling.'],
            ['Calendar spread', 'sell near-term, buy longer-dated same strike · profits from accelerated front-month decay. Advanced, time-decay asymmetric.'],
          ].map(([name, blurb], i) => (
            <li key={i} className="leading-snug">
              <span className="text-[var(--fg)] font-bold">{name}</span> — {blurb}
            </li>
          ))}
        </ol>
      </Panel>

      <Panel title="about/applications">
        <h2 className="text-[var(--green)] mb-3 font-semibold">Trading applications (which strategy for which view)</h2>
        <p className="text-[var(--fg-dim)] leading-relaxed">
          Strategies are opinions about where the underlying lands by expiration. Match the opinion
          to the trade:
        </p>
        <table className="text-xs w-full mt-3 border-collapse">
          <thead>
            <tr className="text-[var(--fg-faint)] uppercase tracking-wider text-[10px] border-b border-[var(--border)]">
              <th className="text-left py-2 pr-2 font-medium">market view</th>
              <th className="text-left py-2 pr-2 font-medium">preferred strategy</th>
              <th className="text-left py-2 pr-2 font-medium">theta profile</th>
              <th className="text-left py-2 font-medium">max-loss shape</th>
            </tr>
          </thead>
          <tbody className="text-[var(--fg-dim)]">
            {[
              ['rally, large', 'long call', 'negative', 'unlimited'],
              ['rally, modest', 'bull call spread', 'negative', 'defined (debit paid)'],
              ['flat-to-down, own the stock', 'covered call', 'positive', 'unlimited (lost upside)'],
              ['flat-to-down, want to be paid to wait', 'short put', 'positive', 'large (K − credit)'],
              ['flat, high vol', 'iron butterfly', 'very positive', 'defined (wing × 100)'],
              ['flat, normal vol', 'iron condor', 'very positive', 'defined (wing × 100)'],
              ['big move either way, low IV', 'long straddle', 'negative', 'premium paid'],
              ['big move either way, even lower cost', 'long strangle', 'negative', 'premium paid'],
              ['whipsaw, no strong view', 'skip the trade', '—', '—'],
            ].map((row, i) => (
              <tr key={i} className="border-b border-[var(--border)]/40">
                {row.map((cell, j) => (
                  <td key={j} className={`py-1.5 pr-2 ${j === 0 ? 'text-[var(--fg)]' : ''}`}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        <h3 className="text-[var(--green)] text-sm mt-5 mb-2 font-semibold">The 4-line decision rubric</h3>
        <ol className="text-[var(--fg-dim)] text-xs space-y-1 list-decimal list-inside marker:text-[var(--green)] marker:font-bold">
          <li>What&rsquo;s my view on direction? (up / down / sideways)</li>
          <li>What&rsquo;s my view on magnitude? (small, modest, big move)</li>
          <li>What&rsquo;s my view on vol? (rising / falling / stable)</li>
          <li>Can I size the trade so max-loss × contracts × 100 is &lt; 2% of portfolio?</li>
        </ol>
        <p className="text-[var(--fg-dim)] text-xs mt-3 leading-relaxed">
          If you answered all four honestly and the math agrees, the trade is probably yours. If any
          answer is &ldquo;I don&rsquo;t know,&rdquo; the trade is no-trade.
        </p>
      </Panel>

      <Panel title="about/the_strategy">
        <h2 className="text-[var(--fg)] mb-3 font-semibold">The Iron Condor (example mechanics)</h2>
        <p className="text-[var(--fg-dim)] mb-4 leading-relaxed">
          Four legs, two credit spreads. You sell an out-of-the-money call and buy a further-OTM call
          (the call credit spread), and sell an out-of-the-money put and buy a further-OTM put
          (the put credit spread). Net result: a net credit received up front, max profit if the
          underlying closes between the short strikes at expiration, max loss if it breaches the
          long strikes.
        </p>
        <pre className="text-xs bg-[var(--bg-3)]/40 border border-[var(--border)] rounded-[var(--radius-sm)] p-4 text-[var(--fg-dim)] overflow-x-auto">
{`S      = spot price
σ      = annualized vol
T      = years to expiry
r      = risk-free rate
z      = Φ⁻¹(1 − Δ)         (Δ = target short-strike delta)

K_sc ≈ S · exp(z·σ·√T − (r + ½σ²)T)         (short call strike)
K_lc  = K_sc + wing                          (long call strike)
K_sp ≈ S · exp(−z·σ·√T − (r + ½σ²)T)        (short put strike)
K_lp  = K_sp − wing                          (long put strike)`}
        </pre>
      </Panel>

      <Panel title="about/math">
        <h2 className="text-[var(--fg)] mb-3 font-semibold">The Math</h2>
        <h3 className="text-[var(--green)] text-sm mb-2 font-semibold">Black-Scholes</h3>
        <pre className="text-xs bg-[var(--bg-3)]/40 border border-[var(--border)] rounded-[var(--radius-sm)] p-4 text-[var(--fg-dim)] overflow-x-auto mb-4">
{`d₁ = [ln(S/K) + (r + ½σ²)T] / (σ√T)
d₂ = d₁ − σ√T

C = S·N(d₁) − K·e^(−rT)·N(d₂)
P = K·e^(−rT)·N(−d₂) − S·N(−d₁)`}
        </pre>
        <h3 className="text-[var(--green)] text-sm mb-2 font-semibold">Geometric Brownian Motion</h3>
        <pre className="text-xs bg-[var(--bg-3)]/40 border border-[var(--border)] rounded-[var(--radius-sm)] p-4 text-[var(--fg-dim)] overflow-x-auto mb-4">
{`S_{t+dt} = S_t · exp((μ − ½σ²)dt + σ·√dt · Z),   Z ~ N(0,1)`}
        </pre>
        <p className="text-[var(--fg-dim)] text-xs leading-relaxed">
          We simulate <span className="text-[var(--fg)] font-semibold">N</span> daily-stepped GBM paths to expiration, then compute
          the per-share P/L on each terminal price using the strategy&rsquo;s payoff function. From
          the resulting distribution we report probability of profit, expected P/L, 5% Value-at-Risk,
          Conditional VaR (expected shortfall in the worst 5%), and the fraction of paths hitting
          max profit vs. max loss.
        </p>
      </Panel>

      <Panel title="about/limitations">
        <h2 className="text-[var(--fg)] mb-3 font-semibold">What this model does NOT do</h2>
        <ul className="text-[var(--fg-dim)] text-xs space-y-1.5">
          {[
            'Constant volatility — real vol has a smile/skew and regime shifts.',
            'Continuous paths — real prices gap overnight and on news.',
            'No bid/ask spreads or commissions modeled.',
            'No early-exercise / pin risk on expiration Friday.',
            'Real-world drift is hard to estimate; the default of 0% is a neutral baseline.',
            'No implied-vol surface — we use realized vol σ as a flat input. Greeks near the money are the most reliable; deep-OTM wings are noisier.',
          ].map((t, i) => (
            <li key={i} className="flex gap-2"><span className="text-[var(--red)]">✗</span><span>{t}</span></li>
          ))}
        </ul>
        <p className="text-[var(--fg-dim)] text-xs mt-4 leading-relaxed">
          Treat outputs as directional guidance, not a forecast. Always size positions so max loss ×
          contracts × 100 fits comfortably within your risk budget (the 2% rule above).
        </p>
      </Panel>

      <Panel title="about/licensing">
        <h2 className="text-[var(--fg)] mb-3 font-semibold">License &amp; data</h2>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <StackRow label="code" value="MIT (open source)" />
          <StackRow label="data" value="free-tier equity quotes" />
          <StackRow label="usage" value="personal, educational" />
          <StackRow label="no-warranty" value="not investment advice" />
        </div>
        <p className="text-[var(--fg-dim)] text-xs mt-4 leading-relaxed">
          No trade recommendations, no auto-trading, no broker integration in the base app. If we
          ever add broker connectivity, it will be opt-in, behind a separate gate, and disclosed
          with the broker&rsquo;s terms before OAuth. Nothing on this site is a recommendation to buy or
          sell any security. Backtests and simulations use historical volatility as a forward-input
          assumption; past behavior is not a guarantee of future behavior.
        </p>
      </Panel>

      <Panel title="about/stack">
        <h2 className="text-[var(--fg)] mb-3 font-semibold">Stack</h2>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <StackRow label="framework" value="Next.js (App Router)" />
          <StackRow label="language" value="TypeScript" />
          <StackRow label="styling" value="Tailwind + custom CSS vars" />
          <StackRow label="charts" value="Recharts" />
          <StackRow label="data" value="Yahoo (free tier) + Stooq fallback" />
          <StackRow label="compute" value="pure TS (Black-Scholes, GBM, IV-rank)" />
          <StackRow label="storage" value="localStorage (paper portfolio)" />
          <StackRow label="deploy" value="serverless (Vercel-ready)" />
        </div>
      </Panel>
    </div>
  );
}

function StackRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-[var(--border)] py-1.5">
      <span className="text-[var(--fg-faint)] text-xs">{label}</span>
      <span className="text-[var(--fg)] text-xs">{value}</span>
    </div>
  );
}
