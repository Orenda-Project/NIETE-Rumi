/**
 * bd-sex15q.17 — the RM page tests' harness, on top of m-ui's (insights/tests/harness: `boot`, `serve`, `F` = the
 * c-api fixtures, `http`, `httpError`, `settle`). Every RM test file starts with the SAME four mocks as the coach pages
 * (vi.mock is hoisted per file):
 *
 *   vi.mock("../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
 *   vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
 *   vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
 *   vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));
 *
 * Only the network boundary is mocked: the gate, the router, the copy, the formatter and the count contract run for real.
 */
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import RmRoutes from "../routes";
import { F, http, settle } from "../../coach/insights/tests/harness";

export { boot, serve, settle, F, http, httpError, expectContract, expectNoIdentity } from "../../coach/insights/tests/harness";

const P = "/coachip";

/** The Urban-I RM's world from contracts/fixtures.json (fictional; coach labels C-nn; schools "Fictional-NN"). */
export function rmWorld(over: Record<string, unknown> = {}) {
  const coachId = (id: string) => `${P}/rm/coach/${id}`;
  const world: Record<string, unknown> = {
    [`${P}/me`]: F.me_rm,
    [`${P}/rm/home`]: F.rm_home,
    [`${P}/rm/circle`]: F.rm_circle,
    [coachId("00000000-0000-4000-8000-070000000003")]: F.rm_coach,
    [`${P}/m/${F.rm_circle.moments[0].moment_id}`]: F.moment_rm,
    [`POST ${P}/rm/notes`]: F.rm_notes_post_201,
    [`POST ${P}/rm/steps`]: F.rm_steps_post_201,
  };
  return { ...world, ...over };
}

/** Render the RM routes at `/portal/rm<sub>` and let every read resolve. */
export async function renderRm(sub = "") {
  const r = render(
    <MemoryRouter initialEntries={[`/portal/rm${sub}`]}>
      <Routes>
        <Route path="/portal/rm/*" element={<RmRoutes />} />
        <Route path="*" element={<div data-testid="elsewhere" />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => {
    if (!r.container.querySelector('[data-testid^="rm-"],[data-testid="elsewhere"]')) throw new Error("no page yet");
    if (r.container.querySelector('[data-testid="rm-gate-loading"]')) throw new Error("gate loading");
  }, { timeout: 5000 });
  await settle();
  await waitFor(() => {
    if (r.container.querySelector('[aria-busy="true"]')) throw new Error("still loading");
  }, { timeout: 3000 }).catch(() => undefined);
  await settle();
  return r;
}

/** Every GET the page made (paths only). */
export function gets(): string[] {
  return http.get.mock.calls.map((c: unknown[]) => String(c[0]));
}

/** B1/B21/B22 on an RM screen: no teacher code, key, session id or phone in the DOM. */
export function expectNoTeacher(root: HTMLElement, expect: (v: unknown) => { toEqual: (x: unknown) => void }) {
  const html = root.innerHTML;
  const text = root.textContent || "";
  expect({
    tcode: /\bT-\d{2,3}\b/.test(text),
    key: /\b[0-9a-f]{16}\b/.test(html) && /teacher_key/.test(html),
    session: /0000-4000-8000-03/.test(html),
    phone: /\+92\d{6,}|\b03\d{9}\b/.test(html),
  }).toEqual({ tcode: false, key: false, session: false, phone: false });
}
