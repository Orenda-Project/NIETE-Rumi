import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { copyProblem, tapProblems } from "../checks/rules";

/**
 * bd-5rz1v.13 — Assessment is its own page (deep-screens.html, Assessment 1): the flat indigo
 * band "Assessment" with "12 made · Last: 3 Oct"; Class, Subject and Chapter rows that open
 * sheets; the Questions stepper (− 15 +) inside the server's bounds; a More row (question types,
 * where questions come from, answer lines); and one green Make assessment button.
 *
 * Every option and bound comes from /assessment/options and /assessment/chapters, as in
 * AssessmentGeneratorPanel: this page holds no assessment rule of its own.
 */

vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../components/PortalLayout", () => ({
  default: ({ children, ownHeading }: { children: React.ReactNode; ownHeading?: boolean }) => (
    <div data-testid="layout" data-own-heading={String(Boolean(ownHeading))}>{children}</div>
  ),
}));
vi.mock("../../services/api", () => ({
  portal: {
    getConfig: vi.fn(),
    getAssessmentOptions: vi.fn(),
    getAssessmentChapters: vi.fn(),
    generateAssessment: vi.fn(),
    getAssessmentPapers: vi.fn(),
  },
}));
import { useAuth } from "../../hooks/useAuth";
import { portal } from "../../services/api";
import AssessmentHome from "./AssessmentHome";
import { forgetAssessmentPicks } from "./assessmentApi";

const GRADES = { success: true, grades: [1, 2, 3, 4, 5], maxQuestions: 25, defaultQuestions: 15 };
const SUBJECTS: Record<number, Array<{ subject_key: string; subject: string }>> = {
  3: [{ subject_key: "english", subject: "English" }],
  4: [{ subject_key: "science", subject: "Science" }, { subject_key: "maths", subject: "Maths" }],
};
const TYPES = [
  { id: "MCQs", category: "objective" }, { id: "Fill in the Blanks", category: "objective" },
  { id: "True/False", category: "objective" }, { id: "Brief Answers", category: "subjective" },
];
const CHAPTERS = [
  { chapter_number: 1, chapter_title: "Living things", page_start: 2, page_end: 10, page_count: 9 },
  { chapter_number: 2, chapter_title: "Plants", page_start: 11, page_end: 20, page_count: 10 },
];
const SUMMARY = {
  success: true, total: 12, page: 1, pageSize: 1,
  papers: [{ paper_id: "p-1", grade: 4, subject_key: "science", subject: "Science", chapter_number: 2, question_count: 15, total_marks: 30, ready_at: "2026-10-03T05:00:00Z", has_answer_key: true }],
};

function Where() {
  const { pathname, state } = useLocation();
  return <output data-testid="where" data-state={JSON.stringify(state ?? null)}>{pathname}</output>;
}

function mockApi({ gate = true, maxFor = 25 }: { gate?: boolean; maxFor?: number } = {}) {
  vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features: { assessmentGenerator: gate, assessmentGeneratorMessage: null, newUi: true } } as never);
  vi.mocked(portal.getAssessmentOptions).mockImplementation(async (grade?: number, subject?: string) => {
    if (grade == null) return GRADES as never;
    const subjects = SUBJECTS[grade] || [];
    if (!subject) return { ...GRADES, subjects } as never;
    return { ...GRADES, subjects, types: TYPES, maxQuestions: maxFor } as never;
  });
  vi.mocked(portal.getAssessmentChapters).mockResolvedValue({ success: true, chapters: CHAPTERS } as never);
  vi.mocked(portal.getAssessmentPapers).mockResolvedValue(SUMMARY as never);
  vi.mocked(portal.generateAssessment).mockResolvedValue({ success: true, requestId: "r-1" });
}

function renderHome(wrapDir?: "rtl") {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: "t-1", firstName: "Hataf", role: "teacher", phoneNumber: "923001234567" }, loading: false, logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
  const page = (
    <MemoryRouter initialEntries={["/portal/assessment"]}>
      <Routes>
        <Route path="/portal/assessment" element={<AssessmentHome />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
  return render(wrapDir ? <div dir={wrapDir}>{page}</div> : page);
}

const row = (name: RegExp) => screen.getByRole("button", { name });
const moreRow = () => screen.getByTestId("assessment-more");
const ready = () => screen.findByRole("button", { name: /Class/ });

async function pick(rowName: RegExp, option: { role: "radio" | "button"; name: RegExp | string }) {
  fireEvent.click(row(rowName));
  const sheet = await screen.findByRole("dialog");
  fireEvent.click(within(sheet).getByRole(option.role, { name: option.name }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}

async function pickAll() {
  await ready();
  await pick(/Class/, { role: "radio", name: "4" });
  await waitFor(() => expect(row(/Subject/)).toBeEnabled());
  await pick(/Subject/, { role: "radio", name: /Science/ });
  await waitFor(() => expect(row(/Chapter/)).toBeEnabled());
  await pickChapters(/Plants/);
}

/** The chapter sheet takes any number of chapters; Done closes it. */
async function pickChapters(...names: RegExp[]) {
  fireEvent.click(row(/Chapter/));
  const sheet = await screen.findByRole("dialog", { name: "Chapter" });
  for (const name of names) fireEvent.click(within(sheet).getByRole("checkbox", { name }));
  fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}

beforeEach(() => {
  vi.clearAllMocks();
  forgetAssessmentPicks();
  mockApi();
});

describe("Assessment — the band", () => {
  it("is a main page: the flat indigo band 'Assessment' with the assessment tile", async () => {
    renderHome();
    expect(screen.getByRole("heading", { level: 1, name: "Assessment" })).toBeInTheDocument();
    expect(screen.getByTestId("newui-heading-tile").tagName).toBe("SPAN");
    expect(screen.getByTestId("layout")).toHaveAttribute("data-own-heading", "true");
    await ready();
  });

  it("says how many she has made and when the last one was: '12 made', 'Last: 3 Oct'", async () => {
    renderHome();
    const ctx = await screen.findByTestId("newui-heading-context");
    expect(await within(ctx).findByText("12 made")).toBeInTheDocument();
    expect(within(ctx).getByText("Last: 3 Oct")).toBeInTheDocument();
    expect(portal.getAssessmentPapers).toHaveBeenCalledWith({ page: 1, page_size: 1 });
  });

  it("before her first assessment the band has no count", async () => {
    vi.mocked(portal.getAssessmentPapers).mockResolvedValue({ success: true, total: 0, page: 1, pageSize: 1, papers: [] } as never);
    renderHome();
    await ready();
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText(/made/)).toBeNull();
    expect(screen.queryByText(/Last:/)).toBeNull();
  });
});

describe("Assessment — Class, Subject, Chapter", () => {
  it("three rows; each says Pick until chosen; Subject and Chapter wait for the row above", async () => {
    renderHome();
    expect(await ready()).toHaveTextContent(/ClassPick/);
    expect(row(/Subject/)).toHaveTextContent(/SubjectPick/);
    expect(row(/Subject/)).toBeDisabled();
    expect(row(/Chapter/)).toBeDisabled();
  });

  it("Class opens a sheet with the server's grades as numbers; the pick shows in dark text", async () => {
    renderHome();
    await ready();
    fireEvent.click(row(/Class/));
    const sheet = await screen.findByRole("dialog", { name: "Class" });
    const grid = within(sheet).getByRole("radiogroup", { name: "Class" });
    expect(within(grid).getAllByRole("radio").map((r) => r.textContent)).toEqual(["1", "2", "3", "4", "5"]);
    fireEvent.click(within(grid).getByRole("radio", { name: "4" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const value = within(row(/Class/)).getByText("4");
    expect(value.className).toMatch(/\btext-nu-surface-text\b/);
    expect(portal.getAssessmentOptions).toHaveBeenCalledWith(4);
  });

  it("Subject lists the grade's subjects; picking one loads its chapters and question types", async () => {
    renderHome();
    await ready();
    await pick(/Class/, { role: "radio", name: "4" });
    await waitFor(() => expect(row(/Subject/)).toBeEnabled());
    fireEvent.click(row(/Subject/));
    const sheet = await screen.findByRole("dialog", { name: "Subject" });
    expect(within(sheet).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Science", "Maths"]);
    fireEvent.click(within(sheet).getByRole("radio", { name: /Science/ }));
    await waitFor(() => expect(row(/Chapter/)).toBeEnabled());
    expect(within(row(/Subject/)).getByText("Science")).toBeInTheDocument();
    expect(portal.getAssessmentChapters).toHaveBeenCalledWith(4, "science");
    expect(portal.getAssessmentOptions).toHaveBeenCalledWith(4, "science");
  });

  it("Chapter lists each chapter with its number and pages; the pick shows its title", async () => {
    renderHome();
    await ready();
    await pick(/Class/, { role: "radio", name: "4" });
    await waitFor(() => expect(row(/Subject/)).toBeEnabled());
    await pick(/Subject/, { role: "radio", name: /Science/ });
    await waitFor(() => expect(row(/Chapter/)).toBeEnabled());
    fireEvent.click(row(/Chapter/));
    const sheet = await screen.findByRole("dialog", { name: "Chapter" });
    const plants = within(sheet).getByRole("checkbox", { name: /Plants/ });
    expect(plants).toHaveTextContent("2");
    expect(plants).toHaveTextContent("p.11–20");
    fireEvent.click(plants);
    expect(plants).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(within(row(/Chapter/)).getByText("Plants")).toBeInTheDocument();
  });

  it("takes several chapters: the sheet stays open, and the row says how many", async () => {
    renderHome();
    await ready();
    await pick(/Class/, { role: "radio", name: "4" });
    await waitFor(() => expect(row(/Subject/)).toBeEnabled());
    await pick(/Subject/, { role: "radio", name: /Science/ });
    await waitFor(() => expect(row(/Chapter/)).toBeEnabled());
    fireEvent.click(row(/Chapter/));
    const sheet = await screen.findByRole("dialog", { name: "Chapter" });
    fireEvent.click(within(sheet).getByRole("checkbox", { name: /Plants/ }));
    fireEvent.click(within(sheet).getByRole("checkbox", { name: /Living things/ }));
    expect(screen.getByRole("dialog", { name: "Chapter" })).toBeInTheDocument();
    expect(within(sheet).getAllByRole("checkbox", { checked: true })).toHaveLength(2);
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(row(/Chapter/)).toHaveTextContent("2 chapters");
  });

  it("taking every chapter off leaves the button disabled", async () => {
    renderHome();
    await pickAll();
    expect(screen.getByRole("button", { name: "Make assessment" })).toBeEnabled();
    await pickChapters(/Plants/);
    expect(row(/Chapter/)).toHaveTextContent(/ChapterPick/);
    expect(screen.getByRole("button", { name: "Make assessment" })).toBeDisabled();
  });

  it("a new class clears the subject and chapter under it", async () => {
    renderHome();
    await pickAll();
    await pick(/Class/, { role: "radio", name: "3" });
    expect(row(/Subject/)).toHaveTextContent(/SubjectPick/);
    expect(row(/Chapter/)).toHaveTextContent(/ChapterPick/);
    expect(row(/Chapter/)).toBeDisabled();
  });
});

describe("Assessment — the Questions stepper", () => {
  it("starts on the server's default and steps by one; there is nothing to type into", async () => {
    renderHome();
    await ready();
    const stepper = screen.getByRole("group", { name: "Questions" });
    expect(within(stepper).getByText("15")).toBeInTheDocument();
    expect(document.querySelector("input")).toBeNull();
    fireEvent.click(within(stepper).getByRole("button", { name: "More questions" }));
    expect(within(stepper).getByText("16")).toBeInTheDocument();
    fireEvent.click(within(stepper).getByRole("button", { name: "Fewer questions" }));
    fireEvent.click(within(stepper).getByRole("button", { name: "Fewer questions" }));
    expect(within(stepper).getByText("14")).toBeInTheDocument();
  });

  it("stops at the server's maximum and at 1", async () => {
    renderHome();
    await ready();
    const stepper = screen.getByRole("group", { name: "Questions" });
    const plus = within(stepper).getByRole("button", { name: "More questions" });
    for (let i = 0; i < 20; i += 1) fireEvent.click(plus);
    expect(within(stepper).getByText("25")).toBeInTheDocument();
    expect(plus).toBeDisabled();
    const minus = within(stepper).getByRole("button", { name: "Fewer questions" });
    for (let i = 0; i < 30; i += 1) fireEvent.click(minus);
    expect(within(stepper).getByText("1")).toBeInTheDocument();
    expect(minus).toBeDisabled();
  });

  it("a subject whose maximum is lower pulls the number down to it", async () => {
    mockApi({ maxFor: 12 });
    renderHome();
    await pickAll();
    const stepper = screen.getByRole("group", { name: "Questions" });
    await waitFor(() => expect(within(stepper).getByText("12")).toBeInTheDocument());
    expect(within(stepper).getByRole("button", { name: "More questions" })).toBeDisabled();
  });
});

describe("Assessment — More", () => {
  it("the More row says Mixed until she picks types", async () => {
    renderHome();
    await pickAll();
    expect(moreRow()).toHaveTextContent("Mixed");
  });

  it("opens a sheet: question types as toggle chips, where questions come from, and answer lines", async () => {
    renderHome();
    await pickAll();
    fireEvent.click(moreRow());
    const sheet = await screen.findByRole("dialog", { name: "More" });
    const types = within(sheet).getByRole("group", { name: "Question types" });
    expect(within(types).getAllByRole("checkbox").map((c) => c.textContent)).toEqual(["MCQ", "Fill in", "True/False", "Brief"]);
    const source = within(sheet).getByRole("radiogroup", { name: "Questions come from" });
    expect(within(source).getByRole("radio", { name: "New questions" })).toHaveAttribute("aria-checked", "true");
    expect(within(sheet).getByRole("checkbox", { name: /Answer lines/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(types).getByRole("checkbox", { name: /MCQ/ }));
    fireEvent.click(within(types).getByRole("checkbox", { name: /Fill in/ }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(moreRow()).toHaveTextContent("MCQFill in");
  });
});

describe("Assessment — Make assessment", () => {
  it("is the one green button, disabled until class, subject and chapter are picked", async () => {
    renderHome();
    await ready();
    const make = screen.getByRole("button", { name: "Make assessment" });
    expect(make).toBeDisabled();
    expect(make.className).toMatch(/\bbg-nu-button-disabled\b/);
    await pickAll();
    expect(make).toBeEnabled();
    expect(make.className).toMatch(/\bbg-nu-button\b/);
  });

  it("sends her picks and opens the writing page", async () => {
    renderHome();
    await pickAll();
    fireEvent.click(moreRow());
    const sheet = await screen.findByRole("dialog", { name: "More" });
    fireEvent.click(within(sheet).getByRole("checkbox", { name: /MCQ/ }));
    fireEvent.click(within(sheet).getByRole("radio", { name: "The book" }));
    fireEvent.click(within(sheet).getByRole("checkbox", { name: /Answer lines/ }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("group", { name: "Questions" }).querySelectorAll("button")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Make assessment" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/portal/assessment/request/r-1"));
    expect(portal.generateAssessment).toHaveBeenCalledWith({
      grade: 4, subject: "science", chapterNumber: 2, chapterNumbers: [2], contentSource: "seen", questionCount: 14,
      questionTypes: ["MCQs"], answerLines: false, outputFormat: "pdf",
    });
    const state = JSON.parse(screen.getByTestId("where").getAttribute("data-state") || "null");
    expect(state).toMatchObject({ subjectName: "Science", chapterTitle: "Plants", spec: { grade: 4, questionCount: 14 } });
    expect(typeof state.startedAt).toBe("number");
  });

  it("several chapters go as one paper: chapterNumbers in book order, no single chapterNumber", async () => {
    renderHome();
    await pickAll();
    await pickChapters(/Living things/);
    fireEvent.click(moreRow());
    const sheet = await screen.findByRole("dialog", { name: "More" });
    fireEvent.click(within(sheet).getByRole("checkbox", { name: /MCQ/ }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Make assessment" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/portal/assessment/request/r-1"));
    expect(portal.generateAssessment).toHaveBeenCalledWith(expect.objectContaining({
      grade: 4, subject: "science", chapterNumber: null, chapterNumbers: [1, 2], questionTypes: ["MCQs"],
    }));
    const state = JSON.parse(screen.getByTestId("where").getAttribute("data-state") || "null");
    expect(state).toMatchObject({ subjectName: "Science", chapterTitle: "2 chapters" });
  });

  it("a refused start shows a 'Not started' chip — never the server's sentence — and the button stays", async () => {
    vi.mocked(portal.generateAssessment).mockRejectedValue(
      Object.assign(new Error("400"), { response: { status: 400, data: { success: false, error: "We do not have that book yet." } } }),
    );
    renderHome();
    await pickAll();
    fireEvent.click(screen.getByRole("button", { name: "Make assessment" }));
    expect(await screen.findByText("Not started")).toBeInTheDocument();
    expect(screen.queryByText(/We do not have/)).toBeNull();
    expect(screen.getByRole("button", { name: "Make assessment" })).toBeEnabled();
    expect(screen.queryByTestId("where")).toBeNull();
  });

  it("an answer without a request id is refused the same way", async () => {
    vi.mocked(portal.generateAssessment).mockResolvedValue({ success: false, error: "Could not start your paper" });
    renderHome();
    await pickAll();
    fireEvent.click(screen.getByRole("button", { name: "Make assessment" }));
    expect(await screen.findByText("Not started")).toBeInTheDocument();
    expect(screen.queryByText(/Could not start/)).toBeNull();
  });

  it("remembers her picks, so Make another starts from them", async () => {
    const first = renderHome();
    await pickAll();
    first.unmount();
    renderHome();
    await ready();
    await waitFor(() => expect(row(/Chapter/)).toHaveTextContent("Plants"));
    expect(row(/Class/)).toHaveTextContent("4");
    expect(row(/Subject/)).toHaveTextContent("Science");
  });
});

describe("Assessment — my assessments", () => {
  it("a row opens My assessments, with how many she has", async () => {
    renderHome();
    await ready();
    const mine = await screen.findByRole("link", { name: /My assessments/ });
    expect(mine).toHaveAttribute("href", "/portal/assessment/mine");
    await waitFor(() => expect(mine).toHaveTextContent("12"));
  });
});

describe("Assessment — when it cannot be used", () => {
  it("the generator turned off: a calm Coming soon, no form and no button", async () => {
    mockApi({ gate: false });
    renderHome();
    expect(await screen.findByText("Coming soon")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Assessment" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Class/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Make assessment" })).toBeNull();
    expect(portal.getAssessmentOptions).not.toHaveBeenCalled();
  });

  it("options that do not load: 'Not loaded' and Try again, which asks again", async () => {
    vi.mocked(portal.getAssessmentOptions).mockRejectedValueOnce(new Error("502"));
    renderHome();
    expect(await screen.findByText("Not loaded")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Make assessment" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await ready()).toBeInTheDocument();
    expect(portal.getAssessmentOptions).toHaveBeenCalledTimes(2);
  });
});

describe("Assessment — the design rules hold on the real page", () => {
  it("every target is at least 56px, with every sheet open in turn", async () => {
    renderHome();
    await pickAll();
    expect(tapProblems(document.body)).toEqual([]);
    for (const open of [() => row(/Class/), () => row(/Subject/), () => row(/Chapter/), moreRow]) {
      fireEvent.click(open());
      await screen.findByRole("dialog");
      expect(tapProblems(document.body)).toEqual([]);
      fireEvent.keyDown(window, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    }
  });

  it("no sentences on the screen: every word on it is a label", async () => {
    renderHome();
    await pickAll();
    const texts = Array.from(document.body.querySelectorAll("*"))
      .flatMap((el) => Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => (n.textContent || "").trim()))
      .filter(Boolean);
    expect(texts.length).toBeGreaterThan(5);
    expect(texts.filter((t) => copyProblem(t))).toEqual([]);
  });

  it("mirrors in Urdu: logical spacing only, and every row arrow turns round", async () => {
    renderHome("rtl");
    await pickAll();
    const all = Array.from(document.body.querySelectorAll("[class]")).map((el) => el.getAttribute("class") || "");
    const PHYSICAL = /(^|\s)(-?m[lr]-|p[lr]-|left-|right-|text-left|text-right|border-[lr](\s|-|$)|rounded-[lr]-)/;
    expect(all.filter((c) => PHYSICAL.test(c))).toEqual([]);
    const chevrons = document.body.querySelectorAll("[data-chevron]");
    expect(chevrons.length).toBeGreaterThanOrEqual(4);
    chevrons.forEach((c) => expect(c.getAttribute("class")).toMatch(/rtl:rotate-180/));
  });
});
