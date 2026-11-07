import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import i18n from "i18next";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: {
    getPeople: vi.fn(), getSchool: vi.fn(), getPending: vi.fn(() => Promise.resolve({ waiting: 0, ids: [] })),
    searchSchools: vi.fn(), addSchool: vi.fn(), removeSchool: vi.fn(),
    checkTeacher: vi.fn(), addTeacher: vi.fn(), removeTeachers: vi.fn(),
  },
  language: { get: vi.fn(() => new Promise(() => {})), set: vi.fn() },
}));
import { coach } from "../../services/api";
import CoachPeople from "./CoachPeople";
import CoachSchool from "./CoachSchool";
import CoachAddSchool from "./CoachAddSchool";
import CoachAddTeacher from "./CoachAddTeacher";
import CoachRemoveTeachers from "./CoachRemoveTeachers";
import { PEOPLE_UR as U } from "../people/copy";

/**
 * The coach's school list and its teachers, in the app — parity with WhatsApp /observe "Add or remove a school"
 * and "Manage teachers" (Blueprint: Coach · Manage schools and teachers). Every write goes through the coach API,
 * which the server saves with the /observe writers.
 */
const C = coach as any;
const T = (name: string, i: number, extra: Record<string, unknown> = {}) => ({
  teacherExtId: `92300111000${i}`, name, phone: `92300111000${i}`, schoolName: "IMSG I-10/1", schoolExtId: "niete:110", emis: "110",
  onRumi: true, hitl: 1, dc: 1, avgHitl: 60, daysSinceVisit: 5, daysSinceTraining: 3, ...extra,
});
const SCHOOL = { schoolExtId: "niete:110", emis: "110", name: "IMSG I-10/1", teachers: 3, visits: 2, daysSinceVisit: 12, avgHitl: 64 };
const SCHOOL2 = { schoolExtId: "niete:620", emis: "620", name: "IMSG G-6/2", teachers: 0, visits: 0, daysSinceVisit: null, avgHitl: null };
const TEACHERS = [T("Ayesha Bibi", 1), T("Bilal Khan", 2), T("Sana Gul", 3)];
const PEOPLE = { success: true, schools: [SCHOOL, SCHOOL2], teachers: TEACHERS };
const rejectWith = (status: number, data: any) => Promise.reject({ response: { status, data } });

/** Where the app went, and the notice it carried there. */
function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}{loc.search}</div>;
}

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/portal/coach/people" element={<><CoachPeople /><Where /></>} />
        <Route path="/portal/coach/school/:emis" element={<><CoachSchool /><Where /></>} />
        <Route path="/portal/coach/schools/add" element={<><CoachAddSchool /><Where /></>} />
        <Route path="/portal/coach/add-teacher" element={<><CoachAddTeacher /><Where /></>} />
        <Route path="/portal/coach/school/:emis/add-teacher" element={<><CoachAddTeacher /><Where /></>} />
        <Route path="/portal/coach/school/:emis/remove-teachers" element={<><CoachRemoveTeachers /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );
}
const where = () => screen.getByTestId("where").textContent;

beforeEach(() => {
  vi.clearAllMocks();
  C.getPeople.mockResolvedValue(PEOPLE);
  C.getSchool.mockImplementation((emis: string) => Promise.resolve(emis === "620"
    ? { success: true, school: SCHOOL2, teachers: [] }
    : { success: true, school: SCHOOL, teachers: TEACHERS }));
  C.searchSchools.mockResolvedValue({ success: true, schools: [
    { schoolExtId: "niete:110", name: "IMSG I-10/1", emis: "110", alreadyMine: true },
    { schoolExtId: "niete:620", name: "IMSG G-6/2", emis: "620", alreadyMine: false },
  ] });
  C.addSchool.mockResolvedValue({ success: true, schoolName: "IMSG G-6/2", emis: "620" });
  C.removeSchool.mockResolvedValue({ success: true, schoolName: "IMSG I-10/1" });
  C.addTeacher.mockResolvedValue({ success: true, outcome: "new", name: "Nadia Akbar" });
  C.removeTeachers.mockResolvedValue({ success: true, removed: [{ name: "Ayesha Bibi" }, { name: "Sana Gul" }], skipped: 0, visitsCancelled: 1 });
});

describe("Schools & teachers: the way in", () => {
  it("the Schools tab docks Add a school; the Teachers tab docks Add a teacher", async () => {
    at("/portal/coach/people");
    expect(await screen.findByRole("link", { name: /add a school/i })).toHaveAttribute("href", "/portal/coach/schools/add");
    at("/portal/coach/people?tab=teachers");
    expect(await screen.findByRole("link", { name: /add a teacher/i })).toHaveAttribute("href", "/portal/coach/add-teacher");
  });

  it("a coach with no schools sees that she has none, and the way to add one", async () => {
    C.getPeople.mockResolvedValue({ success: true, schools: [], teachers: [] });
    at("/portal/coach/people");
    expect(await screen.findByText("No schools yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /add a school/i })).toHaveAttribute("href", "/portal/coach/schools/add");
  });
});

describe("Add a school", () => {
  it("searches every school by name or EMIS; hers are marked and cannot be added again", async () => {
    at("/portal/coach/schools/add");
    fireEvent.change(await screen.findByRole("searchbox", { name: /name or emis/i }), { target: { value: "imsg" } });
    await waitFor(() => expect(C.searchSchools).toHaveBeenCalledWith("imsg"));
    const mine = (await screen.findByText("IMSG I-10/1")).closest("[data-testid=school-hit]") as HTMLElement;
    expect(within(mine).getByText("On your list")).toBeInTheDocument();
    expect(within(mine).queryByRole("link")).toBeNull();
    expect(screen.getByRole("link", { name: /IMSG G-6\/2/ })).toBeInTheDocument();
  });

  it("one letter is not a search", async () => {
    at("/portal/coach/schools/add");
    fireEvent.change(await screen.findByRole("searchbox", { name: /name or emis/i }), { target: { value: "i" } });
    await new Promise((r) => setTimeout(r, 400));
    expect(C.searchSchools).not.toHaveBeenCalled();
  });

  it("a tap asks once, then adds it and opens the school with an Added notice", async () => {
    at("/portal/coach/schools/add?q=imsg");
    fireEvent.click(await screen.findByRole("link", { name: /IMSG G-6\/2/ }));
    const tray = await screen.findByRole("dialog");
    expect(within(tray).getByText("Its teachers come with it")).toBeInTheDocument();
    expect(C.addSchool).not.toHaveBeenCalled();
    fireEvent.click(within(tray).getByRole("button", { name: /^add school$/i }));
    await waitFor(() => expect(C.addSchool).toHaveBeenCalledWith("niete:620"));
    await waitFor(() => expect(where()).toBe("/portal/coach/school/620"));
    expect(await screen.findByTestId("notice")).toHaveTextContent("Added");
    // It has no teacher list yet: say so, rather than a silent empty school.
    expect(screen.getByText(/tell the team/i)).toBeInTheDocument();
  });

  it("a search that finds nothing says so", async () => {
    C.searchSchools.mockResolvedValue({ success: true, schools: [] });
    at("/portal/coach/schools/add?q=zzz");
    expect(await screen.findByText("No school found")).toBeInTheDocument();
  });
});

describe("A school: Manage", () => {
  it("Add a teacher and Remove teachers open their screens for THIS school", async () => {
    at("/portal/coach/school/110");
    expect(await screen.findByRole("link", { name: /add a teacher/i })).toHaveAttribute("href", "/portal/coach/school/110/add-teacher");
    expect(screen.getByRole("link", { name: /remove teachers/i })).toHaveAttribute("href", "/portal/coach/school/110/remove-teachers");
  });

  it("Remove school asks first, says the teachers stay, then removes only her link", async () => {
    at("/portal/coach/school/110");
    fireEvent.click(await screen.findByRole("button", { name: /^remove school$/i }));
    const tray = await screen.findByRole("dialog");
    expect(within(tray).getByText(/its teachers stay/i)).toBeInTheDocument();
    expect(C.removeSchool).not.toHaveBeenCalled();
    fireEvent.click(within(tray).getByRole("button", { name: /^remove school$/i }));
    await waitFor(() => expect(C.removeSchool).toHaveBeenCalledWith("110"));
    await waitFor(() => expect(where()).toBe("/portal/coach/people"));
    expect(await screen.findByTestId("notice")).toHaveTextContent("IMSG I-10/1");
  });

  it("Keep closes the question and removes nothing", async () => {
    at("/portal/coach/school/110");
    fireEvent.click(await screen.findByRole("button", { name: /^remove school$/i }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /^keep$/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(C.removeSchool).not.toHaveBeenCalled();
  });
});

describe("Add a teacher", () => {
  const typeNumber = async (n: string) => {
    fireEvent.change(await screen.findByRole("textbox", { name: /whatsapp number/i }), { target: { value: n } });
    fireEvent.click(screen.getByRole("button", { name: /check number/i }));
  };

  it("an unknown number asks her name, then adds a new teacher to this school", async () => {
    C.checkTeacher.mockResolvedValue({ success: true, outcome: "new", phone: "923001110555", toSchoolName: "IMSG I-10/1" });
    at("/portal/coach/school/110/add-teacher");
    await typeNumber("0300 1110555");
    await waitFor(() => expect(C.checkTeacher).toHaveBeenCalledWith("110", "0300 1110555"));
    fireEvent.change(await screen.findByRole("textbox", { name: /full name/i }), { target: { value: "Nadia Akbar" } });
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    expect(await screen.findByText("New teacher")).toBeInTheDocument();
    expect(C.addTeacher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^add teacher$/i }));
    await waitFor(() => expect(C.addTeacher).toHaveBeenCalledWith("110", "923001110555", "Nadia Akbar"));
    await waitFor(() => expect(where()).toBe("/portal/coach/school/110"));
    expect(await screen.findByTestId("notice")).toHaveTextContent("Nadia Akbar");
  });

  it("someone on record at another school is shown as a MOVE, from where to here", async () => {
    C.checkTeacher.mockResolvedValue({
      success: true, outcome: "move", phone: "923001110003", name: "Sana Riaz", isPrincipal: true,
      fromSchoolName: "IMCG F-7/2", toSchoolName: "IMSG I-10/1",
    });
    C.addTeacher.mockResolvedValue({ success: true, outcome: "move", name: "Sana Riaz" });
    at("/portal/coach/school/110/add-teacher");
    await typeNumber("03001110003");
    const card = await screen.findByTestId("teacher-plan");
    expect(within(card).getByText("Sana Riaz")).toBeInTheDocument();
    expect(within(card).getByText("Principal")).toBeInTheDocument();
    expect(within(card).getByText("IMCG F-7/2")).toBeInTheDocument();
    expect(within(card).getByText("IMSG I-10/1")).toBeInTheDocument();
    expect(screen.getByText("Changes school")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^add teacher$/i }));
    await waitFor(() => expect(C.addTeacher).toHaveBeenCalledWith("110", "923001110003", ""));
  });

  it("refusals stay on the number: a bad number, a coach's number", async () => {
    C.checkTeacher.mockImplementationOnce(() => rejectWith(400, { success: false, reason: "invalid_phone" }));
    at("/portal/coach/school/110/add-teacher");
    await typeNumber("12345");
    expect(await screen.findByTestId("add-error")).toHaveTextContent("Not a valid number");
    C.checkTeacher.mockImplementationOnce(() => rejectWith(400, { success: false, reason: "is_coach" }));
    fireEvent.click(screen.getByRole("button", { name: /check number/i }));
    await waitFor(() => expect(screen.getByTestId("add-error")).toHaveTextContent("A coach's number"));
    expect(C.addTeacher).not.toHaveBeenCalled();
  });

  it("from the Teachers tab she picks the school first", async () => {
    at("/portal/coach/add-teacher");
    const pick = await screen.findByRole("link", { name: /IMSG G-6\/2/ });
    expect(pick).toHaveAttribute("href", "/portal/coach/school/620/add-teacher");
  });
});

describe("Remove teachers", () => {
  it("tick some, check the list, give a reason, and they come off this school", async () => {
    at("/portal/coach/school/110/remove-teachers");
    const next = await screen.findByRole("button", { name: /^next/i });
    expect(next).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Ayesha Bibi" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Sana Gul" }));
    expect(screen.getByRole("checkbox", { name: "Ayesha Bibi" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: /next · 2/i }));

    expect(await screen.findByText(/leave this school for every coach/i)).toBeInTheDocument();
    expect(screen.getByText("Account kept")).toBeInTheDocument();
    expect(screen.getByText("Booked visits cancelled")).toBeInTheDocument();
    expect(C.removeTeachers).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: /reason/i }), { target: { value: "Transferred" } });
    fireEvent.click(screen.getByRole("button", { name: /remove 2 teachers/i }));
    await waitFor(() => expect(C.removeTeachers).toHaveBeenCalledWith("110", ["923001110001", "923001110003"], "Transferred"));
    await waitFor(() => expect(where()).toBe("/portal/coach/school/110"));
    expect(await screen.findByTestId("notice")).toHaveTextContent("Removed 2 teachers");
  });
});

// bd-17v39c.4.16 (queue #47, option A) — Remove teachers lists teachers only. The principal is named apart, above the
// list, in the School card's "Principal: name ›" chip, which opens their Edit teacher page (its "Remove from school" is
// how a principal leaves a school). The server refuses a principal's number too (coach-school-admin).
describe("Remove teachers: the principal apart", () => {
  const HEAD = T("Head Sahib", 9, { isPrincipal: true });
  const HEAD2 = T("Amna Head", 8, { isPrincipal: true });

  it("teachers only to tick; the principal is a chip that opens their Edit teacher page", async () => {
    C.getSchool.mockResolvedValue({ success: true, school: SCHOOL, teachers: [HEAD, ...TEACHERS] });
    at("/portal/coach/school/110/remove-teachers");
    await screen.findByRole("button", { name: /^next/i });
    expect(screen.getAllByRole("checkbox").map((c) => c.getAttribute("aria-label"))).toEqual(["Ayesha Bibi", "Bilal Khan", "Sana Gul"]);
    expect(screen.queryByRole("checkbox", { name: "Head Sahib" })).toBeNull();
    const chip = screen.getByTestId("remove-principal");
    expect(chip).toHaveTextContent("Principal: Head Sahib");
    expect(chip).toHaveAccessibleName("Principal, Head Sahib. Open their page");
    expect(chip).toHaveAttribute("href", "/portal/coach/teacher/923001110009/edit");
    // above "Up to 30"
    expect(chip.compareDocumentPosition(screen.getByText("Up to 30")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("two principals: two chips; none recorded: no chip", async () => {
    C.getSchool.mockResolvedValue({ success: true, school: SCHOOL, teachers: [...TEACHERS, HEAD, HEAD2] });
    const { unmount } = at("/portal/coach/school/110/remove-teachers");
    await screen.findByRole("button", { name: /^next/i });
    expect(screen.getAllByTestId("remove-principal").map((c) => c.textContent)).toEqual(["Principal: Amna Head", "Principal: Head Sahib"]);
    unmount();
    C.getSchool.mockResolvedValue({ success: true, school: SCHOOL, teachers: TEACHERS });
    at("/portal/coach/school/110/remove-teachers");
    await screen.findByRole("button", { name: /^next/i });
    expect(screen.queryByTestId("remove-principal")).toBeNull();
  });

  it("a school with only its principal: 'No teachers', nothing to tick", async () => {
    C.getSchool.mockResolvedValue({ success: true, school: { ...SCHOOL, teachers: 0 }, teachers: [HEAD] });
    at("/portal/coach/school/110/remove-teachers");
    expect(await screen.findByTestId("no-teachers")).toHaveTextContent("No teachers");
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.getByTestId("remove-principal")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^next/i })).toBeDisabled();
  });

  it("Manage: a school with only its principal keeps Edit teacher and has no Remove teachers", async () => {
    C.getSchool.mockResolvedValue({ success: true, school: { ...SCHOOL, teachers: 0 }, teachers: [HEAD] });
    at("/portal/coach/school/110");
    expect(await screen.findByRole("link", { name: /edit teacher/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /remove teachers/i })).toBeNull();
  });
});

describe("in Urdu", () => {
  const setLang = async (lng: string) => { if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} }); await act(async () => { await i18n.changeLanguage(lng); }); };
  beforeEach(async () => { await setLang("ur"); });
  afterEach(async () => { await setLang("en"); });

  it("the school page's Manage rows and the move confirmation are in her words", async () => {
    at("/portal/coach/school/110");
    expect(await screen.findByRole("link", { name: new RegExp(U.addTeacher) })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: U.removeSchool })).toBeInTheDocument();

    C.checkTeacher.mockResolvedValue({
      success: true, outcome: "move", phone: "923001110003", name: "Sana Riaz", isPrincipal: true,
      fromSchoolName: "IMCG F-7/2", toSchoolName: "IMSG I-10/1",
    });
    at("/portal/coach/school/110/add-teacher");
    fireEvent.change(await screen.findByRole("textbox", { name: U.whatsappNumber }), { target: { value: "03001110003" } });
    fireEvent.click(screen.getByRole("button", { name: U.checkNumber }));
    const card = await screen.findByTestId("teacher-plan");
    expect(within(card).getByText(U.currentSchool)).toBeInTheDocument();
    expect(within(card).getByText(U.newSchool)).toBeInTheDocument();
    expect(screen.getByText(U.changesSchool)).toBeInTheDocument();
  });

  // bd-17v39c.4.16 — the chip reuses the School card's word: ہیڈ ٹیچر:
  it("Remove teachers names the principal as ہیڈ ٹیچر:", async () => {
    C.getSchool.mockResolvedValue({ success: true, school: SCHOOL, teachers: [...TEACHERS, T("Head Sahib", 9, { isPrincipal: true })] });
    at("/portal/coach/school/110/remove-teachers");
    expect(await screen.findByTestId("remove-principal")).toHaveTextContent("ہیڈ ٹیچر: Head Sahib");
    expect(screen.getByText(U.upTo30)).toBeInTheDocument();
  });
});
