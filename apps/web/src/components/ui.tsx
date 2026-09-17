import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-emerald-500 text-ink-900 active:bg-emerald-400 disabled:bg-ink-600 disabled:text-slate-500',
  secondary: 'bg-ink-600 text-slate-100 active:bg-ink-500 disabled:text-slate-500',
  ghost: 'bg-transparent text-slate-300 active:bg-ink-700',
  danger: 'bg-rose-500/90 text-white active:bg-rose-500',
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`min-h-[56px] w-full select-none rounded-2xl px-5 text-base font-semibold tracking-tight transition-colors ${VARIANTS[variant]} ${className}`}
    />
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-ink-800 p-4 ${className}`}>{children}</div>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-2xl bg-ink-800 px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 font-mono text-xl tabular-nums text-slate-100">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function Banner({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn' | 'error';
  children: ReactNode;
}) {
  const tones = {
    info: 'bg-sky-500/10 text-sky-200 ring-sky-500/30',
    warn: 'bg-amber-500/10 text-amber-200 ring-amber-500/30',
    error: 'bg-rose-500/10 text-rose-200 ring-rose-500/30',
  } as const;
  return <div className={`rounded-2xl px-4 py-3 text-sm ring-1 ${tones[tone]}`}>{children}</div>;
}
