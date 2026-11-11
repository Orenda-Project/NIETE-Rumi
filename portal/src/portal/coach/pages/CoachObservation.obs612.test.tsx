import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getObservation: vi.fn() },
  leader: { getObservation: vi.fn(), getObservationDraft: vi.fn() },
}));
import { coach, leader } from "../../services/api";
import CoachObservation from "./CoachObservation";
import { reportItem } from "../reports/ReportRows";
import { REPORTS } from "../reports/copy";
import type { CoachReport } from "../types";
import type { Obs612Summary } from "../../lib/obs612";

/**
 * bd-pni007 — an FDE (obs612) visit in the coach's portal: the Reports row says the tool, its result and 'FDE v1'
 * (it has no FICO score), and the observation page shows FDE's own result where the score ring would be.
 */
const C = coach as any;
const L = leader as any;

const FDE: Obs612Summary = {
  label: "FDE v1", rubric: "obs612-enur-v1", tool: "enur", toolName: "English & Urdu tool",
  toolTitle: "CLASSROOM OBSERVATION TOOL For English & Urdu Lessons (Grade VI-VIII)", grade: 7, subject: "English",
  result: "73.6% · Proficient", noTotal: false, headline: "109 / 148 · 73.6% · Proficient",
  rows: [
    { name: "B. Lesson Planning & Objectives", value: "9/12", pct: 75 },
    { name: "D. Interest & Motivation", value: "8/8", pct: 100 },
  ],
  feedback: [{ label: "Strengths", text: "Clear objectives and a warm tone with every student." }],
  footer: "Scored by your coach on FDE's tool (Annexure G, 2026-27). Not a FICO score.",
};

const ROW: CoachReport = {
  id: "fde-1", createdAt: "2026-11-11T09:31:00Z", teacherName: "Ayesha Bibi", teacherPhone: null, teacherExtId: null,
  schoolName: "IMSG I-10/1", schoolExtId: null, status: "observer_review_complete", step: "sent", score: null, portal: false,
  obs612: { label: "FDE v1", toolName: "English & Urdu tool", result: "73.6% · Proficient" },
};

describe("the Reports row of an FDE visit", () => {
  it("its second line: the school, the tool, the result and the label; no FICO %", () => {
    const item = reportItem(ROW, REPORTS.en);
    expect(item.extra).toBe("IMSG I-10/1 · English & Urdu tool · 73.6% · Proficient · FDE v1");
    expect(item.chip?.text).not.toMatch(/%/);
  });

  it("a FICO row is unchanged", () => {
    const item = reportItem({ ...ROW, score: 64, obs612: null }, REPORTS.en);
    expect(item.extra).toBe("IMSG I-10/1");
    expect(item.chip?.text).toBe(REPORTS.en.pct(64));
  });
});

describe("the observation page of an FDE visit", () => {
  const OBS = {
    success: true, id: "fde-1", date: "2026-11-11T09:31:00Z", step: "sent", portal: false, mine: false, score: null, dcScore: null,
    summary: null, teacher: { name: "Ayesha Bibi", teacherExtId: "923001110001", schoolName: "IMSG I-10/1" },
    observer: { self: false, name: "Sana Malik" }, sentAt: "2026-11-11T10:00:00Z", caption: "Your FDE report",
    imageUrl: "https://signed.example/fde.png", audioUrl: null, obs612: FDE,
  };
  beforeEach(() => {
    vi.clearAllMocks();
    C.getObservation.mockResolvedValue(OBS);
    L.getObservation.mockRejectedValue(new Error("not hers"));
  });
  const renderPage = () => render(
    <MemoryRouter initialEntries={["/portal/coach/observation/fde-1"]}>
      <Routes><Route path="/portal/coach/observation/:id" element={<CoachObservation />} /></Routes>
    </MemoryRouter>,
  );

  it("FDE's result where the score would be: headline, rows, feedback, footer, the label; no score card, no NaN", async () => {
    renderPage();
    const block = within(await screen.findByTestId("obs612"));
    expect(block.getByTestId("obs612-headline")).toHaveTextContent("109 / 148 · 73.6% · Proficient");
    expect(block.getAllByTestId("obs612-row")).toHaveLength(2);
    expect(block.getByTestId("obs612-feedback")).toHaveTextContent("Clear objectives");
    expect(block.getByTestId("obs612-footer")).toHaveTextContent("Not a FICO score.");
    expect(block.getByTestId("obs612-label")).toHaveTextContent("FDE v1");
    expect(screen.queryByTestId("score-card")).toBeNull();
    expect(document.body.textContent).not.toMatch(/NaN|undefined/);
  });

  it("Maths & Science: levels with no bar, and no total", async () => {
    C.getObservation.mockResolvedValue({ ...OBS, obs612: {
      ...FDE, tool: "msci", toolName: "Maths & Science tool", result: "11 levels", noTotal: true,
      headline: "FDE gives no total for this tool.", rows: [{ name: "1 · Written work checked", value: "Level 2", pct: null }],
    } });
    renderPage();
    const block = within(await screen.findByTestId("obs612"));
    expect(block.getByTestId("obs612-headline")).toHaveTextContent("FDE gives no total for this tool.");
    expect(block.getByTestId("obs612-row")).toHaveTextContent("Level 2");
    expect(block.getByTestId("obs612-row").querySelector("[aria-hidden='true']")).toBeNull();
  });
});
