'use client';

import { ReactNode, useEffect } from 'react';

export function SettingsModal({
  open,
  onClose,
  title = '~parameters',
  children,
  width = 'max-w-md',
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[55] bg-black/60 backdrop-blur-sm flex items-start justify-center pt-16 px-4" onClick={onClose}>
      <div className={`panel ${width} w-full`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--border)] bg-gradient-to-r from-[rgba(34,197,94,0.04)] to-transparent">
          <div className="text-[10px] text-[var(--fg-dim)] flex items-center gap-1.5">
            <span className="inline-block w-1 h-1 rounded-full bg-[var(--green)] shadow-[0_0_6px_rgba(74,222,128,0.6)]" />
            <span className="tracking-wide">{title}</span>
          </div>
          <button onClick={onClose} className="text-[var(--fg-faint)] hover:text-[var(--fg)] w-6 h-6 flex items-center justify-center text-base">✕</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}