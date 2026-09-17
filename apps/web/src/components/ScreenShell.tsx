import type { ReactNode } from 'react';
import { navigate } from '../lib/router';

export function ScreenShell({
  title,
  back,
  action,
  children,
}: {
  title: string;
  back?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))]">
      <header className="flex items-center gap-3 py-2">
        {back ? (
          <button
            type="button"
            onClick={() => navigate(back)}
            aria-label="Back"
            className="-ml-2 flex h-11 w-11 items-center justify-center rounded-full text-slate-400 active:bg-ink-700"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : null}
        <h1 className="flex-1 text-lg font-semibold tracking-tight text-slate-100">{title}</h1>
        {action}
      </header>
      <main className="flex flex-1 flex-col gap-4 pt-2">{children}</main>
    </div>
  );
}
