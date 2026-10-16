import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import i18n from 'i18next';
import summaries from './fixtures/fde-summaries.json';

/**
 * The FDE board pattern, round 6 of the app: inside WhatsApp's browser on Android each Ready / paper-page file row hands
 * its OWN file to the phone's browser (the scheme is half the product); the FDE Ready drops the "With marking scheme"
 * chip (the rows name both files); the editor hides Marks on a board-pattern paper and says PATTERN_FIXED_MARKS in the
 * deck's words; the customised Syllabus row prints compressed unit ranges; the door holds Islamiat from first paint and
 * forgets itself when the switch is off; Versions never offers Edit on a row it could not read; the status read's
 * `pattern` gives a reopened browser the FDE wait; and a page brought back to the front asks for the status at once.
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
    getAssessmentEditQuestions: vi.fn(),
    getAssessmentAddKinds: vi.fn(),
    validateAssessmentEdit: vi.fn(),
    saveAssessmentVersion: vi.fn(),
    takeGenerateFailure: vi.fn(() => null),
  },
  config: { features: { assessmentGenerator: true, assessmentEditing: true } },
  flag: { on: true },
}));
vi.mock('../../services/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  portal,
  language: { get: vi.fn(() => new Promise(() => {})), set: vi.fn() },
}));
vi.mock('../../lib/useNewUi', () => ({ readConfigShared: () => Promise.resolve(config) }));
vi.mock('../../lib/gradeSubjects', () => ({ loadGradeSubjects: () => Promise.resolve([]) }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { phoneNumber: 'fde-teacher' }, loading: false }) }));
vi.mock('../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { ASSESSMENT_V2_COPY as C, ASSESSMENT_V2_COPY_UR as UR } from './copy';
import { forgetCatalogue } from './api';
import { forgetPapers } from './paperCache';
import { clearPicksForTest, setPicks, usePicks } from './store';
import { isPatternSpec, newPicks, questionsOf, type Picks } from './model';
import { CheckStep, ClassStep, CoverStep } from './NewPaperSteps';
import { RequestPage } from './RequestPage';
import { PaperPage } from './PaperPage';
import { VersionsPage } from './VersionsPage';
import { EditPaperPage, EditQuestionPage } from './EditPages';
import { ASSESSMENT_V2_BASE as B, editQuestionPath, newPaperPath, paperPath, requestPath, versionsPath } from './paths';

type Summary = (typeof summaries)['maths'];
const S = summaries as unknown as Record<string, Summary | null>;
const G5 = ['maths', 'science', 'english', 'urdu', 'social_studies', 'islamiat'];
const NAMES: Record<string, string> = {
  maths: 'Maths', science: 'Science', english: 'English', urdu: 'Urdu', social_studies: 'Social Studies', islamiat: 'Islamiat',
};

function Where() {
  const loc = useLocation();
  const [p] = usePicks();
  return <p data-testid="where">{JSON.stringify({ path: loc.pathname, style: p.style ?? null, pattern: p.pattern ?? null, coverBy: p.coverBy, patternIntent: p.patternIntent ?? null })}</p>;
}
const where = () => JSON.parse(screen.getByTestId('where').textContent || '{}');

function app(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={newPaperPath('class')} element={<ClassStep />} />
        <Route path={newPaperPath('cover')} element={<CoverStep />} />
        <Route path={newPaperPath('check')} element={<CheckStep />} />
        <Route path={`${B}/request/:requestId`} element={<RequestPage />} />
        <Route path={`${B}/paper/:paperId`} element={<PaperPage />} />
        <Route path={`${B}/paper/:paperId/versions`} element={<VersionsPage />} />
        <Route path={`${B}/paper/:paperId/edit`} element={<EditPaperPage />} />
        <Route path={`${B}/paper/:paperId/edit/q/:key`} element={<EditQuestionPage mode="edit" />} />
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

const FDE_PAPER = {
  paper_id: 'p-f', grade: 5, subject_key: 'social_studies', subject: 'Social Studies', chapter_number: null, question_count: 30,
  total_marks: 100, ready_at: new Date().toISOString(), has_answer_key: true, version: 1, pattern: 'fde_g5_2027',
  pages: { paper: 4, scheme: 3 },
};
const writingJob = (spec: Record<string, unknown>) => sessionStorage.setItem('assessment-jobs:v1:fde-teacher', JSON.stringify([{
  requestId: 'req-f', label: 'Social Studies', startedAt: Date.now(), status: 'writing', spec,
}]));

/* ── the browser: WhatsApp's on Android or iPhone, or a plain one ─────────── */

const UA = {
  waAndroid: 'Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36 WhatsApp/2.26.39.72',
  waIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/24.20.79',
};
const PAPER_URL = 'https://acc.r2.cloudflarestorage.com/papers/p-f/paper.pdf?X-Amz-Signature=a';
const SCHEME_URL = 'https://acc.r2.cloudflarestorage.com/papers/p-f/scheme.pdf?X-Amz-Signature=b';
const fromB64url = (f: string) => {
  const b = f.replace(/-/g, '+').replace(/_/g, '/');
  return new TextDecoder().decode(Uint8Array.from(atob(b + '==='.slice((b.length + 3) % 4)), (c) => c.charCodeAt(0)));
};
/** Where an intent:// hand-off sends the phone's browser (the file inside our open-file page's link). */
const handedTo = (to: string) => {
  const m = /^intent:\/\/portal\.niete\.edu\.pk\/open-file\.html\?f=([A-Za-z0-9_-]+)#Intent;scheme=https;end$/.exec(to);
  return m ? fromB64url(m[1]) : null;
};

const restore: Array<() => void> = [];
function useUA(ua: string) {
  const spy = vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(ua);
  restore.push(() => spy.mockRestore());
}
/** window.location with a recorded href setter (jsdom cannot navigate); the page's origin is the portal's. */
function stubLocation() {
  const assign = vi.fn();
  const real = Object.getOwnPropertyDescriptor(window, 'location');
  Object.defineProperty(window, 'location', { configurable: true, value: {
    get href() { return 'https://portal.niete.edu.pk/portal/teacher/assessment/request/req-f'; },
    set href(v: string) { assign(v); },
    origin: 'https://portal.niete.edu.pk',
  } });
  restore.push(() => { if (real) Object.defineProperty(window, 'location', real); });
  return assign;
}
/** Today's download: a hidden anchor clicked (openFile). Records each anchor's href. */
function spyAnchors() {
  const clicked: string[] = [];
  const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this.href); });
  restore.push(() => spy.mockRestore());
  return clicked;
}

async function inUrdu(fn: () => Promise<void>) {
  if (!i18n.isInitialized) await i18n.init({ lng: 'en', resources: {} });
  await act(async () => { await i18n.changeLanguage('ur'); });
  try { await fn(); } finally { await act(async () => { await i18n.changeLanguage('en'); }); }
}

beforeEach(async () => {
  vi.clearAllMocks();
  clearPicksForTest();
  forgetCatalogue();
  forgetPapers();
  sessionStorage.clear();
  localStorage.clear();
  flag.on = true;
  config.features = { assessmentGenerator: true, assessmentEditing: true };
  if (!i18n.isInitialized) await i18n.init({ lng: 'en', resources: {} });
  portal.getAssessmentOptions.mockImplementation(defaultOptions);
  portal.getAssessmentChapters.mockResolvedValue({ success: true, chapters: Array.from({ length: 12 }, (_, i) => ({
    chapter_number: i + 1, chapter_title: `Unit ${i + 1}`, page_start: i * 20 + 1, page_end: i * 20 + 19, page_count: 19,
  })) });
  portal.getAssessmentStatus.mockResolvedValue({ success: true, status: 'queued' });
  portal.getAssessmentPapers.mockResolvedValue({ success: true, papers: [], total: 0, page: 1, pageSize: 10 });
  portal.getAssessmentPaperView.mockResolvedValue({ success: true, paper: {}, sections: [] });
  portal.getAssessmentDownload.mockImplementation(async (_id: string, artifact: string) => ({
    success: true, available: true, url: artifact === 'answer_key' ? SCHEME_URL : PAPER_URL,
  }));
});
afterEach(() => { while (restore.length) restore.pop()!(); });

const fdeReady = () => {
  writingJob({ grade: 5, subject: 'social_studies', pattern: 'fde_g5_2027', scope: 'fde', questionCount: 0 });
  portal.getAssessmentStatus.mockResolvedValue({ success: true, status: 'ready', paperId: 'p-f' });
  portal.getAssessmentPapers.mockResolvedValue({ success: true, total: 1, page: 1, pageSize: 20, papers: [FDE_PAPER] });
};

/* ── R5-18: both files hand off inside WhatsApp's browser ────────────────── */

describe('Ready and the paper page inside WhatsApp\'s browser (R5-18)', () => {
  it('in WhatsApp, the scheme row hands off its own URL', async () => {
    useUA(UA.waAndroid);
    const assign = stubLocation();
    const anchors = spyAnchors();
    fdeReady();
    app(requestPath('req-f'));
    fireEvent.click(await screen.findByTestId('fde-ready-scheme'));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(portal.getAssessmentDownload).toHaveBeenCalledWith('p-f', 'answer_key');
    expect(handedTo(assign.mock.calls[0][0])).toBe(SCHEME_URL);
    fireEvent.click(screen.getByTestId('fde-ready-paper'));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(2));
    expect(handedTo(assign.mock.calls[1][0])).toBe(PAPER_URL);
    expect(anchors).toEqual([]);
  });

  it('outside WhatsApp, rows download as today', async () => {
    const assign = stubLocation();
    const anchors = spyAnchors();
    fdeReady();
    app(requestPath('req-f'));
    fireEvent.click(await screen.findByTestId('fde-ready-scheme'));
    await waitFor(() => expect(anchors).toEqual([SCHEME_URL]));
    expect(assign).not.toHaveBeenCalled();
  });

  it('iPhone WhatsApp (no intent:// there): rows download as today', async () => {
    useUA(UA.waIphone);
    const assign = stubLocation();
    const anchors = spyAnchors();
    fdeReady();
    app(requestPath('req-f'));
    fireEvent.click(await screen.findByTestId('fde-ready-scheme'));
    await waitFor(() => expect(anchors).toEqual([SCHEME_URL]));
    expect(assign).not.toHaveBeenCalled();
  });

  it('a file on a host the hand-off page does not forward to downloads as today', async () => {
    useUA(UA.waAndroid);
    const assign = stubLocation();
    const anchors = spyAnchors();
    portal.getAssessmentDownload.mockResolvedValue({ success: true, available: true, url: 'https://elsewhere.example/s.pdf' });
    fdeReady();
    app(requestPath('req-f'));
    fireEvent.click(await screen.findByTestId('fde-ready-scheme'));
    await waitFor(() => expect(anchors).toEqual(['https://elsewhere.example/s.pdf']));
    expect(assign).not.toHaveBeenCalled();
  });

  it('the paper page\'s key row does the same', async () => {
    useUA(UA.waAndroid);
    const assign = stubLocation();
    portal.getAssessmentPapers.mockResolvedValue({ success: true, total: 1, page: 1, pageSize: 20, papers: [FDE_PAPER] });
    app(paperPath('p-f'));
    fireEvent.click(await screen.findByRole('button', { name: C.markingScheme }));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(portal.getAssessmentDownload).toHaveBeenCalledWith('p-f', 'answer_key');
    expect(handedTo(assign.mock.calls[0][0])).toBe(SCHEME_URL);
    fireEvent.click(screen.getByRole('button', { name: C.join(C.download, C.questionPaper) }));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(2));
    expect(handedTo(assign.mock.calls[1][0])).toBe(PAPER_URL);
  });

  it('golden: a plain paper\'s page downloads its key as today, even inside WhatsApp', async () => {
    useUA(UA.waAndroid);
    const assign = stubLocation();
    const anchors = spyAnchors();
    portal.getAssessmentPapers.mockResolvedValue({ success: true, total: 1, page: 1, pageSize: 20, papers: [{ ...FDE_PAPER, pattern: null, pages: undefined }] });
    app(paperPath('p-f'));
    fireEvent.click(await screen.findByRole('button', { name: C.answerKey }));
    await waitFor(() => expect(anchors).toEqual([SCHEME_URL]));
    expect(assign).not.toHaveBeenCalled();
  });
});

/* ── R5-19: no marking-scheme chip on the FDE Ready ──────────────────────── */

describe('the FDE Ready\'s first view (R5-19)', () => {
  it('FDE Ready has no marking-scheme chip; the two rows name both files', async () => {
    fdeReady();
    app(requestPath('req-f'));
    expect((await screen.findByTestId('fde-ready-paper')).textContent).toContain(C.questionPaper);
    expect(screen.getByTestId('fde-ready-scheme').textContent).toContain(C.markingScheme);
    // the chip's words are retired from the deck with it (R5-19)
    expect(document.body.textContent).not.toContain('With marking scheme');
  });
});

/* ── R5-13: the editor hides Marks on a board-pattern paper ──────────────── */

const editItem = (id: string, number: number, slot: string | null, marks = 5) => ({
  id, number, removed: false, type: 'Short Answer', section: 'subjective', marks, text: `Question ${id}`,
  fields: { shape: 'standard', question: `Question ${id}`, marks, answer: '', show_lines: false, lines_options: [] },
  ...(slot ? { slot } : {}),
});
const editPaper = (pattern: string | null) => ({
  paper: {
    paperId: 'p-e', version: 1, grade: 5, subject: 'Mathematics', subjectKey: 'maths', chapterNumber: null, rtl: false,
    questionCount: 2, marks: 10, pattern,
  },
  items: [editItem('b1', 1, pattern ? 'maths.B.Q2' : null), editItem('b2', 2, pattern ? 'maths.B.Q2' : null)],
});
const fixedMarks = { response: { status: 400, data: { success: false, code: 'PATTERN_FIXED_MARKS', errorCode: 'EDIT_REJECTED', error: 'Board-pattern papers fix each question\'s marks.' } } };

describe('the editor on a board-pattern paper (R5-13)', () => {
  it('pattern paper editor shows no Marks field', async () => {
    portal.getAssessmentEditQuestions.mockResolvedValue(editPaper('fde_g5_2027'));
    app(editQuestionPath('p-e', 'b1'));
    expect(await screen.findByText('Question 1')).toBeTruthy();
    expect(screen.getByDisplayValue('Question b1')).toBeTruthy();
    expect(screen.queryByLabelText(C.marksLabel)).toBeNull();
  });

  it('golden: the plain editor keeps its Marks field', async () => {
    portal.getAssessmentEditQuestions.mockResolvedValue(editPaper(null));
    app(editQuestionPath('p-e', 'b1'));
    expect(((await screen.findByLabelText(C.marksLabel)) as HTMLInputElement).value).toBe('5');
  });

  it('PATTERN_FIXED_MARKS shows the deck\'s words in both languages', async () => {
    portal.getAssessmentEditQuestions.mockResolvedValue(editPaper('fde_g5_2027'));
    portal.validateAssessmentEdit.mockRejectedValue(fixedMarks);
    const en = app(editQuestionPath('p-e', 'b1'));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(C.done) }));
    expect((await screen.findByRole('alert')).textContent).toBe(C.patternFixedMarks);
    expect(C.patternFixedMarks).toBe('Board-pattern papers fix each question\'s marks.');
    en.unmount();
    await inUrdu(async () => {
      app(editQuestionPath('p-e', 'b1'));
      fireEvent.click(await screen.findByRole('button', { name: new RegExp(UR.done) }));
      expect((await screen.findByRole('alert')).textContent).toBe(UR.patternFixedMarks);
    });
    expect(UR.patternFixedMarks).toBe('FDE pattern کے پرچوں میں ہر سوال کے نمبر مقرر ہیں۔');
  });
});

/* ── R5-20 (a): the customised Syllabus row ──────────────────────────────── */

describe('the customised Syllabus row (R5-20 a)', () => {
  it('[1,2,3,4,6,7,8] prints Units 1–4, 6–8', () => {
    expect(C.unitsRange([8, 1, 2, 3, 4, 6, 7])).toBe('Units 1–4, 6–8');
    expect(C.unitsRange([3])).toBe('Unit 3');
    expect(C.unitsRange([2, 3, 9])).toBe('Units 2–3, 9');
    expect(C.unitsRange([])).toBe('');
  });

  it('UR uses ،', () => {
    expect(UR.unitsRange([1, 2, 3, 4, 6, 7, 8])).toBe('یونٹ 1–4، 6–8');
    expect(UR.join(UR.unitsRange([1, 2, 3, 4, 6, 7, 8]), UR.customised)).toBe('یونٹ 1–4، 6–8 · حسبِ ضرورت');
  });

  it('the Check row prints the ranges with the word', async () => {
    setPicks(fdePicks({ subject: 'english', subjectName: 'English', coverBy: 'chapters', chapters: [1, 2, 3, 4, 6, 7, 8] }));
    app(newPaperPath('check'));
    const row = await screen.findByTestId('fde-row-syllabus');
    await waitFor(() => expect(row.textContent).toContain('Units 1–4, 6–8 · customised'));
  });
});

/* ── item 9: the door holds Islamiat from first paint ────────────────────── */

describe('the door\'s Class step', () => {
  it('door: Islamiat is dim before the held read answers', async () => {
    const never = new Promise(() => {});
    portal.getAssessmentOptions.mockImplementation((g?: number, s?: string) => (g === 5 && s === 'islamiat' ? never : defaultOptions(g, s)));
    setPicks(fdePicks({ subject: null, subjectName: null }));
    app(newPaperPath('class'));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(C.selectGradeSubject) }));
    expect((await screen.findByRole('button', { name: /^Grade 5 · Islamiat/ })).hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('fde-held-note').textContent).toBe(C.islamiatHeld);
  });

  it('the probe un-holds Islamiat when the server offers a pattern for it', async () => {
    portal.getAssessmentOptions.mockImplementation(async (g?: number, s?: string) => (g === 5 && s === 'islamiat'
      ? { ...top(), types: [], patterns: [S.maths] }
      : defaultOptions(g, s)));
    setPicks(fdePicks({ subject: null, subjectName: null }));
    app(newPaperPath('class'));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(C.selectGradeSubject) }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Grade 5 · Islamiat/ }).hasAttribute('disabled')).toBe(false));
    expect(screen.queryByTestId('fde-held-note')).toBeNull();
  });

  it('stored door intent with the switch off → plain Class, plain eyebrow', async () => {
    flag.on = false;
    setPicks(fdePicks({ subject: null, subjectName: null }));
    app(newPaperPath('class'));
    await waitFor(() => expect(where()).toMatchObject({ patternIntent: null, style: null, pattern: null, coverBy: 'chapters' }));
    expect(document.body.textContent).not.toContain(C.fdeDoor);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(C.selectGradeSubject) }));
    expect(await screen.findByRole('radio', { name: /^Grade 3/ })).toBeTruthy();
  });

  it('golden: the door with the switch on keeps its intent', async () => {
    setPicks(fdePicks({ subject: null, subjectName: null }));
    app(newPaperPath('class'));
    await screen.findByRole('button', { name: new RegExp(C.selectGradeSubject) });
    expect(where()).toMatchObject({ patternIntent: 'fde_g5_2027', style: 'fde' });
    expect(document.body.textContent).toContain(C.fdeDoor);
  });
});

/* ── item 10: Versions never shows Edit on a row it could not read ───────── */

const FIXED_DAY = '2026-10-01T05:00:00.000Z';
const VERSIONS = [
  { paperId: 'v2', version: 2, status: 'ready', createdAt: FIXED_DAY, questionCount: 30, marks: 100, editedFrom: 'v1', latest: true },
  { paperId: 'v1', version: 1, status: 'ready', createdAt: FIXED_DAY, questionCount: 31, marks: 100, editedFrom: null, latest: false },
];

describe('Versions and its paper\'s row', () => {
  it('Versions on a failed My papers read shows Try again, not Edit', async () => {
    portal.getAssessmentVersions.mockResolvedValue({ success: true, versions: VERSIONS });
    portal.getAssessmentPapers.mockRejectedValue(new Error('network'));
    app(versionsPath('v2'));
    expect(await screen.findByText('Version 1')).toBeTruthy();
    expect(await screen.findByRole('button', { name: C.tryAgain })).toBeTruthy();
    expect(screen.queryAllByRole('link', { name: C.edit })).toHaveLength(0);
    portal.getAssessmentPapers.mockResolvedValue({ papers: [{ ...FDE_PAPER, paper_id: 'v2', pattern: null }], total: 1 });
    fireEvent.click(screen.getByRole('button', { name: C.tryAgain }));
    await waitFor(() => expect(screen.getAllByRole('link', { name: C.edit })).toHaveLength(2));
    expect(screen.queryByRole('button', { name: C.tryAgain })).toBeNull();
  });

  it('a paper My papers does not hold (past its pages): no Edit', async () => {
    portal.getAssessmentVersions.mockResolvedValue({ success: true, versions: VERSIONS });
    portal.getAssessmentPapers.mockResolvedValue({ papers: [], total: 0 });
    app(versionsPath('v2'));
    expect(await screen.findByText('Version 1')).toBeTruthy();
    await waitFor(() => expect(portal.getAssessmentPapers).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryAllByRole('link', { name: C.edit })).toHaveLength(0);
  });

  it('the versions read carries `pattern`: no My papers scan, the scheme rows from it', async () => {
    portal.getAssessmentVersions.mockResolvedValue({ success: true, versions: VERSIONS, pattern: 'fde_g5_2027' });
    portal.getAssessmentPapers.mockRejectedValue(new Error('network'));
    app(versionsPath('v2'));
    expect(await screen.findAllByTestId('version-scheme')).toHaveLength(2);
    expect(portal.getAssessmentPapers).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: C.tryAgain })).toBeNull();
  });

  it('the versions read says plain (`pattern: null`): Edit with no scan', async () => {
    portal.getAssessmentVersions.mockResolvedValue({ success: true, versions: VERSIONS, pattern: null });
    app(versionsPath('v2'));
    await waitFor(() => expect(screen.getAllByRole('link', { name: C.edit })).toHaveLength(2));
    expect(portal.getAssessmentPapers).not.toHaveBeenCalled();
  });
});

/* ── R5-16 + §8.2: the status read on a reopened page ────────────────────── */

describe('the request page with no job in this browser', () => {
  it('status with pattern → FDE wait screen', async () => {
    portal.getAssessmentStatus.mockResolvedValue({ success: true, status: 'generating', pattern: 'fde_g5_2027' });
    app(requestPath('req-x'));
    expect(await screen.findByText(C.aboutThreeMin)).toBeTruthy();
    expect(screen.queryByText(C.aboutAMinute)).toBeNull();
    expect(screen.queryByRole('button', { name: C.makeAnother })).toBeNull();
  });

  it('golden: status without pattern → today\'s wait', async () => {
    portal.getAssessmentStatus.mockResolvedValue({ success: true, status: 'generating' });
    app(requestPath('req-x'));
    expect(await screen.findByText(C.aboutAMinute)).toBeTruthy();
    expect(screen.getByRole('button', { name: C.makeAnother })).toBeTruthy();
  });

  it('a page brought back to the front asks for the status at once', async () => {
    portal.getAssessmentStatus.mockResolvedValue({ success: true, status: 'generating' });
    app(requestPath('req-x'));
    await waitFor(() => expect(portal.getAssessmentStatus).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    portal.getAssessmentStatus.mockResolvedValue({ success: true, status: 'ready', paperId: 'p-plain' });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(portal.getAssessmentStatus).toHaveBeenCalledTimes(2), { timeout: 1500 });
    expect(await screen.findByText(C.answerKey)).toBeTruthy();
  });
});

/* ── item 13: one answer for "is this a board-pattern request" and its count ─ */

describe('model: isPatternSpec / questionsOf', () => {
  it('a pattern spec counts the pattern\'s questions; a plain one its own; never 0 for a pattern', () => {
    expect(isPatternSpec({ grade: 5, subject: 'maths', pattern: 'fde_g5_2027', questionCount: 0 })).toBe(true);
    expect(isPatternSpec({ grade: 5, subject: 'maths', pattern: null, questionCount: 10 })).toBe(false);
    expect(isPatternSpec(null)).toBe(false);
    expect(questionsOf({ pattern: 'fde_g5_2027', questionCount: 0 }, 48)).toBe(48);
    expect(questionsOf({ pattern: 'fde_g5_2027', questionCount: 0 }, null)).toBeNull();
    expect(questionsOf({ questionCount: 10 }, 48)).toBe(10);
    expect(questionsOf({}, null)).toBeNull();
  });
});
