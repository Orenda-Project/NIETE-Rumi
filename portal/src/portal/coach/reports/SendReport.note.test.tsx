import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Sana", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({ coach: { getPending: vi.fn(), getObservation: vi.fn() }, leader: { getObservation: vi.fn(), previewReport: vi.fn(), sendReport: vi.fn() } }));
import { coach, leader } from "../../services/api";
import SendReport from "./SendReport";
import { REPORTS_EN, REPORTS_UR } from "./copy";

/**
 * bd-r2uzg1.23.12 (queue #274, call 28; ICT sheet HITL 49): the note under the report is pre-filled (made from her talk
 * with the teacher) and hers to change before Send. The operator, 27 Nov: "do this the same prefill way, let the coach
 * edit this too. We need telemetry on who edits it and why though." Changed: an optional "why" (four chips) appears;
 * it never blocks Send. Unchanged: Send is exactly as before (the stored note goes).
 */
const L = leader as any;
const C = coach as any;
const NOTE = "*From Sana Malik*\nYou kept every child talking.";
const VIEW = (report: Record<string, unknown> = {}) => ({
  id: "cs-1", createdAt: "2026-10-06T06:30:00Z", sessionStatus: "x", step: "report", problem: null, preparing: false, portal: true,
  teacher: { name: "Ayesha Bibi", phone: "923001110001" }, lesson: { topic: null, subject: null, hasLessonPlan: false }, draft: { edited: false },
  talk: { guide: null, recordedAt: null, feedback: null },
  report: { status: "preview", teacherName: "Ayesha Bibi", teacherPhone: "923001110001", caption: "Your lesson report", companionText: NOTE, imageUrl: "https://signed.example/report.png", sentAt: null, templateSentAt: null, ...report },
});

const renderPage = () => render(
  <MemoryRouter initialEntries={["/portal/coach/observation/cs-1/send"]}>
    <Routes><Route path="/portal/coach/observation/:id/send" element={<SendReport />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  vi.clearAllMocks();
  C.getObservation.mockResolvedValue({ success: true, id: "cs-1", date: "2026-10-06T06:30:00Z", step: "report", score: null, dcScore: 72 });
  L.getObservation.mockResolvedValue(VIEW());
  L.sendReport.mockResolvedValue({ success: true });
});

describe("Send: the note under the report is hers to change", () => {
  it("pre-filled with the note made from her talk, labelled as hers to the teacher", async () => {
    renderPage();
    const box = await screen.findByRole("textbox", { name: "Your note to Ayesha" });
    expect(box).toHaveValue(NOTE);
    expect(screen.getByText(REPORTS_EN.noteHint)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: REPORTS_EN.noteWhy })).toBeNull();
  });

  it("unchanged: Send is exactly as before", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Send to Ayesha" }));
    await waitFor(() => expect(L.sendReport).toHaveBeenCalledWith("cs-1"));
  });

  it("changed: an optional why appears; her pick goes with the note", async () => {
    renderPage();
    const box = await screen.findByRole("textbox", { name: "Your note to Ayesha" });
    fireEvent.change(box, { target: { value: `${NOTE} Even at the back.` } });
    const why = screen.getByRole("group", { name: REPORTS_EN.noteWhy });
    for (const r of ["Added context", "Fixed a mistake", "Changed the tone", "Other"]) expect(within(why).getByRole("button", { name: r })).toBeInTheDocument();
    fireEvent.click(within(why).getByRole("button", { name: "Added context" }));
    expect(within(why).getByRole("button", { name: "Added context" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Send to Ayesha" }));
    await waitFor(() => expect(L.sendReport).toHaveBeenCalledWith("cs-1", { note: `${NOTE} Even at the back.`, reason: "context" }));
  });

  it("the preview shows the note as she will get it, following her edit", async () => {
    renderPage();
    fireEvent.change(await screen.findByRole("textbox", { name: "Your note to Ayesha" }), { target: { value: "Well done today." } });
    expect(within(screen.getByTestId("report-preview")).getByText("Well done today.")).toBeInTheDocument();
  });

  it("changed with no why: Send still goes (the why never blocks)", async () => {
    renderPage();
    fireEvent.change(await screen.findByRole("textbox", { name: "Your note to Ayesha" }), { target: { value: "Well done today." } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Ayesha" }));
    await waitFor(() => expect(L.sendReport).toHaveBeenCalledWith("cs-1", { note: "Well done today.", reason: null }));
  });

  it("no note was made: an empty box she can write in", async () => {
    L.getObservation.mockResolvedValue(VIEW({ companionText: null }));
    renderPage();
    const box = await screen.findByRole("textbox", { name: "Your note to Ayesha" });
    expect(box).toHaveValue("");
    expect(box).toHaveAttribute("placeholder", "Optional");
  });

  it("the words, in English and Urdu", () => {
    expect(REPORTS_EN.noteLabel("Ayesha")).toBe("Your note to Ayesha");
    expect(REPORTS_UR.noteLabel("Ayesha")).toBe("Ayesha کے لیے نوٹ");
    expect(REPORTS_UR.noteWhy).toBe("تبدیلی کی وجہ (اختیاری)");
    expect(Object.keys(REPORTS_UR.noteReasons)).toEqual(["context", "mistake", "tone", "other"]);
  });
});
