'use strict';
/**
 * Retiring /observe2 (operator, 12 Nov 2026: "let the users know perhaps that observe2 experiment has ended, opening
 * regular observe"). The switch is app_settings.observe2_retired, default OFF, shaped and looked up like the other
 * coach switches ("user:<id>", the region, its organization, then "*"), so it is flipped, narrowed or undone with no
 * deploy. ON for a coach: /observe2 gets one line saying the trial has ended, then exactly what /observe opens, and a
 * recording with no form waiting no longer starts a new /observe2 visit. Visits already started are untouched.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const mockRows = { value: [] };
const mockFail = { on: false };
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn((table) => {
    const q = {
      select: () => q,
      eq: () => {
        if (table === 'users') return { maybeSingle: async () => ({ data: { region: 'sihala' }, error: null }) };
        return Promise.resolve(mockFail.on ? { data: null, error: { message: 'down' } } : { data: mockRows.value, error: null });
      },
    };
    return q;
  }),
}));
jest.mock('../../bot/shared/services/region-registry', () => ({ organizationForRegion: async () => 'niete' }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn().mockResolvedValue(true) }));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const Retire = require('../../bot/shared/services/observe/observe2/retire');
const { observe2Strings } = require('../../bot/shared/services/observe/observe2/strings');

const COACH = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const coach = (lang = 'en', id = COACH) => ({ id, role: 'coach', region: 'sihala', preferred_language: lang });
const teacher = () => ({ id: OTHER, role: 'teacher', region: 'sihala', preferred_language: 'en' });

beforeEach(() => {
  Retire._resetCache();
  mockRows.value = [];
  mockFail.on = false;
  jest.clearAllMocks();
});

describe('the switch (app_settings.observe2_retired), default off', () => {
  test('no row, a failed read, an unknown value: /observe2 stays open', async () => {
    expect(Retire.KEY).toBe('observe2_retired');
    expect(await Retire.isRetired({ userId: COACH, region: 'sihala' })).toBe(false);
    Retire._resetCache(); mockFail.on = true;
    expect(await Retire.isRetired({ userId: COACH, region: 'sihala' })).toBe(false);
    Retire._resetCache(); mockFail.on = false; mockRows.value = [{ key: 'observe2_retired', value: 'maybe' }];
    expect(await Retire.isRetired({ userId: COACH, region: 'sihala' })).toBe(false);
  });

  test('"on": retired for everyone', async () => {
    mockRows.value = [{ key: 'observe2_retired', value: 'on' }];
    expect(await Retire.isRetired({ userId: COACH, region: 'sihala' })).toBe(true);
    expect(await Retire.isRetired({ userId: OTHER })).toBe(true);
  });

  test('one account only (a test account first)', async () => {
    mockRows.value = [{ key: 'observe2_retired', value: { [`user:${COACH}`]: 'on' } }];
    expect(await Retire.isRetired({ userId: COACH, region: 'sihala' })).toBe(true);
    expect(await Retire.isRetired({ userId: OTHER, region: 'sihala' })).toBe(false);
  });

  test('retired for everyone but one account kept on /observe2 (a tester)', async () => {
    mockRows.value = [{ key: 'observe2_retired', value: { '*': 'on', [`user:${OTHER}`]: 'off' } }];
    expect(await Retire.isRetired({ userId: COACH, region: 'sihala' })).toBe(true);
    expect(await Retire.isRetired({ userId: OTHER, region: 'sihala' })).toBe(false);
  });

  test('every ICT coach (organization)', async () => {
    mockRows.value = [{ key: 'observe2_retired', value: { ict: 'on' } }];
    expect(await Retire.isRetired({ userId: COACH, region: 'sihala' })).toBe(true);
    expect(await Retire.isRetired({ userId: COACH })).toBe(true);
  });
});

describe('the notice', () => {
  test('retired: a school leader gets the one line in their language, and the caller opens /observe', async () => {
    mockRows.value = [{ key: 'observe2_retired', value: 'on' }];
    expect(await Retire.announceIfRetired(coach('en'), '923000000001')).toBe(true);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith('923000000001', observe2Strings('en').retired_notice);

    WhatsAppService.sendMessage.mockClear();
    expect(await Retire.announceIfRetired(coach('ur'), '923000000002')).toBe(true);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith('923000000002', observe2Strings('ur').retired_notice);
  });

  test('retired: a teacher (never had /observe2) gets no notice, only what /observe gives them', async () => {
    mockRows.value = [{ key: 'observe2_retired', value: 'on' }];
    expect(await Retire.announceIfRetired(teacher(), '923000000003')).toBe(true);
    expect(await Retire.announceIfRetired(null, '923000000004')).toBe(true);
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
  });

  test('not retired: nothing is sent and /observe2 runs as today', async () => {
    expect(await Retire.announceIfRetired(coach('en'), '923000000001')).toBe(false);
    mockRows.value = [{ key: 'observe2_retired', value: { [`user:${OTHER}`]: 'on' } }];
    Retire._resetCache();
    expect(await Retire.announceIfRetired(coach('en'), '923000000001')).toBe(false);
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
  });

  test('a notice that fails to send never stops /observe from opening', async () => {
    mockRows.value = [{ key: 'observe2_retired', value: 'on' }];
    WhatsAppService.sendMessage.mockRejectedValueOnce(new Error('Meta down'));
    expect(await Retire.announceIfRetired(coach('en'), '923000000001')).toBe(true);
  });

  test('the line itself: one short line, en and ur, the commands isolated in Urdu, no gendered address', () => {
    const en = observe2Strings('en').retired_notice;
    const ur = observe2Strings('ur').retired_notice;
    for (const s of [en, ur]) {
      expect(typeof s).toBe('string');
      expect(s).not.toMatch(/\n/);
      expect([...s].length).toBeLessThanOrEqual(120);
      expect(s).toMatch(/\/observe2/);
      expect(s).toMatch(/\/observe(?!2)/);
    }
    expect(en).toMatch(/ended/i);
    // Latin atoms inside RTL prose are isolated (LRI U+2066 … PDI U+2069), never bare.
    expect(ur).toContain('⁦/observe2⁩');
    expect(ur).toContain('⁦/observe⁩');
    expect(ur).toMatch(/[؀-ۿ]/);
    // Coaches are women and men: no "آپ ... رہی/رہے ہیں" address.
    expect(ur).not.toMatch(/رہی ہیں|رہے ہیں|سکتی ہیں|سکتے ہیں/);
  });
});

describe('a visit already started is untouched', () => {
  // Every step after the command (planner Start, period list, live form, seal, recording, check, worklist resume) routes
  // by its own token or button id. Only the two doors that START a visit read the switch: the /observe2 command and the
  // record-first hold. Comments are stripped first, so a mention in a comment cannot pass or fail this.
  const fs = require('fs');
  const path = require('path');
  const { execFileSync } = require('child_process');
  const ROOT = path.join(__dirname, '..', '..');
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');

  test('only the /observe2 command door and the record-first hold read the retire switch', () => {
    const files = execFileSync('git', ['ls-files', 'bot/*.js'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n').filter((f) => f && !f.includes('/node_modules/') && !f.endsWith('observe2/retire.js'));
    const readers = files.filter((f) => /observe2\/retire'|\.\/retire'/.test(strip(fs.readFileSync(path.join(ROOT, f), 'utf8'))));
    expect(readers.sort()).toEqual([
      'bot/shared/handlers/text-message.handler.js',
      'bot/shared/services/observe/observe2/hold.js',
    ]);
  });

  test('a recording for a form already waiting is matched before the record-first hold is asked', () => {
    const router = strip(fs.readFileSync(path.join(ROOT, 'bot/shared/services/observe/observe-audio-router.js'), 'utf8'));
    const waiting = router.indexOf('await _waitingObserve2Form(user.id)');
    const hold = router.indexOf('await _holdForObserve2(user, from');
    expect(waiting).toBeGreaterThan(0);
    expect(hold).toBeGreaterThan(0);
    expect(waiting).toBeLessThan(hold);
  });
});
