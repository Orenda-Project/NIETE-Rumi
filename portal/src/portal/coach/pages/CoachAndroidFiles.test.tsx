import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import i18n from "i18next";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getVisit: vi.fn(), handoff: vi.fn(async () => ({ code: null })) },
  leader: {
    cancelSchedule: vi.fn(), getObserveRecentPlans: vi.fn(), getObserveLessonQuestion: vi.fn(async () => ({ ask: false })),
    presignObserveUpload: vi.fn(), startObservation: vi.fn(),
  },
  portal: { uploadToR2: vi.fn() },
}));
vi.mock("../../lib/recordingStore", () => ({ deleteRecording: vi.fn(async () => {}), latestUnsent: vi.fn(async () => null) }));
const reportSendFailure = vi.hoisted(() => vi.fn());
vi.mock("../../lib/dcUploadReport", async (orig) => ({ ...(await orig<typeof import("../../lib/dcUploadReport")>()), reportSendFailure }));

import { coach, leader, portal } from "../../services/api";
import { isHeld } from "../../lib/pickedRead";
import { readBytes } from "../../lib/audioHash";
import CoachAttach from "./CoachAttach";
import CoachCheckSend from "./CoachCheckSend";
import CoachSending from "./CoachSending";
import { setDraft, getDraft, clearDraft } from "../observeDraft";
import { getJob, resetSender, startSend } from "../observe/sender";
import { failureWords } from "../observe/format";
import { OBSERVE } from "../observe/copy";
import { noticeTracker } from "../../teacher/notices/tracker";

/**
 * bd-tymy1n (queue #179) — production, 18 Nov 12:14–12:24 UTC: a coach in the Android app pressed Send observation 8
 * times; each send stopped on the FIRST of her three photos (a 163 KB JPEG) with NotReadableError before anything of it
 * left the phone, and the page said "The internet stopped". Her internet was fine. Check and send kept each photo as the
 * file the phone had picked, and the Android app's WebView could no longer open it by Send; the teacher's own grid has
 * read photos the moment they are picked since bd-r2uzg1.9 (13 Nov), and its read failures at Submit stopped.
 *
 * Here every file the coach picks on the Observe screens (photos, her own plan, an uploaded recording) is read when she
 * picks it and the page keeps those bytes; and a file the phone could not read at Send says so, with a way on — Send
 * without it, the teacher app's words — never "The internet stopped".
 */
const C = coach as any;
const L = leader as any;
const P = portal as any;
const VISIT_ID = "0d8a6d1c-1111-4c1c-9a1a-000000000002";
const VISIT = {
  success: true,
  visit: { id: VISIT_ID, teacherName: "Ayesha Bibi", teacherExtId: "923001110001", schoolName: "IMSG I-10/1", schoolExtId: "niete:110", scheduledFor: "2026-10-06", scheduledSlot: "11:30", status: "upcoming", overdue: false },
  teacher: { teacherExtId: "923001110001", name: "Ayesha Bibi", phone: "923001110001", hitl: 3, dc: 7, avgHitl: 61, daysSinceTraining: 12 },
  lastVisit: null,
};

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 7, 7];
const notReadable = () => Object.assign(new Error("The requested file could not be read"), { name: "NotReadableError" });

/**
 * A file as the Android app hands it over: it opens while she is picking it, and `lose()` is the WebView letting go of
 * it a little later (what production showed by Send).
 */
function picked(name: string, type: string, bytes: number[] = JPEG) {
  const f = new File([new Uint8Array(bytes)], name, { type });
  let open = true;
  Object.defineProperty(f, "arrayBuffer", {
    value: () => (open ? Promise.resolve(new Uint8Array(bytes).buffer) : Promise.reject(notReadable())),
  });
  return { file: f, lose: () => { open = false; } };
}
/** A file this phone never opens. */
function neverOpens(name: string, type = "image/jpeg") {
  const f = new File([new Uint8Array(JPEG)], name, { type });
  Object.defineProperty(f, "arrayBuffer", { value: () => Promise.reject(notReadable()) });
  return f;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/portal/coach/visit/:id/attach" element={<CoachAttach />} />
        <Route path="/portal/coach/visit/:id/check" element={<CoachCheckSend />} />
        <Route path="/portal/coach/visit/:id/sending" element={<CoachSending />} />
        <Route path="/portal/coach/visit/:id" element={<div>visit page</div>} />
        <Route path="/portal/coach/observation/:id" element={<div>observation page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const draft = () => setDraft(VISIT_ID, {
  blob: new Blob(["x"], { type: "audio/webm" }), filename: "Observation 6 Oct 11.30.webm", durationMs: 33 * 60_000,
  recordingId: null, label: "Ayesha Bibi’s observation", sub: "33 min · just now",
});

let keyN = 0;
beforeEach(async () => {
  vi.clearAllMocks();
  noticeTracker.reset();
  resetSender();
  clearDraft(VISIT_ID);
  keyN = 0;
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  C.getVisit.mockResolvedValue(VISIT);
  L.getObserveRecentPlans.mockResolvedValue({ plans: [] });
  L.getObserveLessonQuestion.mockResolvedValue({ ask: false });
  L.presignObserveUpload.mockImplementation(async (a: { kind: string }) => ({ uploadUrl: `https://r2/${++keyN}`, contentType: "x", key: `k/${a.kind}/${keyN}` }));
  P.uploadToR2.mockResolvedValue(undefined);
  L.startObservation.mockResolvedValue({ coachingSessionId: "cs-1" });
});
afterEach(() => { noticeTracker.reset(); });

/** What went up to R2, by kind, as bytes. */
async function sentBodies() {
  const out: { kind: string; bytes: number[] }[] = [];
  for (const [i, call] of P.uploadToR2.mock.calls.entries()) {
    const kind = L.presignObserveUpload.mock.calls[i][0].kind;
    out.push({ kind, bytes: Array.from(new Uint8Array(await readBytes(call[1] as Blob))) });
  }
  return out;
}

describe("Check and send: a photo is read when she picks it (the Android app lets go of it by Send)", () => {
  it("the photo the phone can no longer open at Send still goes, from the bytes read at the pick", async () => {
    draft();
    renderAt(`/portal/coach/visit/${VISIT_ID}/check`);
    const board = picked("IMG_2041.jpg", "image/jpeg");
    const input = await screen.findByTestId("photos-input");
    await act(async () => { fireEvent.change(input, { target: { files: [board.file] } }); });
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Remove photo/ })).toHaveLength(1));
    board.lose();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send observation" })); });
    await waitFor(() => expect(getJob(VISIT_ID)?.state).toBe("sent"));
    expect(await sentBodies()).toEqual([{ kind: "audio", bytes: expect.any(Array) }, { kind: "photo", bytes: JPEG }]);
    expect(L.startObservation).toHaveBeenCalledWith(expect.objectContaining({ photoKeys: ["k/photo/2"] }));
    expect(reportSendFailure).not.toHaveBeenCalled();
  });

  it("a photo that will not open is refused at the pick, on Check and send, not at Send", async () => {
    draft();
    renderAt(`/portal/coach/visit/${VISIT_ID}/check`);
    const input = await screen.findByTestId("photos-input");
    await act(async () => { fireEvent.change(input, { target: { files: [neverOpens("board.jpg")] } }); });
    expect((await screen.findByRole("alert", undefined, { timeout: 4000 })).textContent).toBe("Photo will not open");
    expect(screen.queryAllByRole("button", { name: /Remove photo/ })).toHaveLength(0);
    expect(reportSendFailure).toHaveBeenCalledWith(expect.objectContaining({ stage: "pick", kind: "photo", reason: "unreadable", errName: "NotReadableError" }));
  });
});

describe("Check and send: her own plan file is read when she picks it", () => {
  it("a plan from Files the phone can no longer open at Send still goes, from the bytes read at the pick", async () => {
    draft();
    renderAt(`/portal/coach/visit/${VISIT_ID}/check`);
    const pdf = [0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3];
    const plan = picked("plan.pdf", "application/pdf", pdf);
    const input = await screen.findByTestId("plan-file-input");
    await act(async () => { fireEvent.change(input, { target: { files: [plan.file] } }); });
    await waitFor(() => expect(screen.getByTestId("chosen-plan")).toHaveTextContent("plan.pdf"));
    plan.lose();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send observation" })); });
    await waitFor(() => expect(getJob(VISIT_ID)?.state).toBe("sent"));
    expect((await sentBodies()).find((b) => b.kind === "lesson_plan")).toEqual({ kind: "lesson_plan", bytes: pdf });
  });

  it("a plan file that will not open is refused at the pick, with its reason in the logs", async () => {
    draft();
    renderAt(`/portal/coach/visit/${VISIT_ID}/check`);
    const input = await screen.findByTestId("plan-gallery-input");
    await act(async () => { fireEvent.change(input, { target: { files: [neverOpens("plan.jpg")] } }); });
    expect((await screen.findByRole("alert", undefined, { timeout: 4000 })).textContent).toContain(OBSERVE.en.fileWontOpen);
    expect(screen.queryByTestId("chosen-plan")).toBeNull();
    expect(reportSendFailure).toHaveBeenCalledWith(expect.objectContaining({ stage: "pick", kind: "lesson_plan", reason: "unreadable", errName: "NotReadableError" }));
  });
});

describe("Upload recording: the file is read when she picks it", () => {
  it("a recording the phone can no longer open at Send still goes, from the bytes read at the pick", async () => {
    renderAt(`/portal/coach/visit/${VISIT_ID}/attach`);
    await screen.findByRole("dialog", { name: "Upload recording" });
    const m4a = [0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 9, 9];
    const rec = picked("lesson-1811.m4a", "audio/mp4", m4a);
    await act(async () => { fireEvent.change(screen.getByTestId("audio-input"), { target: { files: [rec.file] } }); });
    await waitFor(() => expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100"));
    expect(isHeld(getDraftAfterNext())).toBe(true);
    rec.lose();
    const sendButton = await screen.findByRole("button", { name: "Send observation" });
    await act(async () => { fireEvent.click(sendButton); });
    await waitFor(() => expect(getJob(VISIT_ID)?.state).toBe("sent"));
    expect((await sentBodies())[0]).toEqual({ kind: "audio", bytes: m4a });
  });

  it("a recording file that will not open is refused at the pick: Next stays off", async () => {
    renderAt(`/portal/coach/visit/${VISIT_ID}/attach`);
    await screen.findByRole("dialog", { name: "Upload recording" });
    await act(async () => { fireEvent.change(screen.getByTestId("audio-input"), { target: { files: [neverOpens("lesson.m4a", "audio/mp4")] } }); });
    expect((await screen.findByRole("alert", undefined, { timeout: 4000 })).textContent).toContain(OBSERVE.en.fileWontOpen);
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(reportSendFailure).toHaveBeenCalledWith(expect.objectContaining({ stage: "pick", kind: "audio", reason: "unreadable" }));
  });
});

/** Next on Upload recording, then the draft Check and send will send. */
function getDraftAfterNext(): Blob {
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  return getDraft(VISIT_ID)!.blob;
}

describe("a file the phone could not read at Send is not 'The internet stopped'", () => {
  const sendWith = (over: Record<string, unknown>) => startSend({
    visitId: VISIT_ID, teacherExtId: "923001110001", schoolExtId: "niete:110", teacherName: "Ayesha Bibi", visitDay: "2026-10-06",
    durationMs: 33 * 60_000, recordingId: null, audio: { blob: new Blob(["x"], { type: "audio/webm" }), filename: "o.webm" },
    plan: null, photos: [], waitHref: `/portal/coach/visit/${VISIT_ID}/sending`, ...over,
  });

  it("photo 1 unreadable: the reason names the photo, and Send without it sends the rest without sending the recording twice", async () => {
    const good = new File([new Uint8Array(JPEG)], "b.jpg", { type: "image/jpeg" });
    sendWith({ photos: [neverOpens("a.jpg"), good] });
    await waitFor(() => expect(getJob(VISIT_ID)?.state).toBe("failed"), { timeout: 4000 });
    expect(getJob(VISIT_ID)?.errorCode).toBe("unreadable_photo_1");
    renderAt(`/portal/coach/visit/${VISIT_ID}/sending`);
    const reason = await screen.findByRole("alert");
    expect(reason).toHaveTextContent("Photo 1 could not be read on this phone. Send without it.");
    expect(reason).not.toHaveTextContent(/internet/i);
    expect(P.uploadToR2).toHaveBeenCalledTimes(1); // the recording went before photo 1 stopped
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send without it" })); });
    await waitFor(() => expect(screen.getByTestId("send-state")).toHaveTextContent("Observation sent"));
    expect(L.presignObserveUpload.mock.calls.map((c: any[]) => c[0].kind)).toEqual(["audio", "photo"]);
    expect(L.startObservation).toHaveBeenCalledWith(expect.objectContaining({ key: "k/audio/1", photoKeys: ["k/photo/2"] }));
  });

  it("her plan file unreadable: Send without it", async () => {
    sendWith({ plan: { kind: "file", file: neverOpens("plan.pdf", "application/pdf") } });
    await waitFor(() => expect(getJob(VISIT_ID)?.errorCode).toBe("unreadable_lesson_plan"), { timeout: 4000 });
    renderAt(`/portal/coach/visit/${VISIT_ID}/sending`);
    expect(await screen.findByRole("alert")).toHaveTextContent("The lesson plan could not be read on this phone. Send without it.");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send without it" })); });
    await waitFor(() => expect(getJob(VISIT_ID)?.state).toBe("sent"));
    expect(L.startObservation.mock.calls[0][0].lessonPlanKey).toBeUndefined();
    expect(getJob(VISIT_ID)?.planKind).toBeNull();
  });

  it("an uploaded recording unreadable: choose the file again (Upload recording)", async () => {
    sendWith({ audio: { blob: neverOpens("lesson.m4a", "audio/mp4"), filename: "lesson.m4a" } });
    await waitFor(() => expect(getJob(VISIT_ID)?.errorCode).toBe("unreadable_audio"), { timeout: 4000 });
    renderAt(`/portal/coach/visit/${VISIT_ID}/sending`);
    expect(await screen.findByRole("alert")).toHaveTextContent("The recording could not be read on this phone. Select the file again.");
    expect(screen.getByRole("link", { name: OBSERVE.en.chooseFile })).toHaveAttribute("href", `/portal/coach/visit/${VISIT_ID}/attach`);
  });

  it("the words, in both languages; a real network failure still says the internet stopped", () => {
    expect(failureWords("unreadable_photo_2", OBSERVE.en)).toBe("Photo 2 could not be read on this phone. Send without it.");
    expect(failureWords("unreadable_photo_2", OBSERVE.ur)).toBe("تصویر 2 اس فون پر نہیں کھل سکی۔ اس کے بغیر بھیجیں۔");
    expect(failureWords("unreadable_lesson_plan", OBSERVE.ur)).toBe("لیسن پلان اس فون پر نہیں کھل سکا۔ اس کے بغیر بھیجیں۔");
    expect(failureWords("unreadable_audio", OBSERVE.ur)).toBe("ریکارڈنگ اس فون پر نہیں کھل سکی۔ فائل دوبارہ چنیں۔");
    expect(failureWords("network", OBSERVE.en)).toBe("The internet stopped. The observation is safe on this phone.");
  });
});
