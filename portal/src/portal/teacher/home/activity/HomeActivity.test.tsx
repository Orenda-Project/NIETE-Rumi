import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";

/**
 * Home's "Last 30 days" block, option A (GET /me/home `activity`; the server sends it only with
 * portal_teacher_home_activity on). Heading + updated line; four dense tiles (Plans opened → All lesson plans on the
 * same 30 days; Taught in class → My journey's taught lines; DC observations → All DC observations; Quizzes · Papers → a
 * tray of two rows); Rating over time (header → Analytics); Try next class (→ that report); My journey row
 * (portal_teacher_journey, shown even with no numbers). No numbers → no heading, tiles, trend or tip.
 */
const cfg = vi.hoisted(() => ({ features: {} as Record<string, unknown> }));
vi.mock("../../../lib/useNewUi", () => ({
  peekConfig: () => ({ features: cfg.features }),
  readConfigShared: () => Promise.resolve({ features: cfg.features }),
}));

import { tapProblems } from "../../../newui/checks/rules";
import { HomeActivity } from "./HomeActivity";
import { ACTIVITY_COPY as A, ACTIVITY_COPY_UR as U } from "./copy";
import type { HomeActivity as Activity } from "../api";

const NOW = Date.parse("2026-11-19T12:00:00.000Z"); // 17:00 in Pakistan
const c = (now: number, prev: number) => ({ now, prev });
const ACT: Activity = {
  updatedAt: "2026-11-19T09:30:00.000Z", slot: "day",
  tiles: { opened: c(14, 9), taught: c(3, 1), coached: c(2, 2), quizzes: c(4, 0), papers: c(1, 0) },
  trend: [{ indicator: "Checks for understanding", from: "average", to: "good" }],
  tip: { sessionId: "s3", text: "Ask two children to explain" },
};

let onGo: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  cfg.features = { teacherJourney: true };
  onGo = vi.fn();
});
afterEach(() => { vi.useRealTimers(); });

const draw = (activity: Activity | undefined, quizHome: string | null = "/quiz/teacher/tok") =>
  render(<MemoryRouter><HomeActivity activity={activity} quizHome={quizHome} onGo={onGo} /></MemoryRouter>);

describe("with numbers", () => {
  // Design review, Urdu at 360×740: with an icon the number and pill had ~67px and the tiles grew to ~168px, so row 2
  // fell under the menu bar. Home's tiles carry no icon: the number and its pill keep one line.
  it("the four tiles carry no icon, so the number and its pill share one line", () => {
    draw(ACT);
    const tiles = screen.getAllByRole("button").filter((b) => b.querySelector("[data-kpi-top]"));
    expect(tiles).toHaveLength(4);
    for (const tile of tiles) expect(tile.querySelector("[data-kpi-top] > svg:first-child")).toBeNull();
  });

  it("the heading, the updated line, four tiles named number, label and change", () => {
    const { container } = draw(ACT);
    expect(screen.getByRole("heading", { name: A.lastDays })).toBeInTheDocument();
    expect(screen.getByText("Updated today, 2:30 PM")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `14 ${A.opened}, up 5` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `3 ${A.taught}, up 2` })).toHaveTextContent(A.toldUs);
    expect(screen.getByRole("button", { name: `2 ${A.coached}, same as before` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `4 · 1 ${A.quizPapers}, up 5` })).toBeInTheDocument();
    expect(tapProblems(container)).toEqual([]);
  });

  it("each tile is logged, then opens its list on the same 30 days", () => {
    draw(ACT);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^14 ${A.opened}`) }));
    expect(onGo).toHaveBeenLastCalledWith("act_opened", "/portal/teacher/lessons/all?range=custom&from=2026-10-21&to=2026-11-19");
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^3 ${A.taught}`) }));
    expect(onGo).toHaveBeenLastCalledWith("act_taught", "/portal/teacher/journey?step=taught");
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^2 ${A.coached}`) }));
    expect(onGo).toHaveBeenLastCalledWith("act_coached", "/portal/teacher/coaching/all?range=custom&from=2026-10-21&to=2026-11-19");
  });

  it("Quizzes · Papers opens a tray she chose: Quizzes → her quiz home, Papers → All papers", () => {
    draw(ACT);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^4 · 1 ${A.quizPapers}`) }));
    const tray = screen.getByRole("dialog");
    fireEvent.click(within(tray).getByRole("button", { name: new RegExp(A.quizzes) }));
    expect(onGo).toHaveBeenLastCalledWith("act_quiz_papers", "/quiz/teacher/tok");
    fireEvent.click(within(tray).getByRole("button", { name: new RegExp(A.papers) }));
    expect(onGo).toHaveBeenLastCalledWith("act_quiz_papers", "/portal/teacher/assessment/all");
  });

  it("no quiz home → the Quizzes row is information", () => {
    draw(ACT, null);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^4 · 1 ${A.quizPapers}`) }));
    const tray = screen.getByRole("dialog");
    expect(within(tray).queryByRole("button", { name: new RegExp(`^4.*${A.quizzes}`) })).toBeNull();
    expect(within(tray).getByText(A.quizzes)).toBeInTheDocument();
  });

  it("My journey off → the Taught tile is information, no My journey row", () => {
    cfg.features = {};
    draw(ACT);
    expect(screen.getByRole("group", { name: `3 ${A.taught}, up 2` })).toBeInTheDocument();
    expect(screen.queryByText(A.myJourney)).toBeNull();
  });

  it("Rating over time: band words previous → latest; the header opens Analytics", () => {
    draw(ACT);
    expect(screen.getByText("Checks for understanding")).toBeInTheDocument();
    expect(screen.getByText("Average")).toBeInTheDocument();
    expect(screen.getByText("Good")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(A.ratingOverTime) }));
    expect(onGo).toHaveBeenLastCalledWith("act_trend", "/portal/teacher/analytics");
  });

  it("Try next class: the tip as data, opens that report", () => {
    draw(ACT);
    const card = screen.getByRole("button", { name: new RegExp(A.tryNext) });
    expect(card).toHaveTextContent("Ask two children to explain");
    fireEvent.click(card);
    expect(onGo).toHaveBeenLastCalledWith("act_tip", "/portal/teacher/coaching/report/s3");
  });

  it("no trend, no tip → neither card", () => {
    draw({ ...ACT, trend: [], tip: null });
    expect(screen.queryByText(A.ratingOverTime)).toBeNull();
    expect(screen.queryByText(A.tryNext)).toBeNull();
  });

  it("My journey row → the journey page", () => {
    draw(ACT);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(A.myJourney) }));
    expect(onGo).toHaveBeenLastCalledWith("journey", "/portal/teacher/journey");
  });
});

describe("no numbers", () => {
  it("no activity → only the My journey row (no heading, tiles, trend, tip, no spinner)", () => {
    draw(undefined);
    expect(screen.queryByRole("heading", { name: A.lastDays })).toBeNull();
    expect(screen.queryAllByRole("button").map((b) => b.textContent)).toEqual([expect.stringContaining(A.myJourney)]);
  });

  it("every count 0, or a run older than yesterday → the same", () => {
    const z = c(0, 0);
    draw({ ...ACT, tiles: { opened: z, taught: z, coached: z, quizzes: z, papers: z } });
    expect(screen.queryByRole("heading", { name: A.lastDays })).toBeNull();
    draw({ ...ACT, updatedAt: "2026-11-16T09:30:00.000Z" });
    expect(screen.queryByRole("heading", { name: A.lastDays })).toBeNull();
  });

  it("no activity and My journey off → nothing drawn", () => {
    cfg.features = {};
    const { container } = draw(undefined);
    expect(container.querySelector("[data-testid='home-activity']")).toBeNull();
  });
});

describe("Urdu", () => {
  it("Urdu words, the kit's PM word in the updated line, Western digits", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    draw(ACT);
    expect(screen.getByRole("heading", { name: U.lastDays })).toBeInTheDocument();
    const updated = screen.getByText(/اپ ڈیٹ: آج، .*2:30.* بعد دوپہر/);
    expect(updated.textContent).not.toMatch(/\u2066[^\u2069]*بعد/); // the PM word is never inside the digits' isolate
    expect(screen.getByText(U.opened)).toBeInTheDocument();
    expect(screen.getByText(U.myJourney)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/[۰-۹٠-٩]/);
  });
});
