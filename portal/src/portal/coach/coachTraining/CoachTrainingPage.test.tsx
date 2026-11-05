import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: { children: unknown }) => <>{children as never}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Test", role: "coach", phoneNumber: "920000000000" }, loading: false }) }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
import CoachTrainingPage from "./CoachTrainingPage";
import { BEHAVIOUR_MODULE, COACH_MODULES, COACH_TRAINING_PATH, moduleFor, moduleUrl, videoUrl } from "./modules";
import { COACH_TRAINING, COPY_ENTRY } from "./copy";
import { coachPathReady, coachReadyFor } from "../training/appReady";
import { COPY_MODULES } from "../../teacher/copyRegistry";

/**
 * bd-rlxkkt.2 — Coach Training: the ICT HITL owner's nine coaching modules (one per behaviour of the coach-debrief rubric,
 * then the full debrief), each a page she hosts. The coach's Home has a Coach Training tile (not the teacher Training
 * Library); it opens this list, and each module opens in the browser. The behaviour → module map is the one the coach's
 * Feedback Report links from.
 */
const IDS = [
  "Kfy7kDWtaZ4gQ2wX5BHceu", "NdMiwNiFxU5vcxfj8nFGmV", "DSJ3usPDiwBEnTNc8jU4qz", "V7XLdPCcyUZu1v1PGrZF9H", "1wkxNT3zTTKSrEAwMV5VPN",
  "CaqizBAbzEiAwMdKK2mNfx", "SBrvLUoSySSXCKVyshX72q", "MGVm5YMAdQhRCrWRWWg65C", "SZyvWZYrmMFn1XrhtnFGL8",
];

/** bd-rlxkkt.5 — the ICT HITL owner's video lesson for each module (her DM, 5 Nov 2026), in the same order. */
const VIDEOS = [
  "TZdNqRi29i4mw3meZqDLFj", "BcHByTAsY9Ze1g146gaerz", "Jckd2SBKn38TwCRpwVXFeb", "WFug7nbTqtZDHc4pyDvTWL", "V8Z8G4UTREoXrzvdMRHPwG",
  "8PfwS2qKp3rtuwCJ1GiwAZ", "GgzCzuPjSBYNFH7qspadNy", "FnhqM4ae3uV1XwwwgSYfYs", "MUxJFCkertstuJXnNNF9LC",
];

describe("the nine modules", () => {
  it("each has its video lesson as well as its module page, and the two are different pages", () => {
    expect(COACH_MODULES.map((m) => videoUrl(m))).toEqual(VIDEOS.map((id) => `https://claude.ai/artifact/${id}`));
    for (const m of COACH_MODULES) expect(m.video).not.toBe(m.artifact);
  });

  it("are numbered 1–9 in the rubric's order, each a claude.ai page", () => {
    expect(COACH_MODULES.map((m) => m.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(COACH_MODULES.map((m) => moduleUrl(m))).toEqual(IDS.map((id) => `https://claude.ai/artifact/${id}`));
    expect(COACH_MODULES[0].title.en).toBe("Open with specific praise");
    expect(COACH_MODULES[7].title.en).toBe("Rehearse it aloud");
    expect(COACH_MODULES[8].title.en).toBe("The full debrief");
    for (const m of COACH_MODULES) expect(m.title.ur).toMatch(/[؀-ۿ]/);
  });

  it("every behaviour the debrief is judged on has its module (the Feedback Report links from this map)", () => {
    expect(BEHAVIOUR_MODULE).toEqual({
      opened_with_specific_praise: 1,
      anchored_in_real_moment: 2,
      asked_and_waited: 3,
      one_improvement_only: 4,
      moves_not_teacher: 5,
      elicited_if_then: 6,
      righting_reflex_held: 7,
      rehearsed_the_step: 8,
    });
    expect(moduleFor("rehearsed_the_step")?.title.en).toBe("Rehearse it aloud");
    expect(moduleFor("not_a_behaviour")).toBeNull();
  });

  it("never links the programme page (it asks for a sign-in)", () => {
    expect(JSON.stringify(COACH_MODULES)).not.toContain("KLbUq76W");
  });
});

describe("the page", () => {
  beforeAll(async () => { if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} }); });
  let open: ReturnType<typeof vi.fn>;
  beforeEach(() => { open = vi.fn(); vi.stubGlobal("open", open); });
  afterEach(() => { vi.unstubAllGlobals(); });

  const renderPage = () => render(
    <MemoryRouter initialEntries={[COACH_TRAINING_PATH]}>
      <Routes><Route path={COACH_TRAINING_PATH} element={<CoachTrainingPage />} /></Routes>
    </MemoryRouter>,
  );

  it("English: Coach Training, nine modules, each with its Video first and its Module page", async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
    renderPage();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Coach Training");
    const cards = within(screen.getByTestId("coach-modules")).getAllByTestId("coach-module");
    expect(cards).toHaveLength(9);
    expect(cards[0]).toHaveTextContent("Open with specific praise");
    expect(cards[0]).toHaveTextContent("Module 1");
    cards.forEach((card) => {
      const [first, second] = within(card).getAllByRole("button");
      expect(first).toHaveAttribute("data-testid", "coach-module-video");
      expect(first).toHaveTextContent("Video");
      expect(second).toHaveAttribute("data-testid", "coach-module-page");
      expect(second).toHaveTextContent("Module page");
    });
    fireEvent.click(within(cards[7]).getByTestId("coach-module-video"));
    expect(open).toHaveBeenLastCalledWith("https://claude.ai/artifact/FnhqM4ae3uV1XwwwgSYfYs", "_blank", "noopener,noreferrer");
    fireEvent.click(within(cards[7]).getByTestId("coach-module-page"));
    expect(open).toHaveBeenLastCalledWith("https://claude.ai/artifact/MGVm5YMAdQhRCrWRWWg65C", "_blank", "noopener,noreferrer");
    fireEvent.click(within(cards[0]).getByTestId("coach-module-video"));
    expect(open).toHaveBeenLastCalledWith("https://claude.ai/artifact/TZdNqRi29i4mw3meZqDLFj", "_blank", "noopener,noreferrer");
  });

  it("Urdu: the same nine, in Urdu", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    renderPage();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("کوچ ٹریننگ");
    const cards = within(screen.getByTestId("coach-modules")).getAllByTestId("coach-module");
    expect(cards[7]).toHaveTextContent("جانے سے پہلے زبانی پریکٹس");
    expect(within(cards[7]).getByTestId("coach-module-video")).toHaveTextContent("ویڈیو");
    expect(within(cards[7]).getByTestId("coach-module-page")).toHaveTextContent("ماڈیول کا صفحہ");
    await act(async () => { await i18n.changeLanguage("en"); });
  });
});

describe("its words and its door", () => {
  it("Coach Training is never the teacher's Training (Library)", () => {
    expect(COACH_TRAINING.en.title).toBe("Coach Training");
    expect(COACH_TRAINING.ur.title).toBe("کوچ ٹریننگ");
    expect(COACH_TRAINING.en.title).not.toMatch(/Library/);
  });

  it("joins the Urdu completeness checks", () => {
    expect(COPY_MODULES).toContain(COPY_ENTRY);
  });

  it("every coach can open it, whichever coach app she has", () => {
    for (const ready of [coachReadyFor(false, true), coachReadyFor(true, false), coachReadyFor(false, false)]) {
      expect(coachPathReady(COACH_TRAINING_PATH, ready)).toBe(true);
    }
    expect(COACH_TRAINING_PATH).toBe("/portal/coach/coach-training");
  });
});
