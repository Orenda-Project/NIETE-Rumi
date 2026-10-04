import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { tapProblems } from "../checks/rules";

/**
 * bd-5rz1v.26.4 — Logout while a lesson records, in the new look.
 *
 * bd-5rz1v.10 (PR #1524) made Logout ask first while recording, because it really would end the
 * lesson. With portal_new_ui on, the question is now a kit Sheet:
 *
 *   "Stop recording?"   the red Recording chip (amber Paused when paused) and the running time
 *   Keep recording      primary green: the sheet closes, the lesson records on, she stays in
 *   Stop & log out      the outline button with red words: the recording is FINISHED (kept on the
 *                       phone; Coaching offers it under Continue after sign-in), then logout
 *
 * It is the same question wherever Logout is tapped — the account sheet today, the menu's pull-up
 * panel (bd-5rz1v.18) tomorrow — through useLogoutGuard / useGuardedLogout. Flag off, loading or
 * unreadable: the old sheet, as it was (PortalCoachingRecord.session.test.tsx).
 *
 * Mounted through the REAL PortalLayout and navigation; the recorder and the network are mocked.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../services/api", () => ({
  portal: { getConfig: vi.fn(), getDashboard: vi.fn() },
  auth: { logout: vi.fn() },
}));
vi.mock("../../lib/recordingSupport", async (orig) => ({
  ...(await orig<typeof import("../../lib/recordingSupport")>()),
  pickRecordingType: vi.fn(() => ({ mimeType: "audio/webm;codecs=opus", ext: ".webm" })),
}));
vi.mock("../../lib/keepAwake", () => ({ keepScreenOn: vi.fn(async () => async () => {}) }));

const recorder = vi.hoisted(() => ({
  id: "rec-live",
  start: vi.fn(),
  pause: vi.fn(), resume: vi.fn(),
  isPaused: vi.fn(),
  elapsedMs: vi.fn(),
  stop: vi.fn(),
  discard: vi.fn(),
}));
vi.mock("../../lib/lessonRecorder", () => ({ LessonRecorder: vi.fn(function LessonRecorder() { return recorder; }) }));

import { portal, auth } from "../../services/api";
import { resetNewUiMemory } from "../../lib/useNewUi";
import { RecordingSessionProvider, useRecordingSession } from "../../lib/recordingSession";
import PortalLayout from "../../components/PortalLayout";
import { useGuardedLogout } from "../useGuardedLogout";

const api = portal as unknown as Record<string, ReturnType<typeof vi.fn>>;
const getUserMedia = vi.fn();
const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);

/** A stand-in for any Logout tile (the pull-up panel's, bd-5rz1v.18): the hook is all it needs. */
function AnyLogoutTile() {
  const logout = useGuardedLogout();
  return <button type="button" onClick={logout} className="min-h-[56px]">test: any logout tile</button>;
}

function Page() {
  const session = useRecordingSession()!;
  return (
    <PortalLayout>
      <h1>Lesson plans page</h1>
      <button type="button" className="min-h-[56px]" onClick={() => { void session.start({ returnTo: "/portal/coaching/new" }); }}>test: record</button>
      <button type="button" className="min-h-[56px]" onClick={session.pause}>test: pause</button>
      <AnyLogoutTile />
    </PortalLayout>
  );
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={["/portal/curriculum"]}>
      <RecordingSessionProvider>
        <Routes>
          <Route path="/portal/curriculum" element={<Page />} />
          <Route path="/portal/login" element={<h1>Login page</h1>} />
        </Routes>
      </RecordingSessionProvider>
    </MemoryRouter>,
  );
}

async function signedIn(newUi: boolean) {
  api.getConfig.mockResolvedValue({ success: true, features: { selfObservation: true, newUi } });
  renderApp();
  await screen.findByText("Lesson plans page");
  if (newUi) await screen.findByTestId("newui-bottom-nav");
  else await waitFor(() => expect(api.getConfig).toHaveBeenCalled());
}

async function recording(newUi = true) {
  await signedIn(newUi);
  fireEvent.click(screen.getByRole("button", { name: "test: record" }));
  await screen.findByTestId("recording-bar");
}

/** The account sheet's Logout, the way she reaches it today. */
async function accountLogout() {
  await userEvent.setup().click(screen.getByTestId("newui-avatar"));
  await userEvent.setup().click(await screen.findByTestId("mobile-nav-logout"));
}

beforeEach(() => {
  vi.clearAllMocks();
  resetNewUiMemory();
  api.getDashboard.mockResolvedValue({ user: { firstName: "Ayesha", role: "teacher", phoneNumber: "920000000001" } });
  vi.mocked(auth.logout).mockResolvedValue({ success: true });
  recorder.start.mockResolvedValue(undefined);
  recorder.isPaused.mockReturnValue(false);
  recorder.elapsedMs.mockReturnValue(12 * 60_000 + 34_000);
  recorder.discard.mockResolvedValue(undefined);
  recorder.stop.mockResolvedValue({
    blob: new Blob(["rec"], { type: "audio/webm" }), durationMs: 12 * 60_000 + 34_000,
    type: { mimeType: "audio/webm;codecs=opus", ext: ".webm" }, id: "rec-live",
  });
  getUserMedia.mockResolvedValue({ getTracks: () => [] });
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
});

describe("the question, in the kit", () => {
  it("a Sheet: Stop recording?, the red Recording chip and the time, Keep recording then Stop & log out", async () => {
    await recording();
    await accountLogout();
    const ask = await screen.findByRole("dialog", { name: "Stop recording?" });
    expect(ask).toHaveAttribute("data-testid", "recording-logout-sheet");

    const chip = within(ask).getByText("Recording").closest("[data-chip]")!;
    expect(classes(chip)).toEqual(expect.arrayContaining(["bg-nu-record-bg", "text-nu-record"]));
    expect(chip.querySelector("[data-dot]")).not.toBeNull();
    const clock = within(ask).getByTestId("recording-logout-clock");
    expect(clock).toHaveTextContent("12:34");
    expect(classes(clock)).toContain("tabular-nums");

    const [keep, stop] = within(ask).getAllByRole("button").filter((b) => b.textContent);
    expect(keep).toHaveTextContent("Keep recording");
    expect(classes(keep)).toEqual(expect.arrayContaining(["bg-nu-button", "shadow-nu-button"]));
    expect(stop).toHaveTextContent("Stop & log out");
    expect(classes(stop)).toEqual(expect.arrayContaining(["text-nu-button-destructive", "border-2"]));
    expect(tapProblems(ask)).toEqual([]);
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it("paused: the amber Paused chip instead", async () => {
    await recording();
    fireEvent.click(screen.getByRole("button", { name: "test: pause" }));
    recorder.isPaused.mockReturnValue(true);
    await accountLogout();
    const ask = await screen.findByRole("dialog", { name: "Stop recording?" });
    const chip = within(ask).getByText("Paused").closest("[data-chip]")!;
    expect(classes(chip)).toContain("bg-nu-chip-warning-bg");
    expect(within(ask).queryByText("Recording")).toBeNull();
  });

  it("the time keeps running while she decides", async () => {
    await recording();
    await accountLogout();
    const ask = await screen.findByRole("dialog", { name: "Stop recording?" });
    recorder.elapsedMs.mockReturnValue(12 * 60_000 + 40_000);
    await waitFor(() => expect(within(ask).getByTestId("recording-logout-clock")).toHaveTextContent("12:40"), { timeout: 2000 });
  });
});

describe("what each answer does (the same as before)", () => {
  it("Keep recording: the sheet closes, the lesson records on, she stays signed in", async () => {
    await recording();
    await accountLogout();
    const ask = await screen.findByRole("dialog", { name: "Stop recording?" });
    fireEvent.click(within(ask).getByRole("button", { name: "Keep recording" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Stop recording?" })).not.toBeInTheDocument());
    expect(recorder.stop).not.toHaveBeenCalled();
    expect(auth.logout).not.toHaveBeenCalled();
    expect(screen.getByTestId("recording-bar")).toBeInTheDocument();
  });

  it("Close, Escape or a tap on the dim are Keep recording too", async () => {
    await recording();
    await accountLogout();
    await screen.findByRole("dialog", { name: "Stop recording?" });
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Stop recording?" })).not.toBeInTheDocument());
    expect(recorder.stop).not.toHaveBeenCalled();
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it("Stop & log out: the recording is finished and kept on the phone first, then she is logged out", async () => {
    await recording();
    await accountLogout();
    const ask = await screen.findByRole("dialog", { name: "Stop recording?" });
    fireEvent.click(within(ask).getByRole("button", { name: "Stop & log out" }));
    await waitFor(() => expect(auth.logout).toHaveBeenCalledTimes(1));
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(recorder.discard).not.toHaveBeenCalled();
    expect(recorder.stop.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(auth.logout).mock.invocationCallOrder[0]);
    expect(await screen.findByText("Login page")).toBeInTheDocument();
  });

  it("nothing recording: Logout logs out at once, no question", async () => {
    await signedIn(true);
    await accountLogout();
    await waitFor(() => expect(auth.logout).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog", { name: "Stop recording?" })).not.toBeInTheDocument();
  });
});

describe("from anywhere: the hook", () => {
  it("any Logout tile that uses useGuardedLogout asks the same question", async () => {
    await recording();
    fireEvent.click(screen.getByRole("button", { name: "test: any logout tile" }));
    const ask = await screen.findByRole("dialog", { name: "Stop recording?" });
    expect(ask).toHaveAttribute("data-testid", "recording-logout-sheet");
    fireEvent.click(within(ask).getByRole("button", { name: "Stop & log out" }));
    await waitFor(() => expect(auth.logout).toHaveBeenCalledTimes(1));
    expect(recorder.stop).toHaveBeenCalledTimes(1);
  });

  it("and with nothing recording, simply logs out", async () => {
    await signedIn(true);
    fireEvent.click(screen.getByRole("button", { name: "test: any logout tile" }));
    await waitFor(() => expect(auth.logout).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("flag off: the old question, unchanged", () => {
  it("is not the kit sheet", async () => {
    await recording(false);
    fireEvent.click(screen.getByRole("button", { name: "test: any logout tile" }));
    const ask = await screen.findByRole("dialog", { name: /stop recording\?/i });
    expect(ask).not.toHaveAttribute("data-testid", "recording-logout-sheet");
    expect(within(ask).queryByTestId("recording-logout-clock")).toBeNull();
  });
});
