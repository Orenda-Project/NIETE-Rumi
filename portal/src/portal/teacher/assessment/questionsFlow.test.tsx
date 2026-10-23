import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * New paper in four steps (Class, Chapters or pages, Questions, Check and make). Questions is one screen: the seen
 * (book) count, only the unseen types she chose with a count each, Add a type for the rest, and an optional total
 * marks. The paper's size is what those add up to: nothing has to match a number typed somewhere else.
 */

const { portal, config } = vi.hoisted(() => ({
  portal: {
    getAssessmentOptions: vi.fn(),
    getAssessmentChapters: vi.fn(),
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

import { ASSESSMENT_V2_COPY as C } from './copy';
import { forgetCatalogue } from './api';
import { clearPicksForTest, setPicks } from './store';
import { STEPS, defaultTypeCounts, newPicks, stepWhy, toSpec, type Picks } from './model';
import { CheckStep, QuestionsStep } from './NewPaperSteps';
import routes from './routes';
import { ASSESSMENT_V2_BASE, newPaperPath } from './paths';

function at(path: string, routePath: string, el: JSX.Element) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={el} />
        <Route path={newPaperPath('check')} element={<p data-testid="check-page" />} />
        <Route path={`${ASSESSMENT_V2_BASE}/request/:id`} element={<p data-testid="request-page" />} />
        <Route path="*" element={<p data-testid="elsewhere" />} />
      </Routes>
    </MemoryRouter>,
  );
}

const SCIENCE = { grade: 4, subject: 'science', subjectName: 'Science', chapters: [1] };
const picks = (over: Partial<Picks>): Picks => ({ ...newPicks(15), ...SCIENCE, ...over });
const box = async (name: string) => (await screen.findByRole('textbox', { name: C.typeCount(name) })) as HTMLInputElement;
const marksBox = async () => (await screen.findByRole('textbox', { name: C.totalMarks })) as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  clearPicksForTest();
  forgetCatalogue();
  sessionStorage.clear();
  portal.getAssessmentOptions.mockImplementation(async (grade?: number, subject?: string) => {
    if (grade && subject) {
      return { success: true, grades: [4], maxQuestions: 50, defaultQuestions: 15, types: [
        { id: 'MCQs', category: 'objective' }, { id: 'True/False', category: 'objective' },
        { id: 'Fill in the Blanks', category: 'objective' }, { id: 'Brief Answers', category: 'subjective' },
      ] };
    }
    if (grade) return { success: true, grades: [4], maxQuestions: 50, defaultQuestions: 15, subjects: [{ subject_key: 'science', subject: 'Science' }] };
    return { success: true, grades: [4], maxQuestions: 50, defaultQuestions: 15 };
  });
  portal.getAssessmentChapters.mockResolvedValue({ success: true, chapters: [
    { chapter_number: 1, chapter_title: 'Green Guardians of Earth', page_start: 1, page_end: 28, page_count: 28 },
  ] });
  portal.getAssessmentStatus.mockResolvedValue({ success: true, status: 'queued' });
});

describe('the model', () => {
  it('has four steps: Class, Chapters or pages, Questions, Check and make', () => {
    expect([...STEPS]).toEqual(['class', 'cover', 'questions', 'check']);
  });

  it('sends the paper as the seen count plus the chosen types', () => {
    const base = picks({ typesSeeded: true });
    expect(toSpec({ ...base, seen: 5, typeCounts: { MCQs: 4, 'True/False': 3, 'Fill in the Blanks': 3 }, marks: 30 })).toMatchObject({
      questionCount: 15, contentSource: 'both', seenCount: 5,
      questionTypes: [{ id: 'MCQs', count: 4 }, { id: 'True/False', count: 3 }, { id: 'Fill in the Blanks', count: 3 }],
      totalMarks: 30,
    });
    expect(toSpec({ ...base, seen: 0, typeCounts: { MCQs: 6, 'Brief Answers': 0 } })).toMatchObject({
      questionCount: 6, contentSource: 'unseen', seenCount: null, questionTypes: [{ id: 'MCQs', count: 6 }],
    });
    expect(toSpec({ ...base, seen: 8, typeCounts: {} })).toMatchObject({
      questionCount: 8, contentSource: 'seen', seenCount: null, questionTypes: [],
    });
  });

  it('says why Questions cannot go on: nothing, past the cap, too many types, marks out of range or under the count', () => {
    const base = picks({ typesSeeded: true, seen: 5, typeCounts: { MCQs: 4 } });
    expect(stepWhy('questions', base, 50)).toBeNull();
    expect(stepWhy('questions', { ...base, seen: 0, typeCounts: {} }, 50)).toEqual({ code: 'none' });
    expect(stepWhy('questions', { ...base, seen: 45, typeCounts: { MCQs: 10 } }, 50)).toEqual({ code: 'count', max: 50 });
    const nine = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`T${i}`, 1]));
    expect(stepWhy('questions', { ...base, typeCounts: nine }, 50)).toEqual({ code: 'typesMax', max: 8 });
    expect(stepWhy('questions', { ...base, marks: 5 }, 50)).toEqual({ code: 'marksLow', total: 9 });
    expect(stepWhy('questions', { ...base, marks: 1500 }, 50)).toEqual({ code: 'marks', max: 1000 });
    expect(stepWhy('questions', { ...base, marks: 9 }, 50)).toBeNull();
  });

  it('fills a first visit with the default mix: the objective kinds a teacher marks fastest, the rest to the first', () => {
    const offered = [
      { id: 'MCQs', category: 'objective' as const }, { id: 'MSQs', category: 'objective' as const },
      { id: 'True/False', category: 'objective' as const }, { id: 'Fill in the Blanks', category: 'objective' as const },
      { id: 'Brief Answers', category: 'subjective' as const },
    ];
    expect(defaultTypeCounts(offered, 10)).toEqual({ MCQs: 4, 'True/False': 3, 'Fill in the Blanks': 3 });
    expect(defaultTypeCounts(offered.filter((t) => t.id !== 'Fill in the Blanks'), 10)).toEqual({ MCQs: 5, 'True/False': 5 });
    expect(defaultTypeCounts([{ id: 'Word Problems', category: 'subjective' }], 4)).toEqual({ 'Word Problems': 4 });
  });
});

describe('Questions', () => {
  it('asks for the number of questions: a seen row, only her chosen types, the total', async () => {
    setPicks(picks({ typesSeeded: true, seen: 5, typeCounts: { MCQs: 4, 'True/False': 3 } }));
    at(newPaperPath('questions'), newPaperPath('questions'), <QuestionsStep />);
    expect(await screen.findByRole('heading', { name: C.askCount })).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: C.step(3, 4) })).toBeTruthy();
    expect((await box(C.seenQuestions)).value).toBe('5');
    expect((await box('MCQs')).value).toBe('4');
    expect((await box('True/False')).value).toBe('3');
    expect(screen.queryByRole('textbox', { name: C.typeCount('Brief Answers') })).toBeNull();
    expect(screen.getByTestId('questions-total').textContent).toContain(C.questionsCount(12));
  });

  it('a first visit starts with 5 seen and 10 unseen in the default mix', async () => {
    setPicks(picks({}));
    at(newPaperPath('questions'), newPaperPath('questions'), <QuestionsStep />);
    expect((await box('MCQs')).value).toBe('4');
    expect((await box('True/False')).value).toBe('3');
    expect((await box('Fill in the Blanks')).value).toBe('3');
    expect((await box(C.seenQuestions)).value).toBe('5');
  });

  it('Add a type opens the list; a tick adds the type at 1, an untick takes it off', async () => {
    setPicks(picks({ typesSeeded: true, seen: 5, typeCounts: { MCQs: 4 } }));
    at(newPaperPath('questions'), newPaperPath('questions'), <QuestionsStep />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(C.addType) }));
    const list = await screen.findByTestId('types-tray');
    expect(within(list).getByText(C.objective)).toBeTruthy();
    expect(within(list).getByText(C.written)).toBeTruthy();
    expect(within(list).getByRole('checkbox', { name: 'MCQs' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(list).getByRole('checkbox', { name: 'Brief Answers' }));
    expect((await box('Brief Answers')).value).toBe('1');
    fireEvent.click(within(list).getByRole('checkbox', { name: 'MCQs' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: C.typeCount('MCQs') })).toBeNull());
  });

  it('at 1 the minus is a bin: one more tap takes the type off the page', async () => {
    setPicks(picks({ typesSeeded: true, seen: 5, typeCounts: { MCQs: 4, 'True/False': 2 } }));
    at(newPaperPath('questions'), newPaperPath('questions'), <QuestionsStep />);
    fireEvent.click(await screen.findByRole('button', { name: C.fewerOf('True/False') }));
    expect((await box('True/False')).value).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: C.removeType('True/False') }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: C.typeCount('True/False') })).toBeNull());
  });

  it('every number can be typed; Next says why it is off', async () => {
    setPicks(picks({ typesSeeded: true, seen: 5, typeCounts: { MCQs: 4 } }));
    at(newPaperPath('questions'), newPaperPath('questions'), <QuestionsStep />);
    fireEvent.change(await box('MCQs'), { target: { value: '60' } });
    expect((await screen.findByTestId('button-reason')).textContent).toBe(C.why.count(50));
    fireEvent.change(await box('MCQs'), { target: { value: '7' } });
    fireEvent.change(await marksBox(), { target: { value: '5' } });
    expect((await screen.findByTestId('button-reason')).textContent).toBe(C.why.marksLow(12));
    fireEvent.change(await marksBox(), { target: { value: '24' } });
    await waitFor(() => expect(screen.getByRole('link', { name: new RegExp(C.next) })).toBeTruthy());
    expect(screen.getByTestId('questions-total').textContent).toContain(C.marksCount(24));
  });
});

describe('Check and make', () => {
  it('one Questions row, Total marks, an Answer lines switch, and no File row; sends what she chose', async () => {
    setPicks(picks({ typesSeeded: true, seen: 5, typeCounts: { MCQs: 6, 'Brief Answers': 4 }, marks: 40 }));
    portal.generateAssessment.mockResolvedValue({ success: true, requestId: 'req-9' });
    at(newPaperPath('check'), newPaperPath('check'), <CheckStep />);
    expect(await screen.findByText(C.questionsCount(15))).toBeTruthy();
    expect(screen.getByText(C.join(C.seenShort(5), C.unseenShort(10)))).toBeTruthy();
    expect(screen.queryByText(C.file)).toBeNull();
    const lines = screen.getByRole('switch', { name: new RegExp(C.answerLines) });
    expect(lines.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(lines);
    expect(lines.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(C.makePaper) }));
    await waitFor(() => expect(screen.getByTestId('request-page')).toBeTruthy());
    expect(portal.generateAssessment).toHaveBeenCalledWith({
      grade: 4, subject: 'science', chapterNumbers: [1], pageRanges: null,
      questionCount: 15, contentSource: 'both', seenCount: 5,
      questionTypes: [{ id: 'MCQs', count: 6 }, { id: 'Brief Answers', count: 4 }],
      totalMarks: 40, answerLines: false, outputFormat: 'pdf',
    });
  });
});

describe('old links', () => {
  it.each(['types', 'extras'])('/new/%s lands on Questions', async (old) => {
    setPicks(picks({ typesSeeded: true, seen: 5, typeCounts: { MCQs: 4 } }));
    render(
      <MemoryRouter initialEntries={[`${ASSESSMENT_V2_BASE}/new/${old}`]}>
        <Routes>{routes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}</Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: C.askCount })).toBeTruthy();
  });
});
