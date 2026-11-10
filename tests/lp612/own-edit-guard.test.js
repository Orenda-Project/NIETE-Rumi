'use strict';
/**
 * bd-snkn32.15 — "Change this plan": the guard that runs BEFORE any row is written or any model is paid for
 * (lp-own-edit-guard, pure). One change is one generation (~$0.24–0.36), so every refusal here is money not spent.
 */
const G = require('../../bot/shared/services/lp-own-edit-guard');

const ROOT = { id: 'root', parent_own_id: null, edit_round: null, status: 'ready', edit_request: null };
const chain = (...rows) => [ROOT, ...rows];
const round = (n, status, part = 'we_do', text = 'Make the we do a pair game with bottle caps') => ({
  id: `r${n}-${status}`, parent_own_id: 'root', edit_round: n, status, edit_request: { part, text },
});
const ask = (over = {}) => G.checkChange({
  band: 'k5', part: 'we_do', text: 'Make the we do a group game with stones and sticks', chain: chain(), todayCount: 0, ...over,
});

describe('part and text', () => {
  it('accepts a named part and a real request, as round 1', () => {
    expect(ask()).toEqual({ ok: true, round: 1, part: 'we_do', text: 'Make the we do a group game with stones and sticks' });
  });

  it.each([[undefined], [''], ['iDo'], ['development']])('grades 1–5 refuse part %p', (part) => {
    expect(ask({ part }).outcome).toBe('bad_request');
  });

  it('grades 6–12 take the plan\'s own sections, never the whole plan (bd-snkn32.19)', () => {
    for (const part of ['objectives', 'introduction', 'development', 'activity', 'conclusion', 'homework']) {
      expect(ask({ band: 'g612', part }).ok).toBe(true);
    }
    expect(ask({ band: 'g612', part: 'hook' }).outcome).toBe('bad_request');
    expect(ask({ band: 'g612', part: 'whole' }).outcome).toBe('bad_request');
  });

  it('text under 15 characters after trimming is too short', () => {
    expect(ask({ text: '   more games    ' }).outcome).toBe('too_short');
    expect(ask({ text: 12345 }).outcome).toBe('too_short');
  });

  it('a long request is cut to the limit, whitespace collapsed', () => {
    const out = ask({ text: `  Use   ${'stones '.repeat(80)}` });
    expect(out.ok).toBe(true);
    expect(out.text.length).toBe(G.TEXT_MAX);
    expect(out.text.startsWith('Use stones')).toBe(true);
  });
});

describe('tiny edits: refused, never counted', () => {
  it.each([
    'Please fix the spelling of photosynthesis',
    'Add a full stop at the end of each line',
    'There is a typo in the hook, please correct it',
    'commas are missing in the wrap part',
    'zer zabar pesh theek karein is mein',
    'اعراب درست کریں براہ مہربانی',
    'یہاں زیر اور زبر لگائیں پلیز',
    'کاما اور فل اسٹاپ لگا دیں',
  ])('%p is too small', (text) => {
    expect(G.isTinyEdit(text)).toBe(true);
    expect(ask({ text }).outcome).toBe('too_small');
  });

  it.each([
    'Make the we do a group game with stones and sticks',
    'Fix the spelling activity: children should write five new words from page 12 on their slates in pairs',
    'بچوں کو جوڑوں میں کنکروں سے گنتی کروائیں اور پھر کتاب کا سوال حل کریں',
  ])('%p is a real change', (text) => {
    expect(G.isTinyEdit(text)).toBe(false);
  });
});

describe('the chain', () => {
  it('a round still being written blocks another', () => {
    expect(ask({ chain: chain(round(1, 'authoring')) }).outcome).toBe('in_flight');
    expect(ask({ chain: [{ ...ROOT, status: 'authoring' }] }).outcome).toBe('in_flight');
  });

  it('a root plan that failed has nothing to change', () => {
    expect(ask({ chain: [{ ...ROOT, status: 'failed' }] }).outcome).toBe('not_found');
    expect(ask({ chain: [] }).outcome).toBe('not_found');
  });

  it('after one ready change, the next is round 2', () => {
    expect(ask({ chain: chain(round(1, 'ready')) }).round).toBe(2);
  });

  it('two changes used: cap_reached', () => {
    expect(ask({ chain: chain(round(1, 'ready'), round(2, 'ready')) }).outcome).toBe('cap_reached');
  });

  it('a failed round never counts: the same round is tried again', () => {
    expect(ask({ chain: chain(round(1, 'failed')) }).round).toBe(1);
    expect(ask({ chain: chain(round(1, 'ready'), round(2, 'failed')) }).round).toBe(2);
  });

  it('the same request as the last round, normalised, is a repeat', () => {
    const c = chain(round(1, 'ready', 'we_do', 'Make the we do a group game with stones and sticks'));
    expect(ask({ chain: c, text: '  make the WE DO a group game,  with stones and sticks! ' }).outcome).toBe('repeat');
    expect(ask({ chain: c, part: 'you_do' }).ok).toBe(true);
  });

  it('a failed round with the same words may be asked again', () => {
    const c = chain(round(1, 'failed', 'we_do', 'Make the we do a group game with stones and sticks'));
    expect(ask({ chain: c }).ok).toBe(true);
  });
});

describe('daily limit', () => {
  it('five makes and changes today: daily_limit', () => {
    expect(ask({ todayCount: 4 }).ok).toBe(true);
    expect(ask({ todayCount: 5 }).outcome).toBe('daily_limit');
    expect(G.DAILY_LIMIT).toBe(5);
  });

  it('a Pakistan day starts at midnight in Karachi (UTC+5)', () => {
    // 10 Nov 2026 20:30 UTC is 11 Nov 01:30 in Karachi: the day began 10 Nov 19:00 UTC.
    expect(G.karachiDayStart(Date.parse('2026-11-10T20:30:00Z'))).toBe('2026-11-10T19:00:00.000Z');
    expect(G.karachiDayStart(Date.parse('2026-11-10T18:59:00Z'))).toBe('2026-11-09T19:00:00.000Z');
  });
});

describe('changesLeft', () => {
  it('counts only rounds that did not fail', () => {
    expect(G.changesLeft(chain())).toBe(2);
    expect(G.changesLeft(chain(round(1, 'failed')))).toBe(2);
    expect(G.changesLeft(chain(round(1, 'ready')))).toBe(1);
    expect(G.changesLeft(chain(round(1, 'ready'), round(2, 'authoring')))).toBe(0);
  });
});

describe('the plan a change starts from', () => {
  it('is the latest ready plan in the chain: the root, then the highest ready round', () => {
    const root = { ...ROOT, r2_key: 'lp612/v9/en/edits/s/a.pdf' };
    expect(G.editBase([root]).id).toBe('root');
    expect(G.editBase([root, round(1, 'ready')]).id).toBe('r1-ready');
    expect(G.editBase([root, round(1, 'ready'), round(2, 'failed')]).id).toBe('r1-ready');
    expect(G.editBase([root, round(1, 'failed')]).id).toBe('root');
    expect(G.editBase([{ ...root, status: 'failed' }])).toBeNull();
  });

  it('its document sits beside its PDF: .lp.json for grades 6–12, .json for grades 1–5', () => {
    expect(G.baseJsonKey('lp612/v9.1/en/edits/seg/abc.pdf', 'g612')).toBe('lp612/v9.1/en/edits/seg/abc.lp.json');
    expect(G.baseJsonKey('lp612/own-k5/ur/grade_3_urdu_ch1_seg2/abc.pdf', 'k5')).toBe('lp612/own-k5/ur/grade_3_urdu_ch1_seg2/abc.json');
    expect(G.baseJsonKey(null, 'k5')).toBeNull();
    expect(G.baseJsonKey('lp612/x/abc.png', 'k5')).toBeNull();
  });

  it('the band follows the root: a grades 1–5 day has a lesson_id', () => {
    expect(G.bandOf({ lesson_id: 'grade_3_urdu_ch1_seg2' })).toBe('k5');
    expect(G.bandOf({ segment_id: 'grade_8_science.c02.p010-013' })).toBe('g612');
  });
});

describe('the status poll\'s change fields', () => {
  it('a ready own plan says how many changes are left and its band; anything else adds nothing', () => {
    expect(G.statusFields({ changes_left: 1, own_band: 'k5' })).toEqual({ changesLeft: 1, ownBand: 'k5' });
    expect(G.statusFields({ changes_left: 0, own_band: 'g612' })).toEqual({ changesLeft: 0, ownBand: 'g612' });
    expect(G.statusFields({ id: 'render-1' })).toEqual({});
    expect(G.statusFields(null)).toEqual({});
  });
});
