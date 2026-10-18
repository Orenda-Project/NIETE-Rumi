import { describe, it, expect } from 'vitest';
import { planClips, gridClips, sectionClipIds, itemClips, clipIdOf } from '../player/clips';
import type { FlnPlanLike } from '../player/types';

const UUID = 'e0fba701-1a2b-4c3d-8e4f-0123456789ab';
const aud = (src: string, extra: Record<string, unknown> = {}) => ({ kind: 'audio', src, ...extra });

describe('clips: label chain', () => {
  it('uses label_ur in an Urdu plan and label_en in an English plan', () => {
    const item = { text: 'x', media: [aud('https://m.example/a.mp3', { label_ur: 'اردو', label_en: 'english' })] };
    expect(itemClips(item, 'ur')[0].label).toBe('اردو');
    expect(itemClips(item, 'en')[0].label).toBe('english');
  });

  it('falls back to the other language label before anything else', () => {
    expect(itemClips({ text: 'x', media: [aud('https://m.example/a.mp3', { label_en: 'only-en' })] }, 'ur')[0].label).toBe('only-en');
    expect(itemClips({ text: 'x', media: [aud('https://m.example/a.mp3', { label_ur: 'صرف' })] }, 'en')[0].label).toBe('صرف');
  });

  it('falls back to the first bold run, quotes and punctuation stripped', () => {
    const item = { text: 'Say **"c"** then **"k"**.', media: [aud('https://m.example/a.mp3')] };
    expect(itemClips(item, 'en')[0].label).toBe('c');
  });

  it('falls back to the filename stem, uuid prefix removed', () => {
    const item = { text: 'no bold here', media: [aud(`https://m.example/${UUID}_ck.mp3`)] };
    expect(itemClips(item, 'en')[0].label).toBe('ck');
  });

  it('keeps a plain filename stem', () => {
    expect(itemClips({ media: [aud('https://m.example/Apple.mp3')] })[0].label).toBe('Apple');
  });

  it('carries caption, role, orig and sizes; orig defaults to src', () => {
    const [c] = itemClips({ media: [aud('https://m.example/a.mp3', { orig: 'https://o.example/a.mp3', caption_en: 'as in Cat', role: 'word', duration_s: 1.2, bytes: 900, label: 'x' })] }, 'en');
    expect(c).toMatchObject({ src: 'https://m.example/a.mp3', orig: 'https://o.example/a.mp3', caption: 'as in Cat', role: 'word', duration_s: 1.2, bytes: 900 });
    expect(itemClips({ media: [aud('https://m.example/b.mp3')] })[0].orig).toBe('https://m.example/b.mp3');
  });

  it('ignores non-audio media', () => {
    expect(itemClips({ media: [{ kind: 'image', src: 'https://m.example/i.png' }] })).toEqual([]);
  });
});

describe('clips: ids, order, grid', () => {
  const plan: FlnPlanLike = {
    lang: 'en',
    setup: [{ text: 's', media: [aud('https://m.example/setup.mp3', { sha8: 'aaaa1111' })] }],
    sections: [
      { kind: 'one', groups: [{ items: [
        { text: '**b**', media: [aud('https://m.example/narr.mp3', { role: 'narration', sha8: 'nnnn0000' })] },
        { text: '**c**', media: [aud('https://m.example/c.mp3', { sha8: 'cccc2222' })] },
        { text: '**c** again', media: [aud('https://m.example/c-copy.mp3', { sha8: 'cccc2222' })] },
      ] }] },
      { kind: 'two', groups: [{ items: [
        { text: '**d**', media: [aud('https://m.example/d.mp3', { role: 'word' }), aud('https://m.example/d.mp3', { role: 'word' })] },
      ] }] },
    ],
    homework: [{ text: 'h', media: [aud('https://m.example/hw.mp3')] }],
    summary: [{ text: 'z', media: [aud('https://m.example/sum.mp3')] }],
  };

  it('id is sha8 when present, else src', () => {
    expect(clipIdOf({ kind: 'audio', src: 'https://m.example/x.mp3', sha8: 'abcd1234' })).toBe('abcd1234');
    expect(clipIdOf({ kind: 'audio', src: 'https://m.example/x.mp3' })).toBe('https://m.example/x.mp3');
  });

  it('planClips: first-appearance order across setup, sections, homework, summary', () => {
    expect(planClips(plan).map((c) => c.id)).toEqual([
      'aaaa1111', 'nnnn0000', 'cccc2222', 'https://m.example/d.mp3', 'https://m.example/hw.mp3', 'https://m.example/sum.mp3',
    ]);
  });

  it('planClips: distinct by id (a shared sha8 is one clip, first src wins)', () => {
    const c = planClips(plan).filter((x) => x.id === 'cccc2222');
    expect(c).toHaveLength(1);
    expect(c[0].src).toBe('https://m.example/c.mp3');
  });

  it('gridClips: narrations last, others keep first-appearance order', () => {
    const g = gridClips(plan).map((c) => c.id);
    expect(g[g.length - 1]).toBe('nnnn0000');
    expect(g.slice(0, -1)).toEqual(['aaaa1111', 'cccc2222', 'https://m.example/d.mp3', 'https://m.example/hw.mp3', 'https://m.example/sum.mp3']);
  });

  it('sectionClipIds: only that section, distinct', () => {
    expect(sectionClipIds(plan.sections![0])).toEqual(['nnnn0000', 'cccc2222']);
    expect(sectionClipIds(plan.sections![1])).toEqual(['https://m.example/d.mp3']);
  });

  it('itemClips keeps repeats within one step', () => {
    const ids = itemClips(plan.sections![1].groups![0].items![0], 'en').map((c) => c.id);
    expect(ids).toEqual(['https://m.example/d.mp3', 'https://m.example/d.mp3']);
  });

  it('an empty plan has no clips', () => {
    expect(planClips({})).toEqual([]);
    expect(gridClips({})).toEqual([]);
  });
});
