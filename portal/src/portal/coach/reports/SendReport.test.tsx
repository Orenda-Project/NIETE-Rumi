import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({ coach: { getPending: vi.fn() }, leader: { getObservation: vi.fn(), previewReport: vi.fn(), sendReport: vi.fn() } }));
import { leader } from "../../services/api";
import SendReport from "./SendReport";

/**
 * bd-4404s7.5 — Send {name} the report (Blueprint Coach_SendReport): the report exactly as the teacher will get it
 * (the image and caption the bot made), who it goes to, and one Send. Real routes only: report/preview makes it,
 * report/send sends it on WhatsApp (the teacher's own phone, so nothing here sends before she taps Send).
 */
const L = leader as any;
const VIEW = (step: string, extra: Record<string, unknown> = {}, report: Record<string, unknown> = {}) => ({
  id: "cs-1", createdAt: "2026-10-06T06:30:00Z", sessionStatus: "x", step, problem: null, preparing: false, portal: true,
  teacher: { name: "Ayesha Bibi", phone: "923001110001" }, lesson: { topic: null, subject: null, hasLessonPlan: false }, draft: { edited: false },
  talk: { guide: null, recordedAt: null, feedback: null },
  report: { status: "preview", teacherName: "Ayesha Bibi", teacherPhone: "923001110001", caption: "Your report, Ayesha", companionText: null, imageUrl: "https://signed.example/report.png", sentAt: null, templateSentAt: null, ...report },
  ...extra,
});

const renderPage = () => render(
  <MemoryRouter initialEntries={["/portal/coach/observation/cs-1/send"]}>
    <Routes>
      <Route path="/portal/coach/observation/:id/send" element={<SendReport />} />
      <Route path="/portal/coach/observation/:id" element={<div>observation page</div>} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  vi.clearAllMocks();
  L.getObservation.mockResolvedValue(VIEW("report"));
  L.previewReport.mockResolvedValue({ success: true });
  L.sendReport.mockResolvedValue({ success: true });
});
afterEach(() => { vi.useRealTimers(); });

describe("Send {name} the report", () => {
  it("titled with the teacher's name, Step 5 of 5, and the report as she will get it", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Send Ayesha the report"));
    expect(screen.getByTestId("page-crumb")).toHaveTextContent("Ayesha Bibi · Step 5 of 5");
    expect(await screen.findByRole("img", { name: /Ayesha/ })).toHaveAttribute("src", "https://signed.example/report.png");
    expect(screen.getByText("Your report, Ayesha")).toBeInTheDocument();
  });

  it("To: the teacher's name and number", async () => {
    renderPage();
    const to = await screen.findByTestId("send-to");
    expect(to).toHaveTextContent("Ayesha Bibi");
    expect(to).toHaveTextContent("+923001110001");
  });

  it("Send to {name} sends once, then shows the waiting state", async () => {
    renderPage();
    const send = await screen.findByRole("button", { name: "Send to Ayesha" });
    L.getObservation.mockResolvedValue(VIEW("waiting_teacher"));
    fireEvent.click(send);
    await waitFor(() => expect(L.sendReport).toHaveBeenCalledWith("cs-1"));
    expect(L.sendReport).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Waiting for Ayesha")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send to Ayesha" })).toBeNull();
  });

  it("opened straight after the feedback: asks the bot to make the report once, and says it is being made", async () => {
    L.getObservation.mockResolvedValueOnce(VIEW("feedback")).mockResolvedValue(VIEW("report", { preparing: true }));
    renderPage();
    expect(await screen.findByText("Making the report")).toBeInTheDocument();
    await waitFor(() => expect(L.previewReport).toHaveBeenCalledWith("cs-1"));
    expect(L.previewReport).toHaveBeenCalledTimes(1);
    expect(L.sendReport).not.toHaveBeenCalled();
  });

  it("re-reads while the report is being made, and shows it when ready", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    L.getObservation.mockResolvedValueOnce(VIEW("report", { preparing: true })).mockResolvedValue(VIEW("report"));
    renderPage();
    expect(await screen.findByText("Making the report")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(await screen.findByRole("button", { name: "Send to Ayesha" })).toBeInTheDocument();
  });

  it("a send that failed says so and offers Try again, which makes the report again", async () => {
    L.getObservation.mockResolvedValue(VIEW("report", { problem: "send_failed" }));
    renderPage();
    expect(await screen.findByText("Report not sent")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(L.previewReport).toHaveBeenCalledWith("cs-1"));
  });

  it("a send the server refuses shows the failure in the app", async () => {
    L.sendReport.mockRejectedValue(new Error("nope"));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Send to Ayesha" }));
    expect(await screen.findByText("Report not sent")).toBeInTheDocument();
  });

  it("sent: says it was sent, with a way back to the observation", async () => {
    L.getObservation.mockResolvedValue(VIEW("sent"));
    renderPage();
    expect(await screen.findByText("Sent to Ayesha")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open report" })).toHaveAttribute("href", "/portal/coach/observation/cs-1");
    expect(screen.queryByRole("button", { name: "Send to Ayesha" })).toBeNull();
  });
});
