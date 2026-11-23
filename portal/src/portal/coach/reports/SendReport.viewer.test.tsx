import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
const who = vi.hoisted(() => ({ role: "coach" }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: who.role, phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({ coach: { getPending: vi.fn(), getObservation: vi.fn() }, leader: { getObservation: vi.fn(), previewReport: vi.fn(), sendReport: vi.fn() } }));
const flow = vi.hoisted(() => ({ on: true as boolean | null }));
vi.mock("../flow/useCoachFlowV2", async (orig) => ({ ...(await orig<object>()), useFlowV6: () => flow.on, useFlowV2: () => flow.on }));
import { coach, leader } from "../../services/api";
import SendReport from "./SendReport";

/**
 * bd-o15qnr.39.2 (queue #204) — Send {name} the report: on the v6/v7 switch the preview is the report the coach (or the
 * principal, on the principal app: the same screen through its routes) can open full screen in the app; Send is
 * unchanged. Off: the preview exactly as before.
 */
type Mocked = Record<string, ReturnType<typeof vi.fn>>;
const L = leader as unknown as Mocked;
const C = coach as unknown as Mocked;
const VIEW = {
  id: "cs-1", createdAt: "2026-10-06T06:30:00Z", sessionStatus: "x", step: "report", problem: null, preparing: false, portal: true,
  teacher: { name: "Ayesha Bibi", phone: "923001110001" }, lesson: { topic: null, subject: null, hasLessonPlan: false }, draft: { edited: false },
  talk: { guide: null, recordedAt: null, feedback: null },
  report: { status: "preview", teacherName: "Ayesha Bibi", teacherPhone: "923001110001", caption: "Your report, Ayesha", companionText: null, imageUrl: "https://signed.example/report.png", sentAt: null, templateSentAt: null },
};

const renderPage = () => render(
  <MemoryRouter initialEntries={["/portal/coach/observation/cs-1/send"]}>
    <Routes>
      <Route path="/portal/coach/observation/:id/send" element={<SendReport />} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  vi.clearAllMocks();
  flow.on = true;
  who.role = "coach";
  C.getObservation.mockResolvedValue({ success: true, id: "cs-1", date: "2026-10-06T06:30:00Z", step: "report", score: null, dcScore: 72 });
  L.getObservation.mockResolvedValue(VIEW);
  L.sendReport.mockResolvedValue({ success: true });
});

describe("Send {name} the report — the full-screen report", () => {
  it.each(["coach", "principal"])("%s, switch on: the preview opens full screen in the app, and Send is still one tap away", async (role) => {
    who.role = role;
    renderPage();
    const preview = await screen.findByTestId("report-preview");
    fireEvent.click(within(preview).getByRole("button", { name: /Open full screen/ }));
    const viewer = screen.getByRole("dialog", { name: "Ayesha Bibi’s report" });
    expect(within(viewer).getByTestId("report-viewer-image")).toHaveAttribute("src", "https://signed.example/report.png");
    fireEvent.click(within(viewer).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Send to Ayesha" })).toBeInTheDocument();
    expect(L.sendReport).not.toHaveBeenCalled();
  });

  it("switch off: the preview image as before, nothing to open", async () => {
    flow.on = false;
    renderPage();
    const preview = await screen.findByTestId("report-preview");
    expect(within(preview).getByRole("img", { name: "Ayesha Bibi’s report" })).toHaveAttribute("src", "https://signed.example/report.png");
    expect(within(preview).queryByRole("button")).toBeNull();
  });
});
