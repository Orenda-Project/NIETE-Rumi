import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * bd-6clakk.12.4 — on a topic paper she can tick the question wording (stems) she wants under each type. Nothing
 * ticked is "Rumi chooses", the paper as it was. A chapter paper never shows the chips and never sends stems.
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
import { clearPicksForTest, setPicks, usePicks } from './store';
import { newPicks, toSpec, type Picks } from './model';
import { QuestionsStep } from './NewPaperSteps';
import { newPaperPath } from './paths';

const IS = { id: 'is-am-are', text: 'Fill in the blanks with is, am or are.' };
const HAS = { id: 'has-have', text: 'Fill in the blanks with has or have.' };
const ENGLISH = { grade: 1, subject: 'english', subjectName: 'English', chapters: [4] };
const picks = (over: Partial<Picks>): Picks => ({ ...newPicks(15), ...ENGLISH, typesSeeded: true, seen: 0, ...over });
const ON_TOPICS: Partial<Picks> = { topicScope: 'topics', topicIds: ['1-english-4-t1'] };

let latest: Picks;
function Spy() {
  [latest] = usePicks();
  return null;
}

function show() {
  return render(
    <MemoryRouter initialEntries={[newPaperPath('questions')]}>
      <Routes>
        <Route path={newPaperPath('questions')} element={<><QuestionsStep /><Spy /></>} />
        <Route path="*" element={<p data-testid="elsewhere" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  clearPicksForTest();
  forgetCatalogue();
  sessionStorage.clear();
  portal.getAssessmentOptions.mockImplementation(async (grade?: number, subject?: string) => (grade && subject
    ? { success: true, grades: [1], maxQuestions: 50, defaultQuestions: 15, types: [
      { id: 'MCQs', category: 'objective' },
      { id: 'Fill in the Blanks', category: 'objective', stems: [IS, HAS] },
    ] }
    : { success: true, grades: [1], maxQuestions: 50, defaultQuestions: 15 }));
});

const pressed = (el: HTMLElement) => el.getAttribute('aria-pressed');

describe('stem chips on Questions', () => {
  it('a topic paper shows the stems under a type that has them; Rumi chooses is on until she ticks one', async () => {
    setPicks(picks({ ...ON_TOPICS, typeCounts: { MCQs: 2, 'Fill in the Blanks': 3 } }));
    show();
    const group = await screen.findByRole('group', { name: C.stemsFor('Fill in the Blanks') });
    expect(pressed(within(group).getByRole('button', { name: C.rumiChooses }))).toBe('true');
    expect(pressed(within(group).getByRole('button', { name: IS.text }))).toBe('false');
    expect(screen.queryByRole('group', { name: C.stemsFor('MCQs') })).toBeNull();
  });

  it('ticking stems keeps them in her order; Rumi chooses clears them', async () => {
    setPicks(picks({ ...ON_TOPICS, typeCounts: { 'Fill in the Blanks': 3 } }));
    show();
    const group = await screen.findByRole('group', { name: C.stemsFor('Fill in the Blanks') });
    fireEvent.click(within(group).getByRole('button', { name: HAS.text }));
    fireEvent.click(within(group).getByRole('button', { name: IS.text }));
    expect(latest.typeStems).toEqual({ 'Fill in the Blanks': ['has-have', 'is-am-are'] });
    expect(pressed(within(group).getByRole('button', { name: C.rumiChooses }))).toBe('false');
    fireEvent.click(within(group).getByRole('button', { name: HAS.text }));
    expect(latest.typeStems).toEqual({ 'Fill in the Blanks': ['is-am-are'] });
    fireEvent.click(within(group).getByRole('button', { name: C.rumiChooses }));
    expect(latest.typeStems?.['Fill in the Blanks'] ?? []).toEqual([]);
  });

  it('taking the type off the page forgets its stems', async () => {
    setPicks(picks({ ...ON_TOPICS, typeCounts: { 'Fill in the Blanks': 1 }, typeStems: { 'Fill in the Blanks': ['is-am-are'] } }));
    show();
    fireEvent.click(await screen.findByRole('button', { name: C.removeType('Fill in the Blanks') }));
    expect(latest.typeStems?.['Fill in the Blanks']).toBeUndefined();
  });

  it('a chapter paper shows no chips', async () => {
    setPicks(picks({ topicScope: 'chapter', typeCounts: { 'Fill in the Blanks': 3 } }));
    show();
    await screen.findByRole('textbox', { name: C.typeCount('Fill in the Blanks') });
    expect(screen.queryByRole('group', { name: C.stemsFor('Fill in the Blanks') })).toBeNull();
  });
});

describe('toSpec', () => {
  const stems = { 'Fill in the Blanks': ['is-am-are'] };

  it('a topic paper sends her ticked stems on that type only', () => {
    const spec = toSpec(picks({ ...ON_TOPICS, typeCounts: { MCQs: 2, 'Fill in the Blanks': 3 }, typeStems: stems }));
    expect(spec.questionTypes).toEqual([
      { id: 'MCQs', count: 2 },
      { id: 'Fill in the Blanks', count: 3, stems: ['is-am-are'] },
    ]);
  });

  it('a chapter paper, or none ticked, sends the types exactly as before', () => {
    const plain = [{ id: 'Fill in the Blanks', count: 3 }];
    expect(toSpec(picks({ topicScope: 'chapter', typeCounts: { 'Fill in the Blanks': 3 }, typeStems: stems })).questionTypes).toEqual(plain);
    expect(toSpec(picks({ ...ON_TOPICS, typeCounts: { 'Fill in the Blanks': 3 }, typeStems: { 'Fill in the Blanks': [] } })).questionTypes).toEqual(plain);
  });
});
