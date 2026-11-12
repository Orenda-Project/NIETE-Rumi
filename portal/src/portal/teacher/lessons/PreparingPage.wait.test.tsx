import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-ipoxhx.2 — ICT Feedback, Lesson Plans (6-12) row 9: "the 2 min timer keeps repeating and no LP comes".
 *
 *   honest wait   a 6-12 plan takes 173 s at the median and 297 s at p95 (niete-logs lp612.deliver.completed,
 *                 29 Oct–12 Nov, n=789); only 16% were done inside the 2 minutes the page promised. The page,
 *                 the strip and the chip all promise about 5 minutes now, from one number.
 *   one clock     the countdown runs from when the plan was first asked for, not from when this page mounted:
 *                 leaving and coming back carries on where it was instead of starting again at the top.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from "../../services/api";
import { resetLessonPlans } from "../../newui/lessons/lessonPlansApi";
import { noticeTracker } from "../notices/tracker";
import { EXPECTED_MS } from "../notices/model";
import { PreparingPage } from "./PreparingPage";
import { lessonsUrl } from "./paths";
import { LESSONS_V2_COPY } from "./copy";

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
const C = LESSONS_V2_COPY;
const AT = { grade: 9, subject: "Physics", key: "physics", chapter: "c02", lesson: "phy9.c02.p010", render: "R9" };
const T0 = new Date("2026-11-12T09:00:00Z").getTime();

function mount() {
  const path = lessonsUrl("preparing", AT);
  const pathname = path.split("?")[0];
  return render(
    <MemoryRouter initialEntries={[{ pathname, search: `?${path.split("?")[1]}` }]}>
      <Routes><Route path={pathname} element={<PreparingPage />} /></Routes>
    </MemoryRouter>,
  );
}
const ring = () => screen.getByRole("img").getAttribute("aria-label");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(T0);
  vi.clearAllMocks();
  resetLessonPlans();
  noticeTracker.reset();
  http.get.mockImplementation(async (url: string) => {
    if (url.startsWith("/lp612/status")) return { data: { state: "authoring" } };
    if (url.startsWith("/lp612/lessons")) return { data: { lessons: [] } };
    throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); noticeTracker.reset(); });

describe("preparing: the wait it promises", () => {
  it("a 6-12 plan is promised about 5 minutes, which covers 95 in 100 of them", () => {
    expect(EXPECTED_MS.lesson).toBe(300_000);
    mount();
    expect(ring()).toBe("5:00");
    expect(screen.getByText(C.expectedWait)).toBeTruthy();
    expect(C.expectedWait).toBe("~5 min");
  });

  it("coming back to the same plan carries on the countdown; it does not start again", () => {
    mount();
    act(() => { vi.advanceTimersByTime(90_000); });
    expect(ring()).toBe("3:30");
    cleanup(); // she leaves the page …
    act(() => { vi.advanceTimersByTime(60_000); });
    mount(); // … and comes back two and a half minutes after she asked
    expect(ring()).toBe("2:30");
  });
});
