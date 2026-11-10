import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import i18n from 'i18next';

/**
 * A board-pattern (FDE) paper can only have questions removed or put back (PATTERN_NO_EDIT on the server): its rows
 * open no question editor, its sub-questions are not links, and a typed edit link goes back to the paper's editor.
 * A plain paper keeps its question links.
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

import { ASSESSMENT_V2_COPY as C } from './copy';
import { EditPaperPage, EditQuestionPage } from './EditPages';
import { forgetPapers } from './paperCache';
import { ASSESSMENT_V2_BASE as B, editPath, editQuestionPath } from './paths';

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={`${B}/paper/:paperId/edit`} element={<EditPaperPage />} />
        <Route path={`${B}/paper/:paperId/edit/q/:key`} element={<EditQuestionPage mode="edit" />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

const item = (id: string, number: number, extra: Record<string, unknown> = {}) => ({
  id, number, removed: false, type: 'Short Answer', section: 'subjective', marks: 5, text: `Question ${id}`,
  fields: { question: `Question ${id}`, marks: 5 }, ...extra,
});
const paperOf = (pattern: string | null, items: unknown[]) => ({
  paper: { paperId: 'p1', version: 1, grade: 5, subject: 'Mathematics', subjectKey: 'maths', chapterNumber: null, rtl: false, questionCount: items.length, marks: 100, pattern, choices: pattern ? [] : undefined },
  items,
});
const SUBS = { subs: [{ index: 0, fields: { question: 'Sub one', marks: 2 } }] };

beforeEach(async () => {
  vi.clearAllMocks();
  forgetPapers();
  localStorage.clear();
  if (!i18n.isInitialized) await i18n.init({ lng: 'en', resources: {} });
  await act(async () => { await i18n.changeLanguage('en'); });
  portal.getAssessmentOptions.mockResolvedValue({ success: true, patterns: [] });
});

describe('a board-pattern paper: remove or put back only', () => {
  it('its question rows and sub-questions are not links, and Remove is still there', async () => {
    portal.getAssessmentEditQuestions.mockResolvedValue(paperOf('fde_g5_2027', [item('b1', 1, { slot: 'maths.B.Q2', ...SUBS }), item('b2', 2, { slot: 'maths.B.Q2' })]));
    at(editPath('p1'));
    expect(await screen.findByText('Question b1')).toBeTruthy();
    expect(screen.getByText('Question b1').closest('a')).toBeNull();
    expect(screen.queryByText('Sub one')).toBeNull();
    expect(screen.getByRole('checkbox', { name: C.removeQuestion('1') })).toBeTruthy();
  });

  it('a typed edit link for one of its questions goes back to the editor', async () => {
    portal.getAssessmentEditQuestions.mockResolvedValue(paperOf('fde_g5_2027', [item('b1', 1, { slot: 'maths.B.Q2' })]));
    at(editQuestionPath('p1', 'b1'));
    expect(await screen.findByText(editPath('p1'), { selector: '[data-testid="where"]' })).toBeTruthy();
    expect(portal.validateAssessmentEdit).not.toHaveBeenCalled();
  });
});

describe('a plain paper keeps its question editor', () => {
  it('its rows and sub-questions still link to the question editor', async () => {
    portal.getAssessmentEditQuestions.mockResolvedValue(paperOf(null, [item('q1', 1, SUBS)]));
    at(editPath('p1'));
    const text = await screen.findByText('Question q1');
    expect(text.closest('a')?.getAttribute('href')).toBe(editQuestionPath('p1', 'q1'));
    expect(screen.getByText('Sub one').closest('a')?.getAttribute('href')).toBe(editQuestionPath('p1', 'q1#0'));
  });

  it('a question edit link opens the form', async () => {
    portal.getAssessmentEditQuestions.mockResolvedValue(paperOf(null, [item('q1', 1)]));
    at(editQuestionPath('p1', 'q1'));
    expect(await screen.findByDisplayValue('Question q1')).toBeTruthy();
    expect(screen.getByTestId('where').textContent).toBe(editQuestionPath('p1', 'q1'));
  });
});
