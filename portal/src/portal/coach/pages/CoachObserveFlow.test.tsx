import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, within, fireEvent, waitFor, act } from "@testing-library/react";
import i18n from "i18next";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { readFileSync } from "fs";
import { resolve } from "path";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getVisit: vi.fn() },
  leader: { cancelSchedule: vi.fn(), getObserveRecentPlans: vi.fn() },
  portal: {},
}));
const rec = vi.hoisted(() => ({
  state: { recording: true, paused: false, elapsed: 1122000, level: 0.4, screenWentOff: false, micBlocked: false },
  togglePause: vi.fn(),
  finish: vi.fn(),
}));
vi.mock("../../lib/useCoachRecording", () => ({
  useCoachRecording: (opts: { onStarted?: (id: string) => void }) => {
    opts.onStarted?.("rec-1");
    return { ...rec.state, togglePause: rec.togglePause, finish: rec.finish, elapsedNow: () => rec.state.elapsed };
  },
}));
vi.mock("../../lib/coachObserve", async (orig) => ({ ...(await orig<typeof import("../../lib/coachObserve")>()), sendObservation: vi.fn() }));
vi.mock("../../lib/recordingStore", () => ({ deleteRecording: vi.fn(async () => {}), latestUnsent: vi.fn(async () => null) }));

import { coach, leader } from "../../services/api";
import { sendObservation } from "../../lib/coachObserve";
import CoachVisit from "./CoachVisit";
import CoachRecord from "./CoachRecord";
import CoachAttach from "./CoachAttach";
import CoachCheckSend from "./CoachCheckSend";
import { setDraft, getDraft, clearDraft } from "../observeDraft";
import CoachSending from "./CoachSending";
import { getJob, resetSender } from "../observe/sender";
import { noticeTracker } from "../../teacher/notices/tracker";
import { NOTICES } from "../../teacher/notices/copy";

/**
 * bd-o15qnr.9 — taking an observation in coach v2, built from the canvas
 * (v21 Visit, v18 Recording / Attach / CheckSend); bd-4404s7.4 — rebuilt on the kit (Blueprint: Coach_Visit / Record /
 * Upload / Check / Sending): "Start recording", "Record observation", the words "observation" and not "lesson", and SENDING
 * IN THE BACKGROUND (the sender holds the upload; the Sending page and the notices follow it):
 *  6  "i clicked on Record Live and it asked me in a bottom up tray again to Record or Upload" — no second choice.
 *  8  two square buttons, centred icon over label; Record live pulses, Upload nudges; still under reduced motion.
 * 10  the Observation box first (no visible title), Reschedule/Cancel inside it; then Teacher.
 * 12  the teacher card opens with initials, name and phone.
 * The clock is Tuesday 6 Oct 2026, 09:30 in Pakistan.
 */
const C = coach as any;
const L = leader as any;
const send = sendObservation as any;
const VISIT_ID = "0d8a6d1c-1111-4c1c-9a1a-000000000002";

const VISIT = {
  success: true,
  visit: { id: VISIT_ID, teacherName: "Ayesha Bibi", teacherExtId: "923001110001", schoolName: "IMSG I-10/1", schoolExtId: "niete:110", scheduledFor: "2026-10-06", scheduledSlot: "11:30", status: "upcoming", overdue: false },
  teacher: { teacherExtId: "923001110001", name: "Ayesha Bibi", phone: "923001110001", hitl: 3, dc: 7, avgHitl: 61, daysSinceTraining: 12 },
  lastVisit: { id: "s-sent", date: "2026-09-14T09:00:00Z", score: 61, step: "sent", byMe: true, observerName: "Hataf Atif", portal: true },
};

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/portal/coach/visit/:id" element={<CoachVisit />} />
        <Route path="/portal/coach/visit/:id/record" element={<CoachRecord />} />
        <Route path="/portal/coach/visit/:id/attach" element={<CoachAttach />} />
        <Route path="/portal/coach/visit/:id/check" element={<CoachCheckSend />} />
        <Route path="/portal/coach/visit/:id/sending" element={<CoachSending />} />
        <Route path="/portal/coach/observation/:id" element={<div>observation page</div>} />
        <Route path="/portal/coach/reports" element={<div>reports page</div>} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  noticeTracker.reset();
  resetSender();
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-06T09:30:00+05:00"));
  clearDraft(VISIT_ID);
  rec.state = { recording: true, paused: false, elapsed: 1122000, level: 0.4, screenWentOff: false, micBlocked: false };
  C.getVisit.mockResolvedValue(VISIT);
  L.getObserveRecentPlans.mockResolvedValue({ plans: [{ assetId: "a1", topic: "Fractions", grade: 4, subject: "Maths", chapterNumber: 3, dayLabel: "Day 2" }] });
  send.mockResolvedValue({ coachingSessionId: "cs-1" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("10 + 12 — the Visit page, in the canvas order", () => {
  it("the Observation box comes first, holds the two ways and Reschedule/Cancel, and shows no heading", async () => {
    renderAt(`/portal/coach/visit/${VISIT_ID}`);
    const box = await screen.findByRole("group", { name: "Observation" });
    const b = within(box);
    expect(b.getByRole("link", { name: "Start recording" })).toBeInTheDocument();
    expect(b.getByRole("link", { name: "Upload recording" })).toBeInTheDocument();
    expect(b.getByRole("link", { name: /Reschedule/ })).toBeInTheDocument();
    expect(b.getByRole("button", { name: /^Cancel visit$/ })).toBeInTheDocument();
    expect(b.queryByRole("heading")).toBeNull();
    expect(screen.queryByText("Take observation", { selector: "h2" })).toBeNull();
    const teacherHeading = screen.getByRole("heading", { name: "Teacher" });
    // the box, then the Teacher heading, in document order
    expect(box.compareDocumentPosition(teacherHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the teacher card opens with initials, name and phone, then school, time, numbers, last visit and profile", async () => {
    renderAt(`/portal/coach/visit/${VISIT_ID}`);
    const card = await screen.findByTestId("teacher-card");
    const c = within(card);
    expect(c.getByText("AB")).toBeInTheDocument();
    expect(c.getByText("Ayesha Bibi")).toBeInTheDocument();
    expect(c.getByText("0300 1110001")).toBeInTheDocument();
    expect(card).not.toHaveTextContent("+92");
    expect(c.getByText("IMSG I-10/1")).toBeInTheDocument();
    expect(c.getByRole("img", { name: "11:30 AM" })).toBeInTheDocument();
    expect(c.getByText(/· Today/)).toBeInTheDocument();
    expect(c.getByText("In 2 h")).toBeInTheDocument();
    expect(c.getByText("Avg. HITL Score")).toBeInTheDocument(); // bd-o15qnr.18
    const last = c.getByRole("link", { name: /Last visit · 14 Sep/ });
    expect(last).toHaveTextContent("HITL · You");
    expect(last).toHaveTextContent("Sent");
    expect(last).toHaveAttribute("href", "/portal/coach/observation/s-sent"); // bd-o15qnr.19: the one observation page
    expect(c.getByRole("link", { name: /Teacher profile/ })).toHaveAttribute("href", "/portal/coach/teacher/923001110001");
    expect(screen.queryByText("Last visit", { selector: "h2" })).toBeNull();
  });

  it("no phone, no phone line (and no dash)", async () => {
    C.getVisit.mockResolvedValue({ ...VISIT, visit: { ...VISIT.visit, teacherExtId: "sadaf-khan" }, teacher: { ...VISIT.teacher, teacherExtId: "sadaf-khan", phone: null } });
    renderAt(`/portal/coach/visit/${VISIT_ID}`);
    const card = await screen.findByTestId("teacher-card");
    expect(card).not.toHaveTextContent(/\+92|03\d\d /);
    expect(within(card).queryByTestId("teacher-phone")).toBeNull();
  });

  // bd-o15qnr.19 — a WhatsApp observation opens the v2 observation page too, which shows its steps.
  it("someone else's WhatsApp observation: their name, its step, and it opens the observation page", async () => {
    C.getVisit.mockResolvedValue({ ...VISIT, lastVisit: { id: "s-wa", date: "2026-09-30T09:00:00Z", score: null, step: "draft", byMe: false, observerName: "Imran S", portal: false } });
    renderAt(`/portal/coach/visit/${VISIT_ID}`);
    const row = await screen.findByRole("link", { name: /Last visit/ });
    expect(row).toHaveAttribute("href", "/portal/coach/observation/s-wa");
    expect(row).toHaveTextContent("HITL · Imran S");
    expect(row).toHaveTextContent("Feedback Form");
  });

  it("a done visit has no Observation box", async () => {
    C.getVisit.mockResolvedValue({ ...VISIT, visit: { ...VISIT.visit, status: "done" } });
    renderAt(`/portal/coach/visit/${VISIT_ID}`);
    await screen.findByTestId("teacher-card");
    expect(screen.queryByRole("region", { name: "Observation" })).toBeNull();
  });
});

describe("8 — the two square buttons are the kit's RecordUploadPair", () => {
  it("Start recording and Upload recording, side by side, with Reschedule and Cancel visit under them", async () => {
    renderAt(`/portal/coach/visit/${VISIT_ID}`);
    const record = await screen.findByRole("link", { name: "Start recording" });
    const upload = screen.getByRole("link", { name: "Upload recording" });
    expect(record.className).toMatch(/bg-\[#33374a\]/);
    expect(record.className).toMatch(/min-h-\[176px\]/);
    expect(upload.className).toMatch(/bg-white/);
    expect(upload.className).toMatch(/min-h-\[176px\]/);
    expect(screen.getByRole("button", { name: "Cancel visit" }).className).toMatch(/text-\[#c8331f\]/);
  });
});

describe("6 — one choice, then straight on", () => {
  it("tapping Start recording opens the record screen; no sheet with a second Record/Upload choice", async () => {
    renderAt(`/portal/coach/visit/${VISIT_ID}`);
    fireEvent.click(await screen.findByRole("link", { name: "Start recording" }));
    await screen.findByRole("timer");
    expect(screen.getByRole("heading", { level: 1, name: "Record observation" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(/Record Live Lecture/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Upload Recording/i })).toBeNull();
  });

  it("tapping Upload recording opens the upload step for this visit; no second Record/Upload choice", async () => {
    renderAt(`/portal/coach/visit/${VISIT_ID}`);
    fireEvent.click(await screen.findByRole("link", { name: "Upload recording" }));
    const sheet = await screen.findByRole("dialog", { name: "Upload recording" });
    expect(within(sheet).getByText("Select file")).toBeInTheDocument();
    expect(within(sheet).queryByText(/Record/)).toBeNull();
  });
});

describe("Record observation (Blueprint: Coach_Record)", () => {
  it("the timer ring with Recording, the meter, and the visit it is linked to", async () => {
    renderAt(`/portal/coach/visit/${VISIT_ID}/record`);
    expect(await screen.findByRole("timer")).toHaveTextContent("18:42");
    expect(screen.getByRole("timer")).toHaveTextContent("Recording");
    expect(screen.getByTestId("level-meter")).toBeInTheDocument();
    const card = screen.getByTestId("linked-visit");
    expect(card).toHaveTextContent("Ayesha Bibi");
    expect(card).toHaveTextContent("IMSG I-10/1");
    expect(card).toHaveTextContent("Visit ·");
    expect(within(card).getByRole("img", { name: "11:30 AM" })).toBeInTheDocument();
    expect(card).toHaveTextContent("Linked");
  });

  it("Pause pauses; Stop asks once, then Check and send has the recording as an observation", async () => {
    const blob = new Blob(["x"], { type: "audio/webm" });
    rec.finish.mockResolvedValue({ id: "rec-1", blob, durationMs: 1122000, type: { ext: ".webm", mime: "audio/webm" } });
    renderAt(`/portal/coach/visit/${VISIT_ID}/record`);
    fireEvent.click(await screen.findByRole("button", { name: /Pause/ }));
    expect(rec.togglePause).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Stop/ }));
    const ask = await screen.findByRole("dialog", { name: "Stop recording" });
    expect(ask).toHaveTextContent("You recorded 19 min.");
    // bd-fmf24g.41: the kit's ConfirmTray — Yes, stop over Keep recording, both full width and 56px, stacked with a gap.
    const box = within(ask).getByTestId("confirm-tray-actions");
    expect(box.className.split(/\s+/)).toEqual(expect.arrayContaining(["flex", "flex-col", "gap-3"]));
    const actions = within(box).getAllByRole("button");
    expect(actions.map((b) => b.textContent)).toEqual(["Yes, stop", "Keep recording"]);
    for (const b of actions) {
      expect(b.className.split(/\s+/)).toEqual(expect.arrayContaining(["w-full", "min-h-[56px]"]));
      expect(b.className.split(/\s+/)).not.toContain("flex-1");
    }
    fireEvent.click(within(ask).getByRole("button", { name: /Yes, stop/ }));
    await screen.findByText("Ayesha Bibi’s observation");
    expect(screen.getByRole("heading", { level: 1, name: "Check and send" })).toBeInTheDocument();
    expect(getDraft(VISIT_ID)?.recordingId).toBe("rec-1");
    expect(screen.getByText(/19 min · just now/)).toBeInTheDocument();
  });

  it("Stop: Keep recording closes the sheet and keeps recording; a short recording warns (bd-fmf24g.41)", async () => {
    rec.state = { ...rec.state, elapsed: 4 * 60_000 };
    renderAt(`/portal/coach/visit/${VISIT_ID}/record`);
    fireEvent.click(await screen.findByRole("button", { name: /Stop/ }));
    const ask = await screen.findByRole("dialog", { name: "Stop recording" });
    expect(within(ask).getByRole("note")).toHaveTextContent("That is short.");
    fireEvent.click(within(ask).getByRole("button", { name: "Keep recording" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(rec.finish).not.toHaveBeenCalled();
  });

  it("a refused microphone: Try again, or Upload recording instead", async () => {
    rec.state = { ...rec.state, recording: false, micBlocked: true };
    renderAt(`/portal/coach/visit/${VISIT_ID}/record`);
    expect(await screen.findByRole("link", { name: /Upload recording/ })).toHaveAttribute("href", `/portal/coach/visit/${VISIT_ID}/attach`);
    expect(screen.getByRole("button", { name: /Try again/ })).toBeInTheDocument();
  });
});

describe("Upload recording (Blueprint: Coach_Upload)", () => {
  it("a file that is not a recording is refused", async () => {
    renderAt(`/portal/coach/visit/${VISIT_ID}/attach`);
    await screen.findByRole("dialog", { name: "Upload recording" });
    const input = screen.getByTestId("audio-input");
    await act(async () => { fireEvent.change(input, { target: { files: [new File(["x"], "notes.pdf", { type: "application/pdf" })] } }); });
    expect(screen.getByRole("alert")).toHaveTextContent(/Not a recording/);
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("a recording shows its row with a full bar; Next goes to Check and send", async () => {
    renderAt(`/portal/coach/visit/${VISIT_ID}/attach`);
    await screen.findByRole("dialog", { name: "Upload recording" });
    await act(async () => { fireEvent.change(screen.getByTestId("audio-input"), { target: { files: [new File(["abc"], "lesson-0610.m4a", { type: "audio/mp4" })] } }); });
    expect(await screen.findByText("lesson-0610.m4a")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("button", { name: /Redo/ });
    expect(screen.getByRole("heading", { level: 1, name: "Check and send" })).toBeInTheDocument();
    expect(getDraft(VISIT_ID)?.filename).toBe("lesson-0610.m4a");
  });
});

describe("Check and send (Blueprint: Coach_Check)", () => {
  const draft = () => setDraft(VISIT_ID, {
    blob: new Blob(["x"], { type: "audio/webm" }), filename: "Observation 6 Oct 11.30.webm", durationMs: 2520000,
    recordingId: "rec-1", label: "Ayesha Bibi’s observation", sub: "42 min · just now",
  });

  it("the recording, the plan options, photos, and Send observation", async () => {
    draft();
    renderAt(`/portal/coach/visit/${VISIT_ID}/check`);
    expect(await screen.findByText("Ayesha Bibi’s observation")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Redo/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Lesson plan/ })).toHaveTextContent("Optional");
    for (const t of ["Their recent plans", "Library", "Plan photo"]) expect(screen.getByRole("button", { name: t })).toBeInTheDocument();
    const photos = screen.getByRole("heading", { name: /Photos/ });
    expect(photos).toHaveTextContent("Up to 3");
    expect(photos).toHaveTextContent("No faces");
    expect(screen.queryByText(/Board photos/)).toBeNull();
    expect(screen.getByRole("button", { name: "Send observation" })).toBeInTheDocument();
    expect(screen.queryByText(/\blesson\b(?! plan)/i)).toBeNull();
  });

  it("Send observation sends THIS visit's teacher and school IN THE BACKGROUND and moves to the Sending page", async () => {
    send.mockImplementation(() => new Promise(() => {})); // still uploading
    draft();
    renderAt(`/portal/coach/visit/${VISIT_ID}/check`);
    fireEvent.click(await screen.findByRole("button", { name: "Send observation" }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    const args = send.mock.calls[0][0];
    expect(args).toMatchObject({ teacherExtId: "923001110001", schoolExtId: "niete:110", plan: null, photos: [] });
    expect(args.audio.filename).toBe("Observation 6 Oct 11.30.webm");
    expect(await screen.findByTestId("send-state")).toHaveTextContent("Sending");
    // the notices follow it: "Observation · Ayesha Bibi"
    expect(noticeTracker.getItems()).toEqual([expect.objectContaining({ kind: "observation", state: "making", title: "Ayesha Bibi", visitId: VISIT_ID })]);
  });

  it("their recent plan can be picked and is sent with the observation", async () => {
    send.mockImplementation(() => new Promise(() => {}));
    draft();
    renderAt(`/portal/coach/visit/${VISIT_ID}/check`);
    fireEvent.click(await screen.findByRole("button", { name: "Their recent plans" }));
    fireEvent.click(await screen.findByRole("button", { name: /Fractions/ }));
    expect(L.getObserveRecentPlans).toHaveBeenCalledWith("923001110001", "niete:110");
    expect(screen.getByTestId("chosen-plan")).toHaveTextContent("Fractions");
    fireEvent.click(screen.getByRole("button", { name: "Send observation" }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0][0].plan).toEqual({ kind: "library", pick: { assetId: "a1" } });
  });

  it("photos: up to three, each removable; a fourth is refused", async () => {
    draft();
    renderAt(`/portal/coach/visit/${VISIT_ID}/check`);
    await screen.findByText("Ayesha Bibi’s observation");
    const input = screen.getByTestId("photos-input");
    const jpg = (n: string) => new File(["p"], n, { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [jpg("a.jpg"), jpg("b.jpg"), jpg("c.jpg")] } });
    const removers = () => screen.queryAllByRole("button", { name: /^Remove photo/ });
    expect(removers()).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /Add photo/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove photo 2" }));
    expect(removers()).toHaveLength(2);
    fireEvent.change(input, { target: { files: [jpg("d.jpg"), jpg("e.jpg")] } });
    expect(screen.getByRole("alert")).toHaveTextContent(/Up to 3/);
  });

  it("opened with no recording: back to the two ways", async () => {
    renderAt(`/portal/coach/visit/${VISIT_ID}/check`);
    expect(await screen.findByRole("link", { name: "Start recording" })).toHaveAttribute("href", `/portal/coach/visit/${VISIT_ID}/record`);
    expect(screen.getByRole("link", { name: "Upload recording" })).toHaveAttribute("href", `/portal/coach/visit/${VISIT_ID}/attach`);
    expect(send).not.toHaveBeenCalled();
  });

  it("an observation already being sent for this visit: Check and send is the Sending page", async () => {
    send.mockImplementation(() => new Promise(() => {}));
    draft();
    renderAt(`/portal/coach/visit/${VISIT_ID}/check`);
    fireEvent.click(await screen.findByRole("button", { name: "Send observation" }));
    await screen.findByTestId("send-state");
    cleanup();
    renderAt(`/portal/coach/visit/${VISIT_ID}/check`);
    expect(await screen.findByTestId("send-state")).toBeInTheDocument();
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("Sending, in the background (Blueprint: Coach_Sending)", () => {
  const draft = () => setDraft(VISIT_ID, {
    blob: new Blob(["x"], { type: "audio/webm" }), filename: "Observation 6 Oct 11.30.webm", durationMs: 38 * 60_000,
    recordingId: null, label: "Ayesha Bibi’s observation", sub: "38 min · just now",
  });
  async function startSending() {
    draft();
    renderAt(`/portal/coach/visit/${VISIT_ID}/check`);
    fireEvent.click(await screen.findByRole("button", { name: "Send observation" }));
    return screen.findByTestId("send-state");
  }

  it("the ring fills with the real progress; 'You can leave. We'll tell you here.' and the way out, Go to Reports", async () => {
    let progress!: (n: number) => void;
    send.mockImplementation((_a: unknown, _b: unknown, _c: unknown, p: (n: number) => void) => { progress = p; return new Promise(() => {}); });
    await startSending();
    act(() => progress(62));
    expect(screen.getByRole("progressbar", { name: "Sending" })).toHaveAttribute("aria-valuenow", "62");
    expect(screen.getByTestId("send-pct")).toHaveTextContent("62%");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Ayesha Bibi’s observation");
    expect(screen.getByText("38 min")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("You can leave. We'll tell you here.");
    expect(screen.getByRole("note")).toHaveTextContent("The observation keeps sending in the background.");
    expect(screen.getByRole("link", { name: "Go to Reports" })).toHaveAttribute("href", "/portal/coach/reports");
  });

  it("leaving the page does not stop it: the upload carries on and the notices follow it", async () => {
    let finish!: (v: { coachingSessionId: string }) => void;
    send.mockImplementation(() => new Promise((res) => { finish = res; }));
    await startSending();
    fireEvent.click(screen.getByRole("link", { name: "Go to Reports" }));
    expect(await screen.findByText("reports page")).toBeInTheDocument();
    expect(getJob(VISIT_ID)?.state).toBe("sending");
    await act(async () => { finish({ coachingSessionId: "cs-1" }); });
    expect(getJob(VISIT_ID)).toMatchObject({ state: "sent", observationId: "cs-1" });
    expect(noticeTracker.getItems()[0]).toMatchObject({ state: "ready", observationId: "cs-1" });
    expect(getDraft(VISIT_ID)).toBeNull();
  });

  it("sent while she is looking: Open observation", async () => {
    let finish!: (v: { coachingSessionId: string }) => void;
    send.mockImplementation(() => new Promise((res) => { finish = res; }));
    await startSending();
    await act(async () => { finish({ coachingSessionId: "cs-1" }); });
    expect(screen.getByTestId("send-state")).toHaveTextContent("Observation sent");
    fireEvent.click(screen.getByRole("link", { name: "Open observation" }));
    expect(await screen.findByText("observation page")).toBeInTheDocument();
  });

  it("a failure: 'Couldn't send', the real reason and Try again, which sends the SAME observation; nothing goes to WhatsApp", async () => {
    const { SendError } = await import("../../lib/coachingSend");
    send.mockRejectedValueOnce(new SendError("network"));
    await startSending();
    await waitFor(() => expect(screen.getByTestId("send-state")).toHaveTextContent("Couldn't send"));
    expect(screen.getByRole("alert")).toHaveTextContent("The internet stopped. The observation is safe on this phone.");
    send.mockResolvedValueOnce({ coachingSessionId: "cs-2" });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); });
    await waitFor(() => expect(screen.getByTestId("send-state")).toHaveTextContent("Observation sent"));
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].audio).toBe(send.mock.calls[0][0].audio);
  });

  it("in Urdu", async () => {
    send.mockImplementation(() => new Promise(() => {}));
    await act(async () => { await i18n.changeLanguage("ur"); });
    draft();
    renderAt(`/portal/coach/visit/${VISIT_ID}/check`);
    fireEvent.click(await screen.findByRole("button", { name: "مشاہدہ بھیجیں" }));
    expect(await screen.findByTestId("send-state")).toHaveTextContent("بھیجا جا رہا ہے");
    expect(screen.getByRole("note")).toHaveTextContent(NOTICES.ur.leave); // the one line every waiting screen carries
  });

  it("nothing being sent for this visit: back to the visit", async () => {
    renderAt(`/portal/coach/visit/${VISIT_ID}/sending`);
    expect(await screen.findByRole("heading", { level: 1, name: "Ayesha Bibi" })).toBeInTheDocument();
  });
});

describe("routes", () => {
  it("the steps have v2 routes; the old page's route is still there", () => {
    const app = readFileSync(resolve(__dirname, "../../../App.tsx"), "utf8");
    expect(app).toContain('<Route path="/portal/coach/visit/:id/record" element={<CoachRecord />} />');
    expect(app).toContain('<Route path="/portal/coach/visit/:id/attach" element={<CoachAttach />} />');
    expect(app).toContain('<Route path="/portal/coach/visit/:id/check" element={<CoachCheckSend />} />');
    expect(app).toContain('<Route path="/portal/coach/visit/:id/sending" element={<CoachSending />} />');
    expect(app).toMatch(/\/portal\/leader\/observe\/new/);
  });
});
