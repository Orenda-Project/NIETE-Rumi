import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "i18next";

const sw = vi.hoisted(() => ({ on: false }));
vi.mock("../../lib/lessonPlanSwitch", () => ({ useLessonPlanOpen: () => sw.on }));
vi.mock("../../components/LessonPlanSheet", () => ({
  default: ({ view, recording }: any) => <div data-testid="lesson-plan-sheet">{view.source.lane}:{view.source.fileKind || view.source.lessonId}:{recording ? "recording" : "idle"}</div>,
}));
vi.mock("../../components/coaching/LibraryPicker", () => ({
  default: ({ onPick }: any) => <button onClick={() => onPick({ pick: { lessonId: "g4_sci_ch2_seg1" }, title: "Plants", sub: "Library" })}>pick plants</button>,
}));
vi.mock("../../services/api", () => ({ leader: { getObserveRecentPlans: vi.fn(async () => ({ plans: [] })) } }));
vi.mock("../../lib/pickedRead", () => ({
  holdFile: vi.fn(async (f: File) => ({ file: f })), isFileRefused: () => false, tellUnreadablePick: vi.fn(),
}));
import { RecordPlanButton } from "./RecordPlanButton";
import { clearHeldPlan, getHeldPlan, setHeldPlan } from "../observePlan";

/**
 * bd-kijmb8 (queue #318, the operator 27 Nov ~17:30) — the coach's recording page: a plan attached opens OVER the live recording
 * ("Lesson plan"); with none attached the button reads "Attach lesson plan". Switch off: nothing drawn.
 */
const VISIT: any = { id: "v1", teacherExtId: "t1", schoolExtId: "s1", teacherName: "Ayesha Bibi", schoolName: "IMSG", status: "upcoming" };

beforeEach(async () => {
  sw.on = true;
  clearHeldPlan("v1");
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});

describe("RecordPlanButton", () => {
  it("switch off: nothing is drawn", () => {
    sw.on = false;
    const { container } = render(<RecordPlanButton visit={VISIT} recording />);
    expect(container).toBeEmptyDOMElement();
  });

  it("a plan attached on the observation: 'Lesson plan' opens it over the live recording", () => {
    setHeldPlan("v1", { kind: "library", pick: { assetId: "a1" }, title: "Plants", sub: "x", lessonId: "g4_sci_ch2_seg1" });
    render(<RecordPlanButton visit={VISIT} recording />);
    expect(screen.queryByTestId("lesson-plan-attach")).toBeNull();
    fireEvent.click(screen.getByTestId("lesson-plan-open"));
    expect(screen.getByTestId("lesson-plan-sheet").textContent).toBe("k5:g4_sci_ch2_seg1:recording");
  });

  it("her own photo attached: opens as a local image", () => {
    setHeldPlan("v1", { kind: "file", file: new File([new Uint8Array([1])], "plan.jpg", { type: "image/jpeg" }), title: "plan.jpg", sub: "Photo" });
    render(<RecordPlanButton visit={VISIT} recording />);
    fireEvent.click(screen.getByTestId("lesson-plan-open"));
    expect(screen.getByTestId("lesson-plan-sheet").textContent).toBe("local:image:recording");
  });

  it("nothing attached: 'Attach lesson plan'; picking a NIETE plan attaches it, held for Check and send, and the button reads 'Lesson plan'", async () => {
    render(<RecordPlanButton visit={VISIT} recording />);
    fireEvent.click(screen.getByTestId("lesson-plan-attach"));
    expect(screen.getByTestId("attach-plan-layer")).toBeInTheDocument();
    fireEvent.click(screen.getByText("NIETE plan"));
    fireEvent.click(screen.getByText("pick plants"));
    await waitFor(() => expect(screen.getByTestId("lesson-plan-open")).toBeInTheDocument());
    expect(screen.queryByTestId("attach-plan-layer")).toBeNull();
    expect(getHeldPlan("v1")).toMatchObject({ kind: "library", title: "Plants", lessonId: "g4_sci_ch2_seg1" });
  });

  it("nothing attached: the teacher's own file attaches too", async () => {
    render(<RecordPlanButton visit={VISIT} recording />);
    fireEvent.click(screen.getByTestId("lesson-plan-attach"));
    fireEvent.change(screen.getByTestId("attach-file"), { target: { files: [new File([new Uint8Array([1])], "plan.pdf", { type: "application/pdf" })] } });
    await waitFor(() => expect(screen.getByTestId("lesson-plan-open")).toBeInTheDocument());
    expect(getHeldPlan("v1")).toMatchObject({ kind: "file", title: "plan.pdf" });
  });

  it("a wrong file type is refused, nothing attached", async () => {
    render(<RecordPlanButton visit={VISIT} recording />);
    fireEvent.click(screen.getByTestId("lesson-plan-attach"));
    fireEvent.change(screen.getByTestId("attach-file"), { target: { files: [new File([new Uint8Array([1])], "x.exe")] } });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(getHeldPlan("v1")).toBeNull();
  });

  it("a written 6-12 lesson cannot open over the page: it says so, never leaves the recording", () => {
    setHeldPlan("v1", { kind: "library", pick: { segmentId: "seg", lang: "en" }, title: "Algebra", sub: "x" });
    render(<RecordPlanButton visit={VISIT} recording />);
    fireEvent.click(screen.getByTestId("lesson-plan-open"));
    expect(screen.queryByTestId("lesson-plan-sheet")).toBeNull();
    expect(screen.getByText(/after you stop recording/)).toBeInTheDocument();
  });

  it("in Urdu", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    render(<RecordPlanButton visit={VISIT} recording />);
    expect(screen.getByTestId("lesson-plan-attach")).toHaveTextContent("لیسن پلان لگائیں");
    await act(async () => { await i18n.changeLanguage("en"); });
  });
});
