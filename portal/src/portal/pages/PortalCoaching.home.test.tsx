import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// bd-5rz1v — the redesigned Coaching page, for teachers with
// portal_self_observation on (everyone else keeps today's page).
//
//   "N lessons need your answer → Answer"   a banner on top; Answer opens the OLDEST
//   Record your class                       one big, animated button
//   Analysing N lessons…                    a quiet line, not a card
//   Your recordings                         search, subject, newest first, by month;
//                                           waiting lessons are rows in the same list

// A STABLE toast, as the real hook returns: the pages re-fetch when it changes.
vi.mock("@/hooks/use-toast", () => { const toast = vi.fn(); return { useToast: () => ({ toast }) }; });
vi.mock("../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../services/api", () => ({
  portal: {
    getConfig: vi.fn(),
    getCoachingSessions: vi.fn(),
    getActiveCoachingSessions: vi.fn(),
  },
}));

import { portal } from "../services/api";
import PortalCoaching from "./PortalCoaching";

const api = portal as any;

const done = (id: string, date: string, topic: string | null, subject: string | null, percentage: number | null) => ({
  id, date, session_date: date, duration: 1700, overallScore: 0, maxScore: 44, percentage, framework: "fico", topic, subject,
});
const active = (id: string, createdAt: string, stage: string, needsAnswer: boolean, topic: string | null = null) => ({
  id, createdAt, status: stage === "reflection" ? "conducting_conversation" : "analyzing", stage, source: "portal", needsAnswer, topic, subject: null,
});

function renderPage() {
  return render(<MemoryRouter><PortalCoaching /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getConfig.mockResolvedValue({ features: { selfObservation: true } });
  api.getCoachingSessions.mockResolvedValue({
    sessions: [
      done("c-sep", "2026-09-24T09:00:00Z", "Parts of a plant", "General Science", 30),
      done("c-oct1", "2026-10-01T09:00:00Z", "Reading: The Thirsty Crow", "English", 85),
      done("c-oct2", "2026-10-02T08:00:00Z", "Provinces of Pakistan", "Social Studies", 65),
    ],
    pagination: {},
  });
  api.getActiveCoachingSessions.mockResolvedValue({
    sessions: [
      active("a-oldest", "2026-10-01T07:00:00Z", "reflection", true, "Fractions: halves and quarters"),
      active("a-newer", "2026-10-02T06:00:00Z", "reflection", true),
      active("a-third", "2026-10-02T07:00:00Z", "reflection", true),
      active("a-analysing", "2026-10-02T10:40:00Z", "analysing", false),
    ],
  });
});

describe("the redesigned Coaching page", () => {
  it("is today's page for a teacher without the feature", async () => {
    api.getConfig.mockResolvedValue({ features: { selfObservation: false } });
    renderPage();
    expect(await screen.findByText("Coaching Sessions")).toBeInTheDocument();
    expect(screen.queryByTestId("record-your-class")).not.toBeInTheDocument();
    expect(api.getActiveCoachingSessions).not.toHaveBeenCalled();
  });

  it("leads with one big Record your class button", async () => {
    renderPage();
    const cta = await screen.findByTestId("record-your-class");
    expect(cta).toHaveAttribute("href", "/portal/coaching/new");
    expect(within(cta).getByText("Record your class")).toBeInTheDocument();
    expect(within(cta).getByText(/your digital coach listens/i)).toBeInTheDocument();
  });

  it("says how many lessons need her answer, and Answer opens the oldest", async () => {
    renderPage();
    const banner = await screen.findByTestId("needs-answer-banner");
    expect(within(banner).getByText("3 lessons need your answer")).toBeInTheDocument();
    expect(within(banner).getByRole("link", { name: /answer/i })).toHaveAttribute("href", "/portal/coaching/session/a-oldest");
  });

  it("says it in the singular for one lesson", async () => {
    api.getActiveCoachingSessions.mockResolvedValue({ sessions: [active("a-1", "2026-10-02T06:00:00Z", "reflection", true)] });
    renderPage();
    expect(await screen.findByText("1 lesson needs your answer")).toBeInTheDocument();
  });

  it("shows no banner when nothing is waiting for her", async () => {
    api.getActiveCoachingSessions.mockResolvedValue({ sessions: [] });
    renderPage();
    await screen.findByTestId("record-your-class");
    expect(screen.queryByTestId("needs-answer-banner")).not.toBeInTheDocument();
  });

  it("mentions lessons still being analysed in one quiet line", async () => {
    renderPage();
    expect(await screen.findByText(/analysing 1 lesson\. ready in about 10 minutes/i)).toBeInTheDocument();
  });

  it("lists every lesson newest first, by month, waiting ones included and labelled", async () => {
    renderPage();
    const list = await screen.findByTestId("recordings-list");
    const rows = within(list).getAllByRole("link");
    expect(rows.map((r) => r.getAttribute("href"))).toEqual([
      "/portal/coaching/session/a-analysing",
      "/portal/coaching/session/c-oct2",
      "/portal/coaching/session/a-third",
      "/portal/coaching/session/a-newer",
      "/portal/coaching/session/c-oct1",
      "/portal/coaching/session/a-oldest",
      "/portal/coaching/session/c-sep",
    ]);
    expect(within(list).getByText("October 2026")).toBeInTheDocument();
    expect(within(list).getByText("September 2026")).toBeInTheDocument();
    expect(within(rows[0]).getByText("New recording")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Analysing")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Provinces of Pakistan")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Good")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Needs your answer")).toBeInTheDocument();
    expect(within(rows[4]).getByText("Excellent")).toBeInTheDocument();
  });

  it("finds a lesson by its topic", async () => {
    renderPage();
    await screen.findByTestId("recordings-list");
    fireEvent.change(screen.getByPlaceholderText(/search by topic or subject/i), { target: { value: "crow" } });
    const rows = within(screen.getByTestId("recordings-list")).getAllByRole("link");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute("href", "/portal/coaching/session/c-oct1");
  });

  it("filters by subject", async () => {
    renderPage();
    await screen.findByTestId("recordings-list");
    fireEvent.click(screen.getByRole("button", { name: "General Science" }));
    const rows = within(screen.getByTestId("recordings-list")).getAllByRole("link");
    expect(rows.map((r) => r.getAttribute("href"))).toEqual(["/portal/coaching/session/c-sep"]);
  });

  it("shows ten at a time", async () => {
    api.getActiveCoachingSessions.mockResolvedValue({ sessions: [] });
    api.getCoachingSessions.mockResolvedValue({
      sessions: Array.from({ length: 14 }, (_, i) => done(`c-${i}`, `2026-09-${String(10 + i).padStart(2, "0")}T09:00:00Z`, `Lesson ${i}`, "Urdu", 50)),
      pagination: {},
    });
    renderPage();
    const list = await screen.findByTestId("recordings-list");
    expect(within(list).getAllByRole("link")).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: /show more/i }));
    expect(within(screen.getByTestId("recordings-list")).getAllByRole("link")).toHaveLength(14);
    expect(screen.queryByRole("button", { name: /show more/i })).not.toBeInTheDocument();
  });

  it("with nothing yet, explains the three steps", async () => {
    api.getActiveCoachingSessions.mockResolvedValue({ sessions: [] });
    api.getCoachingSessions.mockResolvedValue({ sessions: [], pagination: {} });
    renderPage();
    expect(await screen.findByText(/record your class\. put your phone on the table/i)).toBeInTheDocument();
    expect(screen.getByText(/answer one question/i)).toBeInTheDocument();
    expect(screen.getByText(/get your tips/i)).toBeInTheDocument();
  });
});
