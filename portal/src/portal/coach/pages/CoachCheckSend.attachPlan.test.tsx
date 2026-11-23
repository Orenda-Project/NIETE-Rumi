import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import i18n from "i18next";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getVisit: vi.fn(), getReports: vi.fn() },
  leader: { cancelSchedule: vi.fn(), getObserveRecentPlans: vi.fn(), getObserveLessonQuestion: vi.fn() },
  portal: { getLibraryGrades: vi.fn(), getLibrarySubjects: vi.fn(), getLibraryChapters: vi.fn(), getLibraryLessons: vi.fn(), getRecentLessonPlans: vi.fn() },
}));
vi.mock("../../teacher/principal/api", () => ({ getPrincipalSchoolCard: vi.fn() }));
vi.mock("../../lib/coachObserve", async (orig) => ({ ...(await orig<typeof import("../../lib/coachObserve")>()), sendObservation: vi.fn() }));
vi.mock("../../lib/recordingStore", () => ({ deleteRecording: vi.fn(async () => {}), latestUnsent: vi.fn(async () => null) }));
const flow = vi.hoisted(() => ({ on: true as boolean | null }));
vi.mock("../flow/useCoachFlowV2", async (orig) => ({ ...(await orig<object>()), useFlowV6: () => flow.on, useFlowV2: () => flow.on }));

import { coach, leader, portal } from "../../services/api";
import { getPrincipalSchoolCard } from "../../teacher/principal/api";
import { sendObservation } from "../../lib/coachObserve";
import CoachCheckSend from "./CoachCheckSend";
import { setDraft, clearDraft } from "../observeDraft";
import { resetSender } from "../observe/sender";
import { noticeTracker } from "../../teacher/notices/tracker";
import { ObserveRoutesProvider } from "../observe/observeRoutes";
import { PRINCIPAL_OBSERVE_ROUTES } from "../../teacher/principal/observe";

/**
 * bd-o15qnr.33 (the operator 21 Nov ~09:10, take-an-observation, coaches and principals): "After selecting grade subject at
 * the observation page, when selecting a lesson plan, it should have already filtered down to that subject grades Lesson
 * Plans. In both, Recent ones or Library. Also, combine these 2 together. It should be Attach Lesson Plan. Then 2 buttons,
 * nietes lp or attach teachers lp. ... On nietes lp, show in a tray their 3 last recent plans of that grade subject, or give
 * them the chapter picker to select their own. If they attach, give them the camera vs attach one."
 *
 * Behind the v6/v7 switch (useFlowV6 true). Off: today's three tiles, unchanged.
 */
const C = coach as any;
const L = leader as any;
const PT = portal as any;
const send = sendObservation as any;
const VISIT_ID = "0d8a6d1c-1111-4c1c-9a1a-000000000033";
const OWN_ID = "0e0e0000-0000-4000-8000-0000000000bb";
const VISIT = {
  success: true,
  visit: { id: VISIT_ID, teacherName: "Ayesha Bibi", teacherExtId: "923001110001", schoolName: "IMSG I-10/1", schoolExtId: "niete:110", scheduledFor: "2026-10-06", scheduledSlot: "11:30", status: "upcoming", overdue: false },
  teacher: null,
  lastVisit: null,
};
const ASK = { ask: true, grades: [6, 7, 8, 9, 10, 11, 12], subjectGrades: [6, 7, 8], subjects: ["english", "urdu", "maths", "science", "social_studies", "islamiat", "computer", "other"] };
const dl = (assetId: string, topic: string, grade: number | string, subject: string, day: string) =>
  ({ assetId, lessonId: `l-${assetId}`, topic, grade, subject, chapterNumber: 2, dayLabel: null, pagesLabel: null, downloadedAt: `2026-11-${day}T09:00:00Z` });
// Newest first, as the server sends them (her downloads and her own plans, merged).
const PLANS = [
  dl("a1", "Ratios", 7, "Mathematics", "20"),
  dl("a2", "Nouns", 7, "English", "19"),
  { own: true, ownId: OWN_ID, lessonId: null, topic: "Fractions of a whole", grade: "7", subject: "maths", chapterNumber: "2", madeAt: "2026-11-18T08:00:00Z" },
  dl("a3", "Algebra", 8, "Mathematics", "17"),
  dl("a4", "Percentages", 7, "Maths", "16"),
  dl("a5", "Decimals", 7, "Mathematics", "15"),
  dl("a6", "Describing words", 3, "english", "14"),
  dl("a7", "Halves", 4, "math", "13"),
];
const GRADES = [1, 2, 3, 4, 5].map((grade) => ({ grade, lane: "k5" })).concat([6, 7, 8, 9, 10, 11, 12].map((grade) => ({ grade, lane: "g612" })));

const renderCheck = () => render(
  <MemoryRouter initialEntries={[`/portal/coach/visit/${VISIT_ID}/check`]}>
    <Routes>
      <Route path="/portal/coach/visit/:id/check" element={<CoachCheckSend />} />
      <Route path="/portal/coach/visit/:id/sending" element={<div>sending page</div>} />
      <Route path="*" element={<div>elsewhere</div>} />
    </Routes>
  </MemoryRouter>,
);

const choose = async (field: RegExp, option: string) => {
  fireEvent.click(await screen.findByRole("button", { name: field }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByText(option));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
};

const openNiete = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "NIETE lesson plan" }));
  return screen.findByRole("dialog");
};

const draft = (id: string) => {
  clearDraft(id);
  setDraft(id, {
    blob: new Blob(["x"], { type: "audio/webm" }), filename: "Observation.webm", durationMs: 2520000,
    recordingId: null, label: "Ayesha Bibi’s observation", sub: "42 min",
  });
};

beforeEach(async () => {
  vi.clearAllMocks();
  flow.on = true;
  noticeTracker.reset();
  resetSender();
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  draft(VISIT_ID);
  C.getVisit.mockResolvedValue(VISIT);
  L.getObserveRecentPlans.mockResolvedValue({ plans: PLANS });
  L.getObserveLessonQuestion.mockResolvedValue(ASK);
  PT.getLibraryGrades.mockResolvedValue(GRADES);
  PT.getLibrarySubjects.mockResolvedValue([{ key: "English", label: "English" }, { key: "Mathematics", label: "Mathematics" }]);
  PT.getLibraryChapters.mockResolvedValue([{ key: "ch2", label: "Chapter 2: Ratios" }]);
  PT.getLibraryLessons.mockResolvedValue([{ id: "seg-7-2-1", label: "Ratio tables", sub: null, ready: true, used: false }]);
  send.mockImplementation(() => new Promise(() => {}));
});
afterEach(() => { cleanup(); });

describe("Attach lesson plan (v6/v7 switch on)", () => {
  it("one section, Attach lesson plan (Optional), with two choices; the three old tiles are gone", async () => {
    renderCheck();
    expect(await screen.findByText("Attach lesson plan")).toBeTruthy();
    expect(screen.getByRole("button", { name: "NIETE lesson plan" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Teacher’s own plan" })).toBeTruthy();
    expect(screen.getByText("Optional")).toBeTruthy();
    for (const t of ["Their recent plans", "Library", "Their own plan"]) expect(screen.queryByRole("button", { name: t })).toBeNull();
  });

  it("NIETE lesson plan: the tray lists only that grade and subject's three newest plans", async () => {
    renderCheck();
    await choose(/^Class,/, "Grade 7");
    await choose(/^Subject,/, "Maths");
    const tray = await openNiete();
    expect(await within(tray).findByText("Ratios")).toBeTruthy();
    expect(within(tray).getByText("Fractions of a whole")).toBeTruthy();
    expect(within(tray).getByText("Percentages")).toBeTruthy();
    for (const t of ["Nouns", "Algebra", "Decimals", "Describing words", "Halves"]) expect(within(tray).queryByText(t)).toBeNull();
    // the class it is filtered to, as plain words
    expect(within(tray).getByTestId("niete-class").textContent).toBe("Grade 7 · Maths");
    expect(within(tray).getByRole("button", { name: "Pick a chapter" })).toBeTruthy();
  });

  it("Grade 1-5: only plans for grades 1 to 5", async () => {
    renderCheck();
    await choose(/^Class,/, "Grade 1-5");
    const tray = await openNiete();
    expect(await within(tray).findByText("Describing words")).toBeTruthy();
    expect(within(tray).getByText("Halves")).toBeTruthy();
    for (const t of ["Ratios", "Nouns", "Percentages"]) expect(within(tray).queryByText(t)).toBeNull();
  });

  it("no plan for that class: one slim line, and Pick a chapter is still there", async () => {
    renderCheck();
    await choose(/^Class,/, "Grade 6");
    await choose(/^Subject,/, "Science");
    const tray = await openNiete();
    expect(await within(tray).findByText("None for this class")).toBeTruthy();
    expect(within(tray).getByRole("button", { name: "Pick a chapter" })).toBeTruthy();
  });

  it("the class question is not asked: the newest three overall, and sending is not blocked", async () => {
    L.getObserveLessonQuestion.mockResolvedValue({ ask: false });
    renderCheck();
    const tray = await openNiete();
    expect(await within(tray).findByText("Ratios")).toBeTruthy();
    expect(within(tray).getByText("Nouns")).toBeTruthy();
    expect(within(tray).getByText("Fractions of a whole")).toBeTruthy();
    expect(within(tray).queryByText("Algebra")).toBeNull();
    fireEvent.click(within(tray).getByRole("button", { name: /Close/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send observation" }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0][0].plan).toBeNull();
  });

  it("a plan picked from the tray is sent with the observation, exactly as today's recent pick", async () => {
    renderCheck();
    await choose(/^Class,/, "Grade 7");
    await choose(/^Subject,/, "Maths");
    const tray = await openNiete();
    fireEvent.click(await within(tray).findByText("Ratios"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const chosen = screen.getByTestId("chosen-plan");
    expect(within(chosen).getByText("Ratios")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send observation" }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0][0].plan).toEqual({ kind: "library", pick: { assetId: "a1" } });
    expect(send.mock.calls[0][0].lesson).toEqual({ grade: 7, subject: "maths" });
  });

  it("her own Make my own plan from the tray goes as { ownId }", async () => {
    renderCheck();
    await choose(/^Class,/, "Grade 7");
    await choose(/^Subject,/, "Maths");
    const tray = await openNiete();
    fireEvent.click(await within(tray).findByText("Fractions of a whole"));
    fireEvent.click(screen.getByRole("button", { name: "Send observation" }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0][0].plan).toEqual({ kind: "library", pick: { ownId: OWN_ID } });
  });

  it("Pick a chapter opens the chapter picker already on that class (no grade or subject step); a lesson picked there is sent", async () => {
    renderCheck();
    await choose(/^Class,/, "Grade 7");
    await choose(/^Subject,/, "Maths");
    const tray = await openNiete();
    fireEvent.click(within(tray).getByRole("button", { name: "Pick a chapter" }));
    expect(await screen.findByText("Which chapter?")).toBeTruthy();
    expect(await screen.findByText("Chapter 2: Ratios")).toBeTruthy();
    expect(PT.getLibraryChapters).toHaveBeenCalledWith(7, "g612", "Mathematics");
    expect(screen.queryByText("Which grade?")).toBeNull();
    expect(screen.queryByText("Which subject?")).toBeNull();
    fireEvent.click(screen.getByText("Chapter 2: Ratios"));
    fireEvent.click(await screen.findByText("Ratio tables"));
    const chosen = await screen.findByTestId("chosen-plan");
    expect(within(chosen).getByText("Ratio tables")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send observation" }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0][0].plan).toEqual({ kind: "library", pick: { segmentId: "seg-7-2-1", lang: "en" } });
  });

  it("Back from the class's chapters returns to Check and send (never a skipped grade or subject step)", async () => {
    renderCheck();
    await choose(/^Class,/, "Grade 7");
    await choose(/^Subject,/, "Maths");
    const tray = await openNiete();
    fireEvent.click(within(tray).getByRole("button", { name: "Pick a chapter" }));
    expect(await screen.findByText("Chapter 2: Ratios")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("Attach lesson plan")).toBeTruthy();
    // the class she chose is kept
    expect(screen.getByRole("button", { name: /^Class, Grade 7/ })).toBeTruthy();
  });

  it("no class chosen: Pick a chapter opens the full picker (it asks the grade itself)", async () => {
    L.getObserveLessonQuestion.mockResolvedValue({ ask: false });
    renderCheck();
    const tray = await openNiete();
    fireEvent.click(within(tray).getByRole("button", { name: "Pick a chapter" }));
    expect(await screen.findByText("Which grade?")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "4" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "10" })).toBeTruthy();
  });

  it("Teacher’s own plan: Camera (the photo input with capture) and Attach file (the file picker); no Gallery", async () => {
    renderCheck();
    fireEvent.click(await screen.findByRole("button", { name: "Teacher’s own plan" }));
    const tray = await screen.findByRole("dialog");
    expect(within(tray).getByRole("button", { name: /Camera/ })).toBeTruthy();
    expect(within(tray).getByRole("button", { name: /Attach file/ })).toBeTruthy();
    expect(within(tray).queryByRole("button", { name: /Gallery/ })).toBeNull();
    const photo = screen.getByTestId("plan-photo-input") as HTMLInputElement;
    const files = screen.getByTestId("plan-file-input") as HTMLInputElement;
    expect(photo.getAttribute("capture")).toBe("environment");
    const photoClick = vi.spyOn(photo, "click").mockImplementation(() => {});
    const fileClick = vi.spyOn(files, "click").mockImplementation(() => {});
    fireEvent.click(within(tray).getByRole("button", { name: /Camera/ }));
    expect(photoClick).toHaveBeenCalled();
    fireEvent.click(within(tray).getByRole("button", { name: /Attach file/ }));
    expect(fileClick).toHaveBeenCalled();
  });

  it("an attached file is the plan sent with the observation, as today", async () => {
    renderCheck();
    fireEvent.click(await screen.findByRole("button", { name: "Teacher’s own plan" }));
    const pdf = new File(["%PDF-1.4"], "Ayesha plan.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByTestId("plan-file-input"), { target: { files: [pdf] } });
    const chosen = await screen.findByTestId("chosen-plan");
    expect(within(chosen).getByText("Ayesha plan.pdf")).toBeTruthy();
    expect(within(chosen).getByText("Teacher’s own plan")).toBeTruthy();
    await choose(/^Class,/, "Grade 10");
    fireEvent.click(screen.getByRole("button", { name: "Send observation" }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    const sent = send.mock.calls[0][0].plan;
    expect(sent.kind).toBe("file");
    expect(sent.file.name).toBe("Ayesha plan.pdf");
  });

  it("an attached plan: Change opens its choice again; Remove plan brings back the two choices", async () => {
    renderCheck();
    const tray = await openNiete();
    fireEvent.click(await within(tray).findByText("Ratios"));
    const chosen = await screen.findByTestId("chosen-plan");
    expect(within(chosen).getByText("NIETE lesson plan")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "NIETE lesson plan" })).toBeNull();
    fireEvent.click(within(chosen).getByRole("button", { name: /Change/ }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Close/ }));
    fireEvent.click(within(screen.getByTestId("chosen-plan")).getByRole("button", { name: "Remove plan" }));
    expect(screen.queryByTestId("chosen-plan")).toBeNull();
    expect(screen.getByRole("button", { name: "NIETE lesson plan" })).toBeTruthy();
  });

  it("in Urdu", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    renderCheck();
    expect(await screen.findByText("لیسن پلان لگائیں")).toBeTruthy();
    expect(screen.getByRole("button", { name: "⁦NIETE⁩ لیسن پلان" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "ٹیچر کا اپنا پلان" })).toBeTruthy();
    expect(screen.getByText("اختیاری")).toBeTruthy();
    const tray = await openNieteUr();
    expect(within(tray).getByRole("button", { name: "باب چنیں" })).toBeTruthy();
    expect(await within(tray).findByText("حالیہ لیسن پلان")).toBeTruthy();
  });
});

async function openNieteUr() {
  fireEvent.click(await screen.findByRole("button", { name: "⁦NIETE⁩ لیسن پلان" }));
  return screen.findByRole("dialog");
}

describe("switch off: today's lesson plan tiles, unchanged", () => {
  beforeEach(() => { flow.on = false; });

  it("Lesson plan with Their recent plans, Library and Their own plan; no Attach lesson plan", async () => {
    renderCheck();
    expect(await screen.findByRole("button", { name: "Their recent plans" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Library" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Their own plan" })).toBeTruthy();
    expect(screen.queryByText("Attach lesson plan")).toBeNull();
    expect(screen.queryByRole("button", { name: "NIETE lesson plan" })).toBeNull();
  });

  it("Their recent plans lists every recent plan, not filtered by the class", async () => {
    renderCheck();
    await choose(/^Class,/, "Grade 7");
    await choose(/^Subject,/, "Maths");
    fireEvent.click(screen.getByRole("button", { name: "Their recent plans" }));
    const tray = await screen.findByRole("dialog");
    for (const t of ["Ratios", "Nouns", "Algebra", "Decimals", "Halves"]) expect(await within(tray).findByText(t)).toBeTruthy();
  });

  it("Their own plan keeps Camera, Gallery and Files", async () => {
    renderCheck();
    fireEvent.click(await screen.findByRole("button", { name: "Their own plan" }));
    const tray = await screen.findByRole("dialog");
    for (const t of [/Camera/, /Gallery/, /Files/]) expect(within(tray).getByRole("button", { name: t })).toBeTruthy();
  });

  it("while the switch is still being read (null): today's screen", async () => {
    flow.on = null;
    renderCheck();
    expect(await screen.findByRole("button", { name: "Their recent plans" })).toBeTruthy();
    expect(screen.queryByText("Attach lesson plan")).toBeNull();
  });
});

describe("a principal's take-an-observation (the principal app's routes)", () => {
  const EXT = "900001";
  const CARD = {
    success: true, school: { emis: "1126", name: "GGPS Sample", teachers: 1, lastVisitDaysAgo: null },
    teachers: [{ id: "u-900001", teacherExtId: EXT, name: "Ayesha Sample", isPrincipal: false, levels: ["MIDDLE"], counts: { lp: 0, dc: 0, training: 0, papers: 0 }, total: 0, contributionPct: null, star: false, lastVisitDaysAgo: null }],
    scores: { dc: { count: 0, makers: 0 }, coach: { count: 0, makers: 0 } },
  };
  const renderPrincipal = () => render(
    <MemoryRouter initialEntries={[`/portal/teacher/principal/observe/${EXT}`]}>
      <ObserveRoutesProvider value={PRINCIPAL_OBSERVE_ROUTES}>
        <Routes>
          <Route path="/portal/teacher/principal/observe/:id" element={<CoachCheckSend />} />
          <Route path="/portal/teacher/principal/observe/:id/sending" element={<div>sending page</div>} />
          <Route path="*" element={<div>elsewhere</div>} />
        </Routes>
      </ObserveRoutesProvider>
    </MemoryRouter>,
  );
  beforeEach(() => {
    vi.mocked(getPrincipalSchoolCard).mockResolvedValue(CARD as any);
    draft(EXT);
  });

  it("the same Attach lesson plan: the tray is that class's, and the pick is sent for her teacher", async () => {
    renderPrincipal();
    expect(await screen.findByText("Attach lesson plan")).toBeTruthy();
    await choose(/^Class,/, "Grade 7");
    await choose(/^Subject,/, "Maths");
    const tray = await openNiete();
    expect(await within(tray).findByText("Percentages")).toBeTruthy();
    expect(within(tray).queryByText("Nouns")).toBeNull();
    fireEvent.click(within(tray).getByText("Percentages"));
    fireEvent.click(screen.getByRole("button", { name: "Send observation" }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(L.getObserveRecentPlans).toHaveBeenCalledWith(EXT, "niete:1126");
    expect(send.mock.calls[0][0].plan).toEqual({ kind: "library", pick: { assetId: "a4" } });
    expect(send.mock.calls[0][0].teacherExtId).toBe(EXT);
  });

  it("switch off for her: today's tiles", async () => {
    flow.on = false;
    renderPrincipal();
    expect(await screen.findByRole("button", { name: "Their recent plans" })).toBeTruthy();
    expect(screen.queryByText("Attach lesson plan")).toBeNull();
  });
});
