import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-r2uzg1.13 — "12: never naskh, always nastaliq" (operator, 13 Nov; ICT sheet, Assessment Generator 29: "The Urdu
 * text of the exam is following Arabic script … like in Lesson plans").
 *
 * Nastaliq reached the portal only through `html[lang="ur"] *`, i.e. Urdu MODE. A coach whose app is in English opened
 * an Urdu-medium paper (Social Studies, 2 Nov): the paper set lang="ur" on itself, no rule gave that a font, and the
 * phone drew the Urdu in its default Arabic face (Naskh). Her printed PDF was Nastaliq all along (it embeds the font).
 *
 * jsdom cannot pick glyphs or lay out lines, so this test asks the CASCADE: with the app in English, does every element
 * that draws the paper's own text match a rule in index.css that gives it the Urdu (Nastaliq) stack, and line height 2
 * (Nastaliq's ink is ~2.2em tall; the 1.375-1.625 of `leading-*` overlaps and clips it)? The pixels are the bead's
 * screenshots (Chromium, Noto Nastaliq) in the work folder.
 */

const { portal } = vi.hoisted(() => ({
  portal: {
    getAssessmentPapers: vi.fn(), getAssessmentPaperView: vi.fn(), getAssessmentDownload: vi.fn(),
    getAssessmentEditQuestions: vi.fn(), getAssessmentAddKinds: vi.fn(), getAssessmentOptions: vi.fn(),
    validateAssessmentEdit: vi.fn(), saveAssessmentVersion: vi.fn(),
  },
}));
vi.mock("../portal/services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  portal,
  language: { get: vi.fn(() => new Promise(() => {})), set: vi.fn() },
}));
vi.mock("../portal/lib/useNewUi", () => ({ readConfigShared: () => Promise.resolve({ features: { assessmentGenerator: true, assessmentEditing: true } }) }));
vi.mock("../portal/hooks/useAuth", () => ({ useAuth: () => ({ user: { phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../portal/components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { PaperPage } from "../portal/teacher/assessment/PaperPage";
import { EditPaperPage } from "../portal/teacher/assessment/EditPages";
import { QuestionForm } from "../portal/teacher/assessment/QuestionForm";
import { blankValues } from "../portal/teacher/assessment/editForm";
import { forgetPapers } from "../portal/teacher/assessment/paperCache";
import { ASSESSMENT_V2_BASE as B, editPath, paperPath } from "../portal/teacher/assessment/paths";

const css = readFileSync(resolve(__dirname, "../index.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\s+/g, " ");

/** Every plain style rule in index.css (at-rule wrappers such as `@layer base {` are peeled off), as selector list + body. */
function rules(): { selectors: string[]; body: string }[] {
  const out: { selectors: string[]; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of css.matchAll(re)) {
    const head = m[1].replace(/^.*@layer \w+ \{/, "").replace(/^.*@media[^{]*\{/, "").trim();
    if (!head || head.startsWith("@")) continue;
    out.push({ selectors: head.split(/,(?![^(]*\))/).map((s) => s.trim()).filter(Boolean), body: m[2] });
  }
  return out;
}

/** The selectors of every rule whose body matches `decl`. */
const selectorsFor = (decl: RegExp) => rules().filter((r) => decl.test(r.body)).flatMap((r) => r.selectors);
const safeMatches = (el: Element, sel: string) => { try { return el.matches(sel); } catch { return false; } };

const URDU_FONT = /font-family:\s*var\(--font-urdu\)\s*!important/;
const URDU_LINE = /line-height:\s*2\s*(;|$)/;

/** Elements that draw text of their own (a direct, non-blank text node), inside `root`. */
function textElements(root: Element): Element[] {
  return [root, ...root.querySelectorAll("*")].filter((el) =>
    [...el.childNodes].some((n) => n.nodeType === 3 && /\S/.test(n.textContent || "")));
}

/** Those of `els` that draw Urdu and that NO rule with `decl` reaches. */
function unreached(els: Element[], decl: RegExp): string[] {
  const sels = selectorsFor(decl);
  return els
    .filter((el) => /[؀-ۿ]/.test(el.textContent || ""))
    .filter((el) => !sels.some((s) => safeMatches(el, s)))
    .map((el) => `<${el.tagName.toLowerCase()} class="${el.getAttribute("class") ?? ""}">${(el.textContent || "").slice(0, 24)}`);
}

const URDU_VIEW = {
  success: true,
  paper: { paperId: "p-u", version: 1, grade: 5, subject: "social_studies", chapterNumber: 1, rtl: true, questionCount: 3, marks: 6 },
  sections: [
    { heading: "مختصر جوابات", lead: "درج ذیل سوالات کے جواب دیں", questions: [
      { number: 1, shape: "standard", text: "شہریت کی تعریف کریں۔", marks: 2 },
      { number: 2, shape: "options", text: "درست جواب کا انتخاب کریں", marks: 1, options: ["(الف) شہری", "(ب) ریاست"] },
    ] },
    { heading: null, lead: null, questions: [
      { number: 3, shape: "comprehension", text: "پڑھیں اور جواب دیں", marks: 3, passage: "ایک پیاسا کوا تھا۔", subs: [
        { letter: "a", text: "کوا کیوں پیاسا تھا؟", marks: 3, options: [] },
      ] },
    ] },
  ],
};

beforeEach(async () => {
  vi.clearAllMocks();
  forgetPapers();
  localStorage.clear();
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  // The coach's case: the APP is in English.
  document.documentElement.setAttribute("lang", "en");
  document.documentElement.setAttribute("dir", "ltr");
  portal.getAssessmentPapers.mockResolvedValue({ success: true, total: 1, page: 1, pageSize: 20, papers: [{
    paper_id: "p-u", grade: 5, subject_key: "social_studies", subject: "Social Studies", chapter_number: 1,
    question_count: 3, total_marks: 6, ready_at: "2026-11-02T07:11:06Z", version: 1, has_answer_key: true,
  }] });
});

describe("an Urdu paper is Nastaliq when the app is in English (bd-r2uzg1.13)", () => {
  it("index.css has a rule for Urdu content that does not depend on Urdu mode", () => {
    const outsideUrduMode = selectorsFor(URDU_FONT).filter((s) => !s.includes('html[lang="ur"]'));
    expect(outsideUrduMode.length, "a --font-urdu rule outside html[lang=\"ur\"]").toBeGreaterThan(0);
  });

  it("the paper screen: every Urdu line of the paper gets the Nastaliq stack and line height 2", async () => {
    portal.getAssessmentPaperView.mockResolvedValue(URDU_VIEW);
    render(
      <MemoryRouter initialEntries={[paperPath("p-u")]}>
        <Routes><Route path={`${B}/paper/:paperId`} element={<PaperPage />} /></Routes>
      </MemoryRouter>,
    );
    const body = await screen.findByTestId("paper-body");
    expect(body).toHaveAttribute("dir", "rtl");
    expect(body).toHaveAttribute("lang", "ur");
    const els = textElements(body);
    expect(els.filter((el) => /[؀-ۿ]/.test(el.textContent || "")).length).toBeGreaterThanOrEqual(8);
    expect(unreached(els, URDU_FONT), "Urdu drawn without Nastaliq (the phone's Naskh)").toEqual([]);
    expect(unreached(els, URDU_LINE), "Urdu lines shorter than 2 (Nastaliq clips)").toEqual([]);
  });

  it("an English paper with the app in English is left as it is: no Urdu font, no Urdu line height", async () => {
    portal.getAssessmentPaperView.mockResolvedValue({ ...URDU_VIEW, paper: { ...URDU_VIEW.paper, rtl: false }, sections: [
      { heading: "MCQs", lead: null, questions: [{ number: 1, shape: "standard", text: "Which part takes in water?", marks: 1 }] },
    ] });
    render(
      <MemoryRouter initialEntries={[paperPath("p-u")]}>
        <Routes><Route path={`${B}/paper/:paperId`} element={<PaperPage />} /></Routes>
      </MemoryRouter>,
    );
    const body = await screen.findByTestId("paper-body");
    const q = screen.getByText("Which part takes in water?");
    expect(selectorsFor(URDU_FONT).some((s) => safeMatches(q, s))).toBe(false);
    expect(selectorsFor(URDU_LINE).some((s) => safeMatches(q, s))).toBe(false);
    expect(body).toHaveAttribute("dir", "ltr");
  });

  it("the paper editor: the question list of an Urdu paper is Nastaliq, and its clamped rows keep room for the ink", async () => {
    portal.getAssessmentEditQuestions.mockResolvedValue({
      paper: { ...URDU_VIEW.paper, version: 1 },
      items: [1, 2].map((n) => ({
        id: `q${n}`, number: n, removed: false, type: "Short Answer", section: "subjective", marks: 2,
        text: `سوال ${n}: شہریت کی تعریف کریں۔`, fields: { question: `سوال ${n}: شہریت کی تعریف کریں۔`, marks: 2 },
      })),
    });
    portal.getAssessmentAddKinds.mockResolvedValue({ kinds: [], slotCap: 6 });
    render(
      <MemoryRouter initialEntries={[editPath("p-u")]}>
        <Routes><Route path={`${B}/paper/:paperId/edit`} element={<EditPaperPage />} /></Routes>
      </MemoryRouter>,
    );
    const row = await screen.findByText("سوال 1: شہریت کی تعریف کریں۔");
    expect(unreached([row], URDU_FONT)).toEqual([]);
    expect(unreached([row], URDU_LINE)).toEqual([]);
    // A line-clamp box: the clip edge sits 0.3em outside the line box, as in Urdu mode.
    expect(row.className).toMatch(/line-clamp-/);
    const clip = selectorsFor(/padding-block:\s*0\.3em/).filter((s) => !s.includes('html[lang="ur"]'));
    expect(clip.some((s) => safeMatches(row, s)), "clip room for a clamped Urdu row").toBe(true);
  });

  it("the question form of an Urdu paper: what the teacher types is Nastaliq too", () => {
    const values = { ...blankValues({ kind: "MCQs", label: "MCQs", layout: "options", section: "objective", marks: 1, lines: 0 } as never), question: "درست جواب کا انتخاب کریں" };
    render(<QuestionForm values={values} onChange={() => {}} kind={{ kind: "MCQs", label: "MCQs", layout: "options", section: "objective", marks: 1, lines: 0 } as never} rtl />);
    const boxes = [...document.querySelectorAll("textarea, input")].filter((el) => (el as HTMLInputElement).inputMode !== "numeric");
    expect(boxes.length).toBeGreaterThan(1);
    const sels = selectorsFor(URDU_FONT);
    for (const b of boxes) expect(sels.some((s) => safeMatches(b, s)), `${b.tagName} ${b.getAttribute("aria-label") ?? b.id}`).toBe(true);
  });
});
