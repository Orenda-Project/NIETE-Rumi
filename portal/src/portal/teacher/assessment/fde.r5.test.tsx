import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import i18n from 'i18next';
import summaries from './fixtures/fde-summaries.json';

/**
 * The FDE board pattern's screens when the options read is slow, refused or gone, and the parts of Check and Ready the
 * first build left out: the Cover step with board-pattern picks and no offer, the door's tap while its read is in flight
 * or failed, Check's failed read (not "the pattern is off"), the Syllabus tray's "Chapters or pages" card shown picked
 * once the teacher customises, and Ready's "You add" row with the page it goes on. Same mocked API as fde.pages.test.tsx.
 */

const { portal, config, flag } = vi.hoisted(() => ({
  portal: {
    getAssessmentOptions: vi.fn(),
    getAssessmentChapters: vi.fn(),
    generateAssessment: vi.fn(),
    getAssessmentStatus: vi.fn(),
    getAssessmentPapers: vi.fn(),
    getAssessmentDownload: vi.fn(),
    getAssessmentVersions: vi.fn(),
    getAssessmentPaperView: vi.fn(),
    takeGenerateFailure: vi.fn(() => null),
  },
  config: { features: { assessmentGenerator: true, assessmentEditing: true } },
  flag: { on: true },
}));
vi.mock('../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() }, portal }));
vi.mock('../../lib/useNewUi', () => ({ readConfigShared: () => Promise.resolve(config) }));
vi.mock('../../lib/gradeSubjects', () => ({ loadGradeSubjects: () => Promise.resolve([]) }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { phoneNumber: 'fde-teacher' }, loading: false }) }));
vi.mock('../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { ASSESSMENT_V2_COPY as C, ASSESSMENT_V2_COPY_UR as UR } from './copy';
import { forgetCatalogue } from './api';
import { forgetPapers } from './paperCache';
import { clearPicksForTest, setPicks, usePicks } from './store';
import { newPicks, type Picks } from './model';
import { CheckStep, ClassStep, CoverStep, QuestionsStep } from './NewPaperSteps';
import { RequestPage } from './RequestPage';
import { ASSESSMENT_V2_BASE as B, newPaperPath, requestPath } from './paths';
import { failureLabel } from './failure';
import { isolateRuns } from '../ui/bidi';

const plain = (t: string | null | undefined) => (t || '').replace(/[\u2066-\u2069]/g, '');
const storedPicks = () => JSON.parse(sessionStorage.getItem('teacher-v2-assessment-new:v1') || '{}');

type Summary = (typeof summaries)['maths'];
const S = summaries as unknown as Record<string, Summary | null>;
const G5 = ['maths', 'science', 'english', 'urdu', 'social_studies', 'islamiat'];
const NAMES: Record<string, string> = {
  maths: 'Maths', science: 'Science', english: 'English', urdu: 'Urdu', social_studies: 'Social Studies', islamiat: 'Islamiat',
};

function Where() {
  const loc = useLocation();
  const [p] = usePicks();
  return <p data-testid="where">{JSON.stringify({ path: loc.pathname, grade: p.grade, subject: p.subject, style: p.style ?? null, pattern: p.pattern ?? null, coverBy: p.coverBy, patternIntent: p.patternIntent ?? null, chapters: p.chapters })}</p>;
}
const where = () => JSON.parse(screen.getByTestId('where').textContent || '{}');

/** The New paper's routes and the request page together, with the picks always visible. */
function app(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={newPaperPath('class')} element={<ClassStep />} />
        <Route path={newPaperPath('cover')} element={<CoverStep />} />
        <Route path={newPaperPath('questions')} element={<QuestionsStep />} />
        <Route path={newPaperPath('check')} element={<CheckStep />} />
        <Route path={`${B}/request/:requestId`} element={<RequestPage />} />
        <Route path="*" element={<p>elsewhere</p>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

const fdePicks = (over: Partial<Picks> = {}): Picks => ({
  ...newPicks(15), grade: 5, subject: 'maths', subjectName: 'Maths',
  coverBy: 'fde', style: 'fde', pattern: 'fde_g5_2027', patternIntent: 'fde_g5_2027', ...over,
});

type OptImpl = (grade?: number, subject?: string) => Promise<unknown>;
const top = () => ({ success: true, grades: [3, 5], maxQuestions: 50, defaultQuestions: 15, ...(flag.on ? { patternGrades: [5] } : {}) });
const defaultOptions: OptImpl = async (grade, subject) => {
  if (grade && subject) {
    const s = grade === 5 ? S[subject] : null;
    return { ...top(), types: [{ id: 'MCQs', category: 'objective' }], ...(flag.on && s ? { patterns: [s] } : {}) };
  }
  if (grade === 5) return { ...top(), subjects: G5.map((k) => ({ subject_key: k, subject: NAMES[k] })) };
  if (grade === 3) return { ...top(), subjects: [{ subject_key: 'science', subject: 'Science' }] };
  return top();
};

/** One class's options read held open (or refused) while every other read answers as usual. */
function holdOptionsFor(grade: number, subject: string) {
  let release: (v: unknown) => void = () => {};
  let refuse: (e: unknown) => void = () => {};
  const held = new Promise((res, rej) => { release = res; refuse = rej; });
  portal.getAssessmentOptions.mockImplementation((g?: number, s?: string) => (g === grade && s === subject ? held : defaultOptions(g, s)));
  return {
    release: () => act(async () => { release(await defaultOptions(grade, subject)); }),
    refuse: () => act(async () => { refuse(new Error('network')); await held.catch(() => {}); }),
  };
}

const FDE_PAPER = {
  paper_id: 'p-f', grade: 5, subject_key: 'social_studies', subject: 'Social Studies', chapter_number: null, question_count: 30,
  total_marks: 100, ready_at: new Date().toISOString(), has_answer_key: true, version: 1, pattern: 'fde_g5_2027',
  pages: { paper: 4, scheme: 3 },
};
const writingJob = (spec: Record<string, unknown>) => sessionStorage.setItem('assessment-jobs:v1:fde-teacher', JSON.stringify([{
  requestId: 'req-f', label: 'Social Studies', startedAt: Date.now(), status: 'writing', spec,
}]));

beforeEach(() => {
  vi.clearAllMocks();
  clearPicksForTest();
  forgetCatalogue();
  forgetPapers();
  sessionStorage.clear();
  flag.on = true;
  config.features = { assessmentGenerator: true, assessmentEditing: true };
  portal.getAssessmentOptions.mockImplementation(defaultOptions);
  portal.getAssessmentChapters.mockResolvedValue({ success: true, chapters: Array.from({ length: 12 }, (_, i) => ({
    chapter_number: i + 1, chapter_title: `Unit ${i + 1}`, page_start: i * 20 + 1, page_end: i * 20 + 19, page_count: 19,
  })) });
  portal.getAssessmentStatus.mockResolvedValue({ success: true, status: 'queued' });
  portal.getAssessmentPapers.mockResolvedValue({ success: true, papers: [], total: 0, page: 1, pageSize: 10 });
  portal.getAssessmentPaperView.mockResolvedValue({ success: true, paper: {}, sections: [] });
});

describe('Cover with board-pattern picks', () => {
  it('no pattern offered any more: today\'s Chapters step, the picks back to plain, Next off with today\'s reason', async () => {
    flag.on = false;
    // A customised board-pattern pick (units as chapters and their pages) leaves nothing behind on today's tabs.
    setPicks(fdePicks({ coverBy: 'pages', chapters: [1, 2], ranges: [[1, 24]] }));
    app(newPaperPath('cover'));
    await waitFor(() => expect(where()).toMatchObject({ style: null, pattern: null, coverBy: 'chapters', patternIntent: null, chapters: [] }));
    expect(storedPicks().ranges).toEqual([]);
    expect(screen.getByRole('tab', { name: C.chapters }).getAttribute('aria-selected')).toBe('true');
    expect(await screen.findAllByRole('checkbox')).toHaveLength(12);
    expect((await screen.findByTestId('button-reason')).textContent).toBe(C.why.chapters);
    expect(screen.queryByRole('link', { name: new RegExp(C.next) })).toBeNull();
  });

  it('while the offer loads: no Next to Questions, the wait reason; then the picked side door', async () => {
    const read = holdOptionsFor(5, 'maths');
    setPicks(fdePicks({ patternIntent: null }));
    app(newPaperPath('cover'));
    expect((await screen.findByTestId('button-reason')).textContent).toBe(C.why.wait);
    expect(screen.queryByRole('link', { name: new RegExp(C.next) })).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    await read.release();
    expect(await screen.findByText(C.chaptersOff)).toBeTruthy();
    expect(screen.getByRole('link', { name: new RegExp(C.next) }).getAttribute('href')).toBe(newPaperPath('check'));
  });

  it('a failed offer read keeps the board pattern and says so, with Try again', async () => {
    const read = holdOptionsFor(5, 'maths');
    setPicks(fdePicks({ patternIntent: null }));
    app(newPaperPath('cover'));
    await read.refuse();
    expect(await screen.findAllByText(C.loadFailed)).toHaveLength(2);
    expect(screen.getByTestId('button-reason').textContent).toBe(C.loadFailed);
    expect(where()).toMatchObject({ style: 'fde', pattern: 'fde_g5_2027', coverBy: 'fde' });
    expect(screen.queryByRole('link', { name: new RegExp(C.next) })).toBeNull();
    portal.getAssessmentOptions.mockImplementation(defaultOptions);
    fireEvent.click(screen.getByRole('button', { name: C.tryAgain }));
    expect(await screen.findByText(C.chaptersOff)).toBeTruthy();
  });

  it('golden: plain picks on Cover never wait for the offer', async () => {
    holdOptionsFor(5, 'maths');
    setPicks({ ...newPicks(15), grade: 5, subject: 'maths', subjectName: 'Maths' });
    app(newPaperPath('cover'));
    expect((await screen.findByTestId('button-reason')).textContent).toBe(C.why.chapters);
    expect(screen.getByRole('tab', { name: C.chapters }).getAttribute('aria-selected')).toBe('true');
  });
});

describe('the door\'s tap', () => {
  const tapMaths = async () => {
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(C.selectGradeSubject) }));
    fireEvent.click(await screen.findByRole('radio', { name: /^Grade 5/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Grade 5 · Maths/ }));
  };

  it('while the read is in flight it says so; a failed read stays on Class with Try again, never the plain Cover', async () => {
    const read = holdOptionsFor(5, 'maths');
    setPicks(fdePicks({ subject: null, subjectName: null }));
    app(newPaperPath('class'));
    await tapMaths();
    expect((await screen.findByTestId('fde-door-busy')).textContent).toBe(C.why.wait);
    await read.refuse();
    expect(await screen.findByText(C.loadFailed)).toBeTruthy();
    expect(where().path).toBe(newPaperPath('class'));
    expect(where().patternIntent).toBe('fde_g5_2027');
    portal.getAssessmentOptions.mockImplementation(defaultOptions);
    fireEvent.click(screen.getByRole('button', { name: C.tryAgain }));
    await waitFor(() => expect(where().path).toBe(newPaperPath('check')));
    expect(where()).toMatchObject({ subject: 'maths', style: 'fde', pattern: 'fde_g5_2027', coverBy: 'fde' });
  });
});

describe('the door\'s tap, twice or abandoned', () => {
  const open = async () => {
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(C.selectGradeSubject) }));
    fireEvent.click(await screen.findByRole('radio', { name: /^Grade 5/ }));
  };

  it('a second tap while the first read is out does nothing; the first subject goes on', async () => {
    const read = holdOptionsFor(5, 'maths');
    setPicks(fdePicks({ subject: null, subjectName: null }));
    app(newPaperPath('class'));
    await open();
    fireEvent.click(screen.getByRole('button', { name: /^Grade 5 · Maths/ }));
    await screen.findByTestId('fde-door-busy');
    await open();
    fireEvent.click(screen.getByRole('button', { name: /^Grade 5 · Science/ }));
    await act(async () => { await Promise.resolve(); });
    expect(where()).toMatchObject({ path: newPaperPath('class'), subject: null });
    await read.release();
    await waitFor(() => expect(where()).toMatchObject({ path: newPaperPath('check'), subject: 'maths' }));
  });

  it('a teacher who leaves Class while the read is out is not pulled forward when it answers', async () => {
    const read = holdOptionsFor(5, 'maths');
    setPicks(fdePicks({ subject: null, subjectName: null }));
    const page = app(newPaperPath('class'));
    await open();
    fireEvent.click(screen.getByRole('button', { name: /^Grade 5 · Maths/ }));
    await screen.findByTestId('fde-door-busy');
    page.unmount();
    await read.release();
    expect(storedPicks()).toMatchObject({ subject: null });
  });
});

describe('Check on the FDE path', () => {
  it('a failed options read is a load failure with Try again, not "the pattern is off"', async () => {
    const read = holdOptionsFor(5, 'maths');
    setPicks(fdePicks());
    app(newPaperPath('check'));
    await read.refuse();
    await waitFor(() => expect(screen.getByTestId('button-reason').textContent).toBe(C.loadFailed));
    expect(screen.queryByText(C.fdeFailures.PATTERN_OFF)).toBeNull();
    portal.getAssessmentOptions.mockImplementation(defaultOptions);
    fireEvent.click(screen.getByRole('button', { name: C.tryAgain }));
    expect(await screen.findByTestId('fde-row-syllabus')).toBeTruthy();
  });

  it('Syllabus tray: the "Chapters or pages" card is the picked one once the teacher customises', async () => {
    setPicks(fdePicks({ subject: 'science', subjectName: 'Science' }));
    app(newPaperPath('check'));
    fireEvent.click(await screen.findByTestId('fde-row-syllabus'));
    const tray = await screen.findByTestId('fde-syllabus-tray');
    const fdeCard = () => within(tray).getAllByRole('radio')[0];
    const ownCard = () => within(tray).getByRole('radio', { name: new RegExp(C.steps.cover) });
    expect(fdeCard().getAttribute('aria-checked')).toBe('true');
    expect(ownCard().getAttribute('aria-checked')).toBe('false');
    fireEvent.click(await within(tray).findByRole('checkbox', { name: /Unit 1$/ }));
    await waitFor(() => expect(ownCard().getAttribute('aria-checked')).toBe('true'));
    expect(fdeCard().getAttribute('aria-checked')).toBe('false');
  });
});

describe('Ready on a board-pattern paper', () => {
  const ready = () => {
    portal.getAssessmentStatus.mockResolvedValue({ success: true, status: 'ready', paperId: 'p-f' });
    portal.getAssessmentPapers.mockResolvedValue({ success: true, total: 1, page: 1, pageSize: 20, papers: [FDE_PAPER] });
  };

  it('a third row says what the teacher adds and the page it goes on', async () => {
    writingJob({ grade: 5, subject: 'social_studies', pattern: 'fde_g5_2027', scope: 'fde', questionCount: 0 });
    ready();
    portal.getAssessmentPaperView.mockResolvedValue({ success: true, sections: [], paper: {
      paperId: 'p-f', pattern: 'fde_g5_2027', pages: { paper: 4, scheme: 3 },
      youAdd: { en: 'the map of Pakistan', ur: 'پاکستان کا نقشہ', page: 2 },
    } });
    app(requestPath('req-f'));
    const row = await screen.findByTestId('fde-ready-youadd');
    expect(row.textContent).toBe(C.join(C.youAdd, 'the map of Pakistan', C.onPage(2)));
    expect(portal.getAssessmentPaperView).toHaveBeenCalledWith('p-f');
  });

  it('no page known: the row without the page; nothing to add: no row', async () => {
    writingJob({ grade: 5, subject: 'social_studies', pattern: 'fde_g5_2027', scope: 'fde', questionCount: 0 });
    ready();
    portal.getAssessmentPaperView.mockResolvedValue({ success: true, sections: [], paper: {
      paperId: 'p-f', pattern: 'fde_g5_2027', youAdd: { en: 'the map of Pakistan', ur: 'پاکستان کا نقشہ', page: null },
    } });
    const first = app(requestPath('req-f'));
    expect((await screen.findByTestId('fde-ready-youadd')).textContent).toBe(C.join(C.youAdd, 'the map of Pakistan'));
    first.unmount();
    forgetPapers();
    portal.getAssessmentPaperView.mockResolvedValue({ success: true, sections: [], paper: { paperId: 'p-f', pattern: 'fde_g5_2027', youAdd: null } });
    app(requestPath('req-f'));
    expect(await screen.findByTestId('fde-ready-scheme')).toBeTruthy();
    await waitFor(() => expect(portal.getAssessmentPaperView).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('fde-ready-youadd')).toBeNull();
  });

  it('in Urdu: the row is Urdu; an empty Urdu line falls back to the English one', async () => {
    if (!i18n.isInitialized) await i18n.init({ lng: 'en', resources: {} });
    await act(async () => { await i18n.changeLanguage('ur'); });
    try {
      writingJob({ grade: 5, subject: 'social_studies', pattern: 'fde_g5_2027', scope: 'fde', questionCount: 0 });
      ready();
      portal.getAssessmentPaperView.mockResolvedValue({ success: true, sections: [], paper: {
        paperId: 'p-f', pattern: 'fde_g5_2027', youAdd: { en: 'the map of Pakistan', ur: 'پاکستان کا نقشہ', page: 2 },
      } });
      const first = app(requestPath('req-f'));
      expect(plain((await screen.findByTestId('fde-ready-youadd')).textContent)).toBe(plain(UR.join(UR.youAdd, 'پاکستان کا نقشہ', UR.onPage(2))));
      first.unmount();
      forgetPapers();
      portal.getAssessmentPaperView.mockResolvedValue({ success: true, sections: [], paper: {
        paperId: 'p-f', pattern: 'fde_g5_2027', youAdd: { en: 'the map of Pakistan', ur: '', page: 2 },
      } });
      app(requestPath('req-f'));
      const row = await screen.findByTestId('fde-ready-youadd');
      expect(row.textContent).toBe(UR.join(UR.youAdd, isolateRuns('the map of Pakistan'), UR.onPage(2)));
    } finally {
      await act(async () => { await i18n.changeLanguage('en'); });
    }
  });

  it('golden: a plain paper\'s Ready reads no paper view', async () => {
    writingJob({ grade: 5, subject: 'maths', questionCount: 10 });
    portal.getAssessmentStatus.mockResolvedValue({ success: true, status: 'ready', paperId: 'p-plain' });
    app(requestPath('req-f'));
    expect(await screen.findByText(C.answerKey)).toBeTruthy();
    expect(portal.getAssessmentPaperView).not.toHaveBeenCalled();
    expect(screen.queryByTestId('fde-ready-youadd')).toBeNull();
  });
});

describe('the plain Check and the request page (what QA and the red team found on sandbox)', () => {
  const plainPicks = () => setPicks({ ...newPicks(10), grade: 3, subject: 'science', subjectName: 'Science', chapters: [1] });

  it('a refused Make for the hour limit says so in the teacher\'s words, with the time, above the rows', async () => {
    plainPicks();
    portal.generateAssessment.mockRejectedValue({ response: { status: 429, data: {
      success: false, errorCode: 'RATE_LIMITED', retryAt: '2026-10-15T17:47:00.000Z',
      error: 'You have made 10 papers this hour. The next one can be made at 22:47.',
    } } });
    portal.takeGenerateFailure.mockReturnValueOnce({ errorCode: 'RATE_LIMITED', retryAt: '2026-10-15T17:47:00.000Z', requestId: null } as never);
    app(newPaperPath('check'));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(C.makePaper) }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(C.fdeFailures.RATE_LIMITED('10:47 PM'));
    const firstRow = screen.getByText(C.steps.class);
    expect(alert.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('golden: any other refusal on the plain Check keeps the server\'s message', async () => {
    plainPicks();
    portal.generateAssessment.mockRejectedValue({ response: { status: 400, data: { success: false, error: 'Chapter not found' } } });
    app(newPaperPath('check'));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(C.makePaper) }));
    expect((await screen.findByRole('alert')).textContent).toBe('Chapter not found');
  });

  it('Make before the chapter titles load: the job is named by the chapter number, not "Chapters"', async () => {
    setPicks({ ...newPicks(10), grade: 3, subject: 'science', subjectName: 'Science', chapters: [4, 2] });
    portal.getAssessmentChapters.mockImplementation(() => new Promise(() => {}));
    portal.generateAssessment.mockResolvedValue({ success: true, requestId: 'req-p' });
    app(newPaperPath('check'));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(C.makePaper) }));
    await waitFor(() => expect(where().path).toBe(requestPath('req-p')));
    const jobs = JSON.parse(sessionStorage.getItem('assessment-jobs:v1:fde-teacher') || '[]');
    expect(jobs[0].label).toBe(`${C.chapterShort(2)} +1`);
  });

  it('a board-pattern paper that came out short says "Came out wrong", in both languages', async () => {
    writingJob({ grade: 5, subject: 'maths', pattern: 'fde_g5_2027', scope: 'fde', questionCount: 0 });
    portal.getAssessmentStatus.mockResolvedValue({ success: true, status: 'failed', errorCode: 'PATTERN_SHORT_SLOT' });
    sessionStorage.setItem('assessment-jobs:v1:fde-teacher', JSON.stringify([{
      requestId: 'req-f', label: 'Maths', startedAt: Date.now(), status: 'failed', errorCode: 'PATTERN_SHORT_SLOT',
      spec: { grade: 5, subject: 'maths', pattern: 'fde_g5_2027', scope: 'fde', questionCount: 0 },
    }]));
    app(requestPath('req-f'));
    expect(await screen.findByText(C.failures.BAD_JSON)).toBeTruthy();
    expect(screen.queryByText(C.failureFallback)).toBeNull();
    expect(failureLabel('PATTERN_SHORT_SLOT', UR as never)).toBe(UR.failures.BAD_JSON);
  });
});

describe('words', () => {
  it('Urdu page count: one page is singular', () => {
    expect(UR.pagesCount(1)).toBe('1 صفحہ');
    expect(UR.pagesCount(4)).toBe('4 صفحات');
  });
});
