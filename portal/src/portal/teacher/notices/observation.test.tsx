import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-4404s7.4 — the coach's observation, sent in the background, on the notices the teacher app already has: a
 * third kind of item (an upload, not a render). Mocked at the network boundary only.
 *
 *   strip   "Observation · Ayesha Bibi — Sending · 62%" (the real progress, no time promised)
 *   banner  "Observation sent" (Open → the observation page); or "Couldn't send", the real reason, Try again
 *   own page  on the Sending page nothing is repeated
 *   never asks the server (an observation is sent from this phone) and is never kept across a reload
 */
vi.mock("../../services/api", () => {
  const get = vi.fn();
  const post = vi.fn();
  return { default: { get, post }, portal: { getAssessmentStatus: vi.fn(), generateAssessment: vi.fn() } };
});
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import api from "../../services/api";
import { NoticeHost } from "./NoticeHost";
import { createTracker, noticeTracker } from "./tracker";
import { itemId, type NewNotice } from "./model";

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const USER = "923001234567";
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

const obs = (over: Partial<NewNotice> = {}): NewNotice => ({
  kind: "observation", ref: "visit1", title: "Ayesha Bibi", grade: null, subject: null, questions: null,
  waitHref: "/portal/coach/visit/visit1/sending", visitId: "visit1", visitDay: "2026-10-06", durationMs: 38 * 60_000, ...over,
});
const ID = itemId("observation", "visit1");

function Probe() {
  const l = useLocation();
  return <span data-testid="at">{l.pathname}{l.search}</span>;
}
const mount = (at = "/portal/coach/observe") => render(
  <MemoryRouter initialEntries={[at]}>
    <NoticeHost userKey={USER} local />
    <Probe />
  </MemoryRouter>,
);

beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  noticeTracker.reset();
  http.get.mockRejectedValue(Object.assign(new Error("404"), { response: { status: 404 } }));
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});
afterEach(() => { vi.useRealTimers(); noticeTracker.reset(); });

describe("tracker: an observation is pushed, never polled, never kept", () => {
  it("is followed as 'making' with no ask of the server, however long it takes", async () => {
    const t = createTracker({ fetchNotices: vi.fn(async () => []), report: vi.fn(async () => true) });
    const detach = t.attach(USER, { server: false });
    t.track(obs());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(http.get).not.toHaveBeenCalled();
    expect(t.getItems()).toHaveLength(1);
    expect(t.getItems()[0]).toMatchObject({ id: ID, kind: "observation", state: "making", title: "Ayesha Bibi", progress: 0 });
    detach(); t.reset();
  });

  it("update() carries progress and ends it ready (with the observation) or failed (with why)", () => {
    const t = createTracker({ fetchNotices: vi.fn(async () => []), report: vi.fn(async () => true) });
    t.attach(USER, { server: false });
    t.track(obs());
    t.update(ID, { progress: 0.62 });
    expect(t.getItems()[0].progress).toBe(0.62);
    t.update(ID, { state: "ready", observationId: "cs-1", readyAt: 5 });
    expect(t.getItems()[0]).toMatchObject({ state: "ready", observationId: "cs-1" });
    t.update(ID, { state: "failed", errorCode: "network" });
    expect(t.getItems()[0]).toMatchObject({ state: "failed", errorCode: "network" });
    t.update("observation:nope", { progress: 1 }); // an unknown id changes nothing
    expect(t.getItems()).toHaveLength(1);
    t.reset();
  });

  it("is never written to the phone: its files live in this tab only", () => {
    const t = createTracker({ fetchNotices: vi.fn(async () => []), report: vi.fn(async () => true) });
    t.attach(USER, { server: false });
    t.track(obs());
    t.update(ID, { progress: 0.3 });
    expect(JSON.parse(localStorage.getItem(`teacher-notices:v1:${USER}`) || "[]")).toEqual([]);
    t.reset();
  });

  it("tells the server nothing about it (settle, seen)", async () => {
    const report = vi.fn(async () => true);
    const t = createTracker({ fetchNotices: vi.fn(async () => []), report });
    t.attach(USER, { server: false });
    t.track(obs());
    t.update(ID, { state: "ready", observationId: "cs-1" });
    t.announced([ID], "closed");
    t.settle(ID);
    await vi.advanceTimersByTimeAsync(10);
    expect(report).not.toHaveBeenCalled();
    t.reset();
  });

  it("Try again goes to the handler its sender registered", async () => {
    const t = createTracker({ fetchNotices: vi.fn(async () => []), report: vi.fn(async () => true) });
    t.attach(USER, { server: false });
    const again = vi.fn(async () => ({ ok: true as const }));
    t.registerRetry("observation", again);
    t.track(obs());
    t.update(ID, { state: "failed", errorCode: "network" });
    expect(await t.retry(ID)).toEqual({ ok: true });
    expect(again).toHaveBeenCalledWith(ID);
    t.reset();
  });

  it("a coach's shell (server: false) never asks GET /me/notices", async () => {
    const fetchNotices = vi.fn(async () => []);
    const t = createTracker({ fetchNotices, report: vi.fn(async () => true) });
    t.attach(USER, { server: false });
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchNotices).not.toHaveBeenCalled();
    t.reset();
    const t2 = createTracker({ fetchNotices, report: vi.fn(async () => true) });
    t2.attach(USER);
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchNotices).toHaveBeenCalledTimes(1);
    t2.reset();
  });
});

describe("the strip and banners for an observation", () => {
  it("sending: 'Observation · Ayesha Bibi', 'Sending · 62%', a link to the Sending page", () => {
    noticeTracker.track(obs());
    noticeTracker.update(ID, { progress: 0.62 });
    mount();
    const row = within(screen.getByRole("region", { name: "Being made" })).getByRole("link");
    expect(row).toHaveTextContent("Observation · Ayesha Bibi");
    expect(row).toHaveTextContent("Sending · 62%");
    expect(row).not.toHaveTextContent("min left");
    expect(row).toHaveAttribute("href", "/portal/coach/visit/visit1/sending");
    fireEvent.click(row);
    expect(screen.getByTestId("at")).toHaveTextContent("/portal/coach/visit/visit1/sending");
  });

  it("on its own Sending page the strip does not repeat it", () => {
    noticeTracker.track(obs());
    mount("/portal/coach/visit/visit1/sending");
    expect(screen.queryByRole("region", { name: "Being made" })).toBeNull();
  });

  it("sent: the banner says 'Observation sent' with the name and 'Tue 6 Oct · 38 min'; Open goes to the observation", async () => {
    noticeTracker.track(obs());
    noticeTracker.update(ID, { state: "ready", progress: 1, readyAt: Date.now(), observationId: "cs-9" });
    mount();
    const banner = screen.getByTestId("ready-banner");
    expect(banner).toHaveAccessibleName("Observation sent");
    expect(banner).toHaveTextContent("Ayesha Bibi");
    expect(banner).toHaveTextContent("Tue 6 Oct · 38 min");
    fireEvent.click(within(banner).getByRole("button", { name: /^Open/ }));
    expect(screen.getByTestId("at")).toHaveTextContent("/portal/coach/observation/cs-9");
    expect(noticeTracker.getItems()).toHaveLength(0);
  });

  it("failed: 'Couldn't send', the real reason, Try again — and nothing goes to WhatsApp", async () => {
    const again = vi.fn(async () => ({ ok: true as const }));
    noticeTracker.registerRetry("observation", again);
    noticeTracker.track(obs());
    noticeTracker.update(ID, { state: "failed", errorCode: "network" });
    mount();
    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent("Couldn't send");
    expect(banner).toHaveTextContent("The internet stopped. The observation is safe on this phone.");
    await act(async () => { fireEvent.click(within(banner).getByRole("button", { name: "Try again" })); });
    expect(again).toHaveBeenCalledWith(ID);
    expect(http.post).not.toHaveBeenCalled();
  });

  it("a plan that cannot be used says so, in her language", async () => {
    noticeTracker.track(obs());
    noticeTracker.update(ID, { state: "failed", errorCode: "plan_not_ready" });
    await act(async () => { await i18n.changeLanguage("ur"); });
    mount();
    expect(screen.getByRole("alert")).toHaveTextContent("نہیں بھیجا جا سکا");
    expect(screen.getByRole("alert")).toHaveTextContent("لیسن پلان");
    await tick(0);
  });
});
