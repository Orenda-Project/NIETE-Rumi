import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * bd-pw1ccr.4.3 — the topic-end nudge lands on Class with ?by=topics&grade=&subject=&chapter=: Class fills the class
 * and the chapter in and goes straight on to Topics, which opens on Select topics; nothing is ticked, the paper untagged.
 */

const { portal } = vi.hoisted(() => ({ portal: { getAssessmentOptions: vi.fn() } }));
vi.mock('../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() }, portal }));
vi.mock('../../lib/useNewUi', () => ({ readConfigShared: () => Promise.resolve({ features: { assessmentGenerator: true } }) }));
vi.mock('../../lib/gradeSubjects', () => ({ loadGradeSubjects: () => Promise.resolve([]) }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { phoneNumber: '923001234567' }, loading: false }) }));
vi.mock('../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { forgetCatalogue } from './api';
import { clearPicksForTest, setPicks, usePicks } from './store';
import { ClassStep } from './NewPaperSteps';
import { newPaperPath } from './paths';

function Shown() {
  const [p] = usePicks();
  return <p data-testid="picks">{JSON.stringify({ grade: p.grade, subject: p.subject, chapters: p.chapters, origin: p.origin, byTopics: p.byTopics, topicIds: p.topicIds })}</p>;
}

const at = (search: string) => render(
  <MemoryRouter initialEntries={[`${newPaperPath('class')}${search}`]}>
    <Routes>
      <Route path={newPaperPath('class')} element={<><p>class step</p><Shown /></>} />
      <Route path={newPaperPath('topics')} element={<><p>topics step</p><Shown /></>} />
    </Routes>
    <ClassStepAt />
  </MemoryRouter>,
);
// ClassStep reads the router's location, so it renders inside the class route only.
function ClassStepAt() {
  return <Routes><Route path={newPaperPath('class')} element={<ClassStep />} /><Route path="*" element={null} /></Routes>;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearPicksForTest();
  forgetCatalogue();
  sessionStorage.clear();
  portal.getAssessmentOptions.mockImplementation(async (grade?: number) => (grade
    ? { success: true, grades: [3, 4], maxQuestions: 50, defaultQuestions: 15, subjects: grade === 3
      ? [{ subject_key: 'english', subject: 'English' }] : [{ subject_key: 'science', subject: 'Science' }] }
    : { success: true, grades: [3, 4], maxQuestions: 50, defaultQuestions: 15 }));
});

describe('the topic-end nudge\'s link', () => {
  it('fills grade, subject and chapter in, untagged, and goes on to Topics with nothing ticked', async () => {
    setPicks({ grade: 4, subject: 'science', chapters: [9], origin: 'report' }); // an earlier paper's picks in this tab
    at('?by=topics&grade=3&subject=english&chapter=4');
    await screen.findByText('topics step');
    await waitFor(() => expect(JSON.parse(screen.getByTestId('picks').textContent || '{}'))
      .toEqual({ grade: 3, subject: 'english', chapters: [4], origin: null, byTopics: true, topicIds: null }));
  });

  it('a subject not offered for that grade: stays on Class, topics remembered', async () => {
    at('?by=topics&grade=3&subject=science&chapter=4');
    await waitFor(() => expect(JSON.parse(screen.getByTestId('picks').textContent || '{}').byTopics).toBe(true));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByText('class step')).toBeTruthy();
    expect(JSON.parse(screen.getByTestId('picks').textContent || '{}').grade).toBeNull();
  });

  it('by=topics alone (the hub offer): Class as today', async () => {
    at('?by=topics');
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByText('class step')).toBeTruthy();
    expect(JSON.parse(screen.getByTestId('picks').textContent || '{}').grade).toBeNull();
  });
});
