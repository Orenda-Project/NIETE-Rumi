import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getSchool: vi.fn(), getTeacher: vi.fn(), getPeople: vi.fn(), editTeacher: vi.fn(), removeSchool: vi.fn() },
}));
import { coach } from "../../services/api";
import ManageSchool from "../people/ManageSchool";
import CoachPickTeacher from "./CoachPickTeacher";
import CoachEditTeacher from "./CoachEditTeacher";

/**
 * bd-ewbzns.2 — Edit a teacher from the school, as WhatsApp /observe "Manage teachers → Edit a teacher" does it: the
 * school's Manage group has Edit teacher, which lists the school's teachers with her role and teaching levels; a tap
 * opens her Edit teacher; Save comes back to the list, which shows what changed. Before this, Edit teacher was reached
 * only from a small Edit button inside her own page, and coaches made 62 role and 574 level edits on WhatsApp and none
 * in the portal (prod leader_roster_audit, 30 Oct).
 */
const C = coach as any;
const t = (ext: string, name: string, levels: string[], isPrincipal = false) => ({
  teacherExtId: ext, name, phone: ext, schoolName: "IMSG I-10/1", schoolExtId: "niete:110", emis: "110", isPrincipal, levels,
  hitl: 0, dc: 0, avgHitl: null, daysSinceVisit: null, daysSinceTraining: null,
});
const AYESHA = t("923001110001", "Ayesha Bibi", ["PRIMARY"]);
const SADIA = t("923001110002", "Sadia Noor", ["MIDDLE", "HIGH"], true);
const school = (teachers: any[]) => ({ success: true, school: { schoolExtId: "niete:110", emis: "110", name: "IMSG I-10/1", teachers: teachers.length, visits: 0, daysSinceVisit: null, avgHitl: null }, teachers });

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/portal/coach/school/:emis" element={<ManageSchool emis="110" name="IMSG I-10/1" teacherCount={2} />} />
        <Route path="/portal/coach/school/:emis/edit-teacher" element={<CoachPickTeacher />} />
        <Route path="/portal/coach/teacher/:ext/edit" element={<CoachEditTeacher />} />
        <Route path="/portal/coach/teacher/:ext" element={<div>HER PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  C.getSchool.mockResolvedValue(school([SADIA, AYESHA]));
  C.getTeacher.mockResolvedValue({ success: true, teacher: AYESHA, history: [], nextVisit: null });
  C.getPeople.mockResolvedValue({ success: true, teachers: [], schools: [{ schoolExtId: "niete:110", emis: "110", name: "IMSG I-10/1", teachers: 2, visits: 0, daysSinceVisit: null, avgHitl: null }] });
  C.editTeacher.mockResolvedValue({ success: true, outcome: "saved" });
});

describe("Manage → Edit teacher", () => {
  it("the school's Manage group has Edit teacher, which opens the school's teacher list", async () => {
    renderAt("/portal/coach/school/110");
    const manage = await screen.findByTestId("manage");
    expect(within(manage).getByRole("link", { name: /Edit teacher/ })).toHaveAttribute("href", "/portal/coach/school/110/edit-teacher");
  });

  it("no teachers: no Edit teacher row", () => {
    render(<MemoryRouter><ManageSchool emis="110" name="IMSG I-10/1" teacherCount={0} /></MemoryRouter>);
    expect(screen.queryByRole("link", { name: /Edit teacher/ })).toBeNull();
  });

  it("the list: A to Z, each with her role and teaching levels, each opening her Edit teacher", async () => {
    renderAt("/portal/coach/school/110/edit-teacher");
    const rows = await screen.findAllByTestId("pick-teacher");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/Ayesha Bibi.*Teacher · Primary/),
      expect.stringMatching(/Sadia Noor.*Principal · Middle · High/),
    ]);
    expect(rows[0]).toHaveAttribute("href", "/portal/coach/teacher/923001110001/edit");
  });

  it("a role change is saved through the /observe edit path, and the list she comes back to shows it", async () => {
    renderAt("/portal/coach/school/110/edit-teacher");
    fireEvent.click((await screen.findAllByTestId("pick-teacher"))[0]);
    const principal = await screen.findByRole("radio", { name: "Principal" });
    C.getSchool.mockResolvedValue(school([SADIA, { ...AYESHA, isPrincipal: true }]));
    await act(async () => { fireEvent.click(principal); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Save/ })); });
    expect(C.editTeacher).toHaveBeenCalledWith("923001110001", "role", "principal");
    await waitFor(() => expect(screen.getAllByTestId("pick-teacher")[0]).toHaveTextContent(/Ayesha Bibi.*Principal · Primary/));
  });

  it("a teacher with no level recorded says only her role", async () => {
    C.getSchool.mockResolvedValue(school([t("923001110003", "Hina Unset", [])]));
    renderAt("/portal/coach/school/110/edit-teacher");
    const [row] = await screen.findAllByTestId("pick-teacher");
    expect(row.textContent).toMatch(/Hina Unset/);
    expect(row.textContent).toMatch(/Teacher$/);
  });
});
