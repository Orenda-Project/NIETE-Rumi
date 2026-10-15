import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from 'i18next';

/**
 * Editing a board-pattern paper (SPEC v2 §8.2 EditPages, §8.5 "editor shows willSay and refuses add"): one line says
 * both files change; under Remove / Put back in a choice group, what that question's line will then say, counted
 * from the live paper ("Q2 will then say: any eight of eleven"); Add question is off with its reason, and the
 * server's PATTERN_NO_ADD shows the same words. A plain paper's editor is unchanged (golden snapshot).
 */

const { portal } = vi.hoisted(() => ({
  portal: {
    getAssessmentOptions: vi.fn(),
    getAssessmentEditQuestions: vi.fn(),
    getAssessmentAddKinds: vi.fn(),
    validateAssessmentEdit: vi.fn(),
    saveAssessmentVersion: vi.fn(),
  },
}));
vi.mock('../../services/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  portal,
  language: { get: vi.fn(() => new Promise(() => {})), set: vi.fn() },
}));
vi.mock('../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { EditPaperPage, EditQuestionPage } from './EditPages';
import { ASSESSMENT_V2_BASE as B, addQuestionPath, editPath } from './paths';

const plain = (t: string | null | undefined) => (t || '').replace(/[⁦⁩]/g, '');

function at(path: string, routePath: string, el: JSX.Element) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={el} />
        <Route path="*" element={<p data-testid="elsewhere" />} />
      </Routes>
    </MemoryRouter>,
  );
}

const fields = (q: string) => ({ question: q, marks: 5 });
const item = (id: string, number: number, slot: string | undefined, section: 'objective' | 'subjective' = 'subjective', marks = 5) => ({
  id, number, removed: false, type: 'Short Answer', section, marks, text: `Question ${id}`, fields: fields(`Question ${id}`),
  ...(slot ? { slot } : {}),
});

const CHOICES = [
  { slot: 'maths.B.Q2', label_en: 'Q2', label_ur: 'سوال 2', generate: 12, attempt: 8, marks_each: 5 },
  { slot: 'maths.C.Q9', label_en: 'Q9', label_ur: 'سوال 9', generate: 3, attempt: 2, marks_each: 10 },
];

/** A Maths FDE paper: two MCQs (no choice), Q2's twelve (any eight), Q9's three (any two). */
function fdePaper(withChoices = true) {
  const items = [
    item('a1', 1, 'maths.A.Q1a', 'objective', 1), item('a2', 2, 'maths.A.Q1a', 'objective', 1),
    ...Array.from({ length: 12 }, (_, i) => item(`b${i + 1}`, i + 3, 'maths.B.Q2')),
    ...Array.from({ length: 3 }, (_, i) => item(`c${i + 1}`, i + 15, 'maths.C.Q9', 'subjective', 10)),
  ];
  return {
    paper: {
      paperId: 'p-f', version: 1, grade: 5, subject: 'Mathematics', subjectKey: 'maths', chapterNumber: null, rtl: false,
      questionCount: items.length, marks: 100, pattern: 'fde_g5_2027', ...(withChoices ? { choices: CHOICES } : {}),
    },
    items,
  };
}

const PLAIN = {
  paper: { paperId: 'p-1', version: 2, grade: 4, subject: 'Science', chapterNumber: 2, rtl: false, questionCount: 3, marks: 7 },
  items: [item('q1', 1, undefined, 'objective', 1), item('q2', 2, undefined, 'objective', 1), item('q3', 3, undefined)],
};

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  if (!i18n.isInitialized) await i18n.init({ lng: 'en', resources: {} });
  await act(async () => { await i18n.changeLanguage('en'); });
  portal.getAssessmentAddKinds.mockResolvedValue({ kinds: [{ kind: 'MCQs', label: 'MCQs', layout: 'options', section: 'objective', marks: 1, lines: 0 }], slotCap: 6 });
  portal.getAssessmentOptions.mockResolvedValue({ success: true, grades: [5], maxQuestions: 50, defaultQuestions: 15, patterns: [{ id: 'fde_g5_2027', choices: CHOICES }] });
});

const q2Rows = () => screen.getAllByTestId('will-say').filter((n) => /Q2/.test(n.textContent || ''));

describe('editor shows willSay and refuses add', () => {
  it('says both files change, says what Q2 and Q9 will then say, and keeps Add off with its reason', async () => {
    portal.getAssessmentEditQuestions.mockResolvedValue(fdePaper());
    at(editPath('p-f'), `${B}/paper/:paperId/edit`, <EditPaperPage />);
    await screen.findByTestId('edit-both');
    expect(screen.getByTestId('edit-both').textContent).toBe('Changes the paper and the marking scheme');

    // Under each of Q2's twelve Remove boxes: removing one leaves "any eight of eleven"; Q9: "any two of two" is no choice.
    expect(q2Rows()).toHaveLength(12);
    expect(q2Rows()[0].textContent).toBe('Q2 will then say: any eight of eleven');
    // MCQs carry no choice line.
    expect(screen.getAllByTestId('will-say')).toHaveLength(12 + 3);

    // Add is off, says why, and never asks the server for kinds.
    const add = screen.getByTestId('add-disabled');
    expect((add as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('button-reason').textContent).toBe('Board-pattern papers keep their shape');
    fireEvent.click(add);
    expect(portal.getAssessmentAddKinds).not.toHaveBeenCalled();
    expect(portal.getAssessmentOptions).not.toHaveBeenCalled();
  });

  it('counts from the live paper: after one removal the rest say eleven → ten, the removed one says put back → twelve', async () => {
    portal.getAssessmentEditQuestions.mockResolvedValue(fdePaper());
    at(editPath('p-f'), `${B}/paper/:paperId/edit`, <EditPaperPage />);
    await screen.findByTestId('edit-both');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Remove question 3' }));
    const lines = q2Rows().map((n) => n.textContent);
    expect(lines.filter((t) => t === 'Q2 will then say: any eight of ten')).toHaveLength(11);
    expect(lines.filter((t) => t === 'Q2 will then say: any eight of twelve')).toHaveLength(1);
  });

  it('when a removal would leave no choice, it says so honestly ("attempt all")', async () => {
    portal.getAssessmentEditQuestions.mockResolvedValue(fdePaper());
    at(editPath('p-f'), `${B}/paper/:paperId/edit`, <EditPaperPage />);
    await screen.findByTestId('edit-both');
    const q9 = screen.getAllByTestId('will-say').filter((n) => /Q9/.test(n.textContent || ''));
    expect(q9[0].textContent).toBe('Q9 will then say: attempt both');
  });

  it('without choices on the paper it reads them from the pattern in /assessment/options', async () => {
    portal.getAssessmentEditQuestions.mockResolvedValue(fdePaper(false));
    at(editPath('p-f'), `${B}/paper/:paperId/edit`, <EditPaperPage />);
    await waitFor(() => expect(q2Rows()).toHaveLength(12));
    expect(portal.getAssessmentOptions).toHaveBeenCalledWith(5, 'maths');
  });

  it('in Urdu: the line, the willSay and the reason are Urdu', async () => {
    await act(async () => { await i18n.changeLanguage('ur'); });
    portal.getAssessmentEditQuestions.mockResolvedValue(fdePaper());
    at(editPath('p-f'), `${B}/paper/:paperId/edit`, <EditPaperPage />);
    await screen.findByTestId('edit-both');
    expect(plain(screen.getByTestId('edit-both').textContent)).toBe('پرچہ اور مارکنگ اسکیم دونوں بدلیں گے');
    expect(plain(screen.getAllByTestId('will-say')[0].textContent)).toBe('سوال 2 پھر کہے گا: 11 میں سے کوئی 8');
    expect(plain(screen.getByTestId('button-reason').textContent)).toBe('بورڈ pattern کا پرچہ اپنی شکل رکھتا ہے');
  });

  it("the server's PATTERN_NO_ADD shows the same words, not the server's English", async () => {
    await act(async () => { await i18n.changeLanguage('ur'); });
    portal.getAssessmentEditQuestions.mockResolvedValue(fdePaper());
    portal.validateAssessmentEdit.mockRejectedValue({ response: { status: 400, data: { success: false, errorCode: 'PATTERN_NO_ADD', error: 'Board-pattern papers keep their shape.' } } });
    at(addQuestionPath('p-f', 'MCQs'), `${B}/paper/:paperId/edit/add/:kind`, <EditQuestionPage mode="add" />);
    const done = await screen.findByRole('button', { name: 'مکمل' });
    fireEvent.click(done);
    const alert = await screen.findByRole('alert');
    expect(plain(alert.textContent)).toBe('بورڈ pattern کا پرچہ اپنی شکل رکھتا ہے');
  });

  it('a save refused with PATTERN_NO_ADD shows the same words', async () => {
    portal.getAssessmentEditQuestions.mockResolvedValue(fdePaper());
    portal.saveAssessmentVersion.mockRejectedValue({ response: { status: 400, data: { success: false, errorCode: 'PATTERN_NO_ADD', error: 'Board-pattern papers keep their shape.' } } });
    at(editPath('p-f'), `${B}/paper/:paperId/edit`, <EditPaperPage />);
    await screen.findByTestId('edit-both');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Remove question 3' }));
    fireEvent.click(screen.getByRole('button', { name: /Save as/ }));
    expect((await screen.findByRole('alert')).textContent).toBe('Board-pattern papers keep their shape');
  });
});

describe('the editor counts a board-pattern paper the way it prints', () => {
  it("marks: a choice group counts only what the child attempts (Q2 8×5, Q9 2×10), and drops honestly below it", async () => {
    portal.getAssessmentEditQuestions.mockResolvedValue(fdePaper());
    at(editPath('p-f'), `${B}/paper/:paperId/edit`, <EditPaperPage />);
    await screen.findByTestId('edit-both');
    // A: 2 × 1 · Q2: any 8 of 12 × 5 = 40 · Q9: any 2 of 3 × 10 = 20 → 62 (not the 102 the items add up to).
    expect(screen.getByText('62 marks')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Remove question 3' }));
    expect(screen.getByText('62 marks')).toBeTruthy(); // 11 left, still any eight
    fireEvent.click(screen.getByRole('checkbox', { name: 'Remove question 15' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Remove question 16' }));
    expect(screen.getByText('52 marks')).toBeTruthy(); // Q9 down to one: 1 × 10
  });

  it("reads the edit route's own choices shape (one label, from the paper's _layout)", async () => {
    const paper = fdePaper();
    paper.paper.choices = CHOICES.map(({ slot, label_en, generate, attempt, marks_each }) => ({ slot, label: label_en, generate, attempt, marks_each, live: generate })) as never;
    portal.getAssessmentEditQuestions.mockResolvedValue(paper);
    at(editPath('p-f'), `${B}/paper/:paperId/edit`, <EditPaperPage />);
    await screen.findByTestId('edit-both');
    expect(q2Rows()[0].textContent).toBe('Q2 will then say: any eight of eleven');
    expect(portal.getAssessmentOptions).not.toHaveBeenCalled();
  });
});

describe('the editor is grouped the way the paper prints', () => {
  it('by FDE section (A, B, C), not Objective / Written', async () => {
    portal.getAssessmentEditQuestions.mockResolvedValue(fdePaper());
    at(editPath('p-f'), `${B}/paper/:paperId/edit`, <EditPaperPage />);
    await screen.findByTestId('edit-both');
    expect(screen.getAllByTestId('edit-section').map((n) => n.textContent)).toEqual(['Section A', 'Section B', 'Section C']);
    expect(screen.queryByText('Objective')).toBeNull();
    expect(screen.queryByText('Written')).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Section C' })).getAllByRole('checkbox')).toHaveLength(3);
  });

  it('in Urdu the sections are حصہ الف / ب / ج, and two left is «دونوں»', async () => {
    await act(async () => { await i18n.changeLanguage('ur'); });
    portal.getAssessmentEditQuestions.mockResolvedValue(fdePaper());
    at(editPath('p-f'), `${B}/paper/:paperId/edit`, <EditPaperPage />);
    await screen.findByTestId('edit-both');
    expect(screen.getAllByTestId('edit-section').map((n) => plain(n.textContent))).toEqual(['حصہ الف', 'حصہ ب', 'حصہ ج']);
    const q9 = screen.getAllByTestId('will-say').map((n) => plain(n.textContent)).filter((t) => t.startsWith('سوال 9'));
    expect(q9[0]).toBe('سوال 9 پھر کہے گا: دونوں حل کریں');
  });
});

describe('a plain paper is unchanged', () => {
  it('no both-files line, no willSay, Add opens the kinds tray, no options call', async () => {
    portal.getAssessmentEditQuestions.mockResolvedValue(PLAIN);
    at(editPath('p-1'), `${B}/paper/:paperId/edit`, <EditPaperPage />);
    await screen.findByRole('checkbox', { name: 'Remove question 1' });
    expect(screen.queryByTestId('edit-both')).toBeNull();
    expect(screen.queryByTestId('will-say')).toBeNull();
    expect(screen.queryByTestId('add-disabled')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add question' }));
    await waitFor(() => expect(portal.getAssessmentAddKinds).toHaveBeenCalledWith('p-1'));
    expect(portal.getAssessmentOptions).not.toHaveBeenCalled();
  });

  it('golden: the plain editor renders byte-identical to the branch point', async () => {
    portal.getAssessmentEditQuestions.mockResolvedValue(PLAIN);
    const { container } = at(editPath('p-1'), `${B}/paper/:paperId/edit`, <EditPaperPage />);
    const list = await screen.findByTestId('assessment-edit');
    within(list).getByRole('checkbox', { name: 'Remove question 1' });
    expect(container.innerHTML.replace(/:r[0-9a-z]+:/g, ':id:')).toMatchSnapshot();
  });
});
