import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-x1tl95 — Send feedback, from the coach's More (it opens in WhatsApp's in-app browser from /portal). One question per
 * screen, the WhatsApp-flow form pattern: Topic, then Your feedback (a voice note — the coaches asked for it — and/or
 * words), then Screenshots (up to three, optional), then Send. The files go straight to R2; the send names their keys.
 */
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: { children: unknown }) => <>{children as never}</> }));
vi.mock("../../services/api", () => ({
  portal: { presignFeedbackUpload: vi.fn(), uploadToR2: vi.fn(), sendFeedback: vi.fn() },
  language: { get: vi.fn(), set: vi.fn() },
}));
const voice = {
  available: true, state: "idle" as string, clip: null as null | { blob: Blob; mimeType: string; ext: string },
  elapsedMs: 0, start: vi.fn(), stop: vi.fn(), discard: vi.fn(),
};
vi.mock("../../lib/voiceAnswer", () => ({ useVoiceAnswer: () => voice, VOICE_ANSWER_MAX_MS: 180000 }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
import { portal } from "../../services/api";
import FeedbackPage from "./FeedbackPage";
import { currentCoachMenuItem } from "../../teacher/menu";

const png = (name = "shot.png", size = 2000) => new File([new Uint8Array(size)], name, { type: "image/png" });

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/portal/coach/more", "/portal/coach/feedback"]} initialIndex={1}>
      <Routes>
        <Route path="/portal/coach/feedback" element={<FeedbackPage />} />
        <Route path="/portal/coach/more" element={<div>MORE PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const next = () => screen.getByRole("button", { name: "Next" });
/** A Topic tile: once picked, its name also carries the kit's "Selected" mark. */
const tile = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) });

async function toStep2(user: ReturnType<typeof userEvent.setup>, topic = "Something isn’t working") {
  await user.click(tile(topic));
  await user.click(next());
}

beforeEach(async () => {
  vi.clearAllMocks();
  Object.assign(voice, { available: true, state: "idle", clip: null, elapsedMs: 0 });
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  vi.mocked(portal.presignFeedbackUpload).mockImplementation(async ({ filename, kind }) => ({
    key: `${kind}/${filename}`, uploadUrl: `https://r2/${filename}`, contentType: kind === "feedback_audio" ? "audio/webm" : "image/png",
  }));
  vi.mocked(portal.uploadToR2).mockResolvedValue(undefined);
  vi.mocked(portal.sendFeedback).mockResolvedValue({ success: true, feedbackId: "fb-1" });
  globalThis.URL.createObjectURL = vi.fn(() => "blob:x");
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe("Send feedback — step 1, Topic", () => {
  it("four big choices (Report an issue's four), nothing picked, Next waits for a pick", async () => {
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByRole("heading", { name: "Send feedback" })).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
    for (const t of ["Something isn’t working", "Numbers look wrong", "An idea", "Something else"]) {
      expect(tile(t)).toHaveAttribute("aria-pressed", "false");
    }
    expect(next()).toBeDisabled();
    await user.click(tile("An idea"));
    expect(tile("An idea")).toHaveAttribute("aria-pressed", "true");
    expect(next()).toBeEnabled();
  });
});

describe("Send feedback — step 2, Your feedback", () => {
  it("shows the topic she chose with Change, a big Record a voice note, and a box to write in", async () => {
    const user = userEvent.setup();
    renderPage();
    await toStep2(user);
    expect(screen.getByText("Step 2 of 3")).toBeInTheDocument();
    expect(screen.getByText("Something isn’t working")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record a voice note" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Or write here" })).toBeInTheDocument();
    expect(next()).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /Change/ }));
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
  });

  it("words alone are enough", async () => {
    const user = userEvent.setup();
    renderPage();
    await toStep2(user);
    await user.type(screen.getByRole("textbox", { name: "Or write here" }), "Schools does not open");
    expect(next()).toBeEnabled();
  });

  it("Record starts the microphone", async () => {
    const user = userEvent.setup();
    renderPage();
    await toStep2(user);
    await user.click(screen.getByRole("button", { name: "Record a voice note" }));
    expect(voice.start).toHaveBeenCalled();
  });

  it("a recorded voice note alone is enough; she can listen and delete it", async () => {
    const user = userEvent.setup();
    Object.assign(voice, { state: "recorded", clip: { blob: new Blob(["a"], { type: "audio/webm" }), mimeType: "audio/webm", ext: ".webm" } });
    renderPage();
    await toStep2(user);
    expect(screen.getByTestId("feedback-voice")).toBeInTheDocument();
    expect(next()).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Remove voice note" }));
    expect(voice.discard).toHaveBeenCalled();
  });

  it("while recording: the running clock and Stop, and Next waits", async () => {
    const user = userEvent.setup();
    Object.assign(voice, { state: "recording", elapsedMs: 65000 });
    renderPage();
    await toStep2(user);
    expect(screen.getByText("1:05")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(voice.stop).toHaveBeenCalled();
    expect(next()).toBeDisabled();
  });

  it("a microphone she refused says so, and writing still works", async () => {
    const user = userEvent.setup();
    Object.assign(voice, { state: "blocked" });
    renderPage();
    await toStep2(user);
    expect(screen.getByRole("alert")).toHaveTextContent("Microphone blocked");
  });

  it("a phone that cannot record (an old app build) gets no Record button, only the box", async () => {
    const user = userEvent.setup();
    Object.assign(voice, { available: false });
    renderPage();
    await toStep2(user);
    expect(screen.queryByRole("button", { name: "Record a voice note" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Or write here" })).toBeInTheDocument();
  });

  it("the WhatsApp browser closing or going to the background stops the microphone (in-app browser rule)", async () => {
    const user = userEvent.setup();
    Object.assign(voice, { state: "recording" });
    renderPage();
    await toStep2(user);
    act(() => { window.dispatchEvent(new Event("pagehide")); });
    expect(voice.stop).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(voice.stop).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  });
});

describe("Send feedback — step 3, Screenshots, and Send", () => {
  async function toStep3(user: ReturnType<typeof userEvent.setup>) {
    await toStep2(user);
    await user.type(screen.getByRole("textbox", { name: "Or write here" }), "Schools does not open");
    await user.click(next());
  }

  it("screenshots are optional: Send works with none", async () => {
    const user = userEvent.setup();
    renderPage();
    await toStep3(user);
    expect(screen.getByText("Step 3 of 3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(portal.sendFeedback).toHaveBeenCalledWith({
      topic: "broken", text: "Schools does not open", audioKey: undefined, photoKeys: [], page: "/portal/coach/more", context: {},
    });
    expect(await screen.findByText("Thank you")).toBeInTheDocument();
  });

  it("up to three screenshots; a fourth cannot be added; one can be removed", async () => {
    const user = userEvent.setup();
    renderPage();
    await toStep3(user);
    const input = screen.getByTestId("feedback-shot-input") as HTMLInputElement;
    await user.upload(input, [png("a.png"), png("b.png")]);
    expect(screen.getAllByTestId("feedback-shot")).toHaveLength(2);
    await user.upload(input, [png("c.png"), png("d.png")]);
    expect(screen.getAllByTestId("feedback-shot")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Add screenshot" })).toBeNull();
    await user.click(within(screen.getAllByTestId("feedback-shot")[0]).getByRole("button", { name: "Remove screenshot" }));
    expect(screen.getAllByTestId("feedback-shot")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Add screenshot" })).toBeInTheDocument();
  });

  it("a file that is not a picture is refused with a reason", async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderPage();
    await toStep3(user);
    await user.upload(screen.getByTestId("feedback-shot-input"), new File(["x"], "notes.pdf", { type: "application/pdf" }));
    expect(screen.queryAllByTestId("feedback-shot")).toHaveLength(0);
    expect(screen.getByRole("alert")).toHaveTextContent("Only a picture");
  });

  it("Send uploads the voice note and each screenshot first, then sends their keys", async () => {
    const user = userEvent.setup();
    Object.assign(voice, { state: "recorded", clip: { blob: new Blob(["a"], { type: "audio/webm" }), mimeType: "audio/webm", ext: ".webm" } });
    renderPage();
    await user.click(tile("An idea"));
    await user.click(next());
    await user.click(next());
    await user.upload(screen.getByTestId("feedback-shot-input"), [png("a.png")]);
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(portal.presignFeedbackUpload).toHaveBeenCalledWith({ filename: "voice.webm", sizeBytes: 1, kind: "feedback_audio" });
    expect(portal.presignFeedbackUpload).toHaveBeenCalledWith({ filename: "a.png", sizeBytes: 2000, kind: "feedback_photo" });
    expect(portal.uploadToR2).toHaveBeenCalledTimes(2);
    expect(portal.sendFeedback).toHaveBeenCalledWith({
      topic: "idea", text: undefined, audioKey: "feedback_audio/voice.webm", photoKeys: ["feedback_photo/a.png"], page: "/portal/coach/more", context: {},
    });
    expect(await screen.findByText("Thank you")).toBeInTheDocument();
    expect(screen.getByText("We got your feedback.")).toBeInTheDocument();
  });

  it("Done goes back to More, replacing this page (Back from More does not reopen a sent form)", async () => {
    const user = userEvent.setup();
    renderPage();
    await toStep3(user);
    await user.click(screen.getByRole("button", { name: "Send" }));
    await user.click(await screen.findByRole("button", { name: "Done" }));
    expect(screen.getByText("MORE PAGE")).toBeInTheDocument();
  });

  it("a failed send keeps everything and says so; Send works again", async () => {
    const user = userEvent.setup();
    vi.mocked(portal.sendFeedback).mockRejectedValueOnce(new Error("502"));
    renderPage();
    await toStep3(user);
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t send. Try again.");
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
    expect(screen.queryByText("Thank you")).toBeNull();
  });

  it("the day's limit is named, not a generic failure", async () => {
    const user = userEvent.setup();
    vi.mocked(portal.sendFeedback).mockRejectedValueOnce({ response: { data: { reason: "too_many" } } });
    renderPage();
    await toStep3(user);
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That’s today’s limit");
  });
});

describe("Send feedback — Urdu, and its place in the menu", () => {
  it("draws in Urdu with the vocabulary's words", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByRole("heading", { name: "رائے بھیجیں" })).toBeInTheDocument();
    await user.click(tile("ایک تجویز"));
    await user.click(screen.getByRole("button", { name: "آگے بڑھیں" }));
    expect(screen.getByRole("button", { name: "وائس نوٹ ریکارڈ کریں" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
    expect(screen.getByRole("button", { name: "آگے بڑھیں" })).toBeEnabled();
  });

  // production has no COACHIP menu (insights/paths); the coach menu is the one
  it("the page belongs to More in the coach menu", () => {
    expect(currentCoachMenuItem("/portal/coach/feedback")).toBe("more");
  });
});
