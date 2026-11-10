import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: { children: unknown }) => <>{children as never}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Test", role: "coach", phoneNumber: "920000000000" }, loading: false }) }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
const progress = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("../../services/api", async (orig) => ({
  ...(await orig<typeof import("../../services/api")>()),
  coach: { getCoachTrainingProgress: progress.get, setCoachModuleDone: progress.set },
}));
import CoachTrainingPage from "./CoachTrainingPage";
import { BEHAVIOUR_MODULE, COACH_MODULES, COACH_TRAINING_PATH, moduleFor, modulePath, moduleUrl, videoUrl } from "./modules";
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
  // bd-rlxkkt.12 — Module 10, "No evidence, no level" (the ICT HITL owner's DM, 10 Nov 2026): her page, linked as-is
  "62371mmVGLxniEHz6VGRXx",
];

/** bd-rlxkkt.5 — the ICT HITL owner's video lesson for each module (her DM, 5 Nov 2026), in the same order. */
const VIDEOS = [
  "TZdNqRi29i4mw3meZqDLFj", "BcHByTAsY9Ze1g146gaerz", "Jckd2SBKn38TwCRpwVXFeb", "WFug7nbTqtZDHc4pyDvTWL", "V8Z8G4UTREoXrzvdMRHPwG",
  "8PfwS2qKp3rtuwCJ1GiwAZ", "GgzCzuPjSBYNFH7qspadNy", "FnhqM4ae3uV1XwwwgSYfYs", "MUxJFCkertstuJXnNNF9LC",
];

describe("the ten modules", () => {
  it("modules 1–9 each have their video lesson as well as their module page, and the two are different pages", () => {
    const nine = COACH_MODULES.slice(0, 9);
    expect(nine.map((m) => videoUrl(m))).toEqual(VIDEOS.map((id) => `https://claude.ai/artifact/${id}`));
    for (const m of nine) expect(m.video).not.toBe(m.artifact);
  });

  it("bd-rlxkkt.12 — Module 10 has its page but no video yet (null, never a guessed link)", () => {
    const ten = COACH_MODULES[9];
    expect(ten).toMatchObject({ n: 10, key: "evidence", artifact: "62371mmVGLxniEHz6VGRXx", video: null });
    expect(videoUrl(ten)).toBeNull();
    expect(ten.title).toEqual({ en: "No evidence, no level", ur: "ثبوت نہیں تو لیول نہیں" });
  });

  it("are numbered 1–10: the rubric's order, then Module 10; each a claude.ai page", () => {
    expect(COACH_MODULES.map((m) => m.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(COACH_MODULES.map((m) => m.key)).size).toBe(COACH_MODULES.length);
    expect(COACH_MODULES.map((m) => moduleUrl(m))).toEqual(IDS.map((id) => `https://claude.ai/artifact/${id}`));
    expect(COACH_MODULES[0].title.en).toBe("Open with specific praise");
    expect(COACH_MODULES[7].title.en).toBe("Rehearse it aloud");
    expect(COACH_MODULES[8].title.en).toBe("The full debrief");
    expect(COACH_MODULES[9].title.en).toBe("No evidence, no level");
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
  beforeEach(() => {
    open = vi.fn(); vi.stubGlobal("open", open);
    progress.get.mockReset().mockResolvedValue({ success: true, done: {} });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const renderPage = () => render(
    <MemoryRouter initialEntries={[COACH_TRAINING_PATH]}>
      <Routes><Route path={COACH_TRAINING_PATH} element={<CoachTrainingPage />} /></Routes>
    </MemoryRouter>,
  );

  it("English: Coach Training, ten module rows; a tap opens that module's own screen (no Video/PDF on the list)", async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
    renderPage();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Coach Training");
    const rows = within(screen.getByTestId("coach-modules")).getAllByTestId("coach-module");
    expect(rows).toHaveLength(10);
    expect(screen.getByText("Ten coaching modules")).toBeTruthy();
    expect(rows[0]).toHaveTextContent("Open with specific praise");
    expect(rows[9]).toHaveTextContent("No evidence, no level");
    expect(rows[9]).toHaveTextContent("10");
    expect(rows[0]).toHaveTextContent("Module");
    rows.forEach((row, i) => expect(row).toHaveAttribute("href", `/portal/coach/coach-training/${i + 1}`));
    expect(screen.queryByTestId("coach-module-video")).toBeNull();
    expect(screen.queryByTestId("coach-format-pdf")).toBeNull();
    expect(COACH_MODULES.map(modulePath)).toEqual(COACH_MODULES.map((m) => `/portal/coach/coach-training/${m.n}`));
  });

  it("Urdu: the same ten, in Urdu", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    renderPage();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("کوچ ٹریننگ");
    const rows = within(screen.getByTestId("coach-modules")).getAllByTestId("coach-module");
    expect(rows[7]).toHaveTextContent("جانے سے پہلے زبانی پریکٹس");
    expect(rows[9]).toHaveTextContent("ثبوت نہیں تو لیول نہیں");
    expect(screen.getByText("کوچنگ کے دس ماڈیول")).toBeTruthy();
    await act(async () => { await i18n.changeLanguage("en"); });
  });
});

describe("which modules she has done (bd-rlxkkt.9)", () => {
  beforeAll(async () => { if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} }); });
  const renderPage = () => render(
    <MemoryRouter initialEntries={[COACH_TRAINING_PATH]}>
      <Routes><Route path={COACH_TRAINING_PATH} element={<CoachTrainingPage />} /></Routes>
    </MemoryRouter>,
  );

  it("a Done tick on each module she marked, and the count: 3 of 10 done", async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
    progress.get.mockReset().mockResolvedValue({ success: true, done: { praise: "a", moment: "b", rehearse: "c" } });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("coach-training-count")).toHaveTextContent("3 of 10 done"));
    const rows = within(screen.getByTestId("coach-modules")).getAllByTestId("coach-module");
    const doneRows = rows.map((r, i) => (/Done/.test(r.textContent ?? "") ? i + 1 : 0)).filter(Boolean);
    expect(doneRows).toEqual([1, 2, 8]);
  });

  it("nothing done: 0 of 10 done and no ticks; a count that did not load shows —, never a 0", async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
    progress.get.mockReset().mockResolvedValue({ success: true, done: {} });
    const first = renderPage();
    await waitFor(() => expect(screen.getByTestId("coach-training-count")).toHaveTextContent("0 of 10 done"));
    expect(screen.queryAllByText("Done")).toHaveLength(0);
    first.unmount();
    progress.get.mockReset().mockRejectedValue(new Error("down"));
    renderPage();
    await waitFor(() => expect(progress.get).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId("coach-training-count")).toHaveTextContent("—"));
  });

  it("Urdu: 3/10 مکمل and the مکمل tick", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    progress.get.mockReset().mockResolvedValue({ success: true, done: { praise: "a", moment: "b", rehearse: "c" } });
    renderPage();
    // the chip isolates "3/10" (LRI … PDI) so it reads in order on an Urdu line
    await waitFor(() => expect(screen.getByTestId("coach-training-count").textContent?.replace(/[\u2066-\u2069]/g, "")).toBe("3/10 مکمل"));
    const rows = within(screen.getByTestId("coach-modules")).getAllByTestId("coach-module");
    expect(rows[0]).toHaveTextContent("مکمل");
    await act(async () => { await i18n.changeLanguage("en"); });
  });
});

describe("all ten done (bd-rlxkkt.12)", () => {
  beforeAll(async () => { if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} }); });
  it("Module 10 counts: 10 of 10 done, and its row carries the tick", async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
    const done = Object.fromEntries(COACH_MODULES.map((m) => [m.key, "2026-11-10T12:00:00.000Z"]));
    progress.get.mockReset().mockResolvedValue({ success: true, done });
    render(
      <MemoryRouter initialEntries={[COACH_TRAINING_PATH]}>
        <Routes><Route path={COACH_TRAINING_PATH} element={<CoachTrainingPage />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId("coach-training-count")).toHaveTextContent("10 of 10 done"));
    const rows = within(screen.getByTestId("coach-modules")).getAllByTestId("coach-module");
    expect(rows[9]).toHaveTextContent("Done");
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

  it("every coach can open it and each module's screen, whichever coach app she has", () => {
    for (const ready of [coachReadyFor(false, true), coachReadyFor(true, false), coachReadyFor(false, false)]) {
      expect(coachPathReady(COACH_TRAINING_PATH, ready)).toBe(true);
      for (const m of COACH_MODULES) expect(coachPathReady(modulePath(m), ready)).toBe(true);
      // bd-rlxkkt.12 — Module 10's screen is reachable (the guard allowed only 1–9); a number past the last is not
      expect(coachPathReady("/portal/coach/coach-training/10", ready)).toBe(true);
      expect(coachPathReady("/portal/coach/coach-training/11", ready)).toBe(false);
    }
    expect(COACH_TRAINING_PATH).toBe("/portal/coach/coach-training");
  });
});
