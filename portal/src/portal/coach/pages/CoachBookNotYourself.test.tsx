import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../training/appReady", async (orig) => ({ ...(await orig<Record<string, unknown>>()), coachFeatureReady: () => true }));
vi.mock("../flow/useCoachFlowV2", () => ({ useFlowV2: () => true, useFlowV6: () => false }));
// bd-3xf7vb.1 (#217): every Observe frame now reads useFlowV6 for its "?"; off here, so these screens are as tested.
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Javed", role: "principal", phoneNumber: "923000000009" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getPeople: vi.fn(), getSchedule: vi.fn(), editSchedule: vi.fn(), getTeacher: vi.fn(), getObservation: vi.fn() },
  leader: { createSchedule: vi.fn(), getObservation: vi.fn(), getObservationDraft: vi.fn() },
}));
import { coach, leader } from "../../services/api";
import CoachNewVisit from "./CoachNewVisit";
import CoachTeacher from "./CoachTeacher";

/**
 * bd-sf8ioj (queue #199) — booking a visit, the person booking is never in the teacher list. A principal who holds her
 * own school in the coach app is in her own patch: People and Edit teacher keep her (the 15 Sep rule — her roster view is
 * a different question), but New visit, Start an observation (New visit's ?now=1) and her own Teacher page's "Schedule a
 * visit" leave her out. The server says which row is hers (isSelf) and refuses a booking of herself whatever is posted.
 */
const C = coach as any;
const L = leader as any;

const ME = {
  teacherExtId: "923000000009", name: "Javed Principal", phone: "923000000009", schoolExtId: "niete:494", emis: "494",
  schoolName: "IMCB G-9/4", hitl: 0, dc: 2, avgHitl: null, daysSinceVisit: null, daysSinceTraining: null,
  isPrincipal: true, isSelf: true, levels: ["HIGH"],
};
const SADIA = {
  teacherExtId: "923001110005", name: "Sadia Noor", phone: "923001110005", schoolExtId: "niete:494", emis: "494",
  schoolName: "IMCB G-9/4", hitl: 1, dc: 0, avgHitl: 49, daysSinceVisit: 41, daysSinceTraining: 64, isSelf: false, levels: ["MIDDLE"],
};
const PEOPLE = {
  success: true,
  schools: [{ schoolExtId: "niete:494", emis: "494", name: "IMCB G-9/4", teachers: 1, visits: 1, daysSinceVisit: 41, avgHitl: 49 }],
  teachers: [ME, SADIA],
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/portal/coach/new-visit" element={<CoachNewVisit />} />
        <Route path="/portal/coach/teacher/:ext" element={<CoachTeacher />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  C.getPeople.mockResolvedValue(PEOPLE);
  C.getSchedule.mockResolvedValue({ success: true, from: "x", to: "y", overdue: [], visits: [] });
  L.createSchedule.mockResolvedValue({ success: true, id: "new-1" });
  L.getObservation.mockRejectedValue(new Error("view unavailable"));
});

describe("booking a visit never offers the person booking", () => {
  it("New visit, step 2: her school's teachers without her", async () => {
    renderAt("/portal/coach/new-visit?school=niete%3A494");
    expect(await screen.findByText("Sadia Noor")).toBeInTheDocument();
    expect(screen.queryByText("Javed Principal")).toBeNull();
    expect(screen.queryByTestId("teacher-923000000009")).toBeNull();
  });

  it("Start an observation (?now=1), step 2: the same list, without her", async () => {
    renderAt("/portal/coach/new-visit?school=niete%3A494&now=1");
    expect(await screen.findByText("Sadia Noor")).toBeInTheDocument();
    expect(screen.queryByText("Javed Principal")).toBeNull();
  });

  it("the level chips come from the teachers she can book, not from herself", async () => {
    renderAt("/portal/coach/new-visit?school=niete%3A494");
    await screen.findByText("Sadia Noor");
    // Only Javed teaches High: no High chip (and with Middle alone there is nothing to choose, so no chips at all).
    expect(screen.queryByText("High")).toBeNull();
    expect(screen.queryByTestId("level-chips")).toBeNull();
  });

  it("her own Teacher page has no Schedule visit", async () => {
    C.getTeacher.mockResolvedValue({ success: true, teacher: { ...ME, trainingModules: 0 }, history: [], nextVisit: null });
    renderAt("/portal/coach/teacher/923000000009");
    expect(await screen.findByText("Javed Principal")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Schedule visit/ })).toBeNull();
  });

  it("another teacher's Teacher page still has it", async () => {
    C.getTeacher.mockResolvedValue({ success: true, teacher: { ...SADIA, trainingModules: 0 }, history: [], nextVisit: null });
    renderAt("/portal/coach/teacher/923001110005");
    expect(await screen.findByText("Sadia Noor")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Schedule visit/ })).toBeInTheDocument();
  });
});
