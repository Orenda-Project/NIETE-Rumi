/**
 * bd-t7zk3t.12 — the leader-side FLN API client (contracts/api.md v2: me, links, title, events; teachers + send are
 * PR-E's server routes). Plain `fetch`, the session cookie (same-origin), `cache: 'no-store'` on every read — never the
 * shared `services/api.ts` client, whose 401 handler differs between branches and drops the page being opened.
 * Every function answers a tagged result and never throws, so a component draws one state per answer.
 */
import type { ShareLang, ShareSubject } from './strings.share';

const BASE = '/api/portal/fln';
const READ: RequestInit = { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } };

/** `status` 0 = the network failed; `data` is set only when `ok`. */
export interface Got<T> {
  ok: boolean;
  status: number;
  data: T | null;
  /** The server's `error` code on a refusal, when it sent one (e.g. `link_area_only`). */
  error?: string;
}

async function getJson<T>(path: string): Promise<Got<T>> {
  try {
    const res = await fetch(`${BASE}${path}`, READ);
    if (!res.ok) return { ok: false, status: res.status, data: null };
    return { ok: true, status: res.status, data: (await res.json()) as T };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

export interface FlnMe {
  lessons: boolean;
  share: boolean;
  role: string | null;
  ui_lang: ShareLang;
}

export interface LinkChips {
  sounds?: number;
  words?: number;
  narration?: boolean;
  video?: boolean;
  textbook?: boolean;
  additional?: boolean;
  screener?: boolean;
  guide?: boolean;
}

export interface LinkRow {
  id: number;
  title: string;
  lang: ShareLang;
  dir: 'ltr' | 'rtl';
  minutes?: number | null;
  chips?: LinkChips;
  url: string;
  level: 1 | 2 | 3 | null;
  grades?: number[];
  chapter_title_en?: string | null;
  chapter_title_ur?: string | null;
  pos?: number | null;
  count?: number | null;
  used_by?: number;
}

export interface LinksQuery {
  grade: number;
  subject: ShareSubject;
  level?: number | null;
  q?: string;
  has?: string[];
}

export interface Teacher {
  key: string;
  name: string;
  school?: string | null;
}

export interface SendResult {
  queued: number;
  failed: string[];
}

export const shareApi = {
  me: () => getJson<FlnMe>('/me'),

  links: (q: LinksQuery) => {
    const p = new URLSearchParams({ grade: String(q.grade), subject: q.subject });
    if (q.level) p.set('level', String(q.level));
    if (q.q) p.set('q', q.q);
    if (q.has && q.has.length) p.set('has', q.has.join(','));
    p.set('sort', 'used');
    return getJson<{ rows: LinkRow[] }>(`/links?${p.toString()}`);
  },

  title: (id: number | string) => getJson<{ title: string; lang: ShareLang; dir: 'ltr' | 'rtl' }>(`/title/${encodeURIComponent(String(id))}`),

  teachers: (q: string) => getJson<{ teachers: Teacher[] }>(`/teachers${q ? `?q=${encodeURIComponent(q)}` : ''}`),

  send: async (plan: number, teachers: string[]): Promise<Got<SendResult>> => {
    try {
      const res = await fetch(`${BASE}/send`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ plan, teachers }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: unknown } | null;
        return { ok: false, status: res.status, data: null, error: typeof err?.error === 'string' ? err.error : undefined };
      }
      const body = (await res.json()) as Partial<SendResult>;
      return { ok: true, status: res.status, data: { queued: Number(body.queued) || 0, failed: Array.isArray(body.failed) ? body.failed.map(String) : [] } };
    } catch {
      return { ok: false, status: 0, data: null };
    }
  },

  /** Fire-and-forget telemetry (kinds `share` | `link_copy`); never throws, never blocks the tap. */
  event: (kind: 'share' | 'link_copy', plan: number) => {
    try {
      void fetch(`${BASE}/events`, {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([{ kind, plan }]),
      }).catch(() => undefined);
    } catch {
      /* a fetch that throws synchronously must not break the button */
    }
  },
};
