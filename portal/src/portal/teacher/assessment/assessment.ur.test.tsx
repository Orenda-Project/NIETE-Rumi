import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from 'i18next';

/**
 * bd-fmf24g.13.1 — Assessment in Urdu: the hub, the New paper's steps, Check and make, a paper that did not
 * get made, the paper page, Edit paper and one question take every word from ASSESSMENT (bilingual), none
 * left in English; data (subject names, chapter titles, question types, her own questions) stays as the API
 * sends it. A page range keeps its order on an Urdu page (isolated). MACHINE-DRAFTED Urdu (see the review file).
 */

const { portal, config } = vi.hoisted(() => ({
  portal: {
    getAssessmentOptions: vi.fn(),
    getAssessmentChapters: vi.fn(),
    generateAssessment: vi.fn(),
    getAssessmentStatus: vi.fn(),
    getAssessmentPapers: vi.fn(),
    getAssessmentDownload: vi.fn(),
    getAssessmentVersions: vi.fn(),
    getAssessmentEditQuestions: vi.fn(),
    getAssessmentAddKinds: vi.fn(),
  },
  config: { features: { assessmentGenerator: true, assessmentEditing: true } },
}));
vi.mock('../../services/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  portal,
  language: { get: vi.fn(() => new Promise(() => {})), set: vi.fn() },
}));
vi.mock('../../lib/useNewUi', () => ({ readConfigShared: () => Promise.resolve(config) }));
vi.mock('../../lib/gradeSubjects', () => ({ loadGradeSubjects: () => Promise.resolve([]) }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { phoneNumber: '923001234567' }, loading: false }) }));
vi.mock('../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { ASSESSMENT_V2_COPY_UR as U } from './copy';
import { forgetCatalogue } from './api';
import { forgetPapers } from './paperCache';
import { clearPicksForTest, setPicks } from './store';
import { dayLabel, groupPapersByDay, newPicks, paperLabel } from './model';
import { failureLabel } from './failure';
import { AssessmentHub } from './AssessmentHub';
import { CheckStep, TypesStep } from './NewPaperSteps';
import { PaperPage } from './PaperPage';
import { RequestPage } from './RequestPage';
import { EditPaperPage, EditQuestionPage } from './EditPages';
import { ASSESSMENT_V2_BASE as B, editPath, editQuestionPath, newPaperPath, paperPath, requestPath } from './paths';

/** The kit isolates digit and Latin runs (LRI … PDI) on an Urdu page; compare the words without them. */
const plain = (t: string | null | undefined) => (t || '').replace(/[⁦⁩]/g, '');
const pageText = () => plain(document.body.textContent);
const h1 = () => plain(screen.getByRole('heading', { level: 1 }).textContent);

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

const JOBS_KEY = 'assessment-jobs:v1:923001234567';
const today = new Date().toISOString();
const PAPER = {
  paper_id: 'p-1', grade: 4, subject_key: 'science', subject: 'Science', chapter_number: 2,
  question_count: 14, total_marks: 20, ready_at: today, version: 2, has_answer_key: true,
};

beforeEach(async () => {
  vi.clearAllMocks();
  clearPicksForTest();
  forgetCatalogue();
  forgetPapers();
  sessionStorage.clear();
  localStorage.clear();
  config.features = { assessmentGenerator: true, assessmentEditing: true };
  if (!i18n.isInitialized) await i18n.init({ lng: 'en', resources: {} });
  await act(async () => { await i18n.changeLanguage('ur'); });
  portal.getAssessmentOptions.mockImplementation(async (grade?: number, subject?: string) => {
    if (grade && subject) {
      return { success: true, grades: [4], maxQuestions: 50, defaultQuestions: 15, types: [
        { id: 'MCQs', category: 'objective' }, { id: 'Brief Answers', category: 'subjective' },
      ] };
    }
    if (grade) return { success: true, grades: [4], maxQuestions: 50, defaultQuestions: 15, subjects: [{ subject_key: 'science', subject: 'Science' }] };
    return { success: true, grades: [4], maxQuestions: 50, defaultQuestions: 15 };
  });
  portal.getAssessmentChapters.mockResolvedValue({ success: true, chapters: [
    { chapter_number: 1, chapter_title: 'Green Guardians of Earth', page_start: 1, page_end: 28, page_count: 28 },
  ] });
  portal.getAssessmentStatus.mockResolvedValue({ success: true, status: 'queued' });
  portal.getAssessmentPapers.mockResolvedValue({ success: true, papers: [PAPER], total: 1, page: 1, pageSize: 20 });
  portal.getAssessmentEditQuestions.mockResolvedValue({
    paper: { paperId: 'p-1', version: 2, grade: 4, subject: 'science', chapterNumber: 2, rtl: false, questionCount: 2, marks: 3 },
    items: [
      { id: 'q1', number: 1, removed: false, type: 'MCQs', section: 'objective', marks: 1, text: 'Plants make food by',
        fields: { shape: 'options', question: 'Plants make food by', marks: '1', answer: '', lines: '', lines_default: null,
          lines_options: [], show_lines: false, slots: ['light', 'soil'], correct: '0', show_correct: true } },
      { id: 'q2', number: 2, removed: false, type: 'Brief Answers', section: 'subjective', marks: 2, text: 'Name a plant',
        fields: { shape: 'standard', question: 'Name a plant', marks: '2', answer: 'Rose', lines: '2', lines_default: 2,
          lines_options: [{ id: '2', title: '2' }], show_lines: true } },
    ],
  });
});

describe('Assessment in Urdu', () => {
  it('the hub: title, New paper, Being made (with the reason a paper failed), My papers by day', async () => {
    sessionStorage.setItem(JOBS_KEY, JSON.stringify([
      { requestId: 'req-1', label: 'Green Guardians of Earth', startedAt: Date.now(), status: 'writing', spec: { grade: 4, subject: 'science', questionCount: 15 } },
      { requestId: 'req-2', label: 'Inside The Animal World', startedAt: Date.now(), status: 'failed', errorCode: 'TRUNCATED', spec: { grade: 4, subject: 'science', questionCount: 15 } },
    ]));
    at(B, B, <AssessmentHub />);
    expect(await screen.findByText(U.newPaper)).toBeTruthy();
    expect(h1()).toBe(U.title);
    expect(screen.getByText(U.withKey)).toBeTruthy();
    expect(screen.getByRole('heading', { name: new RegExp(U.beingMade) })).toBeTruthy();
    expect(pageText()).toContain(U.writing);
    expect(pageText()).toContain(U.failures.TRUNCATED);
    expect(await screen.findByText(U.recent)).toBeTruthy();
    expect(pageText()).toContain(U.days.today);
    expect(pageText()).toContain(U.chapterShort(2));
    expect(pageText()).toContain(U.marksCount(20));
    // data stays as it is
    expect(pageText()).toContain('Green Guardians of Earth');
    for (const en of ['New paper', 'With answer key', 'Being made', 'Recent papers', 'Writing', 'Too many questions', 'Today']) {
      expect(screen.queryByText(en)).toBeNull();
    }
  });

  it('a New paper step: Question types — its title, Next, the choices, the groups and the stepper', async () => {
    setPicks({ ...newPicks(15), grade: 4, subject: 'science', subjectName: 'Science', chapters: [1], count: 3, typeMode: 'pick' });
    at(newPaperPath('types'), newPaperPath('types'), <TypesStep />);
    expect(h1()).toBe(U.steps.types);
    expect(screen.getByRole('progressbar').getAttribute('aria-label')).toBe(U.step(4, 6));
    expect(screen.getByRole('button', { name: new RegExp(U.next) })).toBeTruthy();
    expect(screen.getByText(U.autoMix)).toBeTruthy();
    expect(screen.getByText(U.chooseTypes)).toBeTruthy();
    expect(await screen.findByText(U.objective)).toBeTruthy();
    expect(screen.getByText(U.written)).toBeTruthy();
    expect(screen.getByText(U.howManyEach)).toBeTruthy();
    // nothing picked: the reason is on the card and above the off Next, in Urdu
    expect(screen.getAllByText(U.why.typesNone).length).toBe(2);
    // each type has a number box in front, 0 written in it (the type's name is data)
    const mcq = screen.getByRole('textbox', { name: U.typeCount('MCQs') }) as HTMLInputElement;
    expect(mcq.value).toBe('0');
    // too many: the total and the message, live, in Urdu
    fireEvent.change(mcq, { target: { value: '5' } });
    expect(screen.getByText(U.why.totalOf(5, 3))).toBeTruthy();
    expect(screen.getAllByText(U.why.over(2)).length).toBeGreaterThan(0);
    expect(screen.getByTestId('button-reason').textContent).toContain(U.why.over(2));
    for (const en of ['Question types', 'Next', 'Auto mix', 'Choose types', 'Objective', 'Written', 'How many each', 'too many']) {
      expect(screen.queryByText(en)).toBeNull();
    }
  });

  it('Check and make: every row, Edit, the dock — and a page range keeps its order', async () => {
    setPicks({
      ...newPicks(15), grade: 4, subject: 'science', subjectName: 'Science', coverBy: 'pages', ranges: [[4, 14]],
      source: 'both', count: 15, seen: 5,
    });
    at(newPaperPath('check'), newPaperPath('check'), <CheckStep />);
    expect(h1()).toBe(U.steps.check);
    expect(screen.getByRole('button', { name: new RegExp(U.makePaper) })).toBeTruthy();
    for (const w of [U.steps.class, U.pages, U.steps.questions, U.steps.types, U.totalMarks, U.answerLines, U.file, U.pdfWithKey, U.fixed, U.noLimit, U.on]) {
      expect(screen.getAllByText(w).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByRole('link', { name: U.edit })).toHaveLength(6);
    expect(screen.getByText(U.gradeSubject(4, 'Science'))).toBeTruthy();
    expect(pageText()).toContain(plain(U.join(U.questionsCount(15), U.bookShort(5), U.newShort(10))));
    // "4 – 14" inside Urdu would show as "14 – 4": the range is isolated (LRI … PDI).
    expect(screen.getByText(U.pageRange(4, 14)).textContent).toContain('⁦4 – 14⁩');
    for (const en of ['Check and make', 'Make paper', 'Total marks', 'Answer lines', 'Edit', 'Fixed', 'No limit']) {
      expect(screen.queryByText(en)).toBeNull();
    }
  });

  it('a paper that was not made: the title, the reason, Try again, Change choices, Dismiss', async () => {
    sessionStorage.setItem(JOBS_KEY, JSON.stringify([
      { requestId: 'req-2', label: 'Inside The Animal World', startedAt: Date.now(), status: 'failed', errorCode: 'NO_CONTENT', spec: { grade: 4, subject: 'science', questionCount: 15 } },
    ]));
    at(requestPath('req-2'), `${B}/request/:requestId`, <RequestPage />);
    expect(h1()).toBe(U.notMadeTitle);
    expect(screen.getByRole('alert').textContent).toBe(U.failures.NO_CONTENT);
    expect(screen.getByRole('button', { name: new RegExp(U.tryAgain) })).toBeTruthy();
    expect(screen.getByRole('button', { name: U.changeChoices })).toBeTruthy();
    expect(screen.getByRole('button', { name: U.dismiss })).toBeTruthy();
    for (const en of ['Paper not made', 'No chapter text', 'Try again', 'Dismiss']) expect(screen.queryByText(en)).toBeNull();
  });

  it('the paper page: its class, chips, Download, Answer key, Edit and Versions', async () => {
    at(paperPath('p-1'), `${B}/paper/:paperId`, <PaperPage />);
    expect(await screen.findByRole('button', { name: new RegExp(U.download) })).toBeTruthy();
    expect(h1()).toBe(U.gradeSubject(4, 'Science'));
    for (const w of [U.chapterShort(2), U.questionsCount(14), U.marksCount(20), U.versionLong(2), U.days.today]) {
      expect(screen.getByText(w)).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: new RegExp(U.answerKey) })).toBeTruthy();
    expect(screen.getByRole('link', { name: new RegExp(U.edit) })).toBeTruthy();
    expect(screen.getByRole('link', { name: new RegExp(U.versions) })).toBeTruthy();
    for (const en of ['Download', 'Answer key', 'Edit', 'Versions', 'Version 2', '14 questions']) expect(screen.queryByText(en)).toBeNull();
  });

  it('Edit paper: counts, the two groups, Cancel and Save as the next version', async () => {
    at(editPath('p-1'), `${B}/paper/:paperId/edit`, <EditPaperPage />);
    expect(await screen.findByText(U.objective)).toBeTruthy();
    expect(h1()).toBe(U.editPaper);
    expect(screen.getByText(U.written)).toBeTruthy();
    expect(screen.getByText(U.kept(2))).toBeTruthy();
    expect(screen.getByText(U.marksCount(3))).toBeTruthy();
    expect(screen.getByRole('link', { name: U.cancel })).toBeTruthy();
    expect(screen.getByRole('button', { name: new RegExp(U.saveAs(3)) })).toBeTruthy();
    expect(screen.getByRole('button', { name: new RegExp(U.addQuestion) })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: U.removeQuestion(1) })).toBeTruthy();
    // her questions are data
    expect(screen.getByText('Plants make food by')).toBeTruthy();
    for (const en of ['Edit paper', 'Objective', 'Cancel', 'Save as v3', 'Add question', '2 kept']) expect(screen.queryByText(en)).toBeNull();
  });

  it('one question: its boxes, the correct option, Done and Remove question', async () => {
    at(editQuestionPath('p-1', 'q1'), `${B}/paper/:paperId/edit/q/:key`, <EditQuestionPage mode="edit" />);
    expect(await screen.findByRole('button', { name: new RegExp(U.done) })).toBeTruthy();
    expect(h1()).toBe(U.questionN(1));
    expect(screen.getByLabelText(U.question)).toBeTruthy();
    expect(screen.getByText(U.options)).toBeTruthy();
    expect(screen.getByRole('radio', { name: U.correctN(1) })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: U.optionN(2) })).toBeTruthy();
    expect(screen.getByLabelText(U.marksLabel)).toBeTruthy();
    expect(screen.getByRole('button', { name: new RegExp(U.removeFromPaper) })).toBeTruthy();
    for (const en of ['Question', 'Options', 'Marks', 'Done', 'Remove question']) expect(screen.queryByText(en)).toBeNull();
  });

  it('the plain helpers name things in the words they are given', () => {
    expect(failureLabel('TRUNCATED', U)).toBe(U.failures.TRUNCATED);
    expect(failureLabel('SOMETHING_NEW', U)).toBe(U.failureFallback);
    expect(dayLabel('2026-10-08', '2026-10-08', U.days)).toBe(U.days.today);
    expect(dayLabel('2026-10-07', '2026-10-08', U.days)).toBe(U.days.yesterday);
    expect(dayLabel('2026-10-05', '2026-10-08', U.days)).toBe(U.days.date(1, 5, 9));
    const [g] = groupPapersByDay([{ ready_at: '2026-10-08T05:00:00Z' }], '2026-10-08', U.days);
    expect(g.day).toBe(U.days.today);
    expect(paperLabel({ ...newPicks(15), grade: 4, subjectName: 'Science' }, U)).toBe(U.join(U.grade(4), 'Science', U.questionsCount(15)));
  });
});
