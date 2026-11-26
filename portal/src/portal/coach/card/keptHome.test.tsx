import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import { loadApp, net, renderApp, resetAll } from "./harness.testdata";
import { EMIS, schoolCard } from "./fixtures.testdata";

vi.mock("axios", async () => (await import("./harness.testdata")).axiosMock());
vi.setConfig({ testTimeout: 30_000 });
// The phone's kept recordings: one observation cut two minutes ago (listKept: every one, with its last heartbeat).
const kept = vi.hoisted(() => ({ list: [] as any[] }));
vi.mock("../../lib/recordingStore", async (orig) => ({
  ...(await orig<typeof import("../../lib/recordingStore")>()),
  listKept: vi.fn(async () => kept.list),
}));

import { rememberRecording } from "../../lib/coachObserve";

/**
 * bd-ma9jiy.3 (queue #262; the operator 26 Nov ~11:10: kept recordings "should also be on the Needs You section") — on
 * production every coach has the School card switch on (portal_coach_school_card = true), so /portal/coach is the SLIM
 * Home, not the full one: its Needs you card must be there too (sandbox, 26 Nov 13:07: the full Home had it, the slim did
 * not). The real app runs; only the network and the phone's store are fakes.
 */
const VISIT = "0d8a6d1c-1111-4c1c-9a1a-000000000262";
beforeAll(async () => { await loadApp(); }, 120_000);
beforeEach(async () => {
  await resetAll();
  window.localStorage.clear();
  kept.list = [];
  net.answers.set("/config", { success: true, features: { coachV2: true, schoolCard: true, coachip: false, coachFullApp: true } });
  net.answers.set("/coach/people", { success: true, schools: [{ emis: EMIS, name: "Model School Nine", teachers: 12, visits: 1, daysSinceVisit: 1, avgHitl: 60 }], teachers: [] });
  net.answers.set(`/coach/school/${EMIS}/card`, schoolCard());
  net.answers.set("/coach/home", { success: true, home: { today: [], next: null, counts: { week: 1, overdue: 0, waiting: 0, inProgress: 0, teachers: 24, schools: 7 } } });
});

describe("the slim Coach Home (School card on, as on production): Needs you for a kept recording", () => {
  it("a recording cut two minutes ago: Needs you, the teacher, Paused, to the recorder", async () => {
    rememberRecording("rec-1", { teacherExtId: "923001110001", schoolExtId: null, teacherName: "Ayesha Bibi", kind: "obs", visitId: VISIT });
    const last = Date.now() - 2 * 60_000;
    kept.list = [{ meta: { id: "rec-1", mimeType: "audio/webm", ext: ".webm", startedAt: new Date(last - 600_000).toISOString(), elapsedMs: 600_000, finished: false }, beats: [{ t: last, st: "r" }] }];
    await renderApp("/portal/coach");
    await screen.findByTestId("coach-home-slim");
    const card = await screen.findByTestId("home-kept");
    expect(within(card).getByText("Needs you")).toBeInTheDocument();
    const row = within(card).getByRole("link", { name: /Ayesha Bibi/ });
    expect(row).toHaveTextContent("Paused");
    expect(row).toHaveAttribute("href", `/portal/coach/visit/${VISIT}/record`);
  });

  it("nothing kept: no card", async () => {
    await renderApp("/portal/coach");
    await screen.findByTestId("feature-tiles");
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByTestId("home-kept")).toBeNull();
  });
});
