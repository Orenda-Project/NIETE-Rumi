import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Round 12: RDF needs a microphone the coach heard in this visit's check. Without it the RDF rows are greyed out, and a
// tap on one does nothing. With sa_r12_rdf_mic_check (rdfMicCheck) the note under them carries a button that opens the
// microphone check again, so the coach can answer it and come back. Off, the page is today's.

vi.mock("../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../lib/keepAwake", () => ({ keepScreenOn: vi.fn().mockResolvedValue(async () => {}) }));
vi.mock("../services/api", () => ({
  portal: { getConfig: vi.fn() },
  childTestSa: { getSchools: vi.fn(), getList: vi.fn(), markOutcome: vi.fn(), getStatus: vi.fn(), mintLink: vi.fn(), getSwitches: vi.fn(), addChild: vi.fn() },
}));

import { portal, childTestSa } from "../services/api";
import LeaderAssess from "./LeaderAssess";

const api = childTestSa as any;
const child = (n: number) => ({
  drawId: `d${n}`, name: `Child${n} Testwala`, nameUr: null, firstName: `Child${n}`, firstNameUr: null,
  grade: 3, section: "A", classLabel: "Grade 3 - A", classLabelUr: null,
  teacherName: "Teacher Testwala", status: "listed", childNo: n, role: "new", namesake: false, rollNumber: "1",
});
const LIST = {
  visit: { visitId: "v2", visitKey: null }, cycleId: "C1", grade: 3, gradeFallback: false, reused: false,
  children: [1, 2, 3, 4, 5].map(child), alternates: [child(6)],
};
const SCHOOLS = [{ schoolId: "s2", name: "School Beta", visitId: "v2", observedGrade: 3, visitToday: true }];
const BASE = { handbackV2: false, micRequired: false, coachPicksBlock: false, rdfForm: false, resultsView: false, rdfW3Forms: true };

beforeEach(() => {
  vi.clearAllMocks();
  try { window.localStorage.clear(); window.localStorage.setItem("niete-assess-lang", "en"); } catch { /* none */ }
  (portal.getConfig as any).mockResolvedValue({ features: { childTestSa: true } });
  api.getSchools.mockResolvedValue({ schools: SCHOOLS });
  api.getList.mockResolvedValue({ list: LIST });
  api.markOutcome.mockResolvedValue({});
  api.getStatus.mockResolvedValue({ session: { id: "x", status: "started", grade: 3, form: "f" }, block: "B1", lastSeq: 0, tasksDone: [], audio: [] });
});

/** The school; Ready on the pre-flight card WITHOUT answering the microphone check; the first child present. */
async function handoverWithoutMic() {
  render(<MemoryRouter><LeaderAssess /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId("assess-school-s2"));
  fireEvent.click(await screen.findByTestId("assess-preflight-ready"));
  await screen.findByText("Child1 Testwala");
  fireEvent.click(within(screen.getByTestId("assess-child-d1")).getByRole("button", { name: "Present" }));
  return screen.findByTestId("assess-handover");
}

describe("LeaderAssess, RDF without a heard microphone (round 12)", () => {
  it("rdfMicCheck on: the note offers the microphone check, and the button opens it", async () => {
    api.getSwitches.mockResolvedValue({ ...BASE, rdfMicCheck: true });
    await handoverWithoutMic();
    expect(screen.getByTestId("assess-rdf-mic")).toHaveTextContent("RDF needs a working microphone");
    for (const box of screen.getAllByRole("checkbox").slice(1)) expect(box).toBeDisabled();
    fireEvent.click(screen.getByTestId("assess-rdf-mic-check"));
    expect(await screen.findByTestId("assess-preflight")).toBeInTheDocument();
    expect(screen.queryByTestId("assess-handover")).toBeNull();
  });

  it("rdfMicCheck off: today's page, the note and no button", async () => {
    api.getSwitches.mockResolvedValue(BASE);
    await handoverWithoutMic();
    expect(screen.getByTestId("assess-rdf-mic")).toBeInTheDocument();
    expect(screen.queryByTestId("assess-rdf-mic-check")).toBeNull();
  });
});
