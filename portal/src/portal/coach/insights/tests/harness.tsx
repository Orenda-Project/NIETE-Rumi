/**
 * bd-sex15q.15 — the page tests' shared harness. Every page test file starts with the SAME four mocks (vi.mock is
 * hoisted per file, so they cannot live here):
 *
 *   vi.mock("../../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
 *   vi.mock("../../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
 *   vi.mock("../../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
 *   vi.mock("../../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));
 *
 * then `await boot(lang)` in beforeEach, `serve({...})` to answer GET/POST by path from contracts/fixtures.json (copied
 * here as fixtures.json; fictional, codes only), and `renderAt(path)`. The network boundary is the only thing mocked:
 * the gate, the router, the copy, the formatter and the count contract all run for real.
 */
import { act, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";
import { vi } from "vitest";
import api, { portal, language } from "../../../services/api";
import { useAuth } from "../../../hooks/useAuth";
import { resetCoachV2Memory } from "../../useCoachV2";
import { resetLanguageFollow } from "../../../teacher/i18n";
import { resetCoachipMemory } from "../useCoachip";
import InsightsRoutes from "../routes";
import { domContract } from "../count";
import FIXTURES from "./fixtures.json";

export const F = FIXTURES as unknown as Record<string, unknown> & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const COACH = { id: "00000000-0000-4000-8000-000000000c03", role: "coach", phoneNumber: "+920000000003", firstName: "C" };

type Http = { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
export const http = api as unknown as Http;

/** An axios-shaped rejection. */
export function httpError(status: number, data: unknown = { error: "not_found" }) {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });
}

export type Answer = unknown | ((params?: Record<string, unknown>, body?: unknown) => unknown);

/** Answer GETs (and POSTs, keyed "POST /path") by path; a function answer may throw an httpError. Unknown path → 404. */
export function serve(answers: Record<string, Answer>) {
  const answer = (key: string, params?: Record<string, unknown>, body?: unknown) => {
    if (!(key in answers)) return Promise.reject(httpError(404));
    const a = answers[key];
    try {
      const data = typeof a === "function" ? (a as (p?: Record<string, unknown>, b?: unknown) => unknown)(params, body) : a;
      return Promise.resolve({ data });
    } catch (e) {
      return Promise.reject(e);
    }
  };
  http.get.mockImplementation((url: string, cfg?: { params?: Record<string, unknown> }) => answer(url, cfg?.params));
  http.post.mockImplementation((url: string, body?: unknown) => answer(`POST ${url}`, undefined, body));
}

/** Before each test: the coach, v2 + COACHIP on, the language, fresh flag memory. */
export async function boot(lang: "en" | "ur" = "en", features: Record<string, unknown> = { coachV2: true, coachip: true }) {
  resetCoachV2Memory();
  resetCoachipMemory();
  resetLanguageFollow();
  vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features } as never);
  const lg = language as unknown as { get: ReturnType<typeof vi.fn> };
  lg.get.mockResolvedValue({ language: lang });
  vi.mocked(useAuth).mockReturnValue({ user: COACH, loading: false, logout: vi.fn() } as never);
  if (!i18n.isInitialized) await i18n.init({ lng: lang, resources: {} });
  await act(async () => { await i18n.changeLanguage(lang); });
}

export async function settle(rounds = 12) {
  for (let i = 0; i < rounds; i += 1) await act(async () => { await Promise.resolve(); });
}

/** Render the insight routes at `/portal/coach/insights<sub>` and let every read resolve. */
export async function renderAt(sub = "") {
  const r = render(
    <MemoryRouter initialEntries={[`/portal/coach/insights${sub}`]}>
      <Routes>
        <Route path="/portal/coach/insights/*" element={<InsightsRoutes />} />
        <Route path="*" element={<div data-testid="elsewhere" />} />
      </Routes>
    </MemoryRouter>,
  );
  // lazy pages: wait until a page (or the redirect target) is in, then until its reads have resolved
  await waitFor(() => {
    if (!r.container.querySelector('[data-testid^="insights-"],[data-testid="elsewhere"]')) throw new Error("no page yet");
  }, { timeout: 5000 });
  await settle();
  await waitFor(() => {
    if (r.container.querySelector('[aria-busy="true"]')) throw new Error("still loading");
  }, { timeout: 3000 }).catch(() => undefined);
  await settle();
  return r;
}

/** G10, asserted on a rendered page: every count node complete, every window resolved, no bare digit. */
export function expectContract(root: ParentNode, expect: (v: unknown) => { toEqual: (x: unknown) => void; toBeGreaterThan: (x: number) => void }) {
  const c = domContract(root);
  expect(c.nums).toBeGreaterThan(0);
  expect({ nums: c.nums, unresolved: c.unresolvedWins, bare: c.bareDigits, statsWithoutBase: c.stats - c.statsWithBase })
    .toEqual({ nums: c.numsWithDenWin, unresolved: [], bare: [], statsWithoutBase: 0 });
  return c;
}

/** No teacher name, phone or key can appear: the fixture has none, so any of these shapes in the DOM is a leak. */
export function expectNoIdentity(root: HTMLElement, expect: (v: unknown) => { toBe: (x: unknown) => void }) {
  const html = root.innerHTML;
  expect(/teacher_key|\+92\d{6,}|\b03\d{9}\b/.test(html)).toBe(false);
}
