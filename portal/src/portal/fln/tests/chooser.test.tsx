import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { FlnProvider } from '../FlnContext';
import { LevelChooser } from '../LevelChooser';
import { flnStrings } from '../strings';
import { ME_TEACHER, numG2, rhEnG8, stubFetch } from './listFixtures';
import type { FlnMe } from '../types';

/**
 * S3b, the level chooser for grades 6–12 (DESIGN v2 §3): the screener first with its OWN minutes
 * and note, the answer-key chip, NO ✓; three level cards with descriptor, grades, the real count and the
 * Beginner → Level 1 map. A level → ?grade=&level=; the screener → its plan.
 */

const EN = flnStrings('en');

function Where() {
  const loc = useLocation();
  return <div data-testid="where" data-path={loc.pathname} data-search={loc.search} />;
}
function renderChooser(subject: 'rh-en' | 'num', me: FlnMe = ME_TEACHER) {
  return render(
    <MemoryRouter initialEntries={[`/portal/fln/list/${subject}?grade=8`]}>
      <FlnProvider me={me}>
        <Routes>
          <Route path="/portal/fln/list/:subject" element={<LevelChooser subject={subject} grade={8} />} />
          <Route path="*" element={null} />
        </Routes>
      </FlnProvider>
      <Where />
    </MemoryRouter>,
  );
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('LevelChooser', () => {
  it('title, the one line, one screener card with real minutes, its note and the answer-key chip, no ✓', async () => {
    stubFetch({ '/catalogue': { status: 200, body: rhEnG8() } });
    const { container } = renderChooser('rh-en');
    expect(await screen.findByRole('heading', { name: EN.chooser.title })).toBeInTheDocument();
    expect(screen.getByText(EN.chooser.line)).toBeInTheDocument();
    const cards = container.querySelectorAll('[data-fln-screener]');
    expect(cards).toHaveLength(1);
    const card = cards[0] as HTMLElement;
    expect(card.textContent).toContain(EN.minutes(53));
    expect(card.textContent).not.toContain('10 min');
    expect(card.textContent).toContain('one child at a time · 2–4 sessions');
    expect(card.textContent).toContain(EN.chip.answerKey);
    expect(card.textContent).toContain(EN.chooser.startHere);
    expect(card.textContent).not.toContain('✓');
    expect(card.getAttribute('href')).toBe('/portal/fln/p/9002');
  });

  it('three level cards: descriptor, grades, the real count, the group map', async () => {
    stubFetch({ '/catalogue': { status: 200, body: rhEnG8() } });
    const { container } = renderChooser('rh-en');
    await screen.findByRole('heading', { name: EN.chooser.title });
    const levels = Array.from(container.querySelectorAll('[data-fln-level]')) as HTMLElement[];
    expect(levels).toHaveLength(3);
    expect(levels[0].textContent).toContain(EN.levelDesc['rh-en'][1]);
    expect(levels[0].textContent).toContain(EN.levelGrades[1]);
    expect(levels[0].textContent).toContain(EN.lessons(66));
    expect(levels[1].textContent).toContain(EN.lessons(72));
    expect(levels[2].textContent).toContain(EN.chooser.groupMap[3]);
  });

  it('a level card → the same page with ?grade=8&level=n', async () => {
    stubFetch({ '/catalogue': { status: 200, body: rhEnG8() } });
    const { container } = renderChooser('rh-en');
    await screen.findByRole('heading', { name: EN.chooser.title });
    fireEvent.click(container.querySelectorAll('[data-fln-level]')[1]);
    await waitFor(() => expect(screen.getByTestId('where').dataset.search).toBe('?grade=8&level=2'));
    expect(screen.getByTestId('where').dataset.path).toBe('/portal/fln/list/rh-en');
  });

  it('Numeracy: one screener card per level (its own id and minutes)', async () => {
    stubFetch({ '/catalogue': { status: 200, body: { ...numG2(), grade: 8, level: null, strands: [] } } });
    const { container } = renderChooser('num');
    await screen.findByRole('heading', { name: EN.chooser.title });
    const cards = Array.from(container.querySelectorAll('[data-fln-screener]')) as HTMLElement[];
    expect(cards.map((c) => c.getAttribute('href'))).toEqual(['/portal/fln/p/9201', '/portal/fln/p/9202', '/portal/fln/p/9203']);
    expect(cards[2].textContent).toContain(EN.minutes(23));
  });

  it('Back → the New-lesson page', async () => {
    stubFetch({ '/catalogue': { status: 200, body: rhEnG8() } });
    renderChooser('rh-en');
    await screen.findByRole('heading', { name: EN.chooser.title });
    expect(screen.getByRole('link', { name: EN.back }).getAttribute('href')).toBe('/portal/teacher/lessons/new');
  });

  it('Urdu: Urdu chrome, no «·», the screener note in Urdu', async () => {
    stubFetch({ '/catalogue': { status: 200, body: rhEnG8() } });
    const { container } = renderChooser('rh-en', { ...ME_TEACHER, ui_lang: 'ur' });
    const UR = flnStrings('ur');
    expect(await screen.findByRole('heading', { name: UR.chooser.title })).toBeInTheDocument();
    expect(container.textContent).not.toContain('·');
    const card = container.querySelector('[data-fln-screener]') as HTMLElement;
    expect(within(card).getByText('ایک وقت میں ایک بچہ')).toBeInTheDocument();
  });

  it('503 → the calm line with retry', async () => {
    stubFetch({ '/catalogue': { status: 503, body: { error: 'fln_unavailable' } } });
    renderChooser('rh-en');
    expect(await screen.findByText(EN.errors.unavailable)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: EN.errors.retry })).toBeInTheDocument();
  });
});
