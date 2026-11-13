import { browserEnv, getApiBaseUrl } from '@/lib/runtime';

/**
 * "Get ready for offline" and the class list, reported to the logs (POST /funnel/sa-offline → sa_prep.* / sa_list.*).
 * Both run only on the phone: a Get ready that never finished, or a class list that never came, left no trace on our
 * side (a reviewer's phone, 10 Nov). This says how each ended, how long it took, and what the phone's two service
 * workers were doing — the page's (assess-sw.js, scope /portal/leader/assess) and the engine's (/sa/sw.js, scope /sa/).
 * Counts, known words, paths without their query and booleans only: no names, no ids, no children.
 * Fire-and-forget like micReport.ts: nothing waits on it and nothing it does can throw into the page.
 */
export type WorkerState = {
  /** this page is answered by its own offline worker */
  pageSwControlled: boolean;
  pageSwScript: string;
  saSwScript: string;
  /** the engine's active worker's state, 'none' when there is no registration */
  saSwActive: string;
  saSwWaiting: boolean;
  saSwInstalling: boolean;
  /** the engine's registration found a new worker while this was watched (watchSaWorker) */
  saSwUpdateFound: boolean;
};

export type PrepReport = WorkerState & {
  k: 'prep';
  outcome: 'ready' | 'partly' | 'updating';
  ok: boolean;
  why: string | null;
  total: number;
  cached: number;
  missing: number;
  missingPaths: string[];
  missingForms: string[];
  bytes: number;
  forms: number;
  schools: number;
  listed: number;
  grades: number;
  elapsedMs: number;
  pageKept: boolean;
};
export type PrepWaiting = WorkerState & { k: 'prep_waiting'; phase: 'page' | 'lists' | 'files'; done: number; total: number; elapsedMs: number };
export type ListFailed = {
  k: 'list_failed'; reason: string | null; shown: 'problem' | 'failed' | 'saved_list'; network: boolean; status: number | null; elapsedMs: number; grade: number | null;
};
export type ListSlow = WorkerState & { k: 'list_slow'; elapsedMs: number; pending: boolean; grade: number | null };
export type ListLate = { k: 'list_late'; elapsedMs: number; grade: number | null };

export type SaOfflineReport = PrepReport | PrepWaiting | ListFailed | ListSlow | ListLate;

export function reportSaOffline(r: SaOfflineReport): void {
  try {
    const body = JSON.stringify({ ...r, b: browserEnv() });
    void fetch(`${getApiBaseUrl()}/funnel/sa-offline`, {
      method: 'POST', body, headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, credentials: 'include', keepalive: true,
    }).catch(() => {});
  } catch {
    /* the report never decides anything */
  }
}

/** A report is best-effort: whatever it does (throws, rejects), the page goes on. */
export function safely(f: () => unknown): void {
  try {
    const p = f();
    if (p && typeof (p as Promise<unknown>).catch === 'function') (p as Promise<unknown>).catch(() => {});
  } catch { /* never */ }
}

const NONE: WorkerState = {
  pageSwControlled: false, pageSwScript: '', saSwScript: '', saSwActive: 'none', saSwWaiting: false, saSwInstalling: false, saSwUpdateFound: false,
};

const pathOf = (url: string | undefined) => {
  if (!url) return '';
  try { return new URL(url, location.href).pathname; } catch { return ''; }
};

/** Both workers as they are now, read without changing either (no register, no update). Never throws. */
export async function workerState(updateFound = false): Promise<WorkerState> {
  try {
    const sw = navigator.serviceWorker;
    if (!sw) return { ...NONE, saSwUpdateFound: updateFound };
    const page = pathOf(sw.controller?.scriptURL);
    let reg: ServiceWorkerRegistration | undefined;
    try { reg = await sw.getRegistration?.('/sa/'); } catch { reg = undefined; }
    return {
      pageSwControlled: /\/assess-sw\.js$/.test(page),
      pageSwScript: page,
      saSwScript: pathOf(reg?.active?.scriptURL),
      saSwActive: reg?.active?.state || 'none',
      saSwWaiting: !!reg?.waiting,
      saSwInstalling: !!reg?.installing,
      saSwUpdateFound: updateFound,
    };
  } catch {
    return { ...NONE, saSwUpdateFound: updateFound };
  }
}

/** Notice the engine's registration finding a new worker while Get ready runs (listening only). Never throws. */
export function watchSaWorker(): { state: () => Promise<WorkerState>; stop: () => void } {
  let found = false;
  let reg: ServiceWorkerRegistration | undefined;
  let stopped = false;
  const onFound = () => { found = true; };
  try {
    Promise.resolve(navigator.serviceWorker?.getRegistration?.('/sa/')).then((r) => {
      if (!r || stopped) return;
      reg = r;
      r.addEventListener?.('updatefound', onFound);
    }, () => {});
  } catch { /* no worker API */ }
  return {
    state: () => workerState(found),
    stop: () => {
      stopped = true;
      try { reg?.removeEventListener?.('updatefound', onFound); } catch { /* gone */ }
    },
  };
}
