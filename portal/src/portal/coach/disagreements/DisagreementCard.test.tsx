import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../teacher/useLanguageSwitch", () => ({ useLanguageSwitch: () => ({ target: "ur", status: "idle", toggle: vi.fn() }) }));
vi.mock("./api", async (orig) => ({
  ...(await orig<typeof import("./api")>()),
  disagreements: { list: vi.fn(), card: vi.fn(), visited: vi.fn(), clipUrl: (id: string, at: number) => `/api/portal/coach/disagreements/${id}/clip?at=${at}` },
  readDisagreementsOn: vi.fn(),
}));
import { disagreements, readDisagreementsOn } from "./api";
import DisagreementCard from "./DisagreementCard";

/**
 * bd-tbprit.3 — one teacher's disagreement, evidence only (Amena, 19 Oct), in Rifat's order: what she disagrees
 * with and the grader's own evidence for each reason, her voice note, what the report told her; where to look
 * (every indicator with the AI's score); her trend; the full DC report; and "I have visited", one-way.
 */
const D = vi.mocked(disagreements);
const ID = "7e0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const item = (id: string, name: string, score: number | null, at: number | null, evidence = `Quote for ${name}`) =>
  ({ id, name, score, evidence, at, applicable: score != null });

function card(extra: Record<string, unknown> = {}) {
  return {
    id: ID, teacher: "Bushra Ali", school: "IMSG I-9/4", language: "en", status: "sent", done: false,
    reasons: ["score", "missed", "unclear"], createdAt: "2026-10-14T05:00:00Z", noteUrl: "https://r2/note.ogg?sig",
    view: {
      language: "en",
      header: { name: "Bushra", meta: "Grade 4 · English · Animals", date: "13 Oct", pct: 61, marks: 86, max: 140 },
      wells: ["Called students by name"],
      thing: { text: "Ask two children to repeat the rule", why: "Checks they heard it", step: "We Do" },
      sections: [{ key: "student_engagement", name: "Student Engagement", score: 18, max: 28, pct: 64, colour: "amber", notAssessed: false, why: null }],
      journey: { points: [52, 58, 61], first: 52, best: 61, now: 61 },
      quizMessage: null, voice: null, report: null,
    },
    evidence: [
      { code: "score", items: [item("D1", "Active Participation Rate", 1, 190)] },
      { code: "missed", noPlan: true, moves: [], items: [item("B2", "Checks for understanding", 2, null)] },
      { code: "unclear", thing: { text: "Ask two children to repeat the rule", why: null, step: null } },
    ],
    indicators: [
      { key: "lesson_plan_fidelity", score: null, max: null, counted: false, items: [] },
      { key: "student_engagement", score: 18, max: 28, counted: true, items: [item("D1", "Active Participation Rate", 1, 190), item("D2", "Wait time", 3, 60)] },
    ],
    moves: null,
    ...extra,
  };
}

function renderCard() {
  return render(
    <MemoryRouter initialEntries={[`/portal/coach/disagreements/${ID}`]}>
      <Routes>
        <Route path="/portal/coach/disagreements/:id" element={<DisagreementCard />} />
        <Route path="/portal/coach" element={<div data-testid="coach-home" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  vi.clearAllMocks();
  vi.mocked(readDisagreementsOn).mockResolvedValue(true);
  D.card.mockResolvedValue(card());
  D.visited.mockResolvedValue(true);
});
afterEach(async () => { await act(async () => { await i18n.changeLanguage("en"); }); });

describe("DisagreementCard", () => {
  it("Rifat's top: N, her name, Disagrees with report · review, back to the list; the head, the banner, her reasons", async () => {
    renderCard();
    await screen.findByTestId("card-head");
    const bar = screen.getByTestId("disagreements-appbar");
    expect(within(bar).getByTestId("appbar-mark")).toHaveTextContent("N");
    expect(bar).toHaveTextContent("Bushra Ali");
    expect(bar).toHaveTextContent("Disagrees with report · review");
    expect(within(bar).getByTestId("appbar-back")).toHaveAttribute("href", "/portal/coach/disagreements");
    expect(screen.getByTestId("card-pct")).toHaveTextContent("61%");
    expect(screen.getByTestId("card-banner")).toHaveTextContent("3 reasons + voice note");
    expect(screen.getAllByTestId("reason-pill")).toHaveLength(3);
  });

  it("each reason with the grader's evidence: the indicator, the AI's score out of 4, its quote", async () => {
    renderCard();
    const score = await screen.findByTestId("reason-score");
    expect(score).toHaveTextContent("My score doesn't seem right");
    expect(score).toHaveTextContent("Active Participation Rate");
    expect(score).toHaveTextContent("AI score 1/4");
    expect(score).toHaveTextContent("Quote for Active Participation Rate");
  });

  it("no plan checked is said, never guessed; the low indicators stand in", async () => {
    renderCard();
    const missed = await screen.findByTestId("reason-missed");
    expect(missed).toHaveTextContent("Plan not checked");
    expect(missed).toHaveTextContent("Checks for understanding");
  });

  it("didn't understand: what the report told her to try", async () => {
    renderCard();
    expect(await screen.findByTestId("reason-unclear")).toHaveTextContent("Ask two children to repeat the rule");
  });

  it("Listen plays the disputed step from the server, in the kit player — no download link anywhere", async () => {
    renderCard();
    const score = await screen.findByTestId("reason-score");
    expect(document.querySelector('audio[src*="/clip"]')).toBeNull();
    fireEvent.click(within(score).getByRole("button", { name: /Listen/ }));
    const audio = document.querySelector('audio[src*="/clip"]') as HTMLAudioElement;
    expect(audio.getAttribute("src")).toBe(`/api/portal/coach/disagreements/${ID}/clip?at=190`);
    expect(document.querySelector("a[download]")).toBeNull();
    // an item without a time has nothing to play
    expect(within(screen.getByTestId("reason-missed")).queryByRole("button", { name: /Listen/ })).toBeNull();
  });

  it("her voice note, when she left one", async () => {
    renderCard();
    await screen.findByTestId("reason-score");
    expect(document.querySelector('audio[src="https://r2/note.ogg?sig"]')).not.toBeNull();
  });

  it("where to look: closed sections; opened, every indicator with the AI's score", async () => {
    renderCard();
    const where = await screen.findByTestId("where-to-look");
    expect(within(where).queryByText("Wait time")).toBeNull();
    fireEvent.click(within(where).getByRole("button", { name: /Student Engagement/ }));
    expect(within(where).getByText("Wait time")).toBeInTheDocument();
    expect(within(where).getByText("AI score 3/4")).toBeInTheDocument();
    expect(within(where).getByRole("button", { name: /Lesson Plan Fidelity/ })).toHaveTextContent("Plan not checked");
  });

  it("her trend and the full DC report", async () => {
    renderCard();
    expect(await screen.findByTestId("trend")).toHaveTextContent("52 → 58 → 61");
    const report = screen.getByTestId("full-report");
    fireEvent.click(within(report).getByRole("button", { name: /Full DC report/ }));
    expect(report).toHaveTextContent("AI score 61%");
    expect(report).toHaveTextContent("Called students by name");
    expect(report).toHaveTextContent("Student Engagement");
  });

  it("I have visited: one tap posts it, then it reads Visited and cannot be undone here", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "I have visited" }));
    await waitFor(() => expect(D.visited).toHaveBeenCalledWith(ID));
    expect(await screen.findByText("Visited")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "I have visited" })).toBeNull();
  });

  it("a save that fails says so and leaves the button", async () => {
    D.visited.mockResolvedValue(false);
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "I have visited" }));
    expect(await screen.findByText("Could not save")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I have visited" })).toBeInTheDocument();
  });

  it("a done card has no button", async () => {
    D.card.mockResolvedValue(card({ done: true, status: "visited", noteUrl: null }));
    renderCard();
    expect(await screen.findByText("Visited")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "I have visited" })).toBeNull();
  });

  it("flag off: to the coach home, the card is never read", async () => {
    vi.mocked(readDisagreementsOn).mockResolvedValue(false);
    renderCard();
    expect(await screen.findByTestId("coach-home")).toBeInTheDocument();
    expect(D.card).not.toHaveBeenCalled();
  });

  it("in Urdu the page's own words are Urdu", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    renderCard();
    expect(await screen.findByTestId("reason-score")).toHaveTextContent("میرا اسکور درست نہیں لگتا");
    expect(screen.getByRole("button", { name: "میں نے دورہ کر لیا" })).toBeInTheDocument();
  });
});
