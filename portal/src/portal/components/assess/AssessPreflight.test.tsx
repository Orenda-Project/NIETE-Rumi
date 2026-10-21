import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// The pre-flight card. With sa_mic_required on, Ready waits for a working
// microphone or for the coach's explicit choice to go on without recording
// (listening, stories and questions are then skipped). Off, today's card.
// The microphone is mocked.

import AssessPreflight from "./AssessPreflight";
import { COPY } from "../../lib/assess/copy";

const media = (getUserMedia: () => Promise<unknown>) => {
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
};
const blocked = () => media(() => Promise.reject(new Error("NotAllowedError")));
const working = () => media(() => Promise.resolve({ getTracks: () => [{ stop: vi.fn() }] }));

function setup(micRequired?: boolean, lang: "en" | "ur" = "en") {
  const onMic = vi.fn();
  const onReady = vi.fn();
  render(<AssessPreflight copy={COPY[lang]} onMic={onMic} onReady={onReady} micRequired={micRequired} />);
  return { onMic, onReady, ready: screen.getByTestId("assess-preflight-ready") as HTMLButtonElement };
}

afterEach(() => { delete (navigator as any).mediaDevices; });

describe("AssessPreflight with sa_mic_required", () => {
  it("Ready is disabled until the microphone is checked", () => {
    const { ready, onReady } = setup(true);
    expect(ready).toBeDisabled();
    fireEvent.click(ready);
    expect(onReady).not.toHaveBeenCalled();
    expect(screen.queryByTestId("assess-mic-skip")).toBeNull();
  });

  it("a blocked microphone: no 'you can still go on'; Ready waits for the explicit choice, which records mic_ok false", async () => {
    blocked();
    const { ready, onReady, onMic } = setup(true);
    fireEvent.click(screen.getByRole("button", { name: /Check the microphone/ }));
    const denied = await screen.findByTestId("assess-mic-denied");
    expect(denied).not.toHaveTextContent(/still go on/);
    expect(ready).toBeDisabled();
    const skip = screen.getByTestId("assess-mic-skip");
    expect(skip).toHaveTextContent("Go on without recording — listening, stories and questions will be skipped");
    fireEvent.click(skip);
    expect(ready).not.toBeDisabled();
    expect(onMic).toHaveBeenLastCalledWith(expect.objectContaining({ mic_ok: false }));
    fireEvent.click(ready);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("the fix: a re-check that works enables Ready", async () => {
    working();
    const { ready, onMic } = setup(true);
    fireEvent.click(screen.getByRole("button", { name: /Check the microphone/ }));
    fireEvent.click(await screen.findByRole("button", { name: "I heard it" }, { timeout: 4000 }));
    expect(ready).not.toBeDisabled();
    expect(onMic).toHaveBeenLastCalledWith(expect.objectContaining({ mic_ok: true }));
  });

  it("the Urdu choice", async () => {
    blocked();
    setup(true, "ur");
    fireEvent.click(screen.getByRole("button", { name: /مائیک چیک کریں/ }));
    expect(await screen.findByTestId("assess-mic-skip")).toHaveTextContent("ریکارڈنگ کے بغیر جاری رکھیں — سننا، کہانیاں اور سوال چھوڑ دیے جائیں گے");
  });
});

describe("AssessPreflight with the switch off (today)", () => {
  it("Ready works at once, a blocked microphone still says you can go on, and there is no extra choice", async () => {
    blocked();
    const { ready, onReady } = setup(false);
    expect(ready).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Check the microphone/ }));
    expect(await screen.findByTestId("assess-mic-denied")).toHaveTextContent(/still go on/);
    expect(screen.queryByTestId("assess-mic-skip")).toBeNull();
    fireEvent.click(ready);
    expect(onReady).toHaveBeenCalledTimes(1);
  });
});
