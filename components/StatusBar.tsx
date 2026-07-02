'use client';
import { useEffect, useState } from 'react';

export function StatusBar() {
  const [t, setT] = useState('');
  useEffect(() => {
    const fmt = () => new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    setT(fmt());
    const id = setInterval(() => setT(fmt()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <footer className="border-t border-[var(--border)] bg-[var(--bg-2)]/80 backdrop-blur-md text-xs text-[var(--fg-faint)] mt-6">
      <div className="max-w-[1500px] mx-auto px-6 py-2.5 flex items-center gap-5 overflow-x-auto">
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)] shadow-[0_0_6px_rgba(74,222,128,0.6)]" />
          session live
        </span>
        <span>strategy: <span className="text-[var(--fg)]">iron_condor</span></span>
        <span>model: <span className="text-[var(--fg)]">GBM</span></span>
        <span>pricing: <span className="text-[var(--fg)]">black-scholes</span></span>
        <span className="ml-auto tabular-nums">{t}</span>
      </div>
    </footer>
  );
}