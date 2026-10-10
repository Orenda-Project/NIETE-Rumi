import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// bd-5rz1v.6 — "Talk with the teacher": the guide WhatsApp would send, then the
// talk recorded (or uploaded) here, and coached for HER before the report goes.

vi.mock("../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../services/api", () => ({
  portal: { uploadToR2: vi.fn() },
  leader: { getObservation: vi.fn(), getTalkGuide: vi.fn(), presignObserveUpload: vi.fn(), startTalk: vi.fn(), startObservation: vi.fn() },
}));
vi.mock("../lib/recordingSupport", async (orig) => ({ ...(await orig<any>()), canRecordHere: vi.fn() }));
vi.mock("../lib/recordingStore", () => ({ deleteRecording: vi.fn().mockResolvedValue(undefined) }));
const recorderProps = vi.hoisted(() => ({ copy: null as any }));
vi.mock("../components/coaching/coach/CoachRecorder", async (orig) => ({
  ...(await orig<any>()),
  default: ({ label, copy }: any) => ((recorderProps.copy = copy), <div data-testid="recorder">{label}</div>),
}));

import { leader, portal } from "../services/api";
import { canRecordHere } from "../lib/recordingSupport";
import LeaderObserveTalk from "./LeaderObserveTalk";

const L = leader as any;
const P = portal as any;

const GUIDE = {
  intro: "Ten minutes, warm.",
  sections: {
    strengths: { title: "What went well", say_this: "When Ali was stuck you folded it again." },
    growth: { title: "One thing to grow", say_this: "What if you asked why once?" },
    action: { title: "Agree one action", say_this: "Which lesson this week?" },
  },
  reflection_question: "What will you try?",
  outro: "This stays between you.",
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/portal/leader/observe/cs-1/talk"]}>
      <Routes>
        <Route path="/portal/leader/observe/:id/talk" element={<LeaderObserveTalk />} />
        <Route path="/portal/leader/observe/:id" element={<div>observation page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(canRecordHere).mockResolvedValue(true);
  L.getObservation.mockResolvedValue({ teacher: { name: "Ayesha Bibi" }, report: {} });
  L.getTalkGuide.mockResolvedValue({ guide: GUIDE });
  L.presignObserveUpload.mockResolvedValue({ key: "classroom_audio/c/2026-10/portal_t.m4a", uploadUrl: "https://r2/put", contentType: "audio/mp4" });
  P.uploadToR2.mockResolvedValue(undefined);
  L.startTalk.mockResolvedValue({ success: true });
});

describe("LeaderObserveTalk", () => {
  it("shows the guide's three parts and the question to end on", async () => {
    renderPage();
    expect(await screen.findByText("💪 What went well")).toBeInTheDocument();
    expect(screen.getByText("🌱 One thing to grow")).toBeInTheDocument();
    expect(screen.getByText("📋 Agree one action")).toBeInTheDocument();
    expect(screen.getByText("“What will you try?”")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Record your talk/ })).toBeInTheDocument();
  });

  it("an uploaded talk goes to R2 and is attached to this observation", async () => {
    renderPage();
    await screen.findByText("💪 What went well");
    fireEvent.change(screen.getByTestId("talk-input"), { target: { files: [new File(["x"], "talk.m4a")] } });
    expect(await screen.findByText("observation page")).toBeInTheDocument();
    expect(L.presignObserveUpload).toHaveBeenCalledWith({ filename: "talk.m4a", sizeBytes: 1, kind: "audio" });
    expect(L.startTalk).toHaveBeenCalledWith("cs-1", "classroom_audio/c/2026-10/portal_t.m4a");
  });

  it("Record your talk: the recorder's Finish sheet gets its words from this page (bd-fmf24g.41: none written into it)", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Record your talk/ }));
    expect(await screen.findByTestId("recorder")).toHaveTextContent("Your talk with Ayesha Bibi");
    expect(recorderProps.copy).toMatchObject({ finishTitle: "Finish recording?", yesFinish: "Yes, finish", keepRecording: "Keep recording" });
    expect(recorderProps.copy.recorded(30_000)).toBe("You recorded less than a minute.");
    expect(recorderProps.copy.shortNote).toBe("That is short. A few minutes of talking gives better feedback.");
  });

  it("before the draft is saved, the guide is not offered", async () => {
    L.getTalkGuide.mockRejectedValue({ response: { status: 409 } });
    renderPage();
    expect(await screen.findByText(/Save the draft report first/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Record your talk/ })).toBeNull();
  });
});
