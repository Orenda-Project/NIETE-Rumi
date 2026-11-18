import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Round 28: the live dashboard shows a card for a new tapped task (letter_pick10, story_mcq_w3) only when some
// session in view has a score for it; the old cards are unchanged and stay unconditional.

vi.mock("../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../services/api", () => ({ childTestSa: { getSwitches: vi.fn(), getResults: vi.fn(), getSessions: vi.fn() } }));

import { childTestSa } from "../services/api";
import LeaderAssessDashboard from "./LeaderAssessDashboard";

const api = childTestSa as any;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/portal/leader/assess/dashboard"]}>
      <Routes>
        <Route path="/portal/leader/assess/dashboard" element={<LeaderAssessDashboard />} />
      </Routes>
    </MemoryRouter>,
  );
}

const spoken = (taskId: string, score: Record<string, number>) => ({
  taskId, mode: "record", attempted: null, correct: null, optionsN: null, chanceCorrected: null,
  itemsPerMin: null, stopReason: "complete", recording: "scored", score,
});
const tap = (taskId: string, correct: number) => ({
  taskId, mode: "tap", attempted: 10, correct, optionsN: 5, chanceCorrected: null,
  itemsPerMin: null, stopReason: "complete", recording: "none", score: null,
});
let n = 0;
function row(tasks: any[]) {
  n += 1;
  const at = `2026-10-27T0${n % 10}:00:00Z`;
  return {
    schoolId: "sch-1", schoolName: "School One", sector: "Urban-I", grade: 3,
    results: { session: { id: `s-${n}`, grade: 3, form: "A", block: "rdf_auto", status: "completed", startedAt: at, endedAt: null, lang: "ur" }, tasks },
  };
}
const today = () => [spoken("ur.letter_sounds5", { correct: 3 }), spoken("ur.story_w3", { correct: 20, per_minute: 24 })];

beforeEach(() => {
  vi.clearAllMocks();
  n = 0;
  try { window.localStorage.clear(); window.localStorage.setItem("niete-assess-lang", "en"); } catch { /* none */ }
  api.getSwitches.mockResolvedValue({ realDashboard: true });
});

describe("LeaderAssessDashboard: round 28 tasks", () => {
  it("a cohort without the new ids renders no new card; the old cards are there", async () => {
    api.getSessions.mockResolvedValue({ sessions: Array.from({ length: 6 }, () => row(today())) });
    renderPage();
    await screen.findByTestId("dash-live");
    expect(screen.queryByTestId("dash-task-ur.letter_pick10")).toBeNull();
    expect(screen.queryByTestId("dash-task-ur.story_mcq_w3")).toBeNull();
    expect(within(screen.getByTestId("dash-task-ur.letter_sounds5")).getByRole("heading").textContent).toBe("Letter sounds");
    expect(screen.getByTestId("dash-task-ur.story_comp_w3")).toBeTruthy();
  });

  it("one session carrying the picker: its card renders with the new label, the old card unchanged", async () => {
    api.getSessions.mockResolvedValue({ sessions: [...Array.from({ length: 5 }, () => row(today())), row([tap("ur.letter_pick10", 8)])] });
    renderPage();
    await screen.findByTestId("dash-live");
    const card = screen.getByTestId("dash-task-ur.letter_pick10");
    expect(within(card).getByRole("heading").textContent).toBe("Letter sounds (listen and tap)");
    expect(within(screen.getByTestId("dash-task-ur.letter_sounds5")).getByRole("heading").textContent).toBe("Letter sounds");
    expect(screen.queryByTestId("dash-task-ur.story_mcq_w3")).toBeNull();
  });

  it("Urdu: the picker card carries the Urdu label", async () => {
    window.localStorage.setItem("niete-assess-lang", "ur");
    api.getSessions.mockResolvedValue({ sessions: [row([tap("ur.letter_pick10", 8)])] });
    renderPage();
    await screen.findByTestId("dash-live");
    expect(within(screen.getByTestId("dash-task-ur.letter_pick10")).getByRole("heading").textContent).toBe("حروف کی آوازیں (سن کر چُنیں)");
  });
});

// Round 28 (SPEC F): the headline "reading with comprehension" per form. One form: one number, today's tile. Both:
// two labelled numbers side by side, never one pooled share.
const comp = (correct: number) => spoken("ur.story_comp_w3", { correct, of: 4 });
const mcq = (correct: number) => ({ ...tap("ur.story_mcq_w3", correct), attempted: 6, optionsN: 4 });

describe("LeaderAssessDashboard: round 28 headline split", () => {
  it("a mixed cohort shows spoken and tapped apart with their labels, and no pooled number", async () => {
    // spoken: 2 of 3 at 80%+ (67%); tapped: 3 of 3 (100%); a pooled share would read 83%
    api.getSessions.mockResolvedValue({ sessions: [row([comp(4)]), row([comp(4)]), row([comp(1)]), row([mcq(5)]), row([mcq(6)]), row([mcq(5)])] });
    renderPage();
    await screen.findByTestId("dash-live");
    const tile = screen.getByTestId("dash-rwc");
    expect(within(tile).getByTestId("dash-rwc-spoken").textContent).toBe("spoken67%");
    expect(within(tile).getByTestId("dash-rwc-tapped").textContent).toBe("listen and tap100%");
    expect(tile.textContent).not.toContain("83%");
    const cell = within(screen.getAllByTestId("dash-group-row")[0]).getByTestId("dash-group-rwc");
    expect(cell.textContent).toBe("spoken 67% · listen and tap 100%");
  });

  it("Urdu: the two labels are «بول کر» and «سن کر چُنیں»", async () => {
    window.localStorage.setItem("niete-assess-lang", "ur");
    api.getSessions.mockResolvedValue({ sessions: [row([comp(4)]), row([comp(4)]), row([comp(1)]), row([mcq(5)]), row([mcq(6)]), row([mcq(5)])] });
    renderPage();
    await screen.findByTestId("dash-live");
    expect(screen.getByTestId("dash-rwc-spoken").textContent).toContain("بول کر");
    expect(screen.getByTestId("dash-rwc-tapped").textContent).toContain("سن کر چُنیں");
  });

  it("an old-form-only cohort renders today's tile: one number, no split", async () => {
    api.getSessions.mockResolvedValue({ sessions: [row([comp(4)]), row([comp(4)]), row([comp(1)]), row([comp(4)]), row([comp(2)])] });
    renderPage();
    await screen.findByTestId("dash-live");
    expect(screen.queryByTestId("dash-rwc-spoken")).toBeNull();
    expect(screen.queryByTestId("dash-rwc-tapped")).toBeNull();
    expect(screen.getByTestId("dash-rwc").textContent).toBe("Read with comprehension · Urdu60%80% or more of the passage questions right");
  });

  it("a tapped-only cohort shows one number, named as the tapped form", async () => {
    api.getSessions.mockResolvedValue({ sessions: [row([mcq(5)]), row([mcq(6)]), row([mcq(2)]), row([mcq(5)]), row([mcq(5)])] });
    renderPage();
    await screen.findByTestId("dash-live");
    expect(screen.queryByTestId("dash-rwc-spoken")).toBeNull();
    expect(screen.getByTestId("dash-rwc").textContent).toContain("80%");
    expect(screen.getByTestId("dash-rwc").textContent).toContain("listen and tap");
  });
});

// Round 28 (SPEC F): the guessing floor beside every tapped share, and the picker's tap-before-sound rate. Text only.
const pickT = (correct: number, before?: { n: number; of: number }) => ({ ...tap("ur.letter_pick10", correct), ...(before ? { tapBeforeSound: before } : {}) });

describe("LeaderAssessDashboard: round 28 guessing floor and tap-before-sound", () => {
  it("the picker card: the floor line, the tap-before-sound rate, and the warning above 10% (8 of 50 = 16%)", async () => {
    api.getSessions.mockResolvedValue({ sessions: Array.from({ length: 5 }, () => row([pickT(8, { n: 2, of: 10 })])).map((r, i) => (i < 4 ? r : row([pickT(7, { n: 0, of: 10 })]))) });
    renderPage();
    await screen.findByTestId("dash-live");
    const card = screen.getByTestId("dash-task-ur.letter_pick10");
    expect(within(card).getByTestId("dash-guess-floor").textContent).toBe("By guessing alone, 0.008% of children reach 8 of 10 (0.6% reach 6 of 10).");
    expect(within(card).getByTestId("dash-tap-before").textContent).toBe("Taps before the sound: 16% of items");
    expect(within(card).getByTestId("dash-tap-care").textContent).toBe("read with care");
  });

  it("at or below 10% the rate shows with no warning", async () => {
    api.getSessions.mockResolvedValue({ sessions: Array.from({ length: 5 }, (_, i) => row([pickT(8, { n: i < 2 ? 1 : 0, of: 10 })])) });
    renderPage();
    await screen.findByTestId("dash-live");
    const card = screen.getByTestId("dash-task-ur.letter_pick10");
    expect(within(card).getByTestId("dash-tap-before").textContent).toBe("Taps before the sound: 4% of items");
    expect(within(card).queryByTestId("dash-tap-care")).toBeNull();
  });

  it("the MCQ card: the floor line, no tap-before-sound line; Urdu", async () => {
    window.localStorage.setItem("niete-assess-lang", "ur");
    api.getSessions.mockResolvedValue({ sessions: Array.from({ length: 5 }, () => row([{ ...mcq(5), tapBeforeSound: { n: 1, of: 6 } }])) });
    renderPage();
    await screen.findByTestId("dash-live");
    const card = screen.getByTestId("dash-task-ur.story_mcq_w3");
    expect(within(card).getByTestId("dash-guess-floor").textContent).toBe("صرف اندازے سے ⁦۳.۸%⁩ بچے ⁦۶⁩ میں سے ⁦۴⁩ تک پہنچتے ہیں۔");
    expect(within(card).queryByTestId("dash-tap-before")).toBeNull();
  });

  it("a masked card (fewer than 5) has no floor or rate line; the old cards never have one", async () => {
    api.getSessions.mockResolvedValue({ sessions: [...Array.from({ length: 5 }, () => row(today())), row([pickT(8, { n: 5, of: 10 })])] });
    renderPage();
    await screen.findByTestId("dash-live");
    const card = screen.getByTestId("dash-task-ur.letter_pick10");
    expect(within(card).getByTestId("dash-masked")).toBeTruthy();
    expect(within(card).queryByTestId("dash-guess-floor")).toBeNull();
    expect(within(card).queryByTestId("dash-tap-before")).toBeNull();
    expect(within(screen.getByTestId("dash-task-ur.letter_sounds5")).queryByTestId("dash-guess-floor")).toBeNull();
  });
});

// Round 28 (lead ruling): the cohort card reads the floor at the cohort's modal `of` (the items most rated children
// had), and says how many children heard fewer.
describe("LeaderAssessDashboard: the floor at the cohort's modal count", () => {
  const pickOf = (correct: number, presented: number) => ({ ...pickT(correct), attempted: presented, presented });
  it("3 children at 10, 2 at 9: the floor at 10 and '2 children heard fewer items'", async () => {
    api.getSessions.mockResolvedValue({ sessions: [10, 10, 10, 9, 9].map((of) => row([pickOf(8, of)])) });
    renderPage();
    await screen.findByTestId("dash-live");
    const card = screen.getByTestId("dash-task-ur.letter_pick10");
    expect(within(card).getByTestId("dash-guess-floor").textContent).toBe("By guessing alone, 0.008% of children reach 8 of 10 (0.6% reach 6 of 10).");
    expect(within(card).getByTestId("dash-floor-fewer").textContent).toBe("2 children heard fewer items");
  });
  it("every child at 10: no hint", async () => {
    api.getSessions.mockResolvedValue({ sessions: [10, 10, 10, 10, 10].map((of) => row([pickOf(8, of)])) });
    renderPage();
    await screen.findByTestId("dash-live");
    const card = screen.getByTestId("dash-task-ur.letter_pick10");
    expect(within(card).getByTestId("dash-guess-floor").textContent).toBe("By guessing alone, 0.008% of children reach 8 of 10 (0.6% reach 6 of 10).");
    expect(within(card).queryByTestId("dash-floor-fewer")).toBeNull();
  });
  it("an MCQ cohort mostly on 4 (2 lost): the floor at 3 of 4; Urdu hint for the one on fewer", async () => {
    window.localStorage.setItem("niete-assess-lang", "ur");
    const m = (lost: number) => ({ ...mcq(3), unavailable: lost });
    api.getSessions.mockResolvedValue({ sessions: [2, 2, 2, 0, 3].map((lost) => row([m(lost)])) });
    renderPage();
    await screen.findByTestId("dash-live");
    const card = screen.getByTestId("dash-task-ur.story_mcq_w3");
    expect(within(card).getByTestId("dash-guess-floor").textContent).toBe("صرف اندازے سے ⁦۵.۱%⁩ بچے ⁦۴⁩ میں سے ⁦۳⁩ تک پہنچتے ہیں۔");
    expect(within(card).getByTestId("dash-floor-fewer").textContent).toBe("⁦۱⁩ بچے نے کم آئٹمز سنے");
  });
});

describe("round 28: the voice banner's footnote", () => {
  it("a cohort with a round-28 voice kind shows 'A second child reading along is not yet caught.'; today's boolean flag alone shows no footnote", async () => {
    const kind = Array.from({ length: 6 }, () => row(today()));
    kind[0].results.tasks[1] = { ...kind[0].results.tasks[1], secondVoice: true, secondVoiceKind: "help" } as any;
    api.getSessions.mockResolvedValue({ sessions: kind });
    const { unmount } = renderPage();
    const banner = await screen.findByTestId("dash-second-voice");
    expect(banner).toHaveTextContent(/1 of 6 sessions/);
    expect(within(banner).getByTestId("dash-voice-note")).toHaveTextContent("A second child reading along is not yet caught.");
    unmount();
    const plain = Array.from({ length: 6 }, () => row(today()));
    plain[0].results.tasks[1] = { ...plain[0].results.tasks[1], secondVoice: true } as any;
    api.getSessions.mockResolvedValue({ sessions: plain });
    renderPage();
    const banner2 = await screen.findByTestId("dash-second-voice");
    expect(within(banner2).queryByTestId("dash-voice-note")).toBeNull();
  });
});
