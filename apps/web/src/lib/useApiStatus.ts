import { useCallback, useEffect, useState } from 'react';
import { httpClient } from './api';

/**
 * Shared across mounts: Home, Drill and Baseline all ask, and probing once per
 * navigation would put a request behind every screen change for an answer that
 * does not change that fast.
 */
const PROBE_TTL_MS = 30000;
let cached: { at: number; ok: boolean } | null = null;
let inFlight: Promise<boolean> | null = null;

function probe(force: boolean): Promise<boolean> {
  if (!force && cached && Date.now() - cached.at < PROBE_TTL_MS) {
    return Promise.resolve(cached.ok);
  }
  inFlight ??= httpClient()
    .health()
    .then((ok) => {
      cached = { at: Date.now(), ok };
      inFlight = null;
      return ok;
    });
  return inFlight;
}

export interface ApiStatus {
  /** True once the Worker has answered a health check. */
  available: boolean;
  /** False until the first probe has finished, so the UI can avoid flapping. */
  checked: boolean;
  recheck: () => void;
}

/**
 * One health probe on mount, and again whenever the browser regains
 * connectivity. Levels scored by transcription are unlocked by this, so it has
 * to fail closed: an unreachable Worker means those levels stay locked rather
 * than silently scoring every trial as a pass.
 */
export function useApiStatus(): ApiStatus {
  const [available, setAvailable] = useState(false);
  const [checked, setChecked] = useState(false);
  const [nonce, setNonce] = useState(0);

  const recheck = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    void probe(nonce > 0).then((ok) => {
      if (cancelled) return;
      setAvailable(ok);
      setChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  useEffect(() => {
    window.addEventListener('online', recheck);
    return () => window.removeEventListener('online', recheck);
  }, [recheck]);

  return { available, checked, recheck };
}
