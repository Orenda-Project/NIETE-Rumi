import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-fmf24g.15 — the shell draws the notices for a teacher on v2 — and only for her: the strip of what is being
 * made belongs to the teacher app, so a classic page, a coach and a link session never get it.
 */
const flags = vi.hoisted(() => ({ teacher: true as boolean | null, role: "teacher" as string | null }));
vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({ user: { phoneNumber: "923001234567", role: flags.role }, loading: false, logout: vi.fn() }),
}));
vi.mock("../teacher/useTeacherV2", async (orig) => ({
  ...(await orig<typeof import("../teacher/useTeacherV2")>()),
  useTeacherV2: () => flags.teacher,
}));
vi.mock("../coach/useCoachV2", async (orig) => ({ ...(await orig<typeof import("../coach/useCoachV2")>()), useCoachV2: () => false }));
vi.mock("../lib/useNewUi", () => ({ useNewUi: () => false, readConfigShared: () => Promise.resolve(null), forgetConfig: () => {} }));
vi.mock("../lib/recordingSession", () => ({ useRecordingSession: () => null }));
vi.mock("./PortalNavigation", () => ({ default: () => <nav aria-label="Menu" /> }));
vi.mock("./RecordingBar", () => ({ default: () => null }));
vi.mock("../services/api", () => ({
  default: { get: vi.fn().mockResolvedValue({ data: { success: true, state: "authoring" } }), post: vi.fn() },
  portal: { getAssessmentStatus: vi.fn().mockResolvedValue({ success: true, status: "generating" }), generateAssessment: vi.fn() },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import PortalLayout from "./PortalLayout";
import { noticeTracker } from "../teacher/notices/tracker";

const job = {
  kind: "paper" as const, ref: "req1", title: "Plants and food", grade: 4, subject: "Science", questions: 15,
  waitHref: "/portal/teacher/assessment/request/req1", spec: {},
};
const draw = (props: { bare?: boolean } = {}) => render(
  <MemoryRouter initialEntries={["/portal/teacher/training"]}><PortalLayout {...props}><p>page</p></PortalLayout></MemoryRouter>,
);

beforeEach(() => {
  localStorage.clear();
  noticeTracker.reset();
  flags.teacher = true;
  flags.role = "teacher";
});

describe("PortalLayout and the notices", () => {
  it("a teacher on v2 sees what is being made, under every page", () => {
    noticeTracker.attach("923001234567");
    noticeTracker.track(job);
    draw();
    expect(screen.getByRole("region", { name: "Being made" })).toBeInTheDocument();
  });

  it("not when the page has no menu (bare)", () => {
    noticeTracker.attach("923001234567");
    noticeTracker.track(job);
    draw({ bare: true });
    expect(screen.queryByRole("region", { name: "Being made" })).toBeNull();
  });

  it("not for a teacher on today's pages (v2 off), and not while the flag is unknown", () => {
    noticeTracker.attach("923001234567");
    noticeTracker.track(job);
    flags.teacher = false;
    const { unmount } = draw();
    expect(screen.queryByRole("region", { name: "Being made" })).toBeNull();
    unmount();
    flags.teacher = null;
    draw();
    expect(screen.queryByRole("region", { name: "Being made" })).toBeNull();
  });

  it("not for a coach", () => {
    noticeTracker.attach("923001234567");
    noticeTracker.track(job);
    flags.role = "coach";
    draw();
    expect(screen.queryByRole("region", { name: "Being made" })).toBeNull();
  });

  it("the page's bottom padding leaves room for the strip", () => {
    noticeTracker.attach("923001234567");
    noticeTracker.track(job);
    const { container } = draw();
    const spacer = container.querySelector("[data-testid='notice-spacer']") as HTMLElement;
    expect(parseInt(spacer.style.height, 10)).toBeGreaterThanOrEqual(64);
  });
});
