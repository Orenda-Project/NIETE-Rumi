import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * Task 8 — the Topics step on screen. After Chapters, when exactly one chapter with topics is picked: Whole chapter
 * (goes straight on) or Select topics (nothing ticked; grouped headings for English/Urdu, a flat list for Maths and
 * Science; Tick all per heading). Otherwise the step is skipped and Questions follows Chapters as today.
 */

const { portal, config } = vi.hoisted(() => ({
  portal: {
    getAssessmentOptions: vi.fn(),
    getAssessmentChapters: vi.fn(),
    getAssessmentTopics: vi.fn(),
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
import { newPicks, toSpec, type Picks } from './model';
import routes from './routes';
import { newPaperPath } from './paths';

const t = (topicId: string, name: string, heading: string | null, headingOrder: number | null, sortOrder: number) => (
  { topicId, name, heading, headingOrder, sortOrder });
const ENGLISH = [
  t('e1', 'Meet Pinky', 'Reading', 2, 1),
  t('e2', 'Key Words', 'Vocabulary & grammar', 3, 2),
  t('e3', 'Rhyming Words', 'Vocabulary & grammar', 3, 3),
  t('e4', 'Introducing Myself', 'Writing', 5, 4),
];
const URDU = [t('u1', 'حروفِ تہجی', 'قواعد', 2, 1), t('u2', 'کہانی', 'تفہیم', 4, 2)];
const MATHS = [t('m1', 'How many more?', null, null, 1), t('m2', 'Word problems', null, null, 2)];

const TYPES = [
  { id: 'MCQs', category: 'objective' }, { id: 'Fill in the Blanks', category: 'objective' },
  { id: 'Rewrite Sentences', category: 'objective' }, { id: 'Match the Column', category: 'objective' },
  { id: 'Comprehension Passage', category: 'subjective' }, { id: 'Simple Writing', category: 'subjective' },
  { id: 'Short Questions', category: 'subjective' }, { id: 'Word Problems', category: 'subjective' },
];

function now(): Picks {
  let seen: Picks | null = null;
  setPicks((p) => { seen = p; return {}; });
  return seen as unknown as Picks;
}

function go(step: string, query = '') {
  return render(
    <MemoryRouter initialEntries={[newPaperPath(step as Parameters<typeof newPaperPath>[0]) + query]}>
      <Routes>{routes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}</Routes>
    </MemoryRouter>,
  );
}
const start = (over: Partial<Picks>) => setPicks({ ...newPicks(15), grade: 1, subject: 'english', subjectName: 'English', chapters: [1], ...over });
const onStep = (s: string) => screen.findByTestId(`assessment-step-${s}`);
const next = () => screen.getByTestId('step-next');

beforeEach(() => {
  vi.clearAllMocks();
  clearPicksForTest();
  forgetCatalogue();
  sessionStorage.clear();
  portal.getAssessmentOptions.mockImplementation(async (grade?: number, subject?: string) => (
    grade && subject
      ? { success: true, grades: [1], maxQuestions: 50, defaultQuestions: 15, types: TYPES }
      : { success: true, grades: [1], maxQuestions: 50, defaultQuestions: 15, subjects: [] }));
  portal.getAssessmentChapters.mockResolvedValue({ success: true, chapters: [
    { chapter_number: 1, chapter_title: 'All About Me', page_start: 1, page_end: 20, page_count: 20 },
    { chapter_number: 2, chapter_title: 'My Family', page_start: 21, page_end: 40, page_count: 20 },
  ] });
  portal.getAssessmentTopics.mockImplementation(async (_g: number, subject: string) => ({
    success: true, topics: subject === 'urdu' ? URDU : subject === 'maths' ? MATHS : ENGLISH,
  }));
});

describe('when the step shows', () => {
  it('one chapter picked: Next on Chapters goes to Topics, 3 of 5', async () => {
    start({});
    go('cover');
    await onStep('cover');
    await waitFor(() => expect(next().getAttribute('href')).toBe(newPaperPath('topics')));
    expect(screen.getByRole('progressbar', { name: C.step(2, 5) })).toBeTruthy();
    fireEvent.click(next());
    await onStep('topics');
    expect(screen.getByRole('progressbar', { name: C.step(3, 5) })).toBeTruthy();
  });

  it('two chapters: Chapters goes straight to Questions, and the bar still reads of 4', async () => {
    start({ chapters: [1, 2] });
    go('cover');
    await onStep('cover');
    await waitFor(() => expect(next().getAttribute('href')).toBe(newPaperPath('questions')));
    expect(screen.getByRole('progressbar', { name: C.step(2, 4) })).toBeTruthy();
  });

  it('a chapter with no topics loaded: the step steps aside to Questions', async () => {
    portal.getAssessmentTopics.mockResolvedValue({ success: true, topics: [] });
    start({});
    go('topics');
    await onStep('questions');
    expect(now()).toMatchObject({ topicScope: null, topicIds: null });
  });

  it('topics cannot be loaded: the step steps aside to Questions, and the paper is the plain chapter paper', async () => {
    portal.getAssessmentTopics.mockRejectedValue(new Error('500'));
    start({ topicScope: 'topics', topicIds: [], typesSeeded: true, typeCounts: { MCQs: 2 } });
    go('topics');
    await onStep('questions');
    await waitFor(() => expect(now()).toMatchObject({ topicScope: null, topicIds: null }));
    expect(toSpec(now())).not.toHaveProperty('topicIds');
  });

  it('question types cannot be loaded: the same, straight on to Questions', async () => {
    portal.getAssessmentOptions.mockImplementation(async (grade?: number, subject?: string) => {
      if (grade && subject) throw new Error('500');
      return { success: true, grades: [1], maxQuestions: 50, defaultQuestions: 15, subjects: [] };
    });
    start({});
    go('topics');
    await onStep('questions');
    expect(now()).toMatchObject({ topicScope: null, topicIds: null });
    expect(toSpec(now())).not.toHaveProperty('topicIds');
  });

  it('pages, not chapters: an old link to Topics lands on Questions', async () => {
    start({ coverBy: 'pages', chapters: [], ranges: [[1, 4]] });
    go('topics');
    await onStep('questions');
    expect(portal.getAssessmentTopics).not.toHaveBeenCalled();
  });
});

describe('the two choices', () => {
  it('opens on Whole chapter / Select topics, no list yet, and Next says why', async () => {
    start({});
    go('topics');
    await onStep('topics');
    const radios = await screen.findAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual([expect.stringContaining(C.wholeChapter), expect.stringContaining(C.chooseTopics)]);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getByText(C.why.topicScope)).toBeTruthy();
  });

  it('Whole chapter goes straight on to Questions with topicIds null', async () => {
    start({});
    go('topics');
    fireEvent.click(await screen.findByRole('radio', { name: new RegExp(C.wholeChapter) }));
    await onStep('questions');
    expect(now()).toMatchObject({ topicScope: 'chapter', topicIds: null });
    expect(screen.getByRole('progressbar', { name: C.step(4, 5) })).toBeTruthy();
  });

  it('Select topics: the list with nothing ticked, and Next waits for one', async () => {
    start({});
    go('topics');
    fireEvent.click(await screen.findByRole('radio', { name: new RegExp(C.chooseTopics) }));
    const boxes = await screen.findAllByRole('checkbox');
    expect(boxes).toHaveLength(4);
    expect(boxes.every((b) => b.getAttribute('aria-checked') === 'false')).toBe(true);
    expect(screen.getByText(C.why.topics)).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: /Key Words/ }));
    await waitFor(() => expect(screen.queryByText(C.why.topics)).toBeNull());
    expect(now()).toMatchObject({ topicIds: ['e2'], marks: 10 });
    expect(Object.keys(now().typeCounts)).toEqual(['MCQs', 'Fill in the Blanks', 'Rewrite Sentences', 'Match the Column']);
  });
});

describe('the list', () => {
  it('English: grouped under its headings, in teacher words; Tick all ticks one heading only', async () => {
    start({});
    go('topics');
    fireEvent.click(await screen.findByRole('radio', { name: new RegExp(C.chooseTopics) }));
    const grammar = await screen.findByRole('region', { name: 'Vocabulary & grammar' });
    expect(screen.getByRole('region', { name: 'Reading' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Writing' })).toBeTruthy();
    fireEvent.click(within(grammar).getByRole('button', { name: C.tickAll }));
    await waitFor(() => expect(now().topicIds).toEqual(['e2', 'e3']));
    expect(within(grammar).getByRole('button', { name: C.untickAll })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /Meet Pinky/ }).getAttribute('aria-checked')).toBe('false');
    fireEvent.click(within(grammar).getByRole('button', { name: C.untickAll }));
    await waitFor(() => expect(now().topicIds).toEqual([]));
  });

  it('every topic ticked is the whole chapter: topicIds null, the request unchanged', async () => {
    start({});
    go('topics');
    fireEvent.click(await screen.findByRole('radio', { name: new RegExp(C.chooseTopics) }));
    for (const b of await screen.findAllByRole('checkbox')) fireEvent.click(b);
    await waitFor(() => expect(now()).toMatchObject({ topicScope: 'topics', topicIds: null, marks: null, typesSeeded: false }));
    expect(screen.getAllByRole('checkbox').every((b) => b.getAttribute('aria-checked') === 'true')).toBe(true);
  });

  it('Maths: one flat list, no headings', async () => {
    start({ subject: 'maths', subjectName: 'Maths' });
    go('topics');
    fireEvent.click(await screen.findByRole('radio', { name: new RegExp(C.chooseTopics) }));
    expect(await screen.findAllByRole('checkbox')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: C.tickAll })).toBeNull();
  });

  it('Urdu: the list reads right to left, under its Urdu headings', async () => {
    start({ subject: 'urdu', subjectName: 'Urdu' });
    go('topics');
    fireEvent.click(await screen.findByRole('radio', { name: new RegExp(C.chooseTopics) }));
    const q = await screen.findByRole('region', { name: 'قواعد' });
    expect(q.closest('[dir="rtl"]')).toBeTruthy();
    expect(q.closest('[lang="ur"]')).toBeTruthy();
  });
});

describe('around it', () => {
  it('Questions after Topics reads 4 of 5', async () => {
    start({ topicScope: 'topics', topicIds: ['e2'], typesSeeded: true, typeCounts: { MCQs: 2 }, seen: 0, marks: 10 });
    go('questions');
    await onStep('questions');
    expect(screen.getByRole('progressbar', { name: C.step(4, 5) })).toBeTruthy();
  });

  it('Check shows a Topics row (how many ticked) and reads 5 of 5', async () => {
    portal.getAssessmentPapers.mockResolvedValue({ success: true, papers: [] });
    start({ topicScope: 'topics', topicIds: ['e2'], typesSeeded: true, typeCounts: { MCQs: 2 }, seen: 0, marks: 10 });
    go('check');
    await onStep('check');
    expect(screen.getByRole('progressbar', { name: C.step(5, 5) })).toBeTruthy();
    expect(screen.getByText(C.steps.topics)).toBeTruthy();
    expect(screen.getByText(C.picked(1))).toBeTruthy();
  });

  it('picking another chapter forgets the topics', async () => {
    start({ topicScope: 'topics', topicIds: ['e2'], marks: 10, seen: 0, typesSeeded: true, typeCounts: { MCQs: 2 } });
    go('cover');
    fireEvent.click(await screen.findByRole('checkbox', { name: /My Family/ }));
    await waitFor(() => expect(now()).toMatchObject({ chapters: [1, 2], topicScope: null, topicIds: null, marks: null }));
  });
});

describe('the WhatsApp door (?by=topics)', () => {
  it('Class remembers the door the link came through', async () => {
    go('class', '?by=topics');
    await waitFor(() => expect(now()).toMatchObject({ byTopics: true }));
  });

  it('Class without the door leaves it off', async () => {
    go('class');
    await onStep('class');
    expect(now().byTopics).toBeFalsy();
  });

  it('Topics opens on Select topics, nothing ticked, when she came through the door', async () => {
    start({ byTopics: true });
    go('topics');
    expect(await screen.findAllByRole('checkbox')).toHaveLength(4);
    expect(now()).toMatchObject({ topicScope: 'topics', topicIds: [] });
  });

  it('Topics without the door still asks Whole chapter or Select topics', async () => {
    start({});
    go('topics');
    await screen.findByRole('radio', { name: new RegExp(C.chooseTopics) });
    expect(now().topicScope).toBeNull();
  });
});
