/**
 * Test helper: a `fetch` stub keyed by path fragment. Each route answers {status, body} or a function
 * of the request. Every call is recorded with its init so a test can assert `cache: 'no-store'`.
 */
import { vi } from 'vitest';

export type Reply = { status: number; body?: unknown };
export type Route = Reply | ((url: string, init?: RequestInit) => Reply | Promise<Reply>);

export function stubFetch(routes: Record<string, Route>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((k) => url.includes(k));
    if (!key) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
    const r = routes[key];
    const reply = typeof r === 'function' ? await r(url, init) : r;
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export function callsTo(fn: ReturnType<typeof stubFetch>, fragment: string) {
  return fn.mock.calls.filter(([u]) => String(u).includes(fragment));
}

export const ME_LEADER = { lessons: true, share: true, role: 'coach', ui_lang: 'en' as const };
export const ME_LEADER_UR = { ...ME_LEADER, ui_lang: 'ur' as const };
export const ME_TEACHER = { lessons: true, share: false, role: 'teacher', ui_lang: 'en' as const };

export const PLAN_DATA = {
  plan: { id: 11156, key: 'fln:11156', subject: 'rh-en', lang: 'en', dir: 'ltr', title: "Sounds of 'c/k, e, h, r, m, d' (Fluency)", minutes: 36 },
  placement: [{ subject: 'rh-en', level: 1, grades: [1], strand: 'daily', chapter_title_en: 'Unit 4', chapter_title_ur: null, pos: 24, count: 48 }],
};

/** A text matcher for a line drawn in pieces (a number in <bdi>): the element whose whole text is `t`. */
export function wholeText(t: string) {
  return (_content: string, el: Element | null) =>
    !!el && el.textContent === t && Array.from(el.children).every((c) => c.textContent !== t);
}
