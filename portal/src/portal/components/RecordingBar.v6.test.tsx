import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import RecordingBar from "./RecordingBar";

/**
 * bd-o15qnr.27 (queue #204, v6) — with v6 a coach's observation keeps recording while she moves round the app, so the
 * Recording bar follows her in the coach (and teacher) v2 frame: in her language, and above that frame's taller menu
 * (TeacherNavigation: 78px + the safe area), not 6px into it.
 */
const session = {
  active: true, paused: false, stream: null, screenWentOff: false, recordingId: "r1", returnTo: "/portal/coach/visit/v1/record",
  elapsedMs: () => 754_000, start: async () => "recording" as const, pause: () => {}, resume: () => {}, finish: async () => null,
  setChunkListener: () => {}, askBeforeLogout: () => {},
};

beforeEach(async () => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});

describe("the Recording bar in the v2 frame", () => {
  it("sits above the v2 menu", () => {
    render(<MemoryRouter><RecordingBar session={session} v2Menu /></MemoryRouter>);
    expect(screen.getByTestId("recording-bar").parentElement?.className).toContain("bottom-[calc(84px+env(safe-area-inset-bottom))]");
    expect(screen.getByTestId("recording-bar")).toHaveTextContent("Recording · 12:34");
  });

  it("the old menu keeps its place", () => {
    render(<MemoryRouter><RecordingBar session={session} /></MemoryRouter>);
    expect(screen.getByTestId("recording-bar").parentElement?.className).toContain("bottom-[72px]");
  });

  it("speaks Urdu on an Urdu page", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    render(<MemoryRouter><RecordingBar session={session} v2Menu /></MemoryRouter>);
    expect(screen.getByTestId("recording-bar")).toHaveTextContent("ریکارڈنگ");
    expect(screen.getByTestId("recording-bar")).toHaveTextContent("واپس");
  });
});
