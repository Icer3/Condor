import { ReactNode } from 'react';

export function Panel({
  title, children, right, className = '', contentClassName = '',
}: {
  title?: string;
  children: ReactNode;
  right?: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--border)] bg-gradient-to-r from-[rgba(34,197,94,0.04)] to-transparent">
          <div className="text-[10px] text-[var(--fg-dim)] flex items-center gap-1.5">
            <span className="inline-block w-1 h-1 rounded-full bg-[var(--green)] shadow-[0_0_6px_rgba(74,222,128,0.6)]" />
            <span className="tracking-wide">{title}</span>
          </div>
          {right}
        </div>
      )}
      <div className={`p-3 ${contentClassName}`}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, accent = 'fg', size = 'sm' }: {
  label: string; value: ReactNode;
  accent?: 'fg' | 'green' | 'red' | 'dim' | 'yellow';
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const colors: Record<string, string> = {
    fg: 'text-[var(--fg)]',
    green: 'text-[var(--green)]',
    red: 'text-[var(--red)]',
    dim: 'text-[var(--fg-dim)]',
    yellow: 'text-[var(--yellow)]',
  };
  const sizes: Record<string, string> = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-xl',
    xl: 'text-3xl',
  };
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-3)]/60 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-[var(--fg-faint)] font-medium leading-none">{label}</div>
      <div className={`${sizes[size]} font-bold ${colors[accent]} mt-0.5 tabular-nums leading-tight`}>{value}</div>
    </div>
  );
}

export function Tag({ children, color = 'dim' }: { children: ReactNode; color?: 'dim' | 'green' | 'red' | 'yellow' }) {
  const c = {
    dim: 'border-[var(--border)] text-[var(--fg-dim)] bg-[var(--bg-3)]',
    green: 'border-[var(--green-dim)] text-[var(--green)] bg-[var(--green-faint)]',
    red: 'border-[var(--red-dim)] text-[var(--red)] bg-[#1c0a0a]',
    yellow: 'border-[#854d0e] text-[var(--yellow)] bg-[#1c1408]',
  }[color];
  return <span className={`inline-block border rounded-full px-2 py-0.5 text-[9px] uppercase tracking-wider ${c}`}>{children}</span>;
}