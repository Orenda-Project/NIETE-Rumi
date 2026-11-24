import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { ReactNode } from "react";
import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children?: ReactNode }) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: { children?: ReactNode }) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getPending: vi.fn() },
  leader: { getObservation: vi.fn(), getTalkGuide: vi.fn(), retryTalk: vi.fn(), presignObserveUpload: vi.fn(), startTalk: vi.fn() },
  portal: { uploadToR2: vi.fn() },
}));
const flow = vi.hoisted(() => ({ on: true as boolean | null }));
vi.mock("../flow/useCoachFlowV2", async (orig) => ({ ...(await orig<object>()), useFlowV6: () => flow.on, useFlowV2: () => flow.on }));
vi.mock("../report/api", async (orig) => ({ ...(await orig<Record<string, unknown>>()), getCoachReport: vi.fn(async () => ({ id: "cs-1", header: { teacher: "Ayesha Bibi" }, done: 3, total: 8 })) }));
vi.mock("../../lib/recordingSupport", () => ({ canRecordHere: () => Promise.resolve(true) }));
vi.mock("../../lib/recordingStore", () => ({ deleteRecording: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../components/coaching/coach/CoachRecorder", () => ({
  default: ({ label }: { label?: ReactNode }) => <div data-testid="recorder">{label}</div>,
}));
vi.setConfig({ testTimeout: 20_000 });
import { leader, portal } from "../../services/api";
import Debrief from "./Debrief";
import { ObserveRoutesProvider } from "../observe/observeRoutes";
import { PRINCIPAL_OBSERVE_ROUTES } from "../../teacher/principal/observe";

/**
 * bd-o15qnr.49 (queue #254; the operator 24 Nov ~11:00: "At the end of the debrief notes page there's the record button.
 * Maybe the record button should be a floating button at the bottom of the page all the time, so they can read the notes
 * and then they know that here is where they will start recording ... the debrief.") — on the v6/v7 switch, coach and
 * principal, English and Urdu, the debrief notes page (the Debrief page: the guide) keeps Record debrief (and Upload
 * recording) in a bar pinned to the bottom of the screen the whole time she reads, above the menu and the phone's safe
 * area. The bar is sticky, not fixed: it keeps its own room at the end of the page, so the last note scrolls clear of it
 * (measured at 390 px in the work folder's shots). The pair at the end of the page is gone. Same
 * gate as before: only once the notes are there (or did not load), only while the debrief is hers to record.
 * Switch off: the page as on production (the pair at the end, no bar).
 */
const L = leader as unknown as Record<"getObservation" | "getTalkGuide" | "presignObserveUpload" | "startTalk", Mock>;
const P = portal as unknown as { uploadToR2: Mock };
const GUIDE = {
  intro: "Open with what worked.",
  sections: {
    strengths: { title: "Strengths", body: "Students answered by name and felt safe to try." },
    growth: { title: "Growth", body: "Group transitions took three minutes." },
    action: { title: "Action", body: "Try a 10-second countdown before group work." },
  },
  reflection_question: "What will you try in tomorrow's lesson?",
};
const VIEW = (step: string, extra: Record<string, unknown> = {}) => ({
  id: "cs-1", createdAt: "2026-10-06T06:30:00Z", sessionStatus: "x", step, problem: null, preparing: false, portal: true,
  teacher: { name: "Ayesha Bibi", phone: "923001110001" }, lesson: { topic: null, subject: null, hasLessonPlan: false }, draft: { edited: false },
  talk: { guide: null, recordedAt: null, feedback: null },
  report: { status: null, teacherName: "Ayesha Bibi", teacherPhone: null, caption: null, companionText: null, imageUrl: null, sentAt: null, templateSentAt: null },
  ...extra,
});

function renderPage(principal = false) {
  const base = principal ? "/portal/teacher/principal" : "/portal/coach";
  const page = <Debrief />;
  return render(
    <MemoryRouter initialEntries={[`${base}/observation/cs-1/debrief`]}>
      <Routes>
        <Route path={`${base}/observation/:id/debrief`} element={principal ? <ObserveRoutesProvider value={PRINCIPAL_OBSERVE_ROUTES}>{page}</ObserveRoutesProvider> : page} />
        <Route path={`${base}/observation/:id`} element={<div>observation page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * the bar is the page's sticky dock: pinned to the bottom, above the menu, clear of the phone's safe area; sticky (in the
 * page's flow), never fixed, so the end of the page keeps room for it and the last note is never under it.
 */
function pinned(dock: HTMLElement) {
  const bar = dock.closest(".sticky") as HTMLElement | null;
  expect(bar).not.toBeNull();
  expect(bar!.className).toMatch(/bottom-\[calc\(.*env\(safe-area-inset-bottom\)\)\]/);
  expect(bar!.className).not.toMatch(/\bfixed\b/);
  return bar!;
}
const after = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(async () => {
  vi.clearAllMocks();
  flow.on = true;
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  L.getObservation.mockResolvedValue(VIEW("talk"));
  L.getTalkGuide.mockResolvedValue({ guide: GUIDE });
  L.presignObserveUpload.mockResolvedValue({ uploadUrl: "https://r2/put", contentType: "audio/mpeg", key: "k/talk.mp3" });
  P.uploadToR2.mockResolvedValue(undefined);
  L.startTalk.mockResolvedValue({ success: true });
});

describe("the debrief notes keep Record debrief floating at the bottom (bd-o15qnr.49, #254)", () => {
  it("coach, English: Record debrief and Upload recording in a pinned bar after the notes; none at the end of the page", async () => {
    renderPage();
    const guide = await screen.findByTestId("talk-guide", {}, { timeout: 8000 });
    const dock = await screen.findByTestId("debrief-dock");
    pinned(dock);
    expect(after(guide, dock)).toBe(true);
    expect(within(dock).getByRole("button", { name: "Record debrief" })).toBeInTheDocument();
    expect(within(dock).getByRole("button", { name: "Upload recording" })).toBeInTheDocument();
    // one Record, one Upload on the page: the old pair at the end is gone
    expect(screen.getAllByRole("button", { name: /Record debrief|Start recording/ })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /Upload recording/ })).toHaveLength(1);
    // the bar comes after the last note in the page's flow (sticky): scrolled to the end, the note sits above it
    expect(after(within(guide).getByText("What will you try in tomorrow's lesson?"), dock)).toBe(true);
  });

  it("Record debrief opens the recorder; Upload recording sends the picked file", async () => {
    renderPage();
    await screen.findByTestId("talk-guide", {}, { timeout: 8000 });
    const dock = await screen.findByTestId("debrief-dock");
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const click = vi.spyOn(input, "click");
    fireEvent.click(within(dock).getByRole("button", { name: "Upload recording" }));
    expect(click).toHaveBeenCalled();
    fireEvent.click(within(dock).getByRole("button", { name: "Record debrief" }));
    expect(await screen.findByTestId("recorder")).toHaveTextContent(/Ayesha/);
    // recording: no bar over the recorder
    expect(screen.queryByTestId("debrief-dock")).toBeNull();
  });

  it("Urdu: ڈی بریف ریکارڈ کریں and ریکارڈنگ اپ لوڈ کریں in the bar", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    renderPage();
    await screen.findByTestId("talk-guide", {}, { timeout: 8000 });
    const dock = await screen.findByTestId("debrief-dock");
    pinned(dock);
    expect(within(dock).getByRole("button", { name: "ڈی بریف ریکارڈ کریں" })).toBeInTheDocument();
    expect(within(dock).getByRole("button", { name: "ریکارڈنگ اپ لوڈ کریں" })).toBeInTheDocument();
  });

  it("principal: the same bar on the principal's debrief notes", async () => {
    renderPage(true);
    await screen.findByTestId("talk-guide", {}, { timeout: 8000 });
    const dock = await screen.findByTestId("debrief-dock");
    pinned(dock);
    expect(within(dock).getByRole("button", { name: "Record debrief" })).toBeInTheDocument();
  });

  it("the same gate as before: no bar while the notes are being written, nor when the form is not saved yet", async () => {
    L.getTalkGuide.mockReturnValue(new Promise(() => { /* still writing */ }));
    const { unmount } = renderPage();
    await screen.findByTestId("guide-writing", {}, { timeout: 8000 });
    expect(screen.queryByTestId("debrief-dock")).toBeNull();
    expect(screen.queryByRole("button", { name: /Record debrief|Start recording/ })).toBeNull();
    unmount();

    L.getTalkGuide.mockRejectedValue({ response: { status: 409 } });
    renderPage();
    await screen.findByRole("alert", {}, { timeout: 8000 });
    expect(screen.queryByTestId("debrief-dock")).toBeNull();
  });

  it("the notes did not load: the bar is there still (record without the guide), as the pair was", async () => {
    L.getTalkGuide.mockRejectedValue({ response: { status: 400 } });
    renderPage();
    await screen.findByTestId("guide-failed", {}, { timeout: 8000 });
    expect(await screen.findByTestId("debrief-dock")).toBeInTheDocument();
  });

  it("not hers to record (the debrief is in and being listened to): no bar", async () => {
    L.getObservation.mockResolvedValue(VIEW("listening", { talk: { guide: GUIDE, recordedAt: "2026-11-22T05:00:00Z", audioUrl: null, feedback: null } }));
    renderPage();
    await screen.findByTestId("stage-debrief-listening", {}, { timeout: 8000 });
    expect(screen.queryByTestId("debrief-dock")).toBeNull();
  });

  it("switch off: as on production, the pair at the end of the page and no bar", async () => {
    flow.on = false;
    renderPage();
    await screen.findByTestId("talk-guide", {}, { timeout: 8000 });
    expect(await screen.findByRole("button", { name: /Start recording/ })).toBeInTheDocument();
    expect(screen.queryByTestId("debrief-dock")).toBeNull();
    expect(screen.queryByTestId("dock-space")).toBeNull();
  });
});
