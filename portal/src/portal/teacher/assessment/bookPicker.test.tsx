import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * AG row 21 (Hafsa; Amena 21 Nov: a tick-list) — after choosing chapters she sees each chapter's own exercise
 * questions and ticks the ones she wants. The ticks are her Seen questions: counted per type, shown on Check, and
 * sent as seenPicked. Drawn only when the bot offers the picker (options `bookPicker`) on a chapters paper.
 */
const { portal, config } = vi.hoisted(() => ({
  portal: {
    getAssessmentOptions: vi.fn(),
    getAssessmentChapters: vi.fn(),
    getAssessmentExercises: vi.fn(),
    generateAssessment: vi.fn(),
    getAssessmentStatus: vi.fn(),
    getAssessmentPapers: vi.fn(),
  },
  config: { features: { assessmentGenerator: true, assessmentEditing: true } },
}));
vi.mock('../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() }, portal }));
vi.mock('../../lib/useNewUi', () => ({ readConfigShared: () => Promise.resolve(config) }));
vi.mock('../../lib/gradeSubjects', () => ({ loadGradeSubjects: () => Promise.resolve([]) }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { phoneNumber: '923001234567' }, loading: false }) }));
vi.mock('../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { ASSESSMENT_V2_COPY as C, ASSESSMENT_V2_COPY_UR as U } from './copy';
import { forgetCatalogue } from './api';
import { clearPicksForTest, setPicks } from './store';
import { newPicks, toSpec, seenTotal, limitTotal, type Picks } from './model';
import { CheckStep, QuestionsStep } from './NewPaperSteps';
import { ASSESSMENT_V2_BASE, newPaperPath } from './paths';

function at(path: string, routePath: string, el: JSX.Element) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={el} />
        <Route path={`${ASSESSMENT_V2_BASE}/request/:id`} element={<p data-testid="request-page" />} />
        <Route path="*" element={<p data-testid="elsewhere" />} />
      </Routes>
    </MemoryRouter>,
  );
}

const SCIENCE = { grade: 4, subject: 'science', subjectName: 'Science', chapters: [1] };
const picks = (over: Partial<Picks>): Picks => ({ ...newPicks(15), ...SCIENCE, ...over });
const EX = (ref: string, text: string, type: string, heading = 'Exercise 1') => ({ ref, heading, text, type, page: 3 });
const CHAPTER_1 = { chapterNumber: 1, title: 'Green Guardians', exercises: [
  EX('Exercise 1 · Q1', 'What do plants need to grow?', 'Brief Answers'),
  EX('Exercise 1 · Q2', 'Roots take in (a) light (b) water', 'MCQs'),
  EX('Exercise 1 · Q3', 'Plants can walk.', 'True/False'),
] };
const PICK = (e: ReturnType<typeof EX>, chapter = 1) => ({ chapter, ref: e.ref, text: e.text, type: e.type });

let pickerOn = true;
beforeEach(() => {
  vi.clearAllMocks();
  clearPicksForTest();
  forgetCatalogue();
  sessionStorage.clear();
  pickerOn = true;
  portal.getAssessmentOptions.mockImplementation(async (grade?: number, subject?: string) => {
    if (grade && subject) {
      return { success: true, grades: [4], maxQuestions: 50, defaultQuestions: 15, ...(pickerOn ? { bookPicker: true } : {}), types: [
        { id: 'MCQs', category: 'objective' }, { id: 'True/False', category: 'objective' },
        { id: 'Fill in the Blanks', category: 'objective' }, { id: 'Brief Answers', category: 'subjective' },
      ] };
    }
    if (grade) return { success: true, grades: [4], maxQuestions: 50, defaultQuestions: 15, subjects: [{ subject_key: 'science', subject: 'Science' }] };
    return { success: true, grades: [4], maxQuestions: 50, defaultQuestions: 15, groupedTypes: ['MCQs', 'True/False'], maxItems: 100 };
  });
  portal.getAssessmentChapters.mockResolvedValue({ success: true, chapters: [
    { chapter_number: 1, chapter_title: 'Green Guardians', page_start: 1, page_end: 28, page_count: 28 },
  ] });
  portal.getAssessmentExercises.mockResolvedValue({ success: true, enabled: true, chapters: [CHAPTER_1] });
  portal.getAssessmentStatus.mockResolvedValue({ success: true, status: 'queued' });
});

const openQuestions = () => at(newPaperPath('questions'), newPaperPath('questions'), <QuestionsStep />);

describe('model', () => {
  it('her picks are the seen questions, counted per type; picks from a chapter no longer on the paper do not count', () => {
    const p = picks({ seen: 5, seenPicked: [PICK(CHAPTER_1.exercises[0]), PICK(CHAPTER_1.exercises[1]), PICK(CHAPTER_1.exercises[2], 7)] });
    expect(seenTotal(p)).toBe(2);
    expect(limitTotal(p, ['MCQs'])).toBe(2);
  });

  it('the request carries her picks and the counts they make', () => {
    const spec = toSpec(picks({ typesSeeded: true, typeCounts: {}, seenPicked: [PICK(CHAPTER_1.exercises[0]), PICK(CHAPTER_1.exercises[1])] }));
    expect(spec).toMatchObject({
      contentSource: 'seen', questionCount: 2,
      seenTypes: [{ id: 'Brief Answers', count: 1 }, { id: 'MCQs', count: 1 }],
      seenPicked: [PICK(CHAPTER_1.exercises[0]), PICK(CHAPTER_1.exercises[1])],
    });
  });

  it('no picks: no seenPicked key (today\'s request)', () => {
    expect('seenPicked' in toSpec(picks({ seen: 3, typeCounts: { MCQs: 2 } }))).toBe(false);
  });
});

describe('Pick from the book on Questions', () => {
  it('opens the chapter\'s questions as a tick-list, grouped by exercise; Done makes them her seen questions', async () => {
    setPicks(picks({ typesSeeded: true, seen: 5, typeCounts: { MCQs: 4 } }));
    openQuestions();
    fireEvent.click(await screen.findByTestId('pick-from-book'));
    const tray = await screen.findByTestId('book-picker-tray');
    expect(portal.getAssessmentExercises).toHaveBeenCalledWith(4, 'science', [1]);
    expect(await within(tray).findByText('Exercise 1')).toBeTruthy();
    fireEvent.click(within(tray).getByRole('checkbox', { name: /What do plants need to grow\?/ }));
    fireEvent.click(within(tray).getByRole('checkbox', { name: /Plants can walk\./ }));
    expect(within(tray).getByText(C.picked(2))).toBeTruthy();
    fireEvent.click(within(tray).getByRole('button', { name: C.done }));
    expect(await screen.findByTestId('book-picked')).toBeTruthy();
    expect(screen.getByTestId('book-picked').textContent).toContain(C.fromBookPicked(2));
    expect(screen.queryByTestId('count-seen')).toBeNull();
    expect(screen.getByTestId('questions-total').textContent).toContain(C.seenShort(2));
    const saved = JSON.parse(sessionStorage.getItem('teacher-v2-assessment-new:v1') ?? '{}');
    expect(saved.seenPicked.map((x: { ref: string }) => x.ref)).toEqual(['Exercise 1 · Q1', 'Exercise 1 · Q3']);
  });

  it('Clear brings the single book box back', async () => {
    setPicks(picks({ typesSeeded: true, seen: 5, typeCounts: { MCQs: 4 }, seenPicked: [PICK(CHAPTER_1.exercises[0])] }));
    openQuestions();
    fireEvent.click(await screen.findByRole('button', { name: C.clearPicks }));
    expect(await screen.findByTestId('count-seen')).toBeTruthy();
  });

  it('a chapter with no exercise questions says so', async () => {
    portal.getAssessmentExercises.mockResolvedValue({ success: true, enabled: true, chapters: [{ chapterNumber: 1, title: 'X', exercises: [] }] });
    setPicks(picks({ typesSeeded: true, typeCounts: { MCQs: 4 } }));
    openQuestions();
    fireEvent.click(await screen.findByTestId('pick-from-book'));
    expect(await within(await screen.findByTestId('book-picker-tray')).findByText(C.noBookQuestions)).toBeTruthy();
  });

  it('not drawn when the bot does not offer it, or on a pages paper', async () => {
    pickerOn = false;
    setPicks(picks({ typesSeeded: true, typeCounts: { MCQs: 4 } }));
    const a = openQuestions();
    await screen.findByTestId('count-seen');
    expect(screen.queryByTestId('pick-from-book')).toBeNull();
    a.unmount();
    pickerOn = true;
    forgetCatalogue();
    setPicks(picks({ typesSeeded: true, coverBy: 'pages', chapters: [], ranges: [[1, 5]], typeCounts: { MCQs: 4 } }));
    openQuestions();
    await screen.findByTestId('count-seen');
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('pick-from-book')).toBeNull();
  });
});

describe('Check', () => {
  it('says From the book · N picked and sends the picks', async () => {
    setPicks(picks({ typesSeeded: true, typeCounts: { 'Fill in the Blanks': 3 }, seenPicked: [PICK(CHAPTER_1.exercises[0]), PICK(CHAPTER_1.exercises[1])] }));
    portal.generateAssessment.mockResolvedValue({ success: true, requestId: 'req-9' });
    at(newPaperPath('check'), newPaperPath('check'), <CheckStep />);
    expect(await screen.findByText(C.fromBookPicked(2))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(C.makePaper) }));
    await waitFor(() => expect(screen.getByTestId('request-page')).toBeTruthy());
    expect(portal.generateAssessment).toHaveBeenCalledWith(expect.objectContaining({
      contentSource: 'both', seenCount: 2, questionCount: 5,
      seenPicked: [PICK(CHAPTER_1.exercises[0]), PICK(CHAPTER_1.exercises[1])],
    }));
  });
});

describe('Urdu words', () => {
  it('every new label has its Urdu', () => {
    expect(U.pickFromBook).toBe('کتاب سے منتخب کریں');
    expect(U.fromBookPicked(3)).toContain('3');
    expect(U.clearPicks).toBeTruthy();
    expect(U.noBookQuestions).toBeTruthy();
    expect(U.bookQuestionsTitle).toBeTruthy();
  });
});
