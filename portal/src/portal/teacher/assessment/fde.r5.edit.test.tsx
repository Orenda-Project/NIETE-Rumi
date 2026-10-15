import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import i18n from 'i18next';

/**
 * Editing reached on a board-pattern paper while the server cannot edit one yet, or by a typed URL: the server's
 * PATTERN_NO_EDIT is shown in the page's own language (the deck's words, as for PATTERN_NO_ADD); the Add route of a
 * board-pattern paper, refused by the server, goes back to the editor (which says why Add is off) instead of a dead
 * "Could not load"; and Versions offers Edit on a board-pattern paper only where the paper page does (FDE_EDITING).
 */

const { portal } = vi.hoisted(() => ({
  portal: {
    getAssessmentOptions: vi.fn(),
    getAssessmentEditQuestions: vi.fn(),
    getAssessmentAddKinds: vi.fn(),
    validateAssessmentEdit: vi.fn(),
    saveAssessmentVersion: vi.fn(),
    getAssessmentPapers: vi.fn(),
    getAssessmentVersions: vi.fn(),
    getAssessmentDownload: vi.fn(),
  },
}));
vi.mock('../../services/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  portal,
  language: { get: vi.fn(() => new Promise(() => {})), set: vi.fn() },
}));
vi.mock('../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { ASSESSMENT_V2_COPY as C, ASSESSMENT_V2_COPY_UR as U } from './copy';
import { EditPaperPage, EditQuestionPage } from './EditPages';
import { FDE_EDITING } from './PaperPage';
import { VersionsPage } from './VersionsPage';
import { forgetPapers } from './paperCache';
import { ASSESSMENT_V2_BASE as B, addQuestionPath, editPath, versionsPath } from './paths';

const plain = (t: string | null | undefined) => (t || '').replace(/[⁦⁩]/g, '');

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={`${B}/paper/:paperId/edit`} element={<EditPaperPage />} />
        <Route path={`${B}/paper/:paperId/edit/add/:kind`} element={<EditQuestionPage mode="add" />} />
        <Route path={`${B}/paper/:paperId/versions`} element={<VersionsPage />} />
        <Route path="*" element={<p data-testid="elsewhere" />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

const item = (id: string, number: number, slot: string, section: 'objective' | 'subjective' = 'subjective', marks = 5) => ({
  id, number, removed: false, type: 'Short Answer', section, marks, text: `Question ${id}`, fields: { question: `Question ${id}`, marks },
  slot,
});
const CHOICES = [{ slot: 'maths.B.Q2', label_en: 'Q2', label_ur: 'سوال 2', generate: 12, attempt: 8, marks_each: 5 }];
const fdePaper = () => ({
  paper: {
    paperId: 'p-f', version: 1, grade: 5, subject: 'Mathematics', subjectKey: 'maths', chapterNumber: null, rtl: false,
    questionCount: 14, marks: 100, pattern: 'fde_g5_2027', choices: CHOICES,
  },
  items: [
    item('a1', 1, 'maths.A.Q1a', 'objective', 1), item('a2', 2, 'maths.A.Q1a', 'objective', 1),
    ...Array.from({ length: 12 }, (_, i) => item(`b${i + 1}`, i + 3, 'maths.B.Q2')),
  ],
});
const refused = (errorCode: string) => ({ response: { status: 400, data: { success: false, errorCode, error: 'Board-pattern papers keep their shape.' } } });

const FIXED_DAY = '2026-10-01T05:00:00.000Z';
const VERSIONS = [
  { paperId: 'v2', version: 2, status: 'ready', createdAt: FIXED_DAY, questionCount: 30, marks: 100, editedFrom: 'v1', latest: true },
  { paperId: 'v1', version: 1, status: 'ready', createdAt: FIXED_DAY, questionCount: 31, marks: 100, editedFrom: null, latest: false },
];
const row = (paperId: string, pattern: string | null) => ({
  paper_id: paperId, grade: 5, subject_key: 'maths', subject: 'Mathematics', chapter_number: null, question_count: 30,
  total_marks: 100, ready_at: FIXED_DAY, version: 2, has_answer_key: true, pattern,
});

beforeEach(async () => {
  vi.clearAllMocks();
  forgetPapers();
  localStorage.clear();
  if (!i18n.isInitialized) await i18n.init({ lng: 'en', resources: {} });
  await act(async () => { await i18n.changeLanguage('en'); });
  portal.getAssessmentAddKinds.mockResolvedValue({ kinds: [{ kind: 'MCQs', label: 'MCQs', layout: 'options', section: 'objective', marks: 1, lines: 0 }], slotCap: 6 });
  portal.getAssessmentOptions.mockResolvedValue({ success: true, grades: [5], maxQuestions: 50, defaultQuestions: 15, patterns: [{ id: 'fde_g5_2027', choices: CHOICES }] });
  portal.getAssessmentVersions.mockResolvedValue({ success: true, versions: VERSIONS });
});

describe('the server cannot edit a board-pattern paper yet', () => {
  it('a save refused with PATTERN_NO_EDIT says the deck\'s words in Urdu, not the server\'s English', async () => {
    await act(async () => { await i18n.changeLanguage('ur'); });
    portal.getAssessmentEditQuestions.mockResolvedValue(fdePaper());
    portal.saveAssessmentVersion.mockRejectedValue(refused('PATTERN_NO_EDIT'));
    at(editPath('p-f'));
    await screen.findByTestId('edit-both');
    fireEvent.click(screen.getByRole('checkbox', { name: plain(U.removeQuestion(3)) }));
    fireEvent.click(screen.getByRole('button', { name: plain(U.saveAs(2)) }));
    expect(plain((await screen.findByRole('alert')).textContent)).toBe(U.noAddOnPattern);
  });
});

describe('the Add route of a board-pattern paper', () => {
  it('refused by the server (PATTERN_NO_ADD on add-kinds): back to the editor, not "Could not load"', async () => {
    portal.getAssessmentEditQuestions.mockResolvedValue(fdePaper());
    portal.getAssessmentAddKinds.mockRejectedValue(refused('PATTERN_NO_ADD'));
    at(addQuestionPath('p-f', 'MCQs'));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(editPath('p-f')));
    expect(screen.queryByText(C.loadFailed)).toBeNull();
  });
});

describe('Versions follows the paper page on Edit', () => {
  it('a board-pattern paper offers Edit on its versions only where the paper page does (FDE_EDITING)', async () => {
    portal.getAssessmentPapers.mockResolvedValue({ papers: [row('v2', 'fde_g5_2027')], total: 1 });
    at(versionsPath('v2'));
    expect(await screen.findAllByTestId('version-scheme')).toHaveLength(2);
    expect(screen.queryAllByRole('link', { name: C.edit })).toHaveLength(FDE_EDITING ? 2 : 0);
  });

  it('golden: a plain paper keeps Edit on each ready version', async () => {
    portal.getAssessmentPapers.mockResolvedValue({ papers: [row('v2', null)], total: 1 });
    at(versionsPath('v2'));
    await screen.findByText('Version 1');
    await waitFor(() => expect(portal.getAssessmentPapers).toHaveBeenCalled());
    expect(screen.getAllByRole('link', { name: C.edit })).toHaveLength(2);
  });
});
