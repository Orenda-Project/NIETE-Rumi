import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import i18n from 'i18next';

/**
 * A G9-12 FBISE board pattern on the teacher app (bd-5jmnfj.38.25.4). The board pattern has no fixed syllabus
 * (scope.chapters is empty): the teacher picks the chapters from the book on Check, and the request goes as chapters,
 * never `scope: 'fde'` (the server refuses that for a board id). Its words say FBISE, not FDE. G1-5 FDE stays as
 * fde.pages.test.tsx pins it. Fixtures are fictional.
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
    getAssessmentPaperView: vi.fn(() => Promise.resolve({ success: true, paper: {}, sections: [] })),
    takeGenerateFailure: vi.fn(() => null),
  },
  config: { features: { assessmentGenerator: true, assessmentEditing: true } },
}));
vi.mock('../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() }, portal }));
vi.mock('../../lib/useNewUi', () => ({ readConfigShared: () => Promise.resolve(config) }));
vi.mock('../../lib/gradeSubjects', () => ({ loadGradeSubjects: () => Promise.resolve([]) }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { phoneNumber: 'fbise-teacher' }, loading: false }) }));
vi.mock('../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { ASSESSMENT_V2_COPY as C, ASSESSMENT_V2_COPY_UR as U } from './copy';
import { forgetCatalogue } from './api';
import { forgetPapers } from './paperCache';
import { clearPicksForTest, setPicks, usePicks } from './store';
import { isBoardId, newPicks, type Picks } from './model';
import { AssessmentHub } from './AssessmentHub';
import { CheckStep } from './NewPaperSteps';
import { PaperPage } from './PaperPage';
import { RequestPage } from './RequestPage';
import { VersionsPage } from './VersionsPage';
import { paperGroups } from './papersList';
import { jobsStorageKey } from '../../components/assessment-jobs/usePaperJobs';
import { ASSESSMENT_V2_BASE as B, newPaperPath, paperPath, requestPath, versionsPath } from './paths';

const bi = (en: string, ur: string) => ({ en, ur });
// The shape board/index.js summaryFor sends: the teacher picks the chapters, so scope.chapters is empty.
const BOARD = {
  id: 'fbise_ssc1_2027',
  name: bi('FBISE SSC-I pattern', 'FBISE SSC-I pattern'),
  holds: bi('3 sections · 75 marks · 3 h', '3 حصے · 75 نمبر · 3 گھنٹے'),
  sections: [{ id: 'A', ...bi('Section A · MCQs', 'حصہ A · کثیر انتخابی') }],
  choice: null,
  youAdd: null,
  files: bi('Paper + marking scheme', 'پرچہ + مارکنگ اسکیم'),
  scope: {
    ...bi('', ''), label: bi('Chosen chapters', 'منتخب ابواب'),
    chapters: [], displayChapters: [], excluded: [], topicsOnly: [], held: [], unitRanges: [],
  },
  generateTotal: 60, totalMarks: 75, totalTime: bi('3 h', '3 گھنٹے'), waitHint: bi('About 3 min', 'تقریباً 3 منٹ'),
};

function Where() {
  const loc = useLocation();
  const [p] = usePicks();
  return <p data-testid="where">{JSON.stringify({ path: loc.pathname, coverBy: p.coverBy, chapters: p.chapters })}</p>;
}
const where = () => JSON.parse(screen.getByTestId('where').textContent || '{}');

function at(path: string, routePath: string, el: JSX.Element) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={<>{el}<Where /></>} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const boardPicks = (over: Partial<Picks> = {}): Picks => ({
  ...newPicks(15), grade: 9, subject: 'physics', subjectName: 'Physics',
  coverBy: 'fde', style: 'fde', pattern: 'fbise_ssc1_2027', patternIntent: 'fbise_ssc1_2027', ...over,
});

async function inUrdu(fn: () => Promise<void>) {
  if (!i18n.isInitialized) await i18n.init({ lng: 'en', resources: {} });
  await act(async () => { await i18n.changeLanguage('ur'); });
  try { await fn(); } finally { await act(async () => { await i18n.changeLanguage('en'); }); }
}

let grades: number[];
beforeEach(() => {
  vi.clearAllMocks();
  clearPicksForTest();
  forgetCatalogue();
  forgetPapers();
  sessionStorage.clear();
  grades = [9];
  portal.getAssessmentOptions.mockImplementation(async (grade?: number, subject?: string) => {
    const top = { success: true, grades: [5, 9], maxQuestions: 50, defaultQuestions: 15, patternGrades: grades };
    if (grade && subject) return { ...top, types: [{ id: 'MCQs', category: 'objective' }], patterns: grade === 9 ? [BOARD] : [] };
    return top;
  });
  portal.getAssessmentChapters.mockResolvedValue({ success: true, chapters: Array.from({ length: 4 }, (_, i) => ({
    chapter_number: i + 1, chapter_title: `Fictional chapter ${i + 1}`, page_start: i * 20 + 1, page_end: i * 20 + 19, page_count: 19,
  })) });
  portal.getAssessmentStatus.mockResolvedValue({ success: true, status: 'queued' });
  portal.getAssessmentPapers.mockResolvedValue({ success: true, papers: [], total: 0, page: 1, pageSize: 10 });
});

describe('isBoardId', () => {
  it('is true for the FBISE ids only', () => {
    expect(isBoardId('fbise_ssc1_2027')).toBe(true);
    expect(isBoardId('fbise_hssc2_2027')).toBe(true);
    expect(isBoardId('fde_g5_2027')).toBe(false);
    expect(isBoardId('x_fbise_1')).toBe(false);
    expect(isBoardId(null)).toBe(false);
    expect(isBoardId(undefined)).toBe(false);
  });
});

describe('Check on a G9-12 board pattern', () => {
  it('the teacher picks chapters from the book; Make waits for one; the request goes as chapters', async () => {
    setPicks(boardPicks());
    portal.generateAssessment.mockResolvedValue({ success: true, requestId: 'req-b1' });
    at(newPaperPath('check'), newPaperPath('check'), <CheckStep />);
    await screen.findByTestId('fde-row-syllabus');
    await waitFor(() => expect(where()).toMatchObject({ coverBy: 'chapters', chapters: [] }));
    expect(screen.getByTestId('fde-row-syllabus').textContent).toContain(C.picked(0));
    expect(screen.getByRole('button', { name: new RegExp(C.makePaper) }).hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByTestId('fde-row-syllabus'));
    const tray = await screen.findByTestId('fde-syllabus-tray');
    // The book's chapters, every one selectable; no whole-syllabus choice, no "choose units" switch.
    await within(tray).findByRole('checkbox', { name: /Fictional chapter 4$/ });
    expect(within(tray).getAllByRole('checkbox')).toHaveLength(4);
    expect(within(tray).queryAllByRole('radio')).toHaveLength(0);
    fireEvent.click(within(tray).getByRole('checkbox', { name: /Fictional chapter 3$/ }));
    fireEvent.click(within(tray).getByRole('checkbox', { name: /Fictional chapter 1$/ }));
    fireEvent.click(within(tray).getByRole('checkbox', { name: /Fictional chapter 3$/ }));
    fireEvent.click(within(tray).getByRole('checkbox', { name: /Fictional chapter 2$/ }));
    expect(where()).toMatchObject({ coverBy: 'chapters', chapters: [1, 2] });
    fireEvent.click(within(tray).getByRole('button', { name: C.done }));
    expect(screen.getByTestId('fde-row-syllabus').textContent).toContain(C.picked(2));

    fireEvent.click(screen.getByRole('button', { name: new RegExp(C.makePaper) }));
    await waitFor(() => expect(portal.generateAssessment).toHaveBeenCalled());
    expect(portal.generateAssessment.mock.calls[0][0]).toEqual({
      grade: 9, subject: 'physics', pattern: 'fbise_ssc1_2027', chapterNumbers: [1, 2],
      questionCount: 0, contentSource: 'unseen', seenCount: null, questionTypes: [], answerLines: true, outputFormat: 'pdf',
    });
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem(jobsStorageKey('fbise-teacher')) || '[]')[0]?.label).toBe(C.join('Physics', C.fbiseChip)));
    await waitFor(() => expect(where().path).toBe(requestPath('req-b1')));
  });

  it('says FBISE, never FDE: style, Inside, crumb', async () => {
    setPicks(boardPicks());
    at(newPaperPath('check'), newPaperPath('check'), <CheckStep />);
    fireEvent.click(await screen.findByTestId('fde-row-style'));
    const style = await screen.findByTestId('fde-style-tray');
    expect(style.textContent).toContain(C.styleFbise);
    expect(style.textContent).not.toContain('FDE');
    fireEvent.click(within(style).getByRole('radio', { name: new RegExp(C.styleFbise) }));
    fireEvent.click(screen.getByTestId('fde-row-inside'));
    const inside = await screen.findByTestId('fde-inside-tray');
    expect(inside.textContent).toContain(C.fbiseNotOfficial);
    expect(inside.textContent).not.toContain('FDE');
    expect(screen.queryByText(C.useFdeSyllabus)).toBeNull();
    expect(screen.getAllByText(C.boardDoor).length).toBeGreaterThan(0);
    expect(screen.queryByText(C.fdeDoor)).toBeNull();
  });

  it('in Urdu: the Urdu FBISE words', async () => {
    await inUrdu(async () => {
      setPicks(boardPicks());
      at(newPaperPath('check'), newPaperPath('check'), <CheckStep />);
      fireEvent.click(await screen.findByTestId('fde-row-inside'));
      const inside = await screen.findByTestId('fde-inside-tray');
      expect(inside.textContent).toContain(U.fbiseNotOfficial);
      expect(inside.textContent).not.toContain('FDE');
      expect(U.fbiseNotOfficial).not.toBe(C.fbiseNotOfficial);
      expect(U.styleFbise).toContain('FBISE');
      expect(U.boardDoor).not.toBe(C.boardDoor);
    });
  });
});

describe('the hub door', () => {
  it('says "Board pattern papers" once a G6-12 grade is offered', async () => {
    at(B, B, <AssessmentHub />);
    expect((await screen.findByTestId('fde-door')).textContent).toContain(C.boardDoor);
  });

  it('a Grade 6 offer already counts as G6-12', async () => {
    grades = [6];
    at(B, B, <AssessmentHub />);
    expect((await screen.findByTestId('fde-door')).textContent).toContain(C.boardDoor);
  });

  it('G5 and G9 offered together: the door names board patterns', async () => {
    grades = [5, 9];
    at(B, B, <AssessmentHub />);
    expect((await screen.findByTestId('fde-door')).textContent).toContain(C.boardDoor);
  });

  it('stays "FDE pattern papers" for G1-5 only', async () => {
    grades = [5];
    at(B, B, <AssessmentHub />);
    const door = await screen.findByTestId('fde-door');
    expect(door.textContent).toContain(C.fdeDoor);
    expect(door.textContent).not.toContain(C.boardDoor);
  });
});

describe('a G9-12 paper says FBISE on its chips', () => {
  const paper = {
    paper_id: 'p-b', grade: 9, subject_key: 'physics', subject: 'Physics', chapter_number: null, question_count: 68, total_marks: 75,
    ready_at: new Date().toISOString(), has_answer_key: true, version: 1, pattern: 'fbise_ssc1_2027', pages: { paper: 6, scheme: 3 },
  };

  it('the paper page', async () => {
    portal.getAssessmentPapers.mockResolvedValue({ success: true, total: 1, page: 1, pageSize: 20, papers: [paper] });
    at(paperPath('p-b'), `${B}/paper/:paperId`, <PaperPage />);
    expect(await screen.findByText(C.fbiseChip)).toBeTruthy();
    expect(screen.queryByText(C.fdeChip)).toBeNull();
  });

  it('the request page once the paper is ready (the pattern read from the paper row)', async () => {
    portal.getAssessmentStatus.mockResolvedValue({ success: true, status: 'ready', paperId: 'p-b' });
    portal.getAssessmentPapers.mockResolvedValue({ success: true, total: 1, page: 1, pageSize: 20, papers: [paper] });
    at(requestPath('req-b9'), `${B}/request/:requestId`, <RequestPage />);
    expect((await screen.findAllByText(C.fbiseChip)).length).toBeGreaterThan(0);
    expect(screen.queryByText(C.fdeChip)).toBeNull();
  });

  it('the versions page (the versions read names the pattern)', async () => {
    portal.getAssessmentVersions.mockResolvedValue({ success: true, pattern: 'fbise_ssc1_2027', versions: [
      { paperId: 'p-b', version: 1, status: 'ready', createdAt: paper.ready_at, questionCount: 68, marks: 75, editedFrom: null, latest: true },
    ] });
    at(versionsPath('p-b'), `${B}/paper/:paperId/versions`, <VersionsPage />);
    expect(await screen.findByText(C.fbiseChip)).toBeTruthy();
    expect(screen.queryByText(C.fdeChip)).toBeNull();
  });

  it('the papers list row; an FDE paper keeps FDE', () => {
    const fde = { ...paper, paper_id: 'p-f', grade: 5, pattern: 'fde_g5_2027' };
    const rows = paperGroups([paper, fde] as never, C).flatMap((g) => g.items);
    expect(rows.find((r) => r.id === 'p-b')?.chip?.text).toBe(C.fbiseListChip);
    expect(rows.find((r) => r.id === 'p-f')?.chip?.text).toBe(C.fdeListChip);
  });
});
