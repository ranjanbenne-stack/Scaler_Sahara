"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Polls a JSON endpoint so the dashboard updates without manual refresh.
 * Pauses while the tab is hidden and refreshes immediately when it returns.
 * On 401 it redirects to the login page.
 */
export function usePoll<T>(url: string, intervalMs = 4000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(url, { cache: "no-store" });
      setStatus(res.status);
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) {
        setError(res.status === 404 ? "Not found" : `Request failed (${res.status})`);
        return;
      }
      setData((await res.json()) as T);
      setError(null);
    } catch {
      setError("Connection problem — retrying…");
    }
  }, [url]);

  useEffect(() => {
    let active = true;
    const tick = async () => {
      if (!active) return;
      if (document.visibilityState === "visible") await load();
      timer.current = setTimeout(tick, intervalMs);
    };
    void tick();
    const onVis = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      active = false;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load, intervalMs]);

  return { data, error, status, reload: load };
}
