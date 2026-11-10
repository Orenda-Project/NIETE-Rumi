import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

/**
 * bd-snkn32 — "Make my own" as a teacher walks it (BDD over the real pages; the network stubbed):
 *
 *   Given the flag is off       the chapter page is today's: no "Make my own", and its address sends her back
 *   Given the flag is on        a grades 6–12 chapter shows the row, and so does a grades 1–5 one (bd-snkn32.4)
 *   When she answers the five   OK moves her on, each answer in the address; the teaching way is suggested first
 *   And taps Make my plan       her codes go to POST /lp612/own and the Preparing page opens on her fork's id
 *   But it cannot be started    she sees "Couldn't make it" and stays on the check screen
 */

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('../../../components/PortalLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../../../lib/recordingSession', () => ({ useRecordingSession: () => null }));
vi.mock('../../../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const flag = vi.hoisted(() => ({ on: true }));
vi.mock('../../../lib/useNewUi', async (orig) => ({
  ...(await orig<object>()),
  readConfigShared: () => Promise.resolve({ success: true, features: { lpMakeOwn: flag.on } }),
}));

import api from '../../../services/api';
import { resetLessonPlans } from '../../../newui/lessons/lessonPlansApi';
import { LessonsPage } from '../LessonsPage';
import { OwnPage } from './OwnPage';
import { lessonsUrl, LESSONS_HOME } from '../paths';
import { LESSONS_OWN } from './state';
import { OWN_COPY as C } from './copy';

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

function Where() {
  const l = useLocation();
  return <div data-testid="where">{`${l.pathname}${l.search}`}</div>;
}

function at(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path={`${LESSONS_HOME}/lessons`} element={<LessonsPage />} />
        <Route path={LESSONS_OWN} element={<OwnPage />} />
        <Route path="*" element={<div />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}
const where = () => screen.getByTestId('where').textContent ?? '';

beforeEach(() => {
  vi.clearAllMocks();
  resetLessonPlans();
  flag.on = true;
  try { localStorage.clear(); } catch { /* none */ }
  http.get.mockImplementation(async (url: string) => {
    const data: Record<string, unknown> = {
      '/curriculum/grades': { grades: [{ grade: 4, subject_count: 1 }] },
      '/lp612/grades': { grades: [{ grade: 8 }] },
      '/lp612/subjects': { subjects: [{ subject: 'Science', lesson_count: 2 }] },
      '/curriculum/subjects': { subjects: [{ subject_key: 'math', subject: 'Math', lesson_count: 1 }] },
      '/lp612/chapters': { chapters: [{ chapter_key: 'c02', chapter_number: 2, chapter_title: 'Motion', lesson_count: 2 }] },
      '/curriculum/chapters': { chapters: [{ chapter_number: 1, chapter_title: 'Numbers', lesson_count: 1 }] },
      '/lp612/lessons': { lessons: [
        { segment_id: 'sci8.c02.p010', title: 'Speed', pages_label: 'p.10–13', sent: false },
        { segment_id: 'sci8.c02.p014', title: 'Distance', pages_label: 'p.14–16', sent: false },
      ] },
      '/curriculum/lps': { lessons: [
        { lesson_id: 'g4m1', lp_type: 'content', day_label: 'Day 1', topic: 'Counting', pages_label: 'p.2' },
        { lesson_id: 'g4m2', lp_type: 'content', day_label: 'Day 2', topic: 'Adding', pages_label: 'p.3' },
        { lesson_id: 'g4m990', lp_type: 'assessment', day_label: 'Worksheet', topic: 'Worksheet' },
      ] },
    };
    if (!(url in data)) throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
    return { data: data[url] };
  });
});

describe('the chapter page', () => {
  it('flag off: no Make my own, the ready plans as today', async () => {
    flag.on = false;
    at(lessonsUrl('lessons', { grade: 8, subject: 'Science', chapter: 'c02' }));
    await screen.findByText('Speed');
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('own-entry')).toBeNull();
  });

  it('flag on, grades 6–12: the Make my own row, into step 1', async () => {
    at(lessonsUrl('lessons', { grade: 8, subject: 'Science', chapter: 'c02' }));
    const row = await screen.findByTestId('own-entry-row');
    expect(row.textContent).toContain(C.makeMyOwn);
    expect(row.getAttribute('href')).toBe(`${LESSONS_OWN}?grade=8&subject=Science&chapter=c02`);
  });

  // bd-oitowp — operator, 9 Nov: "at the top, not scrolling to the bottom, it'll be missed then".
  it('flag on: Make my own comes FIRST, above the ready plans, as its own card with no heading', async () => {
    at(lessonsUrl('lessons', { grade: 8, subject: 'Science', chapter: 'c02' }));
    const entry = await screen.findByTestId('own-entry');
    const firstPlan = screen.getByText('Speed');
    expect(entry.compareDocumentPosition(firstPlan) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(entry.contains(firstPlan)).toBe(false);
    expect(screen.queryByRole('heading', { name: 'For your class' })).toBeNull();
    expect(screen.getByTestId('own-entry-row').textContent).toContain(C.lessonPlanFive);
  });

  it('flag on: the card and the plans arrive together (no card alone while the plans load)', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const plain = http.get.getMockImplementation()!;
    http.get.mockImplementation(async (url: string, ...rest: unknown[]) => {
      if (url === '/lp612/lessons') await gate;
      return plain(url, ...rest);
    });
    at(lessonsUrl('lessons', { grade: 8, subject: 'Science', chapter: 'c02' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('own-entry')).toBeNull();
    release();
    await screen.findByTestId('own-entry');
    expect(screen.getByText('Speed')).toBeTruthy();
  });

  // bd-snkn32.4 — operator, 9 Nov: "do it for 1-5 also". The same card, first, above the ready plans.
  it('flag on, grades 1–5: the Make my own row FIRST, above the days', async () => {
    at(lessonsUrl('lessons', { grade: 4, subject: 'math', chapter: '1' }));
    const entry = await screen.findByTestId('own-entry');
    expect(entry.compareDocumentPosition(screen.getByText('Counting')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('own-entry-row').getAttribute('href')).toBe(`${LESSONS_OWN}?grade=4&subject=math&chapter=1`);
  });

  it('flag off, grades 1–5: the chapter page as today', async () => {
    flag.on = false;
    at(lessonsUrl('lessons', { grade: 4, subject: 'math', chapter: '1' }));
    await screen.findByText('Counting');
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('own-entry')).toBeNull();
  });
});

describe('Make my own', () => {
  it('flag off: its address sends her back to the chapter', async () => {
    flag.on = false;
    at(`${LESSONS_OWN}?grade=8&subject=Science&chapter=c02`);
    await waitFor(() => expect(where()).toContain('/lessons/lessons?'));
  });

  it('walks the five questions, then Make my plan opens Preparing on her fork', async () => {
    http.post.mockResolvedValue({ data: { success: true, state: 'authoring', renderId: 'own-1' } });
    at(`${LESSONS_OWN}?grade=8&subject=Science&chapter=c02`);

    const ok = () => screen.getByTestId('own-ok');
    await screen.findByTestId('own-opt-sci8.c02.p014');
    expect(ok()).toBeDisabled();
    fireEvent.click(screen.getByTestId('own-opt-sci8.c02.p014'));
    await waitFor(() => expect(where()).toContain('seg=sci8.c02.p014'));
    fireEvent.click(ok());

    await screen.findByTestId('own-opt-51_70');
    fireEvent.click(screen.getByTestId('own-opt-51_70'));
    await waitFor(() => expect(where()).toContain('size=51_70'));
    fireEvent.click(ok());

    await screen.findByTestId('own-opt-objects');
    fireEvent.click(screen.getByTestId('own-opt-textbook'));   // always there: a tap changes nothing
    fireEvent.click(screen.getByTestId('own-opt-board'));
    await waitFor(() => expect(where()).toContain('res=board'));
    expect(where()).not.toContain('textbook');
    fireEvent.click(ok());

    await screen.findByTestId('own-opt-mixed');
    fireEvent.click(screen.getByTestId('own-opt-mixed'));
    await waitFor(() => expect(where()).toContain('level=mixed'));
    fireEvent.click(ok());

    // bd-snkn32.13 — Grade 8: what is this lesson for? (no board exam below Grade 9)
    await screen.findByTestId('own-opt-revise');
    expect(screen.queryByTestId('own-opt-board')).toBeNull();
    expect(ok()).toBeDisabled();
    fireEvent.click(screen.getByTestId('own-opt-revise'));
    await waitFor(() => expect(where()).toContain('purpose=revise'));
    fireEvent.click(ok());

    // Science → demonstration or practical, suggested and first; none of the primary ways.
    const first = await screen.findByTestId('own-opt-practical');
    expect(first.textContent).toContain(C.suggested);
    for (const w of ['tarl', 'cpa', 'phonics', 'games', 'story']) expect(screen.queryByTestId(`own-opt-${w}`)).toBeNull();
    expect(screen.getByTestId('own-opt-worked')).toBeTruthy();
    fireEvent.click(ok());   // keeps the suggestion

    await screen.findByTestId('own-make');
    expect(where()).toContain('way=practical');
    expect(screen.getByText(C.purposes.revise)).toBeTruthy();
    fireEvent.change(screen.getByTestId('own-note'), { target: { value: 'Two grades in one room' } });
    fireEvent.click(screen.getByTestId('own-make'));

    await waitFor(() => expect(where()).toContain('/lessons/preparing?'));
    expect(http.post).toHaveBeenCalledWith('/lp612/own', {
      segment_id: 'sci8.c02.p014',
      answers: {
        size: '51_70', resources: ['textbook', 'board'], level: 'mixed', way: 'practical', note: 'Two grades in one room', purpose: 'revise',
      },
    });
    expect(where()).toContain('render=own-1');
    expect(where()).toContain('lesson=sci8.c02.p014');
  });

  it('remembers children in class on this phone', async () => {
    localStorage.setItem('lp-own-size', '31_50');
    at(`${LESSONS_OWN}?grade=8&subject=Science&chapter=c02&step=size&seg=sci8.c02.p010`);
    const row = await screen.findByTestId('own-opt-31_50');
    expect(row.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('own-ok')).not.toBeDisabled();
  });

  it('a plan that cannot be started: "Couldn\'t make it", and she stays to try again', async () => {
    http.post.mockRejectedValue(Object.assign(new Error('502'), { response: { status: 502 } }));
    at(`${LESSONS_OWN}?grade=8&subject=Science&chapter=c02&step=check&seg=sci8.c02.p010&size=up30&level=ahead&purpose=new&way=worked`);
    fireEvent.click(await screen.findByTestId('own-make'));
    expect(await screen.findByRole('alert')).toHaveTextContent(C.couldNotMake);
    expect(where()).toContain(LESSONS_OWN);
    expect(screen.getByTestId('own-make')).toHaveTextContent(C.tryAgain);
  });
});

// bd-snkn32.13 — a Grade 9–12 lesson whose FBISE SLOs mix Summative and Formative asks which come first.
describe('Make my own, grades 9–12', () => {
  const mix = (mixed: boolean) => {
    const plain = http.get.getMockImplementation()!;
    http.get.mockImplementation(async (url: string, ...rest: unknown[]) => {
      if (url === '/lp612/grades') return { data: { grades: [{ grade: 8 }, { grade: 10 }] } };
      if (url.startsWith('/lp612/own/slo/')) {
        return { data: mixed ? { success: true, mixed: true, summative: ['C-10-A-01'], formative: ['C-10-A-02'] } : { success: true, mixed: false, summative: [], formative: [] } };
      }
      return plain(url, ...rest);
    });
  };
  const base = `${LESSONS_OWN}?grade=10&subject=Chemistry&chapter=c02&seg=sci8.c02.p014&size=up30&level=ahead`;

  it('board exam practice is offered, and suggests past papers', async () => {
    mix(false);
    at(`${base}&step=purpose`);
    fireEvent.click(await screen.findByTestId('own-opt-board'));
    await waitFor(() => expect(where()).toContain('purpose=board'));
    fireEvent.click(screen.getByTestId('own-ok'));
    expect((await screen.findByTestId('own-opt-past_paper')).textContent).toContain(C.suggested);
  });

  it('a mixed lesson: after the way, which SLOs first, then the check; the choice is sent', async () => {
    mix(true);
    http.post.mockResolvedValue({ data: { success: true, state: 'authoring', renderId: 'own-2' } });
    at(`${base}&purpose=new&way=worked&step=way`);
    await screen.findByTestId('own-opt-worked');
    await waitFor(() => expect(http.get).toHaveBeenCalledWith('/lp612/own/slo/sci8.c02.p014'));
    fireEvent.click(screen.getByTestId('own-ok'));
    const summative = await screen.findByTestId('own-opt-summative');
    expect(summative.textContent).toContain('C-10-A-01');
    expect(screen.getByTestId('own-ok')).toBeDisabled();
    fireEvent.click(summative);
    await waitFor(() => expect(where()).toContain('focus=summative'));
    fireEvent.click(screen.getByTestId('own-ok'));
    const make = await screen.findByTestId('own-make');
    expect(screen.getByText(C.foci.summative)).toBeTruthy();
    await waitFor(() => expect(make).not.toBeDisabled());
    fireEvent.click(make);
    await waitFor(() => expect(http.post).toHaveBeenCalledWith('/lp612/own', {
      segment_id: 'sci8.c02.p014',
      answers: { size: 'up30', resources: ['textbook'], level: 'ahead', way: 'worked', note: '', purpose: 'new', focus: 'summative' },
    }));
  });

  it('a lesson that is not mixed goes from the way straight to the check', async () => {
    mix(false);
    at(`${base}&purpose=new&way=worked&step=way`);
    await screen.findByTestId('own-opt-worked');
    await waitFor(() => expect(http.get).toHaveBeenCalledWith('/lp612/own/slo/sci8.c02.p014'));
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.click(screen.getByTestId('own-ok'));
    await screen.findByTestId('own-make');
  });
});

describe('Make my own, grades 1–5 (bd-snkn32.4)', () => {
  it('step 1 lists the chapter\'s lesson plans (days only, no worksheet), and Make my plan sends lesson_id', async () => {
    http.post.mockResolvedValue({ data: { success: true, state: 'authoring', renderId: 'own-k5' } });
    at(`${LESSONS_OWN}?grade=4&subject=math&chapter=1`);
    const day2 = await screen.findByTestId('own-opt-g4m2');
    expect(day2.textContent).toContain('Day 2 · Adding');
    expect(day2.textContent).toContain('p.3');
    expect(screen.queryByTestId('own-opt-g4m990')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(C.day);
    fireEvent.click(day2);
    await waitFor(() => expect(where()).toContain('seg=g4m2'));

    at(`${LESSONS_OWN}?grade=4&subject=math&chapter=1&step=check&seg=g4m2&size=over70&level=behind&way=tarl`);
    fireEvent.click(await screen.findAllByTestId('own-make').then((b) => b[b.length - 1]));
    await waitFor(() => expect(http.post).toHaveBeenCalledWith('/lp612/own', {
      lesson_id: 'g4m2',
      answers: { size: 'over70', resources: ['textbook'], level: 'behind', way: 'tarl', note: '' },
    }));
  });
});
