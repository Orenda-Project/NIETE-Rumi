import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OWN_COPY } from './copy';
import { readOwn } from './state';
import { Check } from './Check';

/**
 * bd-snkn32.19 — "Your plan" (screen 8), out of OwnPage: every answer in the band's words, each with Change, the note,
 * and what went wrong. Grade 8 exam practice is named for the FDE exam; 6–12 say Students; the GRR line is fixed.
 */
const C = OWN_COPY as unknown as Parameters<typeof Check>[0]['C'];
const show = (search: string, over: Partial<Parameters<typeof Check>[0]> = {}) => render(
  <MemoryRouter>
    <Check s={readOwn(search)!} C={C} k5={false} nextLabel={null} pagesLabel="p.42–45" gradeLabel="Grade 8" note="" setNote={() => {}} failed={null} {...over} />
  </MemoryRouter>,
);

beforeEach(() => cleanup());

describe('Check', () => {
  it('Grade 8: Students, lab things, exam practice (FDE) as both purpose and way', () => {
    show('grade=8&subject=Science&chapter=c02&seg=s&size=up30&res=objects&level=behind&purpose=board&way=exam_fde');
    const t = document.body.textContent ?? '';
    expect(t).toContain('Students in class');
    expect(t).toContain('Textbook, Lab things or models');
    expect(t.split('Exam practice (FDE)')).toHaveLength(3);
    expect(t).not.toContain('Exam-paper');
    expect(t).toContain('Where is your class on these pages?');
    expect(t).toContain(OWN_COPY.grrLine);
  });
  it('Grade 4: Children, no purpose row, the day label', () => {
    show('grade=4&subject=Math&chapter=1&seg=d&size=up30&level=behind&way=cpa', { k5: true, pagesLabel: 'Day 2 · Adding' });
    const t = document.body.textContent ?? '';
    expect(t).toContain('Children in class');
    expect(t).toContain('Day 2 · Adding');
    expect(t).not.toContain(OWN_COPY.purposeLabel);
    expect(t).toContain('Things → pictures → numbers (CPA)');
  });
  it('the outcomes row only when chosen; the next lesson when added', () => {
    show('grade=10&subject=Physics&chapter=c&seg=s&purpose=new&focus=formative&ext=double', { nextLabel: 'p.46–48' });
    expect(screen.getByText('Classroom outcomes first')).toBeTruthy();
    expect(screen.getByText(OWN_COPY.extends.double)).toBeTruthy();
  });
  it('the note is hers; a refusal is told in plain words', () => {
    const setNote = vi.fn();
    show('grade=10&subject=Physics&chapter=c&seg=s', { setNote, failed: 'daily_limit' });
    fireEvent.change(screen.getByTestId('own-note'), { target: { value: 'two sections' } });
    expect(setNote).toHaveBeenCalledWith('two sections');
    expect(screen.getByRole('alert').textContent).toBe(OWN_COPY.refusals.daily_limit);
  });
});
