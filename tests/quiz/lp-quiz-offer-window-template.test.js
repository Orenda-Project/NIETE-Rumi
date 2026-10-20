'use strict';
/**
 * The afternoon offer, for a teacher whose 24-hour window has CLOSED.
 *
 * Today that teacher is skipped (`window_closed`): free text and reply buttons cannot
 * reach a number that has not written in a day. A UTILITY template can. This suite holds:
 *
 *  - the two drafts (infrastructure/templates/drafts/teacher_quiz_reminder_v1_{en,ur}.json):
 *    every field inside Meta's cap, measured in CODE POINTS, and the copy as agreed;
 *  - the sender (nudges/window-closed-template.js): its switch
 *    (`app_settings.lp_quiz_offer_window_template`, absent = off, fail closed), the
 *    template it builds, the en / ur language code (as every NIETE draft), the button's teacher-home
 *    link (signTeacherHome, via 'reminder'), the dry run that never calls Meta, and the STOP opt-out
 *    (teacher_reminder_optouts) that blocks the send, dry run included;
 *  - the hook in the offer's send: only when the switch names a template does the
 *    window_closed branch change; switch absent, the skip is exactly today's.
 */

const fs = require('fs');
const path = require('path');
const { makeSupabase } = require('./helpers/filtering-chain');
const { makeStore } = require('./helpers/nudge-contract-mocks');
const pktTime = require('../../bot/shared/services/nudges/pkt-time');
const { fixturePhone } = require('../../bot/tests/quiz/web-quiz/fixture-phone');
const HomeToken = require('../../bot/shared/services/first-touch/teacher-home.token');

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendTemplate: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({
  queueJob: jest.fn().mockResolvedValue('m-1'),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

let mockStore;
jest.mock('../../bot/shared/services/nudges/teacher-nudges.store',
  () => require('./helpers/nudge-contract-mocks').storeFacade(() => mockStore));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const { logToFile } = require('../../bot/shared/utils/logger');
const WindowTemplate = require('../../bot/shared/services/nudges/window-closed-template');
const Offer = require('../../bot/shared/services/nudges/lp-quiz-offer.service');
const RealStore = jest.requireActual('../../bot/shared/services/nudges/teacher-nudges.store');

const cp = (s) => [...String(s)].length;
const NAME = 'teacher_quiz_reminder_v1';
const SETTING = 'lp_quiz_offer_window_template';

// ── the drafts ───────────────────────────────────────────────────────────────

const DIR = path.join(__dirname, '../../infrastructure/templates/drafts');
const load = (f) => JSON.parse(fs.readFileSync(path.join(DIR, `${f}.json`), 'utf8'));
const part = (t, type) => t.components.find((c) => c.type === type);

describe('the drafts: teacher_quiz_reminder_v1 (en, ur)', () => {
  const COPY = {
    en: {
      code: 'en',
      body: "Today's lesson quiz for your class is ready on your NIETE portal. Tap the button to open it.",
      footer: 'Reply STOP to stop reminders',
      button: 'Open quiz',
    },
    ur: {
      code: 'ur',
      body: 'آج کے سبق کا کوئز آپ کی کلاس کے لیے NIETE پورٹل پر تیار ہے۔ کھولنے کے لیے نیچے دبائیں۔',
      footer: 'یاد دہانی بند کرنے کے لیے STOP لکھیں',
      button: 'کوئز کھولیں',
    },
  };

  describe.each(['en', 'ur'])('%s', (lang) => {
    const t = load(`${NAME}_${lang}`);
    const want = COPY[lang];

    it('is a UTILITY template, named teacher_quiz_reminder_v1, under the code the sender uses', () => {
      expect(t.name).toBe(NAME);
      expect(t.category).toBe('UTILITY');
      expect(t.language).toBe(want.code);
    });

    it('has no header, and its body is the agreed copy, no variables, at most 1024 code points', () => {
      expect(part(t, 'HEADER')).toBeUndefined();
      const body = part(t, 'BODY');
      expect(body.text).toBe(want.body);
      expect(body.text).not.toMatch(/\{\{/);
      expect(cp(body.text)).toBeLessThanOrEqual(1024);
    });

    it('footer: the agreed copy, at most 60 code points', () => {
      const footer = part(t, 'FOOTER');
      expect(footer.text).toBe(want.footer);
      expect(cp(footer.text)).toBeLessThanOrEqual(60);
    });

    it('one URL button, at most 20 code points, on the quiz teacher home /quiz/teacher/{{1}}, with one example', () => {
      const { buttons } = part(t, 'BUTTONS');
      expect(buttons).toHaveLength(1);
      expect(buttons[0].type).toBe('URL');
      expect(buttons[0].text).toBe(want.button);
      expect(cp(buttons[0].text)).toBeLessThanOrEqual(20);
      expect(buttons[0].url).toBe('https://portal.niete.edu.pk/quiz/teacher/{{1}}');
      expect(buttons[0].example).toHaveLength(1);
      expect(buttons[0].example[0].startsWith('https://portal.niete.edu.pk/quiz/teacher/')).toBe(true);
      expect(buttons[0].example[0]).not.toMatch(/\{\{/);
    });

    it('the Urdu is in Arabic script and the English has none', () => {
      const text = [part(t, 'BODY').text, part(t, 'FOOTER').text, part(t, 'BUTTONS').buttons[0].text].join(' ');
      expect(/[؀-ۿ]/.test(text)).toBe(lang === 'ur');
    });
  });

  it('they are drafts: not in the folder the publisher walks', () => {
    const top = fs.readdirSync(path.join(DIR, '..')).filter((f) => f.endsWith('.json'));
    expect(top).not.toContain(`${NAME}_en.json`);
    expect(top).not.toContain(`${NAME}_ur.json`);
  });
});

// ── the sender ───────────────────────────────────────────────────────────────

function install(tables) {
  const db = makeSupabase(tables);
  supabase.from.mockImplementation(db.from);
  return db;
}
const switchRow = (value) => ({ app_settings: [{ key: SETTING, value }] });
const UID = 'a0000000-0000-4000-8000-0000000000b2';
const USER = { id: UID, phone_number: fixturePhone(21), preferred_language: 'en' };
const OPTOUTS = 'teacher_reminder_optouts';

beforeEach(() => {
  jest.clearAllMocks();
  WindowTemplate._resetCache();
  WhatsAppService.sendTemplate.mockResolvedValue(true);
  delete process.env.LP_QUIZ_OFFER_TEMPLATE_DRY_RUN;
  process.env.WEB_QUIZ_TOKEN_SECRET = 'unit-web-quiz-secret-not-a-secret';
});
afterAll(() => { delete process.env.LP_QUIZ_OFFER_TEMPLATE_DRY_RUN; delete process.env.WEB_QUIZ_TOKEN_SECRET; });

/** The token the button carries, checked as the teacher home will check it. */
const tokenOf = (call) => call[3][0].parameters[0].text;

describe('buildTemplate — the shape WhatsAppService.sendTemplate takes', () => {
  it('name, language and one URL-button parameter carrying the link token; no header, no body params', () => {
    expect(WindowTemplate.buildTemplate({ name: NAME, lang: 'en', link: 'tok.abc' })).toEqual({
      name: NAME,
      language: 'en',
      components: [
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'tok.abc' }] },
      ],
    });
  });

  it('English is en (the code every NIETE draft uses, never en_US); Urdu is ur; anything else falls to en', () => {
    expect(WindowTemplate.templateLanguage('en')).toBe('en');
    expect(WindowTemplate.templateLanguage('ur')).toBe('ur');
    expect(WindowTemplate.templateLanguage(undefined)).toBe('en');
    expect(WindowTemplate.templateLanguage('sw')).toBe('en');
  });
});

describe('templateName — app_settings.lp_quiz_offer_window_template', () => {
  it('absent ⇒ off (null)', async () => {
    install({});
    expect(await WindowTemplate.templateName()).toBeNull();
  });

  it.each([[true], [1], [''], ['  '], [{ name: NAME }], ['Bad Name!']])('a non-template value (%p) ⇒ off', async (value) => {
    install(switchRow(value));
    expect(await WindowTemplate.templateName()).toBeNull();
  });

  it('a template name ⇒ that name', async () => {
    install(switchRow(NAME));
    expect(await WindowTemplate.templateName()).toBe(NAME);
  });

  it('a read error ⇒ off, and the failure is not cached', async () => {
    supabase.from.mockImplementation(() => { throw new Error('db down'); });
    expect(await WindowTemplate.templateName()).toBeNull();
    install(switchRow(NAME));
    expect(await WindowTemplate.templateName()).toBe(NAME);
  });

  it('cached for 30 seconds', async () => {
    install(switchRow(NAME));
    expect(await WindowTemplate.templateName(1000)).toBe(NAME);
    install({});
    expect(await WindowTemplate.templateName(1000 + 29000)).toBe(NAME);
    expect(await WindowTemplate.templateName(1000 + 31000)).toBeNull();
  });
});

describe('sendWindowClosedTemplate({user}) — the button opens the quiz teacher home', () => {
  it('switch absent ⇒ nothing sent, reason off', async () => {
    install({});
    const res = await WindowTemplate.sendWindowClosedTemplate({ user: USER });
    expect(res).toEqual({ sent: 0, reason: 'off' });
    expect(WhatsAppService.sendTemplate).not.toHaveBeenCalled();
  });

  it('sends the named template with en for an English teacher; the button token is a teacher-home token, via reminder', async () => {
    install(switchRow(NAME));
    const res = await WindowTemplate.sendWindowClosedTemplate({ user: USER });
    expect(res).toEqual({ sent: 1, template: NAME, lang: 'en' });
    expect(WhatsAppService.sendTemplate).toHaveBeenCalledTimes(1);
    const call = WhatsAppService.sendTemplate.mock.calls[0];
    expect([call[0], call[1], call[2]]).toEqual([USER.phone_number, NAME, 'en']);
    const v = HomeToken.verifyTeacherHome(tokenOf(call));
    expect(v).toEqual({ ok: expect.objectContaining({ uid: UID, lang: 'en', via: 'reminder' }) });
  });

  it('ur for an Urdu teacher, and their token opens the Urdu page', async () => {
    install(switchRow(NAME));
    await WindowTemplate.sendWindowClosedTemplate({ user: { ...USER, preferred_language: 'ur' } });
    const call = WhatsAppService.sendTemplate.mock.calls[0];
    expect(call[2]).toBe('ur');
    expect(HomeToken.verifyTeacherHome(tokenOf(call)).ok).toMatchObject({ uid: UID, lang: 'ur', via: 'reminder' });
  });

  it('the link is the draft url with the token in {{1}}: /quiz/teacher/<token>', () => {
    const t = WindowTemplate.reminderLink({ user: USER });
    expect(HomeToken.teacherHomePath(t)).toBe(`/quiz/teacher/${t}`);
    expect(HomeToken.verifyTeacherHome(t).ok).toMatchObject({ uid: UID, via: 'reminder' });
  });

  it('LP_QUIZ_OFFER_TEMPLATE_DRY_RUN=1 ⇒ logs what it would send and NEVER calls Meta', async () => {
    process.env.LP_QUIZ_OFFER_TEMPLATE_DRY_RUN = '1';
    install(switchRow(NAME));
    const res = await WindowTemplate.sendWindowClosedTemplate({ user: USER });
    expect(res).toEqual({ sent: 0, reason: 'dry_run', template: NAME, lang: 'en' });
    expect(WhatsAppService.sendTemplate).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith('lp_quiz_offer.template_dry_run', { template: NAME, lang: 'en' });
  });

  it('Meta refuses (no such template) ⇒ skip as template_missing, logged at error', async () => {
    WhatsAppService.sendTemplate.mockResolvedValue(false);
    install(switchRow(NAME));
    const res = await WindowTemplate.sendWindowClosedTemplate({ user: USER });
    expect(res).toEqual({ sent: 0, reason: 'template_missing', template: NAME, lang: 'en' });
    expect(logToFile.mock.calls.some((c) => c[2] === 'error')).toBe(true);
  });

  it('no signing secret ⇒ no link ⇒ nothing sent', async () => {
    delete process.env.WEB_QUIZ_TOKEN_SECRET;
    const keep = process.env.INTERNAL_API_KEY;
    delete process.env.INTERNAL_API_KEY;
    try {
      install(switchRow(NAME));
      const res = await WindowTemplate.sendWindowClosedTemplate({ user: USER });
      expect(res).toMatchObject({ sent: 0, reason: 'no_link' });
      expect(WhatsAppService.sendTemplate).not.toHaveBeenCalled();
    } finally {
      if (keep !== undefined) process.env.INTERNAL_API_KEY = keep;
    }
  });
});

describe('the STOP opt-out — teacher_reminder_optouts', () => {
  const optedOut = (extra = {}) => ({
    ...switchRow(NAME),
    [OPTOUTS]: [{ id: 'o-1', user_id: UID, kind: 'quiz_reminder_template', source: 'stop_reply' }],
    ...extra,
  });

  it('an opted-out teacher is never sent the template: {sent:0, reason:opted_out}', async () => {
    install(optedOut());
    const res = await WindowTemplate.sendWindowClosedTemplate({ user: USER });
    expect(res).toEqual({ sent: 0, reason: 'opted_out' });
    expect(WhatsAppService.sendTemplate).not.toHaveBeenCalled();
  });

  it('the dry run honours it too: no dry-run line for an opted-out teacher', async () => {
    process.env.LP_QUIZ_OFFER_TEMPLATE_DRY_RUN = '1';
    install(optedOut());
    const res = await WindowTemplate.sendWindowClosedTemplate({ user: USER });
    expect(res).toEqual({ sent: 0, reason: 'opted_out' });
    expect(logEvent).not.toHaveBeenCalledWith('lp_quiz_offer.template_dry_run', expect.anything());
  });

  it("another teacher's opt-out does not stop this one", async () => {
    install({ ...switchRow(NAME), [OPTOUTS]: [{ id: 'o-2', user_id: 'someone-else', kind: 'quiz_reminder_template' }] });
    const res = await WindowTemplate.sendWindowClosedTemplate({ user: USER });
    expect(res.sent).toBe(1);
  });

  it('isOptedOut reads the row; a read failure counts as opted out (never message someone who may have said STOP)', async () => {
    install(optedOut());
    expect(await WindowTemplate.isOptedOut(UID)).toBe(true);
    install({});
    expect(await WindowTemplate.isOptedOut(UID)).toBe(false);
    supabase.from.mockImplementation(() => { throw new Error('db down'); });
    expect(await WindowTemplate.isOptedOut(UID)).toBe(true);
  });

  it('optOut inserts {user_id, kind, source}; a duplicate (23505) is success, not an error', async () => {
    const db = install({});
    expect(await WindowTemplate.optOut(UID)).toBe(true);
    expect(db.writes).toEqual([expect.objectContaining({
      table: OPTOUTS, op: 'insert',
      row: expect.objectContaining({ user_id: UID, kind: 'quiz_reminder_template', source: 'stop_reply' }),
    })]);
    supabase.from.mockImplementation(() => ({ insert: async () => ({ error: { code: '23505', message: 'duplicate key' } }) }));
    expect(await WindowTemplate.optOut(UID)).toBe(true);
    supabase.from.mockImplementation(() => ({ insert: async () => ({ error: { code: '42P01', message: 'no table' } }) }));
    expect(await WindowTemplate.optOut(UID)).toBe(false);
    expect(await WindowTemplate.optOut(null)).toBe(false);
  });
});

// ── the hook in the offer's send ─────────────────────────────────────────────

describe('the offer send: the window_closed branch', () => {
  const NUDGE_DATE = '2026-09-22';
  const T1 = '11111111-1111-4111-8111-111111111111';
  const SEND_AT = pktTime.atPkt(NUDGE_DATE, 15, 0);
  const lesson = { lesson_id: 'grade_4_math_ch2_seg1', asset_id: 'a-1', version_stamp: 'v', content_hash: 'h', topic: 'Fractions' };
  const row = (over = {}) => ({
    id: 'nudge-1', user_id: T1, kind: 'lp_quiz_offer', nudge_date: NUDGE_DATE, status: 'sending',
    scheduled_at: SEND_AT.toISOString(), quiz_id: null,
    context: { classes: [{ key: 'g4_math', grade: 4, subject: 'math', lessons: [lesson] }] },
    ...over,
  });
  const closedTeacher = {
    id: T1, role: 'teacher', is_test_user: false, deleted_at: null, school_id: 's-1', region: 'X',
    phone_number: fixturePhone(22), preferred_language: 'en',
    last_message_at: pktTime.atPkt('2026-09-20', 8, 0).toISOString(),
  };
  const world = (extra = {}) => ({ users: [closedTeacher], coaching_sessions: [], quizzes: [], teacher_nudges: [], ...extra });
  const stub = (name, result = { sent: 1 }) => ({
    templateName: jest.fn().mockResolvedValue(name),
    sendWindowClosedTemplate: jest.fn().mockResolvedValue(result),
  });

  beforeEach(() => {
    mockStore = makeStore();
    process.env.LP_QUIZ_OFFER_ENABLED = 'true';
    process.env.WEB_TRAINING_TOKEN_SECRET = 'test-secret';
  });
  afterEach(() => {
    delete process.env.LP_QUIZ_OFFER_ENABLED;
    delete process.env.WEB_TRAINING_TOKEN_SECRET;
    delete process.env.TEACHER_NUDGES_ENABLED;
  });

  it('switch absent ⇒ exactly today\'s skip, and the template is never sent', async () => {
    install(world());
    const tpl = stub(null);
    const res = await Offer.send(row(), { now: SEND_AT, windowTemplate: tpl });
    expect(tpl.templateName).toHaveBeenCalledTimes(1);   // the changed line ran
    expect(tpl.sendWindowClosedTemplate).not.toHaveBeenCalled();
    expect(res).toEqual({ skipped: 'window_closed' });
    expect(WhatsAppService.sendTemplate).not.toHaveBeenCalled();
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
  });

  it('switch absent through the REAL module (no app_settings row) ⇒ today\'s skip', async () => {
    install(world());
    const res = await Offer.send(row(), { now: SEND_AT });
    expect(res).toEqual({ skipped: 'window_closed' });
    expect(WhatsAppService.sendTemplate).not.toHaveBeenCalled();
  });

  it('switch names a template ⇒ the hook passes just the teacher (the module mints the link), recorded as window_closed_template {sent}', async () => {
    install(world());
    const tpl = stub(NAME, { sent: 1, template: NAME, lang: 'en' });
    const res = await Offer.send(row(), { now: SEND_AT, windowTemplate: tpl });
    expect(tpl.sendWindowClosedTemplate).toHaveBeenCalledTimes(1);
    const arg = tpl.sendWindowClosedTemplate.mock.calls[0][0];
    expect(arg.user.id).toBe(T1);
    expect(Object.keys(arg)).toEqual(['user']);
    expect(res).toEqual({ skipped: 'window_closed_template', context: { sent: 1, template: NAME, lang: 'en' } });
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
  });

  it('an OPEN window is untouched by the switch: the normal offer goes, no template', async () => {
    install(world({ users: [{ ...closedTeacher, last_message_at: pktTime.atPkt(NUDGE_DATE, 12, 0).toISOString() }] }));
    const tpl = stub(NAME);
    const res = await Offer.send(row(), { now: SEND_AT, windowTemplate: tpl });
    expect(res.sent).toBe(true);
    expect(tpl.templateName).not.toHaveBeenCalled();
    expect(tpl.sendWindowClosedTemplate).not.toHaveBeenCalled();
  });

  it('through the real sweeper and module, dry run on: the row is skipped as window_closed_template with sent 0, Meta never called', async () => {
    process.env.TEACHER_NUDGES_ENABLED = 'true';
    process.env.LP_QUIZ_OFFER_TEMPLATE_DRY_RUN = '1';
    const Sweeper = require('../../bot/shared/services/nudges/teacher-nudges.sweeper');
    mockStore = makeStore([row({ status: 'pending' })]);
    install(world(switchRow(NAME)));
    const counts = await Sweeper.runSweep({ now: SEND_AT });
    expect(counts).toMatchObject({ claimed: 1, sent: 0, skipped: 1 });
    expect(mockStore.rows[0].context.skip_reason).toBe('window_closed_template');
    expect(mockStore.rows[0].context.sent).toBe(0);
    expect(mockStore.rows[0].context.reason).toBe('dry_run');
    expect(WhatsAppService.sendTemplate).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith('lp_quiz_offer.template_dry_run', { template: NAME, lang: 'en' });
  });

  it('window_closed_template is a reason the store accepts and the offer declares', () => {
    expect(RealStore.SKIP_REASONS).toContain('window_closed_template');
    expect(Offer.SKIP_REASONS_USED).toContain('window_closed_template');
  });
});
