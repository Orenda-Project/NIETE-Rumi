import { describe, it, expect } from 'vitest';
import { readLink, reportPicks } from './linkPicks';
import { newPicks, toSpec } from './model';
import type { Catalogue } from './api';

/** bd-pw1ccr.1/.2 — the A/B report button's link: origin=report, and grade, subject, chapter filled in. */

const CAT = { byGrade: { 3: [{ key: 'english', name: 'English' }, { key: 'urdu', name: 'Urdu' }] } } as unknown as Catalogue;
const q = (s: string) => new URLSearchParams(s);

describe('readLink', () => {
  it('reads origin and the pre-fill', () => {
    expect(readLink(q('origin=report&grade=3&subject=english&chapter=4')))
      .toEqual({ origin: 'report', prefill: { grade: 3, subject: 'english', chapter: 4 } });
  });
  it('origin alone: no pre-fill', () => {
    expect(readLink(q('origin=report'))).toEqual({ origin: 'report', prefill: null });
  });
  it('a pre-fill without origin=report is ignored', () => {
    expect(readLink(q('grade=3&subject=english&chapter=4'))).toEqual({ origin: null, prefill: null });
  });
  it.each(['grade=x&subject=english&chapter=4', 'grade=3&subject=&chapter=4', 'grade=3&subject=english&chapter=0',
    'grade=3&subject=english', 'grade=3.5&subject=english&chapter=4'])('a malformed pre-fill is dropped: %s', (s) => {
    expect(readLink(q(`origin=report&${s}`))).toEqual({ origin: 'report', prefill: null });
  });
  it('any other origin is no origin', () => {
    expect(readLink(q('origin=hub')).origin).toBeNull();
  });
});

describe('reportPicks', () => {
  it('a fresh paper on that one chapter, tagged report', () => {
    const p = reportPicks({ grade: 3, subject: 'english', chapter: 4 }, CAT, 15);
    expect(p).toEqual({
      ...newPicks(15), grade: 3, subject: 'english', subjectName: 'English', coverBy: 'chapters', chapters: [4], origin: 'report',
    });
  });
  it('a subject the catalogue does not offer for that grade: null', () => {
    expect(reportPicks({ grade: 3, subject: 'science', chapter: 4 }, CAT, 15)).toBeNull();
    expect(reportPicks({ grade: 4, subject: 'english', chapter: 4 }, CAT, 15)).toBeNull();
  });
});

describe('toSpec carries the tag', () => {
  const ready = { ...newPicks(15), grade: 3, subject: 'english', subjectName: 'English', chapters: [4], typeCounts: { mcq: 5 } };
  it('origin report rides on the request', () => {
    expect(toSpec({ ...ready, origin: 'report' })).toEqual(expect.objectContaining({ origin: 'report' }));
  });
  it('no origin: the request is unchanged', () => {
    expect(toSpec(ready)).not.toHaveProperty('origin');
  });
  it('a new paper starts untagged', () => {
    expect(newPicks(15).origin).toBeNull();
  });
});
