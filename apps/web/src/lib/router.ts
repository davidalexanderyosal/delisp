import { useSyncExternalStore } from 'react';

/** Hash routing: no server rewrites needed, and the phone's back button works. */
export function navigate(path: string): void {
  window.location.hash = path.startsWith('#') ? path : `#${path}`;
}

function currentPath(): string {
  const hash = window.location.hash.replace(/^#/, '');
  return hash.length > 0 ? hash : '/';
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

export function useRoute(): string {
  return useSyncExternalStore(subscribe, currentPath, () => '/');
}
