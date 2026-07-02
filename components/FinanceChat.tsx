'use client';

import { useState, useRef, useEffect } from 'react';
import { answer, QUICK_QUESTIONS, QAContext } from '@/lib/financeQA';

interface Message {
  role: 'user' | 'assistant';
  text: string;
  followUps?: string[];
}

export function FinanceChat({ context }: { context: QAContext | null }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      text: context
        ? `Hi! I'm condor.ai, your finance-only options copilot. I can answer questions about your **${context.strategyName}** on **${context.ticker}** — try the chips below or ask anything finance-related.`
        : `Hi! I'm condor.ai, your finance-only options copilot. Run a simulation on /trade first, then ask me anything about the trade.`,
    },
  ]);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  // Reset chat when context changes (new sim).
  useEffect(() => {
    if (context) {
      setMessages([{
        role: 'assistant',
        text: `Loaded new sim: **${context.strategyName}** on **${context.ticker}**. P(profit) is ${(context.probProfit*100).toFixed(0)}%, max loss $${Math.abs(context.maxLoss ?? 0).toFixed(0)}. What do you want to know?`,
      }]);
    }
  }, [context?.strategyName, context?.ticker]); // eslint-disable-line

  const ask = (q: string) => {
    if (!q.trim()) return;
    setInput('');
    setMessages(m => [...m, { role: 'user', text: q }]);
    const response = answer(q, context);
    setTimeout(() => {
      setMessages(m => [...m, { role: 'assistant', text: response.text, followUps: response.followUps }]);
    }, 250);
  };

  return (
    <>
      {/* Floating brand mark — same image as favicon, NOT clipped to a circle.
          Previous version used mark-32.png inside a rounded-full button which
          shrunk the visible mark to a sub-pixel inset; now we render the full
          squircle + cream-bar favicon at its natural shape. */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Open finance AI assistant"
        className={`fixed bottom-5 right-5 z-[60] w-16 h-16 hover:scale-110 active:scale-95 transition-all duration-200 drop-shadow-[0_0_18px_rgba(34,197,94,0.55)] hover:drop-shadow-[0_0_28px_rgba(34,197,94,0.8)] ${open ? '' : ''}`}
        style={{ animation: open ? 'none' : 'pulse-glow 2.5s ease-in-out infinite' }}
      >
        <img src="/icon.png" alt="condor.ai" width={64} height={64} className="w-full h-full" />
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-24 right-5 z-[60] w-[400px] max-w-[calc(100vw-2.5rem)] h-[540px] max-h-[calc(100vh-8rem)] rounded-[var(--radius)] border border-[var(--border-bright)] bg-[var(--bg-2)]/95 backdrop-blur-md shadow-[var(--shadow-lg)] flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] bg-gradient-to-r from-[var(--green-faint)] to-transparent">
            <div className="flex items-center gap-2">
              <img src="/icon.png" alt="condor.ai" width={28} height={28} className="drop-shadow-[0_0_10px_rgba(34,197,94,0.5)]" />
              <div>
                <div className="text-xs font-bold text-[var(--fg)] tracking-wide">condor.ai</div>
                <div className="text-[9px] text-[var(--fg-faint)] uppercase tracking-wider">finance-only · strict</div>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="text-[var(--fg-faint)] hover:text-[var(--fg)] text-base w-7 h-7 flex items-center justify-center">✕</button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {messages.map((m, i) => (
              <div key={i}>
                <div className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[88%] px-2.5 py-1.5 rounded-[var(--radius-sm)] text-[11px] leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-[var(--green-faint)] border border-[var(--green-dim)] text-[var(--fg)]'
                      : 'bg-[var(--bg-3)] border border-[var(--border)] text-[var(--fg)]'
                  }`}>
                    {renderInline(m.text)}
                  </div>
                </div>
                {m.role === 'assistant' && m.followUps && m.followUps.length > 0 && i === messages.length - 1 && (
                  <div className="flex flex-wrap gap-1 mt-1.5 ml-1">
                    {m.followUps.map((q, j) => (
                      <button
                        key={j}
                        onClick={() => ask(q)}
                        className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--border)] bg-[var(--bg-3)]/40 text-[var(--fg-dim)] hover:text-[var(--green)] hover:border-[var(--green-dim)] transition"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick-reply chips at start */}
          {messages.length <= 1 && context && (
            <div className="px-3 pb-2 flex gap-1 flex-wrap border-t border-[var(--border)] pt-2">
              {QUICK_QUESTIONS.slice(0, 4).map(q => (
                <button
                  key={q}
                  onClick={() => ask(q)}
                  className="text-[10px] px-2 py-1 rounded-full border border-[var(--green-dim)] bg-[var(--green-faint)]/40 text-[var(--green)] hover:bg-[var(--green-faint)] transition"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          <div className="p-2 border-t border-[var(--border)] flex gap-1.5 bg-[var(--bg-3)]/40">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && ask(input)}
              placeholder="Ask about this trade..."
              className="flex-1 text-[11px] px-2 py-1.5"
            />
            <button
              onClick={() => ask(input)}
              disabled={!input.trim()}
              className="btn-primary px-3 text-[10px] font-bold"
            >
              send
            </button>
          </div>
          <div className="text-center text-[9px] text-[var(--fg-faint)] py-1 border-t border-[var(--border)] bg-[var(--bg-3)]/20">
            not investment advice · educational tool only
          </div>
        </div>
      )}
    </>
  );
}

function renderInline(text: string) {
  // Split on **bold** and on [text](url)
  const parts = text.split(/(\*\*[^*]+\*\*)/);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="text-[var(--green)] font-bold">{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}