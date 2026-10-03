import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { copyProblem, tapProblems } from "../checks/rules";

/**
 * bd-5rz1v.13 — My assessments (deep-screens.html, Assessment 4): an inner page with filter
 * chips (All, then her classes; a class then offers its subjects), the picked one indigo; a row
 * per paper — its subject's icon, "Science · Ch 2", chips "15 Q" and "3 Oct", and a download.
 * The list pages with a More row. Data: GET /assessment/papers, newest first, one entry per
 * paper (its latest version), as AssessmentPapersPanel.
 *
 * The subject icon is neutral grey, not the subject's colour: DESIGN.md's colour rule (operator,
 * 2026-10-03, "still too much colour") says subject icons are grey, and the style check holds it.
 */

vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../components/PortalLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));
vi.mock("../../services/api", () => ({
  portal: {
    getConfig: vi.fn(),
    getAssessmentOptions: vi.fn(),
    getAssessmentPapers: vi.fn(),
    getAssessmentDownload: vi.fn(),
  },
}));
import { useAuth } from "../../hooks/useAuth";
import { portal } from "../../services/api";
import MyAssessments from "./MyAssessments";

const paper = (i: number, over: Record<string, unknown> = {}) => ({
  paper_id: `p-${i}`, grade: 4, subject_key: "science", subject: "Science", chapter_number: 2,
  question_count: 15, total_marks: 30, ready_at: "2026-10-03T05:00:00Z", has_answer_key: true, version: 1, version_count: 1, ...over,
});
const FIRST = [
  paper(1),
  paper(2, { question_count: 20, ready_at: "2026-10-02T05:00:00Z", version: 2, version_count: 2 }),
  paper(3, { subject_key: "maths", subject: "Maths", chapter_number: 4, question_count: 10, ready_at: "2026-09-28T05:00:00Z", has_answer_key: false }),
  paper(4, { grade: 3, subject_key: "english", subject: "English", chapter_number: 1, ready_at: "2026-09-20T05:00:00Z" }),
];

function Where() {
  const { pathname } = useLocation();
  return <output data-testid="where">{pathname}</output>;
}

let clicks: Array<{ href: string; target: string }>;

function renderMine() {
  vi.mocked(useAuth).mockReturnValue({ user: { firstName: "Hataf", role: "teacher" }, loading: false, logout: vi.fn() } as unknown as ReturnType<typeof useAuth>);
  return render(
    <MemoryRouter initialEntries={["/portal/assessment/mine"]}>
      <Routes>
        <Route path="/portal/assessment/mine" element={<MyAssessments />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const list = () => screen.findByRole("list", { name: "My assessments" });

beforeEach(() => {
  vi.clearAllMocks();
  clicks = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({ href: this.href, target: this.target });
  });
  vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features: { assessmentGenerator: true, assessmentGeneratorMessage: null, newUi: true } } as never);
  vi.mocked(portal.getAssessmentOptions).mockImplementation(async (grade?: number) => (
    grade == null
      ? { success: true, grades: [3, 4], maxQuestions: 25, defaultQuestions: 15 }
      : { success: true, grades: [3, 4], subjects: grade === 4 ? [{ subject_key: "science", subject: "Science" }, { subject_key: "maths", subject: "Maths" }] : [{ subject_key: "english", subject: "English" }], maxQuestions: 25, defaultQuestions: 15 }
  ) as never);
  vi.mocked(portal.getAssessmentPapers).mockResolvedValue({ success: true, total: 4, page: 1, pageSize: 20, papers: FIRST } as never);
  vi.mocked(portal.getAssessmentDownload).mockResolvedValue({ success: true, available: true, url: "https://r2.example/p.pdf" });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("My assessments — the page", () => {
  it("is an inner page: crumb Assessment, title My assessments; Back goes to Assessment", async () => {
    renderMine();
    await list();
    expect(screen.getByTestId("newui-crumb")).toHaveTextContent("Assessment");
    expect(screen.getByRole("heading", { level: 1, name: "My assessments" })).toBeInTheDocument();
    expect(portal.getAssessmentPapers).toHaveBeenCalledWith({ page: 1, page_size: 20 });
  });

  it("a row per paper: 'Science · Ch 2', chips '15 Q' and '3 Oct', a download icon at its end", async () => {
    renderMine();
    const rows = within(await list()).getAllByRole("button");
    expect(rows.map((r) => r.textContent)).toEqual([
      "Science · Ch 215 Q3 Oct",
      "Science · Ch 2 · v220 Q2 Oct",
      "Maths · Ch 410 Q28 Sep",
      "English · Ch 115 Q20 Sep",
    ]);
    for (const r of rows) {
      expect(r.querySelector("[data-end]")).not.toBeNull();
      expect(r.querySelector("[data-chevron]")).toBeNull();
    }
  });

  it("each subject has its own icon, in neutral grey (the colour rule)", async () => {
    renderMine();
    const rows = within(await list()).getAllByRole("button");
    const tile = (r: HTMLElement) => r.querySelector("[data-testid=newui-row-tile]") as HTMLElement;
    for (const r of rows) expect(tile(r).className).toMatch(/\bbg-nu-neutral-tile\b/);
    expect(tile(rows[0]).innerHTML).toBe(tile(rows[1]).innerHTML);
    expect(tile(rows[0]).innerHTML).not.toBe(tile(rows[2]).innerHTML);
    expect(tile(rows[2]).innerHTML).not.toBe(tile(rows[3]).innerHTML);
  });
});

describe("My assessments — the filters", () => {
  it("All and her classes; All is picked (indigo)", async () => {
    renderMine();
    await list();
    const classes = await screen.findByRole("radiogroup", { name: "Class" });
    const radios = within(classes).getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["All", "Grade 3", "Grade 4"]);
    expect(radios[0]).toHaveAttribute("aria-checked", "true");
    expect((radios[0].querySelector("[data-pill]") as HTMLElement).className).toMatch(/\bbg-nu-chip-selected-bg\b/);
    expect(screen.queryByRole("radiogroup", { name: "Subject" })).toBeNull();
  });

  it("a class asks again for that class and offers its subjects; a subject narrows it again", async () => {
    renderMine();
    await list();
    fireEvent.click(within(await screen.findByRole("radiogroup", { name: "Class" })).getByRole("radio", { name: "Grade 4" }));
    await waitFor(() => expect(portal.getAssessmentPapers).toHaveBeenLastCalledWith({ page: 1, page_size: 20, grade: 4 }));
    const subjects = await screen.findByRole("radiogroup", { name: "Subject" });
    expect(within(subjects).getAllByRole("radio").map((r) => r.textContent)).toEqual(["All subjects", "Science", "Maths"]);
    fireEvent.click(within(subjects).getByRole("radio", { name: "Maths" }));
    await waitFor(() => expect(portal.getAssessmentPapers).toHaveBeenLastCalledWith({ page: 1, page_size: 20, grade: 4, subject: "maths" }));
    expect(within(subjects).getByRole("radio", { name: "Maths" })).toHaveAttribute("aria-checked", "true");
  });

  it("back to All drops the subject", async () => {
    renderMine();
    await list();
    const classes = await screen.findByRole("radiogroup", { name: "Class" });
    fireEvent.click(within(classes).getByRole("radio", { name: "Grade 4" }));
    fireEvent.click(within(await screen.findByRole("radiogroup", { name: "Subject" })).getByRole("radio", { name: "Science" }));
    fireEvent.click(within(classes).getByRole("radio", { name: "All" }));
    await waitFor(() => expect(portal.getAssessmentPapers).toHaveBeenLastCalledWith({ page: 1, page_size: 20 }));
    expect(screen.queryByRole("radiogroup", { name: "Subject" })).toBeNull();
  });
});

describe("My assessments — paging", () => {
  it("a More row loads the next page under the first, and goes when all are shown", async () => {
    vi.mocked(portal.getAssessmentPapers)
      .mockResolvedValueOnce({ success: true, total: 5, page: 1, pageSize: 20, papers: FIRST } as never)
      .mockResolvedValueOnce({ success: true, total: 5, page: 2, pageSize: 20, papers: [paper(5, { subject: "Urdu", subject_key: "urdu", chapter_number: 7 })] } as never);
    renderMine();
    const more = await screen.findByTestId("assessment-mine-more");
    expect(more).toHaveTextContent("More");
    fireEvent.click(more);
    await waitFor(() => expect(within(screen.getByRole("list", { name: "My assessments" })).getAllByRole("button")).toHaveLength(5));
    expect(portal.getAssessmentPapers).toHaveBeenLastCalledWith({ page: 2, page_size: 20 });
    expect(screen.getByText("Urdu · Ch 7")).toBeInTheDocument();
    expect(screen.queryByTestId("assessment-mine-more")).toBeNull();
  });
});

describe("My assessments — a paper", () => {
  it("tapping a row offers Download (primary) and Answer key (outline)", async () => {
    renderMine();
    fireEvent.click(within(await list()).getAllByRole("button")[0]);
    const sheet = await screen.findByRole("dialog", { name: "Science · Ch 2" });
    expect(within(sheet).getByText("15 Q")).toBeInTheDocument();
    expect(within(sheet).getByText("30 marks")).toBeInTheDocument();
    const download = within(sheet).getByRole("button", { name: "Download" });
    expect(download.className).toMatch(/\bbg-nu-button\b/);
    fireEvent.click(download);
    await waitFor(() => expect(clicks).toEqual([{ href: "https://r2.example/p.pdf", target: "_blank" }]));
    expect(portal.getAssessmentDownload).toHaveBeenCalledWith("p-1", "paper");
    fireEvent.click(within(sheet).getByRole("button", { name: "Answer key" }));
    await waitFor(() => expect(portal.getAssessmentDownload).toHaveBeenLastCalledWith("p-1", "answer_key"));
  });

  it("a paper with no answer key offers Download only", async () => {
    renderMine();
    fireEvent.click(within(await list()).getAllByRole("button")[2]);
    const sheet = await screen.findByRole("dialog", { name: "Maths · Ch 4" });
    expect(within(sheet).queryByRole("button", { name: "Answer key" })).toBeNull();
  });

  it("a link that is not there: a 'Not available' chip, and nothing opens", async () => {
    vi.mocked(portal.getAssessmentDownload).mockResolvedValue({ success: true, available: false });
    renderMine();
    fireEvent.click(within(await list()).getAllByRole("button")[0]);
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "Download" }));
    expect(await within(sheet).findByText("Not available")).toBeInTheDocument();
    expect(clicks).toEqual([]);
  });

  it("in the Android app the paper opens without a new tab", async () => {
    (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    try {
      renderMine();
      fireEvent.click(within(await list()).getAllByRole("button")[0]);
      fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Download" }));
      await waitFor(() => expect(clicks).toEqual([{ href: "https://r2.example/p.pdf", target: "" }]));
    } finally {
      delete (globalThis as { Capacitor?: unknown }).Capacitor;
    }
  });
});

describe("My assessments — loading, failed, empty", () => {
  it("while loading: 'Loading…'", async () => {
    vi.mocked(portal.getAssessmentPapers).mockImplementation(() => new Promise(() => {}));
    renderMine();
    await screen.findByRole("radiogroup", { name: "Class" });
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "My assessments" })).toBeNull();
  });

  it("failed: 'Not loaded' and Try again — never an empty list", async () => {
    vi.mocked(portal.getAssessmentPapers).mockRejectedValueOnce(new Error("502"));
    renderMine();
    expect(await screen.findByText("Not loaded")).toBeInTheDocument();
    expect(screen.queryByText("Nothing yet")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await list()).toBeInTheDocument();
  });

  it("none yet: 'Nothing yet' and a way to make one", async () => {
    vi.mocked(portal.getAssessmentPapers).mockResolvedValue({ success: true, total: 0, page: 1, pageSize: 20, papers: [] } as never);
    renderMine();
    expect(await screen.findByText("Nothing yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Make assessment" })).toHaveAttribute("href", "/portal/assessment");
  });

  it("the generator turned off: back to the Assessment page", async () => {
    vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features: { assessmentGenerator: false, assessmentGeneratorMessage: null, newUi: true } } as never);
    renderMine();
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/portal\/assessment$/));
    expect(portal.getAssessmentPapers).not.toHaveBeenCalled();
  });
});

describe("My assessments — the design rules", () => {
  it("every target is at least 56px, the paper's sheet too; no word is a sentence", async () => {
    renderMine();
    await list();
    await screen.findByRole("radiogroup", { name: "Class" });
    expect(tapProblems(document.body)).toEqual([]);
    fireEvent.click(within(await list()).getAllByRole("button")[0]);
    await screen.findByRole("dialog");
    await act(async () => { await Promise.resolve(); });
    expect(tapProblems(document.body)).toEqual([]);
    const texts = Array.from(document.body.querySelectorAll("*"))
      .flatMap((el) => Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => (n.textContent || "").trim()))
      .filter(Boolean);
    expect(texts.filter((t) => copyProblem(t))).toEqual([]);
  });

  it("mirrors in Urdu: no left/right spacing, and the back arrow turns round", async () => {
    vi.mocked(useAuth).mockReturnValue({ user: { firstName: "Hataf", role: "teacher" }, loading: false, logout: vi.fn() } as unknown as ReturnType<typeof useAuth>);
    render(
      <div dir="rtl">
        <MemoryRouter initialEntries={["/portal/assessment/mine"]}>
          <Routes><Route path="/portal/assessment/mine" element={<MyAssessments />} /></Routes>
        </MemoryRouter>
      </div>,
    );
    await list();
    const all = Array.from(document.body.querySelectorAll("[class]")).map((el) => el.getAttribute("class") || "");
    const PHYSICAL = /(^|\s)(-?m[lr]-|p[lr]-|left-|right-|text-left|text-right|border-[lr](\s|-|$)|rounded-[lr]-)/;
    expect(all.filter((c) => PHYSICAL.test(c))).toEqual([]);
    const back = screen.getByRole("button", { name: "Back" });
    expect(back.querySelector("svg")?.getAttribute("class")).toMatch(/rtl:-scale-x-100/);
  });
});
