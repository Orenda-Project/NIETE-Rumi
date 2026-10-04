import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { tapProblems } from "../checks/rules";

/**
 * bd-5rz1v.26 — Coaching's main page in the new UI (portal_new_ui + portal_self_observation, a
 * teacher). Today's flow (CoachingHome), rebuilt from the kit:
 *
 *   band       "Coaching" with the mic tile; "7 lessons", "1 analysing"
 *   to do      Answer your question (n waiting) → the OLDEST one; Continue (a recording left on
 *              the phone, not sent) → a sheet with Continue and Delete
 *   filter     the subjects, as FilterChips, when there are two or more
 *   list       newest first, under a month label; the day in the tile, the topic, the subject,
 *              the band as a word (green good, amber below) or the lesson's state; › opens it
 *   button     ONE green Send a lesson → a sheet: Record live lecture (red mic, only where the
 *              microphone can work) | Upload recording | Cancel
 *
 * The record page is told what she chose in the route state ({ start: record | file | resume }),
 * exactly as before.
 */

vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/use-toast", () => { const toast = vi.fn(); return { useToast: () => ({ toast }) }; });
vi.mock("../../components/PortalLayout", () => ({
  default: ({ children, ownHeading }: { children: React.ReactNode; ownHeading?: boolean }) => (
    <div data-testid="layout" data-own-heading={String(Boolean(ownHeading))}>{children}</div>
  ),
}));
vi.mock("../../services/api", () => ({
  portal: {
    getConfig: vi.fn(),
    getDashboard: vi.fn(),
    getCoachingSessions: vi.fn(),
    getActiveCoachingSessions: vi.fn(),
  },
}));
vi.mock("../../lib/recordingSupport", async (orig) => ({
  ...(await orig<typeof import("../../lib/recordingSupport")>()),
  canRecordHere: vi.fn(),
  pickRecordingType: vi.fn(() => ({ mimeType: "audio/webm;codecs=opus", ext: ".webm" })),
}));
vi.mock("../../lib/recordingStore", () => ({
  latestUnsent: vi.fn(),
  deleteRecording: vi.fn().mockResolvedValue(undefined),
  createRecording: vi.fn(), appendChunk: vi.fn(), markFinished: vi.fn(),
}));
vi.mock("../../lib/keepAwake", () => ({ keepScreenOn: vi.fn(async () => async () => {}) }));
const recorder = vi.hoisted(() => ({
  id: "rec-live", start: vi.fn(), pause: vi.fn(), resume: vi.fn(), isPaused: vi.fn(), elapsedMs: vi.fn(), stop: vi.fn(), discard: vi.fn(),
}));
vi.mock("../../lib/lessonRecorder", () => ({ LessonRecorder: vi.fn(function LessonRecorder() { return recorder; }) }));

import { useAuth } from "../../hooks/useAuth";
import { portal } from "../../services/api";
import { canRecordHere } from "../../lib/recordingSupport";
import { latestUnsent, deleteRecording } from "../../lib/recordingStore";
import { takeHandedOffRecording } from "../../lib/lessonHandoff";
import { resetNewUiMemory } from "../../lib/useNewUi";
import { RecordingSessionProvider, useRecordingSession } from "../../lib/recordingSession";
import PortalCoaching from "../../pages/PortalCoaching";

const api = portal as unknown as Record<string, ReturnType<typeof vi.fn>>;

const TEACHER = { id: "t-1", firstName: "Ayesha", role: "teacher", phoneNumber: "920000000001" };

const done = (id: string, date: string, topic: string | null, subject: string | null, percentage: number | null, extra = {}) => ({
  id, date, duration: 1700, overallScore: 0, maxScore: 44, percentage, framework: "fico", topic, subject, ...extra,
});
const active = (id: string, createdAt: string, stage: string, needsAnswer: boolean, topic: string | null = null, source = "portal") => ({
  id, createdAt, status: "x", stage, source, needsAnswer, topic, subject: null,
});

const UNSENT = {
  meta: { id: "rec-old", mimeType: "audio/webm", ext: ".webm", startedAt: "2026-10-02T03:00:00Z", elapsedMs: 31 * 60_000, finished: false },
  blob: new Blob(["old"], { type: "audio/webm" }),
};

function config(features: Record<string, unknown>) {
  api.getConfig.mockResolvedValue({ success: true, features: { assessmentGenerator: false, assessmentGeneratorMessage: null, ...features } });
}

/** Stands in for the record page and the lesson page: where she went, and with what. */
function Where() {
  const { pathname, state } = useLocation();
  return <output data-testid="where" data-state={JSON.stringify(state ?? null)}>{pathname}</output>;
}

/** Starts a lesson recording the way the record page does, from outside this page. */
function StartRecording() {
  const s = useRecordingSession();
  return <button type="button" data-testid="start-recording" className="min-h-[56px] min-w-[56px]" onClick={() => { void s?.start({ returnTo: "/portal/coaching/new" }); }} />;
}

function renderPage({ state = null as unknown, user = TEACHER as Record<string, unknown>, dir }: { state?: unknown; user?: Record<string, unknown>; dir?: "rtl" } = {}) {
  vi.mocked(useAuth).mockReturnValue({ user, loading: false, logout: vi.fn() } as unknown as ReturnType<typeof useAuth>);
  const page = (
    <MemoryRouter initialEntries={[{ pathname: "/portal/coaching", state }]}>
      <RecordingSessionProvider>
        <StartRecording />
        <Routes>
          <Route path="/portal/coaching" element={<PortalCoaching />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </RecordingSessionProvider>
    </MemoryRouter>
  );
  return render(dir ? <div dir={dir}>{page}</div> : page);
}

const heading = () => screen.findByTestId("newui-main-heading");
/** The list has arrived (it loads after the band). */
const loaded = () => screen.findByTestId("coaching-recordings");
const list = () => screen.getByTestId("coaching-recordings");
const chipText = (el: HTMLElement) => [...el.querySelectorAll("[data-chip]")].map((c) => c.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  resetNewUiMemory();
  takeHandedOffRecording();
  config({ selfObservation: true, newUi: true });
  api.getCoachingSessions.mockResolvedValue({
    sessions: [
      done("c-sep", "2026-09-24T09:00:00Z", "Parts of a plant", "General Science", 30),
      done("c-oct1", "2026-10-01T09:00:00Z", "Reading: The Thirsty Crow", "English", 85),
      done("c-oct2", "2026-10-02T08:00:00Z", "Provinces of Pakistan", "Social Studies", 65),
      done("c-obs", "2026-09-20T05:00:00Z", null, null, null, { observation: { observerName: "Noor", observedAt: null, sentAt: null } }),
    ],
    pagination: {},
  });
  api.getActiveCoachingSessions.mockResolvedValue({
    sessions: [
      active("a-oldest", "2026-10-01T07:00:00Z", "reflection", true, "Fractions: halves and quarters"),
      active("a-newer", "2026-10-02T06:00:00Z", "reflection", true),
      active("a-wa", "2026-10-02T07:00:00Z", "reflection", false, null, "whatsapp"),
      active("a-analysing", "2026-10-02T10:40:00Z", "analysing", false),
    ],
  });
  vi.mocked(canRecordHere).mockResolvedValue(true);
  vi.mocked(latestUnsent).mockResolvedValue(null);
  recorder.start.mockResolvedValue(undefined);
  recorder.isPaused.mockReturnValue(false);
  recorder.elapsedMs.mockReturnValue(60_000);
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) }, configurable: true });
});

describe("which Coaching she gets", () => {
  it("a teacher with the new UI and self-observation: the new page, drawing its own heading", async () => {
    renderPage();
    const band = await heading();
    expect(within(band).getByRole("heading", { level: 1 })).toHaveTextContent("Coaching");
    expect(within(band).getByTestId("newui-heading-tile").querySelector("svg.lucide-mic")).not.toBeNull();
    expect(screen.getByTestId("layout")).toHaveAttribute("data-own-heading", "true");
    expect(screen.queryByTestId("send-a-lesson")).toBeNull();
  });

  it("the new UI without self-observation: today's list, unchanged", async () => {
    config({ selfObservation: false, newUi: true });
    renderPage();
    expect(await screen.findByText("Coaching Sessions")).toBeInTheDocument();
    expect(screen.queryByTestId("newui-main-heading")).toBeNull();
  });

  it("self-observation without the new UI: CoachingHome, unchanged", async () => {
    config({ selfObservation: true, newUi: false });
    renderPage();
    expect(await screen.findByTestId("send-a-lesson")).toBeInTheDocument();
    expect(screen.queryByTestId("newui-main-heading")).toBeNull();
  });

  it("a school leader never gets it", async () => {
    renderPage({ user: { ...TEACHER, role: "coach" } });
    expect(await screen.findByTestId("send-a-lesson")).toBeInTheDocument();
    expect(screen.queryByTestId("newui-main-heading")).toBeNull();
  });
});

describe("the band", () => {
  it("says how many lessons, and how many are being analysed", async () => {
    renderPage();
    const context = await screen.findByTestId("newui-heading-context");
    await waitFor(() => expect(chipText(context)).toEqual(["8 lessons", "1 analysing"]));
  });
});

describe("the list", () => {
  it("is newest first under month labels; each row opens its lesson", async () => {
    renderPage();
    await loaded();
    const rows = within(list()).getAllByRole("link");
    expect(rows.map((r) => r.getAttribute("href"))).toEqual([
      "/portal/coaching/session/a-analysing",
      "/portal/coaching/session/c-oct2",
      "/portal/coaching/session/a-wa",
      "/portal/coaching/session/a-newer",
      "/portal/coaching/session/c-oct1",
      "/portal/coaching/session/a-oldest",
      "/portal/coaching/session/c-sep",
      "/portal/coaching/session/c-obs",
    ]);
    expect(within(list()).getAllByRole("heading").map((h) => h.textContent)).toEqual(["Oct 2026", "Sep 2026"]);
  });

  it("a finished lesson: the day in the tile, the topic, its subject, and its band as a word", async () => {
    renderPage();
    await loaded();
    const row = within(list()).getAllByRole("link")[1];
    expect(within(row).getByTestId("newui-row-tile")).toHaveTextContent("2");
    expect(row).toHaveTextContent("Provinces of Pakistan");
    expect(chipText(row)).toEqual(["Social Studies", "Good"]);
  });

  it("a band's colour is its meaning: Good and above green, below Good amber", async () => {
    renderPage();
    await loaded();
    const chip = (text: string) => within(list()).getByText(text).closest("[data-chip]")!;
    expect(chip("Excellent").className).toMatch(/bg-nu-chip-done-bg/);
    expect(chip("Good").className).toMatch(/bg-nu-chip-done-bg/);
    expect(chip("Below average").className).toMatch(/bg-nu-chip-warning-bg/);
  });

  it("lessons on their way say where they are; a coach's observation says so", async () => {
    renderPage();
    await loaded();
    const rows = within(list()).getAllByRole("link");
    expect(rows[0]).toHaveTextContent("New recording");
    expect(chipText(rows[0])).toEqual(["Analysing"]);
    expect(chipText(rows[2])).toEqual(["On WhatsApp"]);
    expect(chipText(rows[3])).toEqual(["Your answer"]);
    expect(rows[5]).toHaveTextContent("Fractions: halves and quarters");
    expect(rows[7]).toHaveTextContent("Coach observation");
    expect(chipText(rows[7])).toEqual(["Coach visit", "Not rated"]);
    expect(within(list()).getByText("Analysing").closest("[data-chip]")!.className).toMatch(/bg-nu-chip-warning-bg/);
  });

  it("filters by subject with FilterChips when there are two or more", async () => {
    renderPage();
    await loaded();
    const group = screen.getByRole("radiogroup");
    expect(within(group).getAllByRole("radio").map((r) => r.textContent)).toEqual(["All", "English", "General Science", "Social Studies"]);
    fireEvent.click(within(group).getByRole("radio", { name: "English" }));
    expect(within(list()).getAllByRole("link").map((r) => r.getAttribute("href"))).toEqual(["/portal/coaching/session/c-oct1"]);
  });

  it("shows ten, then a More row shows ten more", async () => {
    api.getCoachingSessions.mockResolvedValue({
      sessions: Array.from({ length: 13 }, (_, i) => done(`d-${i}`, `2026-09-${String(28 - i).padStart(2, "0")}T05:00:00Z`, `Lesson ${i}`, "Maths", 70)),
    });
    api.getActiveCoachingSessions.mockResolvedValue({ sessions: [] });
    renderPage();
    await loaded();
    expect(within(list()).getAllByRole("link")).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(within(list()).getAllByRole("link")).toHaveLength(13);
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
  });

  it("nothing yet: a calm word, and the button", async () => {
    api.getCoachingSessions.mockResolvedValue({ sessions: [] });
    api.getActiveCoachingSessions.mockResolvedValue({ sessions: [] });
    renderPage();
    expect(await screen.findByText("No lessons yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send a lesson" })).toBeInTheDocument();
  });

  it("the list failed: Not loaded and Try again, which asks again", async () => {
    api.getCoachingSessions.mockRejectedValueOnce(new Error("down"));
    renderPage();
    expect(await screen.findByText("Not loaded")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Provinces of Pakistan")).toBeInTheDocument();
  });
});

describe("what is waiting for her", () => {
  it("Answer your question: n waiting, and it opens the OLDEST", async () => {
    renderPage();
    await heading();
    const row = screen.getByTestId("coaching-answer");
    expect(row).toHaveAttribute("href", "/portal/coaching/session/a-oldest");
    expect(row).toHaveTextContent("Answer your question");
    expect(chipText(row)).toEqual(["2 waiting"]);
  });

  it("none waiting: no row", async () => {
    api.getActiveCoachingSessions.mockResolvedValue({ sessions: [] });
    renderPage();
    await heading();
    expect(screen.queryByTestId("coaching-answer")).toBeNull();
  });

  it("a recording left on the phone: a Continue row; its sheet continues it", async () => {
    vi.mocked(latestUnsent).mockResolvedValue(UNSENT);
    renderPage();
    const row = await screen.findByTestId("coaching-unsent");
    expect(row).toHaveTextContent("Continue");
    expect(chipText(row)).toEqual(["Not sent", "31 min", "2 Oct"]);
    fireEvent.click(row);
    const sheet = await screen.findByRole("dialog", { name: "Not sent" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Continue" }));
    expect(await screen.findByTestId("where")).toHaveTextContent("/portal/coaching/new");
    expect(screen.getByTestId("where")).toHaveAttribute("data-state", JSON.stringify({ start: "resume" }));
  });

  it("…and Delete throws it away from the phone, red, as the second choice", async () => {
    vi.mocked(latestUnsent).mockResolvedValue(UNSENT);
    renderPage();
    fireEvent.click(await screen.findByTestId("coaching-unsent"));
    const sheet = await screen.findByRole("dialog", { name: "Not sent" });
    const del = within(sheet).getByRole("button", { name: "Delete" });
    expect(del.className).toMatch(/text-nu-button-destructive/);
    fireEvent.click(del);
    await waitFor(() => expect(deleteRecording).toHaveBeenCalledWith("rec-old"));
    await waitFor(() => expect(screen.queryByTestId("coaching-unsent")).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("while a lesson is recording, the unsent row stays away (it IS that lesson)", async () => {
    vi.mocked(latestUnsent).mockResolvedValue(UNSENT);
    renderPage();
    await screen.findByTestId("coaching-unsent");
    await act(async () => { fireEvent.click(screen.getByTestId("start-recording")); });
    await waitFor(() => expect(screen.queryByTestId("coaching-unsent")).toBeNull());
  });
});

describe("Send a lesson", () => {
  it("is ONE green bottom button", async () => {
    renderPage();
    await heading();
    const btn = screen.getByRole("button", { name: "Send a lesson" });
    expect(btn.className).toMatch(/(^|\s)bg-nu-button(\s|$)/);
    expect(screen.getByTestId("newui-bottom-actions")).toContainElement(btn);
  });

  it("opens a sheet: Record live lecture (red mic), Upload recording, Cancel", async () => {
    renderPage();
    await heading();
    fireEvent.click(screen.getByRole("button", { name: "Send a lesson" }));
    const sheet = await screen.findByRole("dialog", { name: "Send a lesson" });
    const record = await within(sheet).findByRole("button", { name: "Record live lecture" });
    expect(within(record).getByTestId("newui-row-tile").className).toMatch(/bg-nu-record-bg/);
    expect(within(record).getByTestId("newui-row-tile").querySelector("svg.lucide-mic")).not.toBeNull();
    expect(within(sheet).getByRole("button", { name: "Upload recording" })).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Record live lecture → the record page, recording", async () => {
    renderPage();
    await heading();
    fireEvent.click(screen.getByRole("button", { name: "Send a lesson" }));
    fireEvent.click(await screen.findByRole("button", { name: "Record live lecture" }));
    expect(await screen.findByTestId("where")).toHaveTextContent("/portal/coaching/new");
    expect(screen.getByTestId("where")).toHaveAttribute("data-state", JSON.stringify({ start: "record" }));
  });

  it("an app build that cannot record is offered Upload only", async () => {
    vi.mocked(canRecordHere).mockResolvedValue(false);
    renderPage();
    await heading();
    fireEvent.click(screen.getByRole("button", { name: "Send a lesson" }));
    const sheet = await screen.findByRole("dialog", { name: "Send a lesson" });
    expect(within(sheet).getByRole("button", { name: "Upload recording" })).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Record live lecture" })).toBeNull();
  });

  it("Upload recording: a file that is not a recording is refused in the sheet, in two words", async () => {
    renderPage();
    await heading();
    fireEvent.click(screen.getByRole("button", { name: "Send a lesson" }));
    const sheet = await screen.findByRole("dialog", { name: "Send a lesson" });
    fireEvent.change(within(sheet).getByTestId("send-audio-input"), { target: { files: [new File(["x"], "notes.pdf")] } });
    expect(await within(sheet).findByText("Not a recording")).toBeInTheDocument();
    expect(screen.queryByTestId("where")).toBeNull();
  });

  it("Upload recording: a recording is handed to the record page", async () => {
    renderPage();
    await heading();
    fireEvent.click(screen.getByRole("button", { name: "Send a lesson" }));
    const sheet = await screen.findByRole("dialog", { name: "Send a lesson" });
    const f = new File(["x"], "Period 3.m4a");
    fireEvent.change(within(sheet).getByTestId("send-audio-input"), { target: { files: [f] } });
    expect(await screen.findByTestId("where")).toHaveTextContent("/portal/coaching/new");
    expect(screen.getByTestId("where")).toHaveAttribute("data-state", JSON.stringify({ start: "file" }));
    expect(takeHandedOffRecording()).toBe(f);
  });

  it("the record page sending her back ({ sendSheet }) opens the sheet once, then forgets it", async () => {
    renderPage({ state: { sendSheet: true } });
    expect(await screen.findByRole("dialog", { name: "Send a lesson" })).toBeInTheDocument();
  });

  it("while a lesson is recording, Send a lesson goes back to it — never a second one", async () => {
    renderPage();
    await heading();
    await act(async () => { fireEvent.click(screen.getByTestId("start-recording")); });
    fireEvent.click(screen.getByRole("button", { name: "Send a lesson" }));
    expect(await screen.findByTestId("where")).toHaveTextContent("/portal/coaching/new");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the layout", () => {
  it("on a phone the button's space ends the page: it never opens a gap between what waits and the list", async () => {
    vi.mocked(latestUnsent).mockResolvedValue(UNSENT);
    renderPage();
    await screen.findByTestId("coaching-unsent");
    await loaded();
    const spacer = screen.getByTestId("newui-bottom-actions-spacer");
    const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(screen.getByTestId("coaching-unsent"), screen.getByTestId("coaching-recordings"))).toBe(true);
    expect(follows(screen.getByTestId("coaching-recordings"), spacer)).toBe(true);
  });
});

describe("the rules", () => {
  it("every target is 56px, sheets included", async () => {
    vi.mocked(latestUnsent).mockResolvedValue(UNSENT);
    renderPage();
    await screen.findByTestId("coaching-unsent");
    expect(tapProblems(document.body)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Send a lesson" }));
    await screen.findByRole("button", { name: "Record live lecture" });
    expect(tapProblems(document.body)).toEqual([]);
  });

  it("mirrors in Urdu: the row arrows turn round", async () => {
    renderPage({ dir: "rtl" });
    await loaded();
    const chevron = within(list()).getAllByRole("link")[0].querySelector("[data-chevron]")!;
    expect(chevron.getAttribute("class")).toMatch(/rtl:rotate-180/);
  });
});
