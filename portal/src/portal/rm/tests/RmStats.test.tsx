import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";

vi.mock("../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { boot, expectContract, expectNoTeacher, renderRm, rmWorld, serve } from "./harness";

/** bd-sex15q.17 — the RM's Stats: the sector's rows (sector count AS the count), the window and the marker row. */
describe.each(["en", "ur"] as const)("RM Stats (%s)", (lang) => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T05:00:00Z"));
    await boot(lang);
    serve(rmWorld());
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

  it("rows, the marker, the contract, no teacher, no 'Move 2'", async () => {
    const { container } = await renderRm("/stats");
    const page = screen.getByTestId("rm-stats");
    expectContract(page, expect);
    expectNoTeacher(container, expect);
    expect(screen.getAllByTestId("rm-stats-row").map((r) => r.getAttribute("data-w"))).toEqual(["W-IP-TIME", "W-WARM"]);
    expect(screen.getByTestId("rm-stats-marker").textContent).toContain(lang === "en" ? "Windows before it are not compared." : "موازنہ نہیں کیا جاتا");
    expect(/Move 2|دوسرا قدم/.test(page.textContent || "")).toBe(false);
  });
});

describe("the Coaches tab", () => {
  beforeEach(async () => { await boot("en"); serve(rmWorld()); });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });
  it("shows the same two groups as S8, under the contract", async () => {
    await renderRm("/coaches");
    expectContract(screen.getByTestId("rm-coaches"), expect);
    expect(screen.getByTestId("group-needs_me")).toBeTruthy();
    expect(screen.getByTestId("group-on_track")).toBeTruthy();
  });
});
