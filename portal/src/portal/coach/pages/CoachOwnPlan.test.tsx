import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, within, fireEvent, waitFor, act } from "@testing-library/react";
import i18n from "i18next";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getVisit: vi.fn() },
  leader: { cancelSchedule: vi.fn(), getObserveRecentPlans: vi.fn() },
  portal: {},
}));
vi.mock("../../lib/coachObserve", async (orig) => ({ ...(await orig<typeof import("../../lib/coachObserve")>()), sendObservation: vi.fn() }));
vi.mock("../../lib/recordingStore", () => ({ deleteRecording: vi.fn(async () => {}), latestUnsent: vi.fn(async () => null) }));

import { coach, leader } from "../../services/api";
import { sendObservation } from "../../lib/coachObserve";
import CoachCheckSend from "./CoachCheckSend";
import CoachSending from "./CoachSending";
import { setDraft, clearDraft } from "../observeDraft";
import { resetSender } from "../observe/sender";
import { noticeTracker } from "../../teacher/notices/tracker";
import { checkPlanFile, planKindOf, PLAN_FILE_EXTENSIONS } from "../../lib/coachingUpload";

/**
 * bd-fmf24g.66 — Check and send's lesson plan: "Their own plan" (the teacher taught from her own PDF, Word file or
 * photo). The third tile opens one sheet (Camera, Gallery, Files); the file is checked on arrival (.pdf .docx .jpg
 * .jpeg .png, 25 MB — no .doc: the reader cannot read binary Word) and goes up with the recording as the plan.
 */
const C = coach as any;
const L = leader as any;
const send = sendObservation as any;
const VISIT_ID = "0d8a6d1c-1111-4c1c-9a1a-000000000002";
const VISIT = {
  success: true,
  visit: { id: VISIT_ID, teacherName: "Ayesha Bibi", teacherExtId: "923001110001", schoolName: "IMSG I-10/1", schoolExtId: "niete:110", scheduledFor: "2026-10-06", scheduledSlot: "11:30", status: "upcoming", overdue: false },
  teacher: { teacherExtId: "923001110001", name: "Ayesha Bibi", phone: "923001110001", hitl: 3, dc: 7, avgHitl: 61, daysSinceTraining: 12 },
  lastVisit: null,
};
const MB = 1024 * 1024;
const file = (name: string, type: string, size = 1200) => {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
};

const draft = () => setDraft(VISIT_ID, {
  blob: new Blob(["x"], { type: "audio/webm" }), filename: "Observation 6 Oct 11.30.webm", durationMs: 2520000,
  recordingId: "rec-1", label: "Ayesha Bibi’s observation", sub: "42 min · just now",
});

const renderCheck = () => render(
  <MemoryRouter initialEntries={[`/portal/coach/visit/${VISIT_ID}/check`]}>
    <Routes>
      <Route path="/portal/coach/visit/:id/check" element={<CoachCheckSend />} />
      <Route path="/portal/coach/visit/:id/sending" element={<CoachSending />} />
      <Route path="*" element={<div>elsewhere</div>} />
    </Routes>
  </MemoryRouter>,
);

const pick = async (testid: string, f: File) => {
  await screen.findByText("Ayesha Bibi’s observation");
  fireEvent.change(screen.getByTestId(testid), { target: { files: [f] } });
};

beforeEach(async () => {
  vi.clearAllMocks();
  noticeTracker.reset();
  resetSender();
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-06T09:30:00+05:00"));
  clearDraft(VISIT_ID);
  C.getVisit.mockResolvedValue(VISIT);
  L.getObserveRecentPlans.mockResolvedValue({ plans: [] });
  send.mockImplementation(() => new Promise(() => {}));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the file rules the picker uses", () => {
  it("PDF, Word (.docx), JPG and PNG up to 25 MB; never .doc", () => {
    expect(PLAN_FILE_EXTENSIONS).toEqual([".pdf", ".docx", ".jpg", ".jpeg", ".png"]);
    for (const n of ["plan.pdf", "PLAN.PDF", "plan.docx", "a.jpg", "a.jpeg", "a.png"]) expect(checkPlanFile(file(n, ""))).toBeNull();
    for (const n of ["plan.doc", "notes.txt", "photo.heic", "plan"]) expect(checkPlanFile(file(n, ""))).toBe("wrong_type");
    expect(checkPlanFile(file("big.pdf", "", 25 * MB))).toBeNull();
    expect(checkPlanFile(file("big.pdf", "", 25 * MB + 1))).toBe("too_large");
  });

  it("the kind shown on the row: PDF, Word or Photo", () => {
    expect(planKindOf("a.pdf")).toBe("pdf");
    expect(planKindOf("a.DOCX")).toBe("word");
    expect(planKindOf("a.jpeg")).toBe("photo");
    expect(planKindOf("a.png")).toBe("photo");
    expect(planKindOf("a.doc")).toBeNull();
  });
});

describe("Check and send, Lesson plan", () => {
  it("the third tile is Their own plan; Plan photo is gone", async () => {
    draft();
    renderCheck();
    await screen.findByText("Ayesha Bibi’s observation");
    for (const t of ["Their recent plans", "Library", "Their own plan"]) expect(screen.getByRole("button", { name: t })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Plan photo" })).toBeNull();
  });

  it("it opens a sheet with Camera, Gallery and Files, and what is accepted", async () => {
    draft();
    renderCheck();
    fireEvent.click(await screen.findByRole("button", { name: "Their own plan" }));
    const sheet = within(await screen.findByRole("dialog", { name: "Their own plan" }));
    for (const t of ["Camera", "Gallery", "Files"]) expect(sheet.getByRole("button", { name: t })).toBeInTheDocument();
    for (const t of ["PDF", "Word", "Photo", "Up to 25 MB"]) expect(sheet.getByText(t)).toBeInTheDocument();
  });

  it("the three pickers: the camera opens the camera, the gallery the photos, Files the file list (no .doc)", async () => {
    draft();
    renderCheck();
    await screen.findByText("Ayesha Bibi’s observation");
    const camera = screen.getByTestId("plan-photo-input");
    expect(camera).toHaveAttribute("accept", "image/*");
    expect(camera).toHaveAttribute("capture", "environment");
    const gallery = screen.getByTestId("plan-gallery-input");
    expect(gallery).toHaveAttribute("accept", "image/*");
    expect(gallery).not.toHaveAttribute("capture");
    const files = screen.getByTestId("plan-file-input");
    expect(files.getAttribute("accept")).toBe(".pdf,.docx,.jpg,.jpeg,.png");
    expect(files).not.toHaveAttribute("capture");
  });

  it("a PDF from Files: the row shows its name and PDF · size, and it is sent as the plan", async () => {
    draft();
    renderCheck();
    await pick("plan-file-input", file("Maths_Week3_plan.pdf", "application/pdf", 1.2 * MB));
    const row = screen.getByTestId("chosen-plan");
    expect(row).toHaveTextContent("Maths_Week3_plan.pdf");
    expect(row).toHaveTextContent("PDF · 1.2 MB");
    expect(row).toHaveTextContent("Remove plan");
    expect(screen.queryByRole("button", { name: "Their own plan" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send observation" }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    const plan = send.mock.calls[0][0].plan;
    expect(plan.kind).toBe("file");
    expect(plan.file.name).toBe("Maths_Week3_plan.pdf");
  });

  it("a Word file and a gallery photo are accepted too", async () => {
    draft();
    renderCheck();
    await pick("plan-file-input", file("plan.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 300 * 1024));
    expect(screen.getByTestId("chosen-plan")).toHaveTextContent("Word · 300 KB");
    fireEvent.click(within(screen.getByTestId("chosen-plan")).getByRole("button"));
    await pick("plan-gallery-input", file("IMG_0834.jpg", "image/jpeg", 3.4 * MB));
    expect(screen.getByTestId("chosen-plan")).toHaveTextContent("Photo · 3.4 MB");
  });

  it("a photo taken with the camera is the plan, shown as before", async () => {
    draft();
    renderCheck();
    await pick("plan-photo-input", file("image.jpg", "image/jpeg"));
    expect(screen.getByTestId("chosen-plan")).toHaveTextContent("Plan photo");
    expect(screen.getByTestId("chosen-plan")).toHaveTextContent("Taken just now");
  });

  it("the wrong type and too big are refused, in the bar, and nothing is chosen", async () => {
    draft();
    renderCheck();
    await pick("plan-file-input", file("old.doc", "application/msword"));
    expect(screen.getByRole("alert")).toHaveTextContent("Not a plan file");
    expect(screen.queryByTestId("chosen-plan")).toBeNull();
    fireEvent.change(screen.getByTestId("plan-file-input"), { target: { files: [file("huge.pdf", "application/pdf", 26 * MB)] } });
    expect(screen.getByRole("alert")).toHaveTextContent("File too large");
    expect(screen.getByRole("alert")).toHaveTextContent("Up to 25 MB");
    expect(screen.queryByTestId("chosen-plan")).toBeNull();
    // the next good file clears the bar
    fireEvent.change(screen.getByTestId("plan-file-input"), { target: { files: [file("ok.pdf", "application/pdf")] } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("chosen-plan")).toHaveTextContent("ok.pdf");
  });

  it("Remove plan puts the three tiles back and sends no plan", async () => {
    draft();
    renderCheck();
    await pick("plan-file-input", file("a.pdf", "application/pdf"));
    fireEvent.click(within(screen.getByTestId("chosen-plan")).getByRole("button"));
    expect(screen.queryByTestId("chosen-plan")).toBeNull();
    expect(screen.getByRole("button", { name: "Their own plan" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send observation" }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0][0].plan).toBeNull();
  });

  it("Sending says a plan is going up: Plan · PDF", async () => {
    draft();
    renderCheck();
    await pick("plan-file-input", file("a.pdf", "application/pdf"));
    fireEvent.click(screen.getByRole("button", { name: "Send observation" }));
    expect(await screen.findByTestId("send-state")).toHaveTextContent("Sending");
    expect(screen.getByTestId("send-plan")).toHaveTextContent("Plan · PDF");
  });

  it("in Urdu: the tile, the sheet and the bar are in Urdu", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    draft();
    renderCheck();
    await screen.findByRole("button", { name: "مشاہدہ بھیجیں" });
    fireEvent.click(await screen.findByRole("button", { name: "ان کا اپنا پلان" }));
    const sheet = within(await screen.findByRole("dialog", { name: "ان کا اپنا پلان" }));
    for (const t of ["کیمرا", "گیلری", "فائلیں"]) expect(sheet.getByRole("button", { name: t })).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("plan-file-input"), { target: { files: [file("x.txt", "text/plain")] } });
    expect(screen.getByRole("alert")).toHaveTextContent("پلان کی فائل نہیں");
  });
});
