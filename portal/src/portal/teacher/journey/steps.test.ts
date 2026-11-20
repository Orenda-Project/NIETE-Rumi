import { describe, it, expect } from 'vitest';
import { AudioLines, BookOpen, CircleCheck, ClipboardList, FileText, Lightbulb, ListChecks } from 'lucide-react';
import { stepRow, type RowWords } from './steps';
import { JOURNEY_COPY } from './copy';

const NOW = Date.parse('2026-11-19T14:40:00+05:00');
const AT = new Date(Date.parse('2026-11-19T09:00:00+05:00')).toISOString();
const W: RowWords = {
  J: JOURNEY_COPY,
  gradeShort: (g) => `G${g}`,
  chapter: (n) => `Chap ${n}`,
  days: { today: 'Today', yesterday: 'Yesterday', weekdaysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] },
  bands: { excellent: 'Excellent', good: 'Good', average: 'Average', below_average: 'Below average', needs_support: 'Needs support' },
  lang: 'en',
};
const row = (kind: string, refId: string, meta: Record<string, unknown>, readOnly = false) =>
  stepRow({ kind, at: AT, refId, meta }, NOW, W, { readOnly });

describe('stepRow — one line per step, its icon, data · day, and what it opens', () => {
  it('opened a plan: class · day → the plan by its key', () => {
    const r = row('plan_opened', 'grade_3_math_ch2_seg1', { plan_kind: 'k5', grade: 3, subject: 'math' });
    expect(r).toMatchObject({ lead: 'glyph', glyph: BookOpen, title: 'Opened a lesson plan', extra: 'G3 Math · Today', action: 'chevron' });
    expect(r.to).toBe('/portal/teacher/lessons/open?plan=k5%3Agrade_3_math_ch2_seg1&grade=3');
  });
  it('taught: class · topic · day → the plan she taught', () => {
    const r = row('taught', 'f1', { plan_kind: 'g612', plan_ref: 'grade_7_history.c03.p046', grade: 7, subject: 'History', topic: 'Rivers' });
    expect(r).toMatchObject({ glyph: CircleCheck, title: 'Taught in class', extra: 'G7 Hist · Rivers · Today' });
    expect(r.to).toContain('plan=g612%3Agrade_7_history.c03.p046');
  });
  it('a taught line with no plan key is information', () => {
    expect(row('taught', 'f1', { topic: 'Rivers' })).toMatchObject({ action: 'none', to: undefined });
  });
  it('DC observation → its page', () => {
    expect(row('coached', 's1', { topic: 'Fractions' })).toMatchObject({ glyph: AudioLines, title: 'DC observation', extra: 'Fractions · Today', to: '/portal/teacher/coaching/report/s1' });
  });
  it('report ready: band chip (Good+ green, below amber), Opened when she opened it', () => {
    expect(row('report', 's1', { topic: 'Fractions', band: 'good', opened_at: AT })).toMatchObject({
      glyph: FileText, title: 'Report ready', extra: 'Fractions · Opened · Today', chip: { text: 'Good', tone: 'done' }, to: '/portal/teacher/coaching/report/s1',
    });
    expect(row('report', 's1', { band: 'average' }).chip).toEqual({ text: 'Average', tone: 'waiting' });
    expect(row('report', 's1', {}).chip).toBeNull();
  });
  it('tip: one line, cut with … → the report', () => {
    const r = row('tip', 's1', { text: 'Ask two children to explain their answer in their own words before you move on to the next part.' });
    expect(r).toMatchObject({ glyph: Lightbulb, title: 'Try next class', to: '/portal/teacher/coaching/report/s1' });
    expect(r.extra).toMatch(/^Ask two children .{20,}… · Today$/);
  });
  it('quiz: topic · day, n played when known; information (no quiz home here)', () => {
    expect(row('quiz', 'q1', { topic: 'Shapes', played: 12 })).toMatchObject({ glyph: ListChecks, title: 'Sent a quiz', extra: 'Shapes · Today', chip: { text: '12 played', tone: 'info' }, action: 'none' });
    expect(row('quiz', 'q1', { topic: 'Shapes' }).chip).toBeNull();
  });
  it('paper: class · chapter · day → the paper', () => {
    expect(row('exam', 'p1', { grade: 'grade_5', subject: 'math', chapter: 3 })).toMatchObject({
      glyph: ClipboardList, title: 'Made a paper', extra: 'G5 Math · Chap 3 · Today', to: '/portal/teacher/assessment/paper/p1',
    });
  });
  it('read-only (the team view): every line is information', () => {
    for (const k of ['plan_opened', 'coached', 'report', 'tip', 'exam']) {
      expect(row(k, 'x', { plan_kind: 'k5' }, true)).toMatchObject({ action: 'none', to: undefined });
    }
  });
});
