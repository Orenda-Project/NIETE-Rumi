'use strict';
/**
 * bd-snkn32.45 — the WhatsApp /observe lesson-plan list offers the observed teacher's own "Make my own"
 * plans beside the plans she downloaded. A picked own plan goes onto the observation exactly as the
 * portal's Check and send puts it (bd-snkn32.41): her stored PDF (resolved by observe-own-plans.resolveKey,
 * her user id + status ready) as lesson_plan_r2_key, extraction pending — an attached plan.
 * The label never assumes the teacher's gender: "Made by the teacher" / «ٹیچر کا بنایا ہوا».
 */
const fs = require('fs');
const path = require('path');

const OWN = '../../bot/shared/services/coaching/lp-coaching/lp-own-plans';
const HANDLER = '../../bot/shared/services/coaching/lp-coaching/lp-list-selection.handler';
const LIST = '../../bot/shared/services/coaching/lp-coaching/lp-selection-list.service';

const SID = 'd2163959-2942-4667-abb8-ab89c8cf7408';
const OWN_ID = '0e0e0000-0000-4000-8000-0000000000aa';
const TEACHER = '7eac0000-0000-4000-8000-000000000003';
const FROM = '923001234567';
const PDF = 'lp612/own-k5/en/grade_4_english_ch5_seg1/63d74689e29e32ca.pdf';
const cp = (s) => [...String(s)].length;

const ownPlan = (over = {}) => ({
  own: true, ownId: OWN_ID, lessonId: 'grade_4_english_ch5_seg1', topic: 'Describing words',
  grade: 4, subject: 'english', chapterNumber: '5', madeAt: '2026-11-12T08:00:00Z', ...over,
});
const download = (id, at) => ({ id, asset_id: id, topic: `Plan ${id}`, grade: '4', subject: 'english', created_at: at });

describe('own plans in the WhatsApp list', () => {
  test('the label is gender-neutral in both languages', () => {
    const { ownLabel } = require(OWN);
    expect(ownLabel('en')).toBe('Made by the teacher');
    expect(ownLabel('ur')).toBe('ٹیچر کا بنایا ہوا');
  });

  test('an own plan becomes an lp_own_ row: topic title, label + grade/subject/chapter, within 24 / 72', () => {
    const { buildLPSelectionList } = require(LIST);
    const { toListLp } = require(OWN);
    const lp = toListLp(ownPlan({ topic: 'A very long topic name that will not fit in a row' }));
    for (const lang of ['en', 'ur']) {
      const out = buildLPSelectionList(SID, [lp], lang, undefined, { isObservation: true });
      const row = out.listData.action.sections[0].rows[0];
      expect(row.id).toBe(`lp_own_${OWN_ID}_${SID}`);
      expect(cp(row.title)).toBeLessThanOrEqual(24);
      expect(cp(row.description)).toBeLessThanOrEqual(72);
      expect(row.description.startsWith(lang === 'ur' ? 'ٹیچر کا بنایا ہوا' : 'Made by the teacher')).toBe(true);
      expect(row.description).toContain('Ch5');
    }
  });

  test('merge: downloads and own plans newest first, never more than 8 rows', () => {
    const { mergeWithOwn, toListLp } = require(OWN);
    const dls = Array.from({ length: 8 }, (_, i) => download(`a${i}`, `2026-11-0${i + 1}T08:00:00Z`));
    const out = mergeWithOwn(dls, [toListLp(ownPlan())]);
    expect(out).toHaveLength(8);
    expect(out[0].ownId).toBe(OWN_ID); // 12 Nov, newer than every download
    expect(out[1].id).toBe('a7');
    expect(out.map((r) => r.id)).not.toContain('a0'); // the oldest falls off
  });

  test('recentWithOwn: her own ready plans come from observe-own-plans for the session owner', async () => {
    const { recentWithOwn } = require(OWN);
    const listOwn = jest.fn().mockResolvedValue([ownPlan()]);
    const out = await recentWithOwn(TEACHER, { downloads: async () => [download('a1', '2026-11-13T08:00:00Z')], listOwn });
    expect(listOwn).toHaveBeenCalledWith(TEACHER);
    expect(out.map((r) => r.id)).toEqual(['a1', OWN_ID]);
  });

  test('recentWithOwn: a failure loading her own plans leaves the downloads', async () => {
    const { recentWithOwn } = require(OWN);
    const out = await recentWithOwn(TEACHER, {
      downloads: async () => [download('a1', '2026-11-13T08:00:00Z')],
      listOwn: async () => { throw new Error('boom'); },
    });
    expect(out.map((r) => r.id)).toEqual(['a1']);
  });
});

describe('attaching her plan to the observation', () => {
  function fakeDb(session = { user_id: TEACHER }) {
    const writes = [];
    const supabase = {
      from: (t) => {
        const q = {
          select: () => q, eq: () => q,
          maybeSingle: async () => ({ data: session, error: null }),
          update: (row) => { writes.push({ table: t, row }); return { eq: async () => ({ error: null }) }; },
        };
        return q;
      },
    };
    return { supabase, writes };
  }

  test('her plan is resolved through observe-own-plans and written like an attached PDF', async () => {
    const { attachOwnPlan } = require(OWN);
    const { supabase, writes } = fakeDb();
    const resolveKey = jest.fn().mockResolvedValue(PDF);
    const queueExtraction = jest.fn().mockResolvedValue('m1');
    const out = await attachOwnPlan(SID, OWN_ID, {
      supabase, resolveKey, queueExtraction, publicUrl: (k) => `https://r2.example/${k}`,
    });
    expect(resolveKey).toHaveBeenCalledWith({ userId: TEACHER, ownId: OWN_ID });
    expect(out).toEqual({ attached: true, r2Key: PDF });
    expect(writes).toEqual([{
      table: 'coaching_sessions',
      row: {
        has_lesson_plan: true,
        lesson_plan_url: `https://r2.example/${PDF}`,
        lesson_plan_r2_key: PDF,
        lesson_plan_format: 'pdf',
        lesson_plan_extraction_status: 'pending',
        lesson_plan_extraction_error: null,
      },
    }]);
    expect(queueExtraction).toHaveBeenCalledWith(SID, { r2Key: PDF, fileType: 'pdf', userId: TEACHER });
  });

  test('not hers, not ready or gone: nothing is written', async () => {
    const { attachOwnPlan } = require(OWN);
    const { supabase, writes } = fakeDb();
    const queueExtraction = jest.fn();
    const out = await attachOwnPlan(SID, OWN_ID, { supabase, resolveKey: async () => null, queueExtraction, publicUrl: (k) => k });
    expect(out).toEqual({ attached: false });
    expect(writes).toEqual([]);
    expect(queueExtraction).not.toHaveBeenCalled();
  });
});

describe('tapping an own-plan row', () => {
  function deps({ status = 'awaiting_lesson_plan', attached = true } = {}) {
    const log = { sent: [], buttons: [], queued: [], attached: [], resent: [] };
    const d = {
      sessionStatus: async () => status,
      resolveLanguage: async () => 'en',
      sendMessage: async (to, text) => { log.sent.push(text); return true; },
      sendButtons: async (to, payload) => { log.buttons.push(payload); return true; },
      queueAnalysis: async (sid, payload) => { log.queued.push({ sid, payload }); return true; },
      deferLpOutcome: async ({ text }) => { log.sent.push(text); return {}; },
      resendList: async (sid) => { log.resent.push(sid); return true; },
      describeOwn: async () => ({ title: 'Describing words', description: 'Made by the teacher · Grade 4 English · Ch5' }),
      attachOwn: async (sid, ownId) => { log.attached.push({ sid, ownId }); return attached ? { attached: true, r2Key: PDF } : { attached: false }; },
      linker: { handleLPSelection: async () => { throw new Error('the library linker must not run for an own plan'); } },
    };
    return { d, log };
  }
  const load = () => { jest.resetModules(); return require(HANDLER); };

  test('asks to confirm first, naming her plan; nothing is attached yet', async () => {
    const { handleLpListSelection } = load();
    const { d, log } = deps();
    expect(await handleLpListSelection(`lp_own_${OWN_ID}_${SID}`, FROM, d)).toBe(true);
    expect(log.attached).toEqual([]);
    expect(log.buttons[0].body).toContain('Describing words');
    expect(log.buttons[0].buttons.map((b) => b.id)).toEqual([`lpconfirm_yes_own_${OWN_ID}_${SID}`, `lpconfirm_no_${SID}`]);
  });

  test('"Yes" attaches her plan and starts the analysis as an attached plan', async () => {
    const { handleLpConfirmTap } = load();
    const { d, log } = deps();
    expect(await handleLpConfirmTap(`lpconfirm_yes_own_${OWN_ID}_${SID}`, FROM, d)).toBe(true);
    expect(log.attached).toEqual([{ sid: SID, ownId: OWN_ID }]);
    expect(log.queued).toEqual([{ sid: SID, payload: expect.objectContaining({ from: FROM, lpUploaded: true }) }]);
    expect(log.buttons).toEqual([]);
  });

  test('a plan that no longer resolves attaches nothing and re-sends the list', async () => {
    const { handleLpConfirmTap } = load();
    const { d, log } = deps({ attached: false });
    await handleLpConfirmTap(`lpconfirm_yes_own_${OWN_ID}_${SID}`, FROM, d);
    expect(log.queued).toEqual([]);
    expect(log.resent).toEqual([SID]);
  });

  test('a late tap after the analysis attaches the plan without re-running the analysis', async () => {
    const { handleLpConfirmTap } = load();
    const { d, log } = deps({ status: 'awaiting_observer_review' });
    await handleLpConfirmTap(`lpconfirm_yes_own_${OWN_ID}_${SID}`, FROM, d);
    expect(log.attached).toHaveLength(1);
    expect(log.queued).toEqual([]);
  });

  test('after the review is submitted nothing is attached', async () => {
    const { handleLpListSelection } = load();
    const { d, log } = deps({ status: 'observer_review_complete' });
    await handleLpListSelection(`lp_own_${OWN_ID}_${SID}`, FROM, { ...d, confirmed: true });
    expect(log.attached).toEqual([]);
  });

  test('the bot routes lp_own_ list taps to the handler', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../bot/whatsapp-bot.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).toMatch(/\^lp_\(select\|upload\|none\|own\)_/);
  });
});
