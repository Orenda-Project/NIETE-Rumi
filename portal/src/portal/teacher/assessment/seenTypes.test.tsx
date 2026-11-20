import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * bd-e5n2jf — Seen (book) questions get per-type counts, like Unseen (Mubashar Zia, 20 Nov). The single "as in the
 * book" box stays until she adds a Seen type; then each Seen type has its own count and the paper adds them up.
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
import { newPicks, type Picks } from './model';
import { CheckStep, QuestionsStep } from './NewPaperSteps';
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
const seenBox = async (name: string) => (await screen.findByRole('textbox', { name: C.seenTypeCount(name) })) as HTMLInputElement;
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

const openQuestions = () => at(newPaperPath('questions'), newPaperPath('questions'), <QuestionsStep />);

describe('Seen types on Questions', () => {
  it('with no Seen types the single book box stays', async () => {
    setPicks(picks({ typesSeeded: true, seen: 5, typeCounts: { MCQs: 4 } }));
    openQuestions();
    expect(await screen.findByTestId('count-seen')).toBeTruthy();
    expect(screen.getByTestId('add-seen-type')).toBeTruthy();
  });

  it('the first Seen type ticked takes the book count; the single box goes; the total holds', async () => {
    setPicks(picks({ typesSeeded: true, seen: 5, typeCounts: { MCQs: 4 } }));
    openQuestions();
    fireEvent.click(await screen.findByTestId('add-seen-type'));
    const tray = await screen.findByTestId('seen-types-tray');
    fireEvent.click(await within(tray).findByRole('checkbox', { name: 'MCQs' }));
    expect((await seenBox('MCQs')).value).toBe('5');
    expect(screen.queryByTestId('count-seen')).toBeNull();
    expect(screen.getByTestId('questions-total').textContent).toContain(C.questionsCount(9));
  });

  it('each Seen type steps on its own; the last one removed brings the single box back', async () => {
    setPicks(picks({ typesSeeded: true, seen: 5, seenTypeCounts: { MCQs: 3, 'True/False': 1 }, typeCounts: { MCQs: 4 } }));
    openQuestions();
    expect((await seenBox('MCQs')).value).toBe('3');
    expect(screen.getByTestId('questions-total').textContent).toContain(C.questionsCount(8));
    fireEvent.click(within(screen.getByTestId('seen-type-count-MCQs')).getByRole('button', { name: C.moreOf('MCQs') }));
    expect((await seenBox('MCQs')).value).toBe('4');
    fireEvent.click(within(screen.getByTestId('seen-type-count-True/False')).getByRole('button', { name: C.removeType('True/False') }));
    await waitFor(() => expect(screen.queryByTestId('seen-type-count-True/False')).toBeNull());
    expect(JSON.parse(sessionStorage.getItem('teacher-v2-assessment-new:v1') ?? '{}').seenTypeCounts).toEqual({ MCQs: 4 });
    for (let i = 0; i < 3; i += 1) {
      fireEvent.click(within(screen.getByTestId('seen-type-count-MCQs')).getByRole('button', { name: C.fewerOf('MCQs') }));
    }
    fireEvent.click(within(screen.getByTestId('seen-type-count-MCQs')).getByRole('button', { name: C.removeType('MCQs') }));
    expect(await screen.findByTestId('count-seen')).toBeTruthy();
  });
});

describe('Seen types on Check', () => {
  it('shows the Seen types and sends them', async () => {
    setPicks(picks({ typesSeeded: true, seen: 0, seenTypeCounts: { MCQs: 3, 'True/False': 2 }, typeCounts: { 'Brief Answers': 4 } }));
    portal.generateAssessment.mockResolvedValue({ success: true, requestId: 'req-9' });
    at(newPaperPath('check'), newPaperPath('check'), <CheckStep />);
    expect(await screen.findByText(C.questionsCount(9))).toBeTruthy();
    expect(screen.getByText(C.join(C.seenShort(5), C.unseenShort(4)))).toBeTruthy();
    expect(screen.getByText(`${C.seenTypesTitle}: MCQs 3 · True/False 2`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(C.makePaper) }));
    await waitFor(() => expect(screen.getByTestId('request-page')).toBeTruthy());
    expect(portal.generateAssessment).toHaveBeenCalledWith(expect.objectContaining({
      questionCount: 9, contentSource: 'both', seenCount: 5,
      seenTypes: [{ id: 'MCQs', count: 3 }, { id: 'True/False', count: 2 }],
      questionTypes: [{ id: 'Brief Answers', count: 4 }],
    }));
  });
});
