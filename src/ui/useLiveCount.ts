"use client";

import { useEffect, useState } from "react";

export type LiveSuggestion = { kind: string; maxCents?: number; gain: number } | null;

/**
 * "Atbilst N" for a candidate state (encoded `?a=`), from /api/count, which
 * uses the same rules as the results page. Debounced so dragging a slider
 * does not flood the server; the last request wins.
 */
export function useLiveCount(subId: string, encoded: string, initial: number | null = null) {
  const [count, setCount] = useState<number | null>(initial);
  const [suggestion, setSuggestion] = useState<LiveSuggestion>(null);
  // Loading is derived: the key the shown count belongs to differs from the current one.
  const key = `${subId}|${encoded}`;
  const [loadedKey, setLoadedKey] = useState(initial === null ? "" : key);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/count?sub=${encodeURIComponent(subId)}&a=${encodeURIComponent(encoded)}`, {
        signal: controller.signal,
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((body: { count: number; suggestion: LiveSuggestion } | null) => {
          if (!body) return;
          setCount(body.count);
          setSuggestion(body.suggestion);
        })
        .catch(() => {})
        .finally(() => setLoadedKey(key));
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [subId, encoded, key]);

  return { count, suggestion, loading: loadedKey !== key };
}
