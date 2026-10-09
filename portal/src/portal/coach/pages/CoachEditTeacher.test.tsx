import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import i18n from "i18next";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getTeacher: vi.fn(), getPeople: vi.fn(), moveTeacher: vi.fn(), removeTeacher: vi.fn(), editTeacher: vi.fn() },
}));
import { coach } from "../../services/api";
import CoachTeacher from "./CoachTeacher";
import CoachEditTeacher from "./CoachEditTeacher";
import { PEOPLE_UR as U } from "../people/copy";

/**
 * bd-o15qnr.11 + .13 — Edit teacher (v22 EditTeacher.dc.html).
 *   Name, Role, Teaching level (multi: Primary / Middle / High) and Phone save
 *   through main's /observe edit path, ported (teacher-edit-commit.service);
 *   School and Remove through commitAdd / commitRemovals.
 *   Phone is checked first (free / shell / taken) and only then changed.
 */
const C = coach as any;
const TEACHER = {
  success: true,
  teacher: {
    teacherExtId: "923001110001", name: "Ayesha Bibi", phone: "923001110001", schoolName: "IMSG I-10/1",
    schoolExtId: "niete:110", emis: "110", isPrincipal: false, levels: ["PRIMARY"],
    hitl: 3, dc: 7, avgHitl: 61, daysSinceVisit: 22, daysSinceTraining: 12, trainingModules: 4,
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
const EDIT = "/portal/coach/teacher/923001110001/edit";
const rejectWith = (status: number, data: any) => Promise.reject({ response: { status, data } });

beforeEach(() => {
  vi.clearAllMocks();
  C.getTeacher.mockResolvedValue(TEACHER);
  C.getPeople.mockResolvedValue(PEOPLE);
  C.moveTeacher.mockResolvedValue({ success: true, outcome: "move" });
  C.removeTeacher.mockResolvedValue({ success: true });
  C.editTeacher.mockResolvedValue({ success: true, outcome: "saved" });
});

describe("Edit teacher", () => {
  it("the teacher page has an Edit button that opens her edit screen", async () => {
    renderAt("/portal/coach/teacher/923001110001");
    expect(await screen.findByRole("link", { name: /edit/i })).toHaveAttribute("href", EDIT);
  });

  it("a new name + Save saves it through the /observe edit path", async () => {
    renderAt(EDIT);
    const name = await screen.findByRole("textbox", { name: /name/i });
    fireEvent.change(name, { target: { value: "Ayesha Khan" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(C.editTeacher).toHaveBeenCalledWith("923001110001", "name", "Ayesha Khan"));
  });

  it("teaching level is a multi-select of Primary / Middle / High — no Early years — saved as bands", async () => {
    renderAt(EDIT);
    const group = await screen.findByRole("group", { name: /teaching level/i });
    const boxes = within(group).getAllByRole("checkbox");
    expect(boxes.map((b) => b.textContent)).toEqual(["Primary", "Middle", "High"]);
    expect(screen.queryByText(/early years/i)).toBeNull();
    expect(boxes[0]).toHaveAttribute("aria-checked", "true");
    fireEvent.click(boxes[1]);
    fireEvent.click(boxes[2]);
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(C.editTeacher).toHaveBeenCalledWith("923001110001", "level", ["PRIMARY", "MIDDLE", "HIGH"]));
  });

  it("a level changed in the last 48 hours: the reason is shown with the hours left", async () => {
    C.editTeacher.mockImplementation(() => rejectWith(409, { success: false, reason: "cooldown", hoursRemaining: 31 }));
    renderAt(EDIT);
    const group = await screen.findByRole("group", { name: /teaching level/i });
    fireEvent.click(within(group).getAllByRole("checkbox")[2]);
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByTestId("edit-error")).toHaveTextContent(/31 h/);
  });

  it("Teacher → Principal saves the role, and says what it gives", async () => {
    renderAt(EDIT);
    fireEvent.click(await screen.findByRole("radio", { name: /principal/i }));
    expect(screen.getByTestId("role-note")).toHaveTextContent(/can observe/i);
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(C.editTeacher).toHaveBeenCalledWith("923001110001", "role", "principal"));
  });

  it("phone: checked first, then changed only on confirm", async () => {
    C.editTeacher.mockImplementation((_ext: string, edit: string) => Promise.resolve(
      edit === "phone_check" ? { success: true, outcome: "free", phone: "923004445556" } : { success: true, outcome: "moved", phone: "923004445556" }));
    renderAt(EDIT);
    const phone = await screen.findByRole("textbox", { name: /phone/i });
    fireEvent.change(phone, { target: { value: "0300 4445556" } });
    fireEvent.click(screen.getByRole("button", { name: /check number/i }));
    await waitFor(() => expect(C.editTeacher).toHaveBeenCalledWith("923001110001", "phone_check", "0300 4445556"));
    expect(C.editTeacher).not.toHaveBeenCalledWith("923001110001", "phone", expect.anything());
    fireEvent.click(await screen.findByRole("button", { name: /change number/i }));
    await waitFor(() => expect(C.editTeacher).toHaveBeenCalledWith("923001110001", "phone", "923004445556"));
  });

  it("her number shows as 03xx; 03xx, +92 or 92 are each sent as typed for the bot to normalise", async () => {
    C.editTeacher.mockResolvedValue({ success: true, outcome: "free", phone: "923004445556" });
    renderAt(EDIT);
    const phone = await screen.findByRole("textbox", { name: /phone/i });
    expect(phone).toHaveAttribute("placeholder", "0300 1110001");
    for (const typed of ["0300 4445556", "+92 300 4445556", "923004445556"]) {
      fireEvent.change(phone, { target: { value: typed } });
      fireEvent.click(screen.getByRole("button", { name: /check number/i }));
      await waitFor(() => expect(C.editTeacher).toHaveBeenLastCalledWith("923001110001", "phone_check", typed));
      await screen.findByTestId("phone-result");
    }
  });

  it("phone check refused (a real teacher's number): main's reason is shown and nothing can be confirmed", async () => {
    C.editTeacher.mockImplementation(() => rejectWith(409, {
      success: false, reason: "taken", heading: "Please wait while we fix your data", message: "This change will take some time, please check back later.",
    }));
    renderAt(EDIT);
    fireEvent.change(await screen.findByRole("textbox", { name: /phone/i }), { target: { value: "03003330003" } });
    fireEvent.click(screen.getByRole("button", { name: /check number/i }));
    expect(await screen.findByTestId("phone-result")).toHaveTextContent(/please wait while we fix your data/i);
    expect(screen.queryByRole("button", { name: /change number/i })).toBeNull();
  });

  it("an invalid number is refused with its reason", async () => {
    C.editTeacher.mockImplementation(() => rejectWith(400, { success: false, reason: "invalid_phone" }));
    renderAt(EDIT);
    fireEvent.change(await screen.findByRole("textbox", { name: /phone/i }), { target: { value: "12345" } });
    fireEvent.click(screen.getByRole("button", { name: /check number/i }));
    expect(await screen.findByTestId("phone-result")).toHaveTextContent(/not a valid number/i);
  });

  it("a new school + Save moves her through the /observe writer", async () => {
    renderAt(EDIT);
    const select = await screen.findByLabelText(/^school$/i);
    await waitFor(() => expect(screen.getByRole("option", { name: "IMSG G-6/2" })).toBeInTheDocument());
    fireEvent.change(select, { target: { value: "niete:620" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(C.moveTeacher).toHaveBeenCalledWith("923001110001", "niete:620"));
  });

  it("Save does nothing until something changed", async () => {
    renderAt(EDIT);
    expect(await screen.findByRole("button", { name: /^save$/i })).toBeDisabled();
  });

  it("outside her patch (404 on save): refused, she stays on the screen", async () => {
    C.editTeacher.mockImplementation(() => rejectWith(404, { success: false, reason: "not_found" }));
    renderAt(EDIT);
    fireEvent.change(await screen.findByRole("textbox", { name: /name/i }), { target: { value: "X Y" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByTestId("edit-error")).toHaveTextContent(/not your teacher/i);
  });

  it("Remove from school asks once more, then removes her", async () => {
    renderAt(EDIT);
    fireEvent.click(await screen.findByRole("button", { name: /remove from school/i }));
    expect(C.removeTeacher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    await waitFor(() => expect(C.removeTeacher).toHaveBeenCalledWith("923001110001"));
    expect(await screen.findByText("SCHOOL PAGE")).toBeInTheDocument();
  });
});

describe("Edit teacher in Urdu", () => {
  const setLang = async (lng: string) => { if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} }); await act(async () => { await i18n.changeLanguage(lng); }); };
  beforeEach(async () => { await setLang("ur"); });
  afterEach(async () => { await setLang("en"); });

  it("every label is the Urdu word; the levels are the Urdu names; Save saves the same way", async () => {
    renderAt(EDIT);
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(U.editTeacher);
    const group = await screen.findByRole("group", { name: U.teachingLevel });
    expect(within(group).getAllByRole("checkbox").map((b) => b.textContent)).toEqual([U.levelNames.PRIMARY, U.levelNames.MIDDLE, U.levelNames.HIGH]);
    expect(screen.getByRole("button", { name: U.removeFromSchool })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: U.nameLabel }), { target: { value: "Ayesha Khan" } });
    fireEvent.click(screen.getByRole("button", { name: U.save }));
    await waitFor(() => expect(C.editTeacher).toHaveBeenCalledWith("923001110001", "name", "Ayesha Khan"));
  });
});
