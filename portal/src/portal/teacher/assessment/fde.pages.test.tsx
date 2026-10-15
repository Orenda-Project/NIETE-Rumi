import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import summaries from './fixtures/fde-summaries.json';

/**
 * The FDE board pattern in the teacher app (the request carries `pattern` only when /assessment/options offers it):
 * the hub's door and its remembering state, the door path (Class → Check), the side door on today's Chapters step,
 * the one Check screen with its three trays, the server's refusals in the teacher's words, the wait, the two named
 * files on Ready, the paper page. Without `patterns` / `patternGrades` nothing new renders.
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
    getAssessmentPaperView: vi.fn(() => Promise.resolve({ success: true, paper: {}, sections: [] })),
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

import { ASSESSMENT_V2_COPY as C } from './copy';
import { forgetCatalogue } from './api';
import { forgetPapers } from './paperCache';
import { clearPicksForTest, setPicks, usePicks } from './store';
import { newPicks, type Picks } from './model';
import { AssessmentHub } from './AssessmentHub';
import { CheckStep, ClassStep, CoverStep } from './NewPaperSteps';
import { PaperPage } from './PaperPage';
import { RequestPage } from './RequestPage';
import { ASSESSMENT_V2_BASE as B, newPaperPath, paperPath, requestPath } from './paths';

type Summary = (typeof summaries)['maths'];
const S = summaries as unknown as Record<string, Summary | null>;
const G5 = ['maths', 'science', 'english', 'urdu', 'social_studies', 'islamiat'];
const NAMES: Record<string, string> = {
  maths: 'Maths', science: 'Science', english: 'English', urdu: 'Urdu', social_studies: 'Social Studies', islamiat: 'Islamiat',
};

function Where() {
  const loc = useLocation();
  const [p] = usePicks();
  return <p data-testid="where">{JSON.stringify({ path: loc.pathname, grade: p.grade, subject: p.subject, style: p.style, pattern: p.pattern, coverBy: p.coverBy, patternIntent: p.patternIntent, chapters: p.chapters })}</p>;
}
const where = () => JSON.parse(screen.getByTestId('where').textContent || '{}');

function at(path: string, routePath: string, el: JSX.Element) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={el} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const fdePicks = (over: Partial<Picks> = {}): Picks => ({
  ...newPicks(15), grade: 5, subject: 'maths', subjectName: 'Maths',
  coverBy: 'fde', style: 'fde', pattern: 'fde_g5_2027', patternIntent: 'fde_g5_2027', ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  clearPicksForTest();
  forgetCatalogue();
  forgetPapers();
  sessionStorage.clear();
  flag.on = true;
  config.features = { assessmentGenerator: true, assessmentEditing: true };
  portal.getAssessmentOptions.mockImplementation(async (grade?: number, subject?: string) => {
    const on = flag.on;
    const top = { success: true, grades: [3, 5], maxQuestions: 50, defaultQuestions: 15, ...(on ? { patternGrades: [5] } : {}) };
    if (grade && subject) {
      const s = grade === 5 ? S[subject] : null;
      return { ...top, types: [{ id: 'MCQs', category: 'objective' }], ...(on && s ? { patterns: [s] } : {}) };
    }
    if (grade === 5) return { ...top, subjects: G5.map((k) => ({ subject_key: k, subject: NAMES[k] })) };
    if (grade === 3) return { ...top, subjects: [{ subject_key: 'science', subject: 'Science' }] };
    return top;
  });
  portal.getAssessmentChapters.mockResolvedValue({ success: true, chapters: Array.from({ length: 12 }, (_, i) => ({
    chapter_number: i + 1, chapter_title: `Unit ${i + 1}`, page_start: i * 20 + 1, page_end: i * 20 + 19, page_count: 19,
  })) });
  portal.getAssessmentStatus.mockResolvedValue({ success: true, status: 'queued' });
  portal.getAssessmentPapers.mockResolvedValue({ success: true, papers: [], total: 0, page: 1, pageSize: 10 });
});

describe('hub', () => {
  it('hub shows the door only with patternGrades; the door sets the FDE picks and goes to Class', async () => {
    at(B, B, <AssessmentHub />);
    const door = await screen.findByTestId('fde-door');
    expect(door.textContent).toContain(C.fdeDoor);
    for (const chip of C.fdeDoorChips.split(' · ')) expect(door.textContent).toContain(chip);
    fireEvent.click(door);
    await waitFor(() => expect(where().path).toBe(newPaperPath('class')));
    expect(where()).toMatchObject({ grade: 5, style: 'fde', coverBy: 'fde' });
    expect(where().patternIntent).toBeTruthy();
  });

  it('no door with the flag off (no patternGrades): today\'s hub', async () => {
    flag.on = false;
    at(B, B, <AssessmentHub />);
    expect(await screen.findByText(C.newPaper)).toBeTruthy();
    await waitFor(() => expect(portal.getAssessmentOptions).toHaveBeenCalled());
    expect(screen.queryByTestId('fde-door')).toBeNull();
    expect(screen.queryByText(C.fdeDoor)).toBeNull();
  });

  it('remembering door goes to check with the last subject; FDE rows wear the FDE chip', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
    portal.getAssessmentPapers.mockResolvedValue({ success: true, total: 1, page: 1, pageSize: 10, papers: [{
      paper_id: 'p-f', grade: 5, subject_key: 'science', subject: 'Science', chapter_number: null, question_count: 30,
      total_marks: 100, ready_at: twoDaysAgo, has_answer_key: true, version: 1, pattern: 'fde_g5_2027', pages: { paper: 4, scheme: 3 },
    }] });
    at(B, B, <AssessmentHub />);
    const again = await screen.findByTestId('fde-door-again');
    expect(screen.getByTestId('fde-door').textContent).toContain(C.lastMade('Science', 2));
    expect(screen.getAllByText(C.fdeListChip).length).toBeGreaterThan(0);
    fireEvent.click(again);
    await waitFor(() => expect(where().path).toBe(newPaperPath('check')));
    expect(where()).toMatchObject({ grade: 5, subject: 'science', style: 'fde', pattern: 'fde_g5_2027', coverBy: 'fde' });
  });
});

describe('Class on the door path', () => {
  it('door → tap Maths → route is check with patternIntent, coverBy fde, style fde; the bar says Step 1 of 2', async () => {
    setPicks(fdePicks({ subject: null, subjectName: null }));
    at(newPaperPath('class'), newPaperPath('class'), <ClassStep />);
    expect(await screen.findByRole('progressbar', { name: C.step(1, 2) })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(C.selectGradeSubject) }));
    fireEvent.click(await screen.findByRole('radio', { name: /^Grade 5/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Grade 5 · Maths/ }));
    await waitFor(() => expect(where().path).toBe(newPaperPath('check')));
    expect(where()).toMatchObject({ grade: 5, subject: 'maths', style: 'fde', pattern: 'fde_g5_2027', patternIntent: 'fde_g5_2027', coverBy: 'fde' });
  });

  it('Islamiat on the door path: the note says after review, and the pick falls back to today\'s steps', async () => {
    setPicks(fdePicks({ subject: null, subjectName: null }));
    at(newPaperPath('class'), newPaperPath('class'), <ClassStep />);
    expect(await screen.findByText(C.islamiatHeld)).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(C.selectGradeSubject) }));
    fireEvent.click(await screen.findByRole('radio', { name: /^Grade 5/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Grade 5 · Islamiat/ }));
    await waitFor(() => expect(where().path).toBe(newPaperPath('cover')));
    expect(where()).toMatchObject({ subject: 'islamiat', style: null, pattern: null, coverBy: 'chapters' });
  });

  it('golden: a plain New paper\'s Class step shows no note and counts six steps', async () => {
    at(newPaperPath('class'), newPaperPath('class'), <ClassStep />);
    expect(await screen.findByRole('progressbar', { name: C.step(1, 6) })).toBeTruthy();
    expect(screen.queryByText(C.islamiatHeld)).toBeNull();
  });
});

describe('side door on the Chapters step', () => {
  it('side-door card only for grade 5 + eligible + patterns; picked → Next goes to Check with the bar at 2 of 2', async () => {
    setPicks({ ...newPicks(15), grade: 5, subject: 'maths', subjectName: 'Maths' });
    at(newPaperPath('cover'), newPaperPath('cover'), <CoverStep />);
    const card = await screen.findByTestId('fde-side-door');
    expect((await screen.findByTestId('button-reason')).textContent).toBe(C.why.scopeOrFde);
    fireEvent.click(within(card).getByRole('radio'));
    expect(await screen.findByText(C.chaptersOff)).toBeTruthy();
    expect(screen.getByText(C.skips4)).toBeTruthy();
    const next = await screen.findByRole('link', { name: new RegExp(C.next) });
    expect(next.getAttribute('href')).toBe(newPaperPath('check'));
    fireEvent.click(next);
    await waitFor(() => expect(where()).toMatchObject({ path: newPaperPath('check'), style: 'fde', pattern: 'fde_g5_2027', coverBy: 'fde' }));
  });

  it.each([
    ['Grade 3 Science, flag on', 3, 'science', true],
    ['Grade 5 Islamiat, flag on', 5, 'islamiat', true],
    ['Grade 5 Maths, flag off', 5, 'maths', false],
  ])('%s: no card, today\'s reason', async (_n, grade, subject, on) => {
    flag.on = on as boolean;
    setPicks({ ...newPicks(15), grade: grade as number, subject: subject as string, subjectName: NAMES[subject as string] ?? 'Science' });
    at(newPaperPath('cover'), newPaperPath('cover'), <CoverStep />);
    expect((await screen.findByTestId('button-reason')).textContent).toBe(C.why.chapters);
    await waitFor(() => expect(portal.getAssessmentOptions).toHaveBeenCalled());
    expect(screen.queryByTestId('fde-side-door')).toBeNull();
    expect(screen.getByRole('progressbar', { name: C.step(2, 6) })).toBeTruthy();
  });
});

describe('Check and make on the FDE path', () => {
  it('Check shows the four rows and sends pattern + scope', async () => {
    setPicks(fdePicks());
    portal.generateAssessment.mockResolvedValue({ success: true, requestId: 'req-f1' });
    at(newPaperPath('check'), newPaperPath('check'), <CheckStep />);
    expect(await screen.findByRole('progressbar', { name: C.step(2, 2) })).toBeTruthy();
    expect((await screen.findByTestId('fde-row-style')).textContent).toContain(S.maths!.name.en);
    expect(screen.getByTestId('fde-row-class').textContent).toContain('Grade 5 · Maths');
    expect(screen.getByTestId('fde-row-syllabus').textContent).toContain(S.maths!.scope.label.en);
    expect(screen.getByTestId('fde-row-syllabus').textContent).toContain(S.maths!.scope.en);
    expect(screen.getByTestId('fde-row-inside').textContent).toContain(S.maths!.holds.en);
    expect(screen.getByText(C.readyHint)).toBeTruthy();
    expect(screen.queryByTestId('fde-row-youadd')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(C.makePaper) }));
    await waitFor(() => expect(portal.generateAssessment).toHaveBeenCalled());
    expect(portal.generateAssessment.mock.calls[0][0]).toEqual({
      grade: 5, subject: 'maths', pattern: 'fde_g5_2027', scope: 'fde',
      questionCount: 0, contentSource: 'unseen', seenCount: null, questionTypes: [], answerLines: true, outputFormat: 'pdf',
    });
    await waitFor(() => expect(where().path).toBe(requestPath('req-f1')));
  });

  it('Science: the amber You add row', async () => {
    setPicks(fdePicks({ subject: 'science', subjectName: 'Science' }));
    at(newPaperPath('check'), newPaperPath('check'), <CheckStep />);
    expect((await screen.findByTestId('fde-row-youadd')).textContent).toContain(S.science!.youAdd!.en);
  });

  it('Inside tray lists the summary', async () => {
    setPicks(fdePicks());
    at(newPaperPath('check'), newPaperPath('check'), <CheckStep />);
    fireEvent.click(await screen.findByTestId('fde-row-inside'));
    const tray = await screen.findByTestId('fde-inside-tray');
    for (const s of S.maths!.sections) expect(tray.textContent).toContain(s.en);
    expect(tray.textContent).toContain(S.maths!.files.en);
    expect(tray.textContent).toContain(C.notOfficial);
  });

  it('style sheet → own paper sends chapters and no pattern', async () => {
    setPicks(fdePicks());
    at(newPaperPath('check'), newPaperPath('check'), <CheckStep />);
    fireEvent.click(await screen.findByTestId('fde-row-style'));
    const tray = await screen.findByTestId('fde-style-tray');
    fireEvent.click(within(tray).getByRole('radio', { name: new RegExp(C.styleOwn) }));
    expect(within(tray).getByText(C.ownNext)).toBeTruthy();
    fireEvent.click(within(tray).getByTestId('fde-style-next'));
    await waitFor(() => expect(where().path).toBe(newPaperPath('questions')));
    expect(where()).toMatchObject({ style: 'own', pattern: null, coverBy: 'chapters', chapters: S.maths!.scope.chapters });
  });

  it('syllabus sheet round-trips scope fde / unit ids / zero ticks', async () => {
    setPicks(fdePicks({ subject: 'science', subjectName: 'Science' }));
    portal.generateAssessment.mockResolvedValue({ success: true, requestId: 'req-f2' });
    at(newPaperPath('check'), newPaperPath('check'), <CheckStep />);
    fireEvent.click(await screen.findByTestId('fde-row-syllabus'));
    const tray = await screen.findByTestId('fde-syllabus-tray');
    // Untick unit 1: customised, the other FDE units stay.
    fireEvent.click(await within(tray).findByRole('checkbox', { name: /Unit 1$/ }));
    expect(where).toBeTruthy();
    const kept = S.science!.scope.chapters.filter((n) => n !== 1);
    fireEvent.click(within(tray).getByRole('button', { name: C.done }));
    expect((await screen.findByTestId('fde-row-syllabus')).textContent).toContain(C.customised);
    // Inside says how to get the full rehearsal back, and does it.
    fireEvent.click(screen.getByTestId('fde-row-inside'));
    const inside = await screen.findByTestId('fde-inside-tray');
    expect(inside.textContent).toContain(C.fullRehearsal);
    fireEvent.click(within(inside).getByRole('button', { name: C.useFdeSyllabus }));
    await waitFor(() => expect(screen.getByTestId('fde-row-syllabus').textContent).not.toContain(C.customised));
    // Customise again, then send: chapters, no scope.
    fireEvent.click(screen.getByTestId('fde-row-syllabus'));
    fireEvent.click(await within(await screen.findByTestId('fde-syllabus-tray')).findByRole('checkbox', { name: /Unit 1$/ }));
    fireEvent.click(within(screen.getByTestId('fde-syllabus-tray')).getByRole('button', { name: C.done }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(C.makePaper) }));
    await waitFor(() => expect(portal.generateAssessment).toHaveBeenCalled());
    expect(portal.generateAssessment.mock.calls[0][0]).toMatchObject({ pattern: 'fde_g5_2027', chapterNumbers: kept });
    expect(portal.generateAssessment.mock.calls[0][0]).not.toHaveProperty('scope');
  });

  it('zero ticks: Make is off with its reason', async () => {
    setPicks(fdePicks({ subject: 'english', subjectName: 'English', coverBy: 'chapters', chapters: [] }));
    at(newPaperPath('check'), newPaperPath('check'), <CheckStep />);
    await waitFor(() => expect(screen.getByTestId('button-reason').textContent).toBe(C.why.chapters));
  });

  it('Make disabled while a same-class job is generating', async () => {
    sessionStorage.setItem('assessment-jobs:v1:fde-teacher', JSON.stringify([{
      requestId: 'req-b', label: 'Maths', startedAt: Date.now(), status: 'writing',
      spec: { grade: 5, subject: 'maths', pattern: 'fde_g5_2027', scope: 'fde', questionCount: 0 },
    }]));
    setPicks(fdePicks());
    at(newPaperPath('check'), newPaperPath('check'), <CheckStep />);
    await waitFor(() => expect(screen.getByTestId('button-reason').textContent).toBe(C.why.generating));
    expect((screen.getByTestId('step-next') as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([
    ['PATTERN_OFF', 400, {}, () => C.fdeFailures.PATTERN_OFF],
    ['ALREADY_GENERATING', 409, { requestId: 'req-x' }, () => C.fdeFailures.ALREADY_GENERATING],
    ['RATE_LIMITED', 429, { retryAt: '2026-10-16T06:40:00Z' }, () => C.fdeFailures.RATE_LIMITED('11:40 AM')],
  ])('%s shows the bilingual message', async (code, status, extra, text) => {
    setPicks(fdePicks());
    const err = { response: { status, data: { success: false, error: 'server words', errorCode: code, ...extra } } };
    // The real parser services/api runs on the refusal (its own test drives it through the axios boundary).
    const { generateFailureOf } = await vi.importActual<typeof import('../../services/api')>('../../services/api');
    portal.generateAssessment.mockRejectedValue(err);
    portal.takeGenerateFailure.mockReturnValueOnce(generateFailureOf(err) as never);
    at(newPaperPath('check'), newPaperPath('check'), <CheckStep />);
    await screen.findByTestId('fde-row-inside');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(C.makePaper) }));
    expect(await screen.findByRole('alert')).toHaveTextContent(text());
  });

  it('flag turned off mid-journey: Check says so and offers an own paper, no dead Retry', async () => {
    flag.on = false;
    setPicks(fdePicks());
    at(newPaperPath('check'), newPaperPath('check'), <CheckStep />);
    expect(await screen.findByRole('alert')).toHaveTextContent(C.fdeFailures.PATTERN_OFF);
    fireEvent.click(screen.getByRole('button', { name: C.styleOwn }));
    await waitFor(() => expect(where()).toMatchObject({ path: newPaperPath('cover'), style: null, pattern: null, coverBy: 'chapters' }));
  });

  it('409: the error offers the paper already being made (its requestId)', async () => {
    setPicks(fdePicks());
    const err = { response: { status: 409, data: { success: false, error: 'busy', errorCode: 'ALREADY_GENERATING', requestId: 'req-x' } } };
    const { generateFailureOf } = await vi.importActual<typeof import('../../services/api')>('../../services/api');
    portal.generateAssessment.mockRejectedValue(err);
    portal.takeGenerateFailure.mockReturnValueOnce(generateFailureOf(err) as never);
    at(newPaperPath('check'), newPaperPath('check'), <CheckStep />);
    await screen.findByTestId('fde-row-inside');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(C.makePaper) }));
    const link = await screen.findByRole('link', { name: C.seePaperBeingMade });
    expect(link.getAttribute('href')).toBe(requestPath('req-x'));
  });

  it('golden: a plain Check is today\'s, with no FDE row', async () => {
    setPicks({ ...newPicks(15), grade: 5, subject: 'maths', subjectName: 'Maths', chapters: [1] });
    at(newPaperPath('check'), newPaperPath('check'), <CheckStep />);
    expect(await screen.findByRole('progressbar', { name: C.step(6, 6) })).toBeTruthy();
    expect(screen.queryByTestId('fde-row-style')).toBeNull();
    expect(screen.queryByText(C.readyHint)).toBeNull();
  });
});

describe('request page', () => {
  const job = (status: string) => sessionStorage.setItem('assessment-jobs:v1:fde-teacher', JSON.stringify([{
    requestId: 'req-f', label: 'Maths', startedAt: Date.now(), status,
    spec: { grade: 5, subject: 'maths', pattern: 'fde_g5_2027', scope: 'fde', questionCount: 0 },
  }]));

  it('request page says ~3 min and has no Make another', async () => {
    job('writing');
    at(requestPath('req-f'), `${B}/request/:requestId`, <RequestPage />);
    expect(await screen.findByText(C.aboutThreeMin)).toBeTruthy();
    expect(screen.getByText(C.waitHub)).toBeTruthy();
    expect(screen.getByText(C.waitPoll)).toBeTruthy();
    expect(screen.getByRole('link', { name: C.myPapers })).toBeTruthy();
    expect(screen.queryByRole('button', { name: C.makeAnother })).toBeNull();
  });

  it('ready names two files with page counts; no Edit on a board-pattern paper', async () => {
    job('writing');
    portal.getAssessmentStatus.mockResolvedValue({ success: true, status: 'ready', paperId: 'p-f' });
    portal.getAssessmentPapers.mockResolvedValue({ success: true, total: 1, page: 1, pageSize: 20, papers: [{
      paper_id: 'p-f', grade: 5, subject_key: 'maths', subject: 'Maths', chapter_number: null, question_count: 48, total_marks: 100,
      ready_at: new Date().toISOString(), has_answer_key: true, version: 1, pattern: 'fde_g5_2027', pages: { paper: 4, scheme: 3 },
    }] });
    at(requestPath('req-f'), `${B}/request/:requestId`, <RequestPage />);
    const paperRow = await screen.findByTestId('fde-ready-paper');
    expect(paperRow.textContent).toContain(C.questionPaper);
    expect(paperRow.textContent).toContain(C.pagesCount(4));
    expect(screen.getByTestId('fde-ready-scheme').textContent).toContain(C.markingScheme);
    expect(screen.getByTestId('fde-ready-scheme').textContent).toContain(C.pagesCount(3));
    expect(screen.getByText(C.withScheme)).toBeTruthy();
    expect(screen.queryByRole('link', { name: C.edit })).toBeNull();
    expect(screen.getByTestId('share-open')).toBeTruthy();
  });
});

describe('paper page', () => {
  it('paper page says Marking scheme and carries the FDE chip; no Edit on a board-pattern paper', async () => {
    portal.getAssessmentPapers.mockResolvedValue({ success: true, total: 1, page: 1, pageSize: 20, papers: [{
      paper_id: 'p-f', grade: 5, subject_key: 'maths', subject: 'Maths', chapter_number: null, question_count: 48, total_marks: 100,
      ready_at: new Date().toISOString(), has_answer_key: true, version: 1, pattern: 'fde_g5_2027', pages: { paper: 4, scheme: 3 },
    }] });
    at(paperPath('p-f'), `${B}/paper/:paperId`, <PaperPage />);
    expect(await screen.findByRole('button', { name: new RegExp(C.markingScheme) })).toBeTruthy();
    expect(screen.queryByRole('button', { name: new RegExp(C.answerKey) })).toBeNull();
    expect(screen.getByText(C.fdeChip)).toBeTruthy();
    expect(screen.queryByRole('link', { name: new RegExp(`^${C.edit}`) })).toBeNull();
  });
});
