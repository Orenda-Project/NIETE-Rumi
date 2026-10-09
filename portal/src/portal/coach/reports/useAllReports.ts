import { useEffect, useState } from "react";
import { coach } from "../../services/api";
import type { CoachReport } from "../types";
import { shouldLoadMore, type Span } from "./data";

/**
 * bd-4404s7.5 — the All Observations page's rows. The server answers newest first, 30 a page, with the search
 * applied; the page asks for further pages while the numbers still need them (data.ts shouldLoadMore: the range and
 * the period before it). A cap keeps a runaway list from asking forever. A failed page is a failure, never a
 * shorter list.
 */
const MAX_PAGES = 40;

export type AllReports = {
  status: "loading" | "ready" | "failed";
  items: CoachReport[];
  total: number;
  /** What waits on her now (the page's own Waiting for you). */
  waiting: number;
  retry: () => void;
};

export function useAllReports(q: string, span: Span): AllReports {
  const [state, setState] = useState<Omit<AllReports, "retry">>({ status: "loading", items: [], total: 0, waiting: 0 });
  const [tick, setTick] = useState(0);
  const { from, to, prevFrom, prevTo } = span;

  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, status: "loading" }));
    (async () => {
      let items: CoachReport[] = [];
      let total = 0;
      let waiting = 0;
      const bounds: Span = { from, to, prevFrom, prevTo };
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const d = await coach.getReports({ page, q: q.trim() || undefined });
        if (!live) return;
        items = items.concat(d.all.items);
        total = d.all.total;
        waiting = d.waiting.length;
        if (!d.all.items.length || !shouldLoadMore(items, total, bounds)) break;
      }
      if (live) setState({ status: "ready", items, total, waiting });
    })().catch(() => { if (live) setState((s) => ({ ...s, status: "failed" })); });
    return () => { live = false; };
  }, [q, from, to, prevFrom, prevTo, tick]);

  return { ...state, retry: () => setTick((n) => n + 1) };
}
