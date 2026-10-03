import { render, act, cleanup, fireEvent, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// bd-5rz1v.10 — the Android back key while a lesson is recording.
//
// Back used to be trapped on the record page. Now the teacher can leave it and
// use the rest of the app, so Back can walk her all the way to a home page —
// where Back leaves the app (minimizeApp). A backgrounded app gets silence from
// the microphone, so a lesson recorded that way would quietly go blank. While a
// lesson is recording, the Back that would leave the app takes her to the
// recording instead. Every other Back is unchanged.

type BackHandler = (event: { canGoBack: boolean }) => void;

const runtime = vi.hoisted(() => ({ native: true, plugin: true }));
const appPlugin = vi.hoisted(() => {
  const state: { handler: BackHandler | null } = { handler: null };
  return {
    state,
    addListener: vi.fn(async (_event: string, handler: BackHandler) => { state.handler = handler; return { remove: vi.fn() }; }),
    toggleBackButtonHandler: vi.fn(async () => {}),
    minimizeApp: vi.fn(async () => {}),
  };
});

vi.mock("@/lib/runtime", () => ({
  isNativeApp: () => runtime.native,
  isNativePluginAvailable: (name: string) => runtime.plugin && name === "App",
}));
vi.mock("@capacitor/app", () => ({
  App: { addListener: appPlugin.addListener, toggleBackButtonHandler: appPlugin.toggleBackButtonHandler, minimizeApp: appPlugin.minimizeApp },
}));
vi.mock("../lib/recordingSupport", async (orig) => ({
  ...(await orig<typeof import("../lib/recordingSupport")>()),
  pickRecordingType: vi.fn(() => ({ mimeType: "audio/webm;codecs=opus", ext: ".webm" })),
}));
vi.mock("../lib/keepAwake", () => ({ keepScreenOn: vi.fn(async () => async () => {}) }));
const recorder = {
  id: "rec-live", start: vi.fn().mockResolvedValue(undefined), pause: vi.fn(), resume: vi.fn(),
  isPaused: vi.fn().mockReturnValue(false), elapsedMs: vi.fn().mockReturnValue(1000),
  stop: vi.fn().mockResolvedValue({ blob: new Blob(["x"]), durationMs: 1000, type: { mimeType: "audio/webm", ext: ".webm" }, id: "rec-live" }),
  discard: vi.fn(),
};
vi.mock("../lib/lessonRecorder", () => ({ LessonRecorder: vi.fn(function LessonRecorder() { return recorder; }) }));

import BackButtonHandler from "./BackButtonHandler";
import { RecordingSessionProvider, useRecordingSession } from "../lib/recordingSession";

let currentPath = "";
const WhereAmI = () => { currentPath = useLocation().pathname; return null; };
const Start = () => {
  const s = useRecordingSession();
  return <button type="button" onClick={() => { void s?.start({ returnTo: "/portal/coaching/new" }); }}>start {s?.active ? "on" : "off"}</button>;
};

function mount(entries: string[]) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <RecordingSessionProvider>
        <BackButtonHandler />
        <WhereAmI />
        <Start />
      </RecordingSessionProvider>
    </MemoryRouter>,
  );
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const pressBack = (canGoBack: boolean) => act(async () => { appPlugin.state.handler?.({ canGoBack }); });

async function startRecording() {
  fireEvent.click(screen.getByRole("button", { name: /start/i }));
  await screen.findByRole("button", { name: "start on" });
}

beforeEach(() => {
  vi.clearAllMocks();
  runtime.native = true;
  runtime.plugin = true;
  appPlugin.state.handler = null;
  currentPath = "";
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) }, configurable: true,
  });
});

afterEach(() => cleanup());

describe("bd-5rz1v.10 — Back while a lesson is recording", () => {
  it("from the dashboard goes to the recording instead of putting the app in the background", async () => {
    mount(["/portal/login", "/portal/dashboard"]);
    await settle();
    await startRecording();
    await pressBack(true);
    expect(appPlugin.minimizeApp).not.toHaveBeenCalled();
    expect(currentPath).toBe("/portal/coaching/new");
  });

  it("from a page with nothing behind it goes to the recording too", async () => {
    mount(["/portal/curriculum"]);
    await settle();
    await startRecording();
    await pressBack(false);
    expect(appPlugin.minimizeApp).not.toHaveBeenCalled();
    expect(currentPath).toBe("/portal/coaching/new");
  });

  it("an inner page with history still just goes back — Back is not trapped", async () => {
    mount(["/portal/coaching/new", "/portal/curriculum"]);
    await settle();
    await startRecording();
    await pressBack(true);
    expect(currentPath).toBe("/portal/coaching/new");
    expect(appPlugin.minimizeApp).not.toHaveBeenCalled();
  });

  it("with no recording, the dashboard's Back still leaves the app as before", async () => {
    mount(["/portal/login", "/portal/dashboard"]);
    await settle();
    await pressBack(true);
    expect(appPlugin.minimizeApp).toHaveBeenCalledTimes(1);
  });
});
