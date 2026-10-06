import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getTeacher: vi.fn(), getPeople: vi.fn(), moveTeacher: vi.fn(), removeTeacher: vi.fn() },
}));
import { coach } from "../../services/api";
import CoachTeacher from "./CoachTeacher";
import CoachEditTeacher from "./CoachEditTeacher";

/**
 * bd-o15qnr.11 — Edit teacher. School and Remove save through the WhatsApp
 * /observe teacher admin (commitAdd moves, commitRemovals removes). Name, role
 * and teaching level have no /observe writer, so they are shown, not edited.
 */
const C = coach as any;
const TEACHER = {
  success: true,
  teacher: {
    teacherExtId: "923001110001", name: "Ayesha Bibi", phone: "923001110001", schoolName: "IMSG I-10/1",
    schoolExtId: "niete:110", emis: "110", isPrincipal: false, hitl: 3, dc: 7, avgHitl: 61, daysSinceVisit: 22, daysSinceTraining: 12, trainingModules: 4,
  },
  history: [],
  nextVisit: null,
};
const PEOPLE = {
  success: true,
  teachers: [],
  schools: [
    { schoolExtId: "niete:110", emis: "110", name: "IMSG I-10/1", teachers: 6, visits: 9, daysSinceVisit: 0, avgHitl: 66 },
    { schoolExtId: "niete:620", emis: "620", name: "IMSG G-6/2", teachers: 6, visits: 0, daysSinceVisit: null, avgHitl: null },
  ],
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/portal/coach/teacher/:ext" element={<CoachTeacher />} />
        <Route path="/portal/coach/teacher/:ext/edit" element={<CoachEditTeacher />} />
        <Route path="/portal/coach/school/:emis" element={<div>SCHOOL PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  C.getTeacher.mockResolvedValue(TEACHER);
  C.getPeople.mockResolvedValue(PEOPLE);
  C.moveTeacher.mockResolvedValue({ success: true, outcome: "move" });
  C.removeTeacher.mockResolvedValue({ success: true });
});

describe("Edit teacher", () => {
  it("the teacher page has an Edit button that opens her edit screen", async () => {
    renderAt("/portal/coach/teacher/923001110001");
    const edit = await screen.findByRole("link", { name: /edit/i });
    expect(edit).toHaveAttribute("href", "/portal/coach/teacher/923001110001/edit");
  });

  it("name, phone and role are shown, not editable — /observe has no writer for them", async () => {
    renderAt("/portal/coach/teacher/923001110001/edit");
    expect(await screen.findByTestId("edit-name")).toHaveTextContent("Ayesha Bibi");
    expect(screen.getByTestId("edit-phone")).toHaveTextContent("+92");
    expect(screen.getByTestId("edit-role")).toHaveTextContent("Teacher");
    expect(screen.queryByRole("textbox", { name: /name/i })).toBeNull();
  });

  it("a new school + Save moves her through the /observe writer, then back to her page", async () => {
    renderAt("/portal/coach/teacher/923001110001/edit");
    const select = await screen.findByLabelText(/school/i);
    await waitFor(() => expect(screen.getByRole("option", { name: "IMSG G-6/2" })).toBeInTheDocument());
    fireEvent.change(select, { target: { value: "niete:620" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(C.moveTeacher).toHaveBeenCalledWith("923001110001", "niete:620"));
    expect(await screen.findByText("Ayesha Bibi")).toBeInTheDocument();
  });

  it("Save does nothing until a different school is picked", async () => {
    renderAt("/portal/coach/teacher/923001110001/edit");
    const save = await screen.findByRole("button", { name: /save/i });
    expect(save).toBeDisabled();
  });

  it("a school she does not hold: the refusal is shown and she stays on the screen", async () => {
    C.moveTeacher.mockRejectedValue({ response: { status: 403, data: { success: false, reason: "not_my_school" } } });
    renderAt("/portal/coach/teacher/923001110001/edit");
    const select = await screen.findByLabelText(/school/i);
    await waitFor(() => expect(screen.getByRole("option", { name: "IMSG G-6/2" })).toBeInTheDocument());
    fireEvent.change(select, { target: { value: "niete:620" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByTestId("edit-error")).toHaveTextContent(/not your school/i);
  });

  it("Remove from school asks once more, then removes her through the /observe writer", async () => {
    renderAt("/portal/coach/teacher/923001110001/edit");
    fireEvent.click(await screen.findByRole("button", { name: /remove from school/i }));
    expect(C.removeTeacher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    await waitFor(() => expect(C.removeTeacher).toHaveBeenCalledWith("923001110001"));
    expect(await screen.findByText("SCHOOL PAGE")).toBeInTheDocument();
  });
});
