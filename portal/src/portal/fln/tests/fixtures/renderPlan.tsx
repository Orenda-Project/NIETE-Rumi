/**
 * Render the plan page the way the router does (`/portal/fln/p/:id`), with `fetch` (the network
 * boundary) answering the plan request. A probe route shows where Back / "Go to the lesson list" navigated.
 */
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import { PlanScreen } from '../../PlanPage';
import type { FlnMe, FlnPlanResponse } from '../../types';
import type { FlnLang } from '../../strings';

function Probe() {
  const loc = useLocation();
  return <div data-testid="probe">{loc.pathname + loc.search}</div>;
}

export interface RenderOpts { lang?: FlnLang; share?: boolean; status?: number; entries?: string[] }

export function mockPlanFetch(body: FlnPlanResponse | null, status = 200) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/events')) return new Response(null, { status: 204 });
    if (status === -1) return new Promise<Response>(() => undefined);
    if (status !== 200) return new Response(JSON.stringify({ error: 'x' }), { status });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', f);
  return calls;
}

export function renderPlan(res: FlnPlanResponse | null, opts: RenderOpts = {}) {
  const lang = opts.lang ?? 'en';
  const calls = mockPlanFetch(res, opts.status ?? 200);
  const me: FlnMe = { lessons: true, share: !!opts.share, role: opts.share ? 'coach' : 'teacher', ui_lang: lang };
  const id = res?.plan.id ?? 99999;
  const utils = render(
    <div className="fln-root" lang={lang} dir={lang === 'ur' ? 'rtl' : 'ltr'}>
      <MemoryRouter initialEntries={opts.entries ?? [`/portal/fln/p/${id}`]}>
        <Routes>
          <Route path="/portal/fln/p/:id" element={<PlanScreen me={me} lang={lang} />} />
          <Route path="/portal/fln/list/:subject" element={<Probe />} />
          <Route path="/portal/teacher/lessons" element={<Probe />} />
          <Route path="/somewhere" element={<Probe />} />
        </Routes>
      </MemoryRouter>
    </div>,
  );
  return { ...utils, calls };
}
