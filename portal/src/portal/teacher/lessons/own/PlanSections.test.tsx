import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OWN_COPY as C } from './copy';
import { changeUrl, type ChangeAt } from './change';
import { PlanSections, phaseOf, type Section } from './PlanSections';

/**
 * bd-snkn32.19 — screen 9 of the unified spec, her plan section by section:
 *
 *   Given a made plan             its sections as cards in plan order, each with Change this section (N left)
 *   Given a 6–12 plan             each card carries its I do / We do / You do tag; no "whole plan" card
 *   When one section was changed  that card says Changed with Before / After; every other card says Unchanged
 *   Given no changes left         no Change button on any card
 */

const K5: ChangeAt = { own: 'own-1', band: 'k5', left: 2, grade: 4, subject: 'math', chapter: '1', lesson: 'g4m2' };
const G612: ChangeAt = { ...K5, band: 'g612', grade: 8, subject: 'Science', lesson: 'sci8.c02.p010' };
const long = Array.from({ length: 8 }, (_, i) => `Line ${i + 1} of the section.`).join('\n');
const K5_SECTIONS: Section[] = [
  { part: 'hook', text: 'Ask who has seen a market.' },
  { part: 'i_do', text: 'Show 3 + 4 with stones.' },
  { part: 'we_do', text: long, way: 'games' },
  { part: 'you_do', text: 'Children add in their books.' },
  { part: 'wrap', text: 'One question to close.' },
];
const show = (at: ChangeAt, sections: Section[], changed: Section['part'] | null = null) => render(
  <MemoryRouter><PlanSections C={C} at={at} sections={sections} changed={changed} /></MemoryRouter>,
);
afterEach(cleanup);

describe('her plan, section by section', () => {
  it('1–5: the five sections in order, each with Change this section (N left), opening on that section', () => {
    show(K5, K5_SECTIONS);
    const cards = screen.getAllByTestId(/^own-sec-/).filter((e) => e.tagName === 'SECTION');
    expect(cards.map((c) => c.getAttribute('data-testid'))).toEqual(['own-sec-hook', 'own-sec-i_do', 'own-sec-we_do', 'own-sec-you_do', 'own-sec-wrap']);
    const change = screen.getByTestId('own-sec-change-we_do');
    expect(change.textContent).toBe(C.changeSection(2));
    expect(change.getAttribute('href')).toBe(changeUrl({ ...K5, part: 'we_do' }));
    expect(screen.getByTestId('own-sec-we_do').textContent).toContain(`${C.partNames.we_do} · ${C.ways.games}`);
    expect(screen.getByTestId('own-grr').textContent).toBe(C.grrLine);
    expect(screen.queryByText(C.unchanged)).toBeNull();
  });

  it('a long section shows 3 lines, then Show all / Show less', () => {
    show(K5, K5_SECTIONS);
    const body = screen.getByTestId('own-sec-text-we_do');
    expect(body.className).toContain('line-clamp-3');
    fireEvent.click(screen.getByTestId('own-sec-more-we_do'));
    expect(body.className).not.toContain('line-clamp-3');
    expect(screen.getByTestId('own-sec-more-we_do').textContent).toBe(C.showLess);
    expect(screen.queryByTestId('own-sec-more-hook')).toBeNull();
  });

  it('6–12: each section tagged with its phase; never a whole-plan card', () => {
    show(G612, [
      { part: 'introduction', text: 'Recall speed.' }, { part: 'development', text: 'Teacher shows, class tries.' },
      { part: 'activity', text: 'Groups measure.' }, { part: 'homework', text: 'Q1–3.' },
    ]);
    expect(screen.getByTestId('own-sec-phase-development').textContent).toBe(`${C.partNames.i_do} · ${C.partNames.we_do}`);
    expect(screen.getByTestId('own-sec-phase-activity').textContent).toBe(C.partNames.you_do);
    expect(screen.queryByTestId('own-sec-phase-homework')).toBeNull();
    expect(screen.queryByTestId('own-sec-whole')).toBeNull();
  });

  it('a changed section: Changed, with Before / After; every other card says Unchanged', () => {
    show(K5, [{ ...K5_SECTIONS[1] }, { part: 'we_do', text: 'Pairs race with stones.', before: 'Choral counting.' }], 'we_do');
    expect(screen.getByTestId('own-sec-badge-we_do').textContent).toBe(C.changed);
    expect(screen.getByTestId('own-sec-badge-i_do').textContent).toBe(C.unchanged);
    expect(screen.getByTestId('own-sec-text-we_do').textContent).toBe('Pairs race with stones.');
    fireEvent.click(screen.getByRole('radio', { name: C.before }));
    expect(screen.getByTestId('own-sec-text-we_do').textContent).toBe('Choral counting.');
    expect(screen.queryByRole('radiogroup', { name: `${C.partNames.i_do}: ${C.before} / ${C.after}` })).toBeNull();
  });

  it('no changes left: no Change button', () => {
    show({ ...K5, left: 0 }, K5_SECTIONS);
    expect(screen.queryByTestId('own-sec-change-we_do')).toBeNull();
  });

  it('phaseOf: 1–5 parts are their own phase; 6–12 development is I do + We do, activity is You do', () => {
    expect(phaseOf('i_do')).toEqual([]);
    expect(phaseOf('development')).toEqual(['i_do', 'we_do']);
    expect(phaseOf('activity')).toEqual(['you_do']);
    expect(phaseOf('objectives')).toEqual([]);
  });
});
