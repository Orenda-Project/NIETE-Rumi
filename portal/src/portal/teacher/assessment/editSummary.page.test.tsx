import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from 'i18next';

/**
 * ICT sheet, Assessment Generator rows 6-7 (Hashir, RM): while editing, each question shows its Bloom's level, and a
 * summary of the levels (as shares of the paper) and the question types follows every Remove / Put back. Editor only:
 * the printed paper is made by the bot and never sees these words. A paper whose questions carry no level shows no
 * summary at all, so older papers' editors are unchanged.
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

import { EditPaperPage } from './EditPages';
import { ASSESSMENT_V2_BASE as B, editPath } from './paths';

const item = (id: string, n: number, type: string, blooms?: string) => ({
  id, number: n, removed: false, type, section: type === 'MCQs' ? 'objective' : 'subjective', marks: 1,
  text: `Question ${id}`, fields: { question: `Question ${id}`, marks: 1 }, ...(blooms ? { blooms } : {}),
});
const paper = (items: unknown[]) => ({
  paper: { paperId: 'p-1', version: 1, grade: 5, subject: 'Math', chapterNumber: 1, rtl: false, questionCount: items.length, marks: items.length },
  items,
});

function open() {
  render(
    <MemoryRouter initialEntries={[editPath('p-1')]}>
      <Routes><Route path={`${B}/paper/:paperId/edit`} element={<EditPaperPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  if (!i18n.isInitialized) await i18n.init({ lng: 'en', resources: {} });
  await act(async () => { await i18n.changeLanguage('en'); });
});

describe("editor shows Bloom's levels (AG rows 6-7)", () => {
  it('tags each question and keeps the summary in step with Remove', async () => {
    portal.getAssessmentEditQuestions.mockResolvedValue(paper([
      item('a', 1, 'MCQs', 'Remember'), item('b', 2, 'MCQs', 'Apply'),
      item('c', 3, 'Short Questions', 'Remember'), item('d', 4, 'Short Questions', 'Understand'),
    ]));
    open();
    const sum = await screen.findByTestId('edit-summary');
    expect(sum.textContent).toContain('Remember 50%');
    expect(sum.textContent).toContain('Apply 25%');
    expect(sum.textContent).toContain('MCQs 2');
    expect(screen.getAllByTestId('bloom-tag').map((n) => n.textContent)).toEqual(['Remember', 'Apply', 'Remember', 'Understand']);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Remove question 3' }));
    const after = screen.getByTestId('edit-summary').textContent;
    expect(after).toContain('Remember 33%');
    expect(after).toContain('Short Questions 1');
  });

  it('shows no summary when no question carries a level', async () => {
    portal.getAssessmentEditQuestions.mockResolvedValue(paper([item('a', 1, 'MCQs'), item('b', 2, 'MCQs')]));
    open();
    await screen.findByText('Question a');
    expect(screen.queryByTestId('edit-summary')).toBeNull();
    expect(screen.queryAllByTestId('bloom-tag')).toHaveLength(0);
  });
});
