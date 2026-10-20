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
 *    template it builds, the en_US / ur language code, and the dry run that never calls Meta;
 *  - the hook in the offer's send: only when the switch names a template does the
 *    window_closed branch change; switch absent, the skip is exactly today's.
 */

const fs = require('fs');
const path = require('path');
const { makeSupabase } = require('./helpers/filtering-chain');
const { makeStore } = require('./helpers/nudge-contract-mocks');
const pktTime = require('../../bot/shared/services/nudges/pkt-time');

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

describe('the drafts: teacher_quiz_reminder_v1 (en_US, ur)', () => {
  const COPY = {
    en: {
      code: 'en_US',
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

    it('one URL button, at most 20 code points, on the portal /t/{{1}} link, with one example', () => {
      const { buttons } = part(t, 'BUTTONS');
      expect(buttons).toHaveLength(1);
      expect(buttons[0].type).toBe('URL');
      expect(buttons[0].text).toBe(want.button);
      expect(cp(buttons[0].text)).toBeLessThanOrEqual(20);
      expect(buttons[0].url).toBe('https://portal.niete.edu.pk/t/{{1}}');
      expect(buttons[0].example).toHaveLength(1);
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
const USER = { id: 'u-1', phone_number: '920000000000', preferred_language: 'en' };

beforeEach(() => {
  jest.clearAllMocks();
  WindowTemplate._resetCache();
  WhatsAppService.sendTemplate.mockResolvedValue(true);
  delete process.env.LP_QUIZ_OFFER_TEMPLATE_DRY_RUN;
});
afterAll(() => { delete process.env.LP_QUIZ_OFFER_TEMPLATE_DRY_RUN; });

describe('buildTemplate — the shape WhatsAppService.sendTemplate takes', () => {
  it('name, language and one URL-button parameter carrying the link token; no header, no body params', () => {
    expect(WindowTemplate.buildTemplate({ name: NAME, lang: 'en', link: 'tok.abc' })).toEqual({
      name: NAME,
      language: 'en_US',
      components: [
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'tok.abc' }] },
      ],
    });
  });

  it('English is en_US (the code the en draft is approved under); Urdu is ur; anything else falls to en_US', () => {
    expect(WindowTemplate.templateLanguage('en')).toBe('en_US');
    expect(WindowTemplate.templateLanguage('ur')).toBe('ur');
    expect(WindowTemplate.templateLanguage(undefined)).toBe('en_US');
    expect(WindowTemplate.templateLanguage('sw')).toBe('en_US');
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

describe('sendWindowClosedTemplate({user, link})', () => {
  it('switch absent ⇒ nothing sent, reason off', async () => {
    install({});
    const res = await WindowTemplate.sendWindowClosedTemplate({ user: USER, link: 'tok' });
    expect(res).toEqual({ sent: 0, reason: 'off' });
    expect(WhatsAppService.sendTemplate).not.toHaveBeenCalled();
  });

  it('sends the named template with en_US for an English teacher', async () => {
    install(switchRow(NAME));
    const res = await WindowTemplate.sendWindowClosedTemplate({ user: USER, link: 'tok' });
    expect(res).toEqual({ sent: 1, template: NAME, lang: 'en_US' });
    expect(WhatsAppService.sendTemplate).toHaveBeenCalledTimes(1);
    const [to, name, code, components] = WhatsAppService.sendTemplate.mock.calls[0];
    expect([to, name, code]).toEqual([USER.phone_number, NAME, 'en_US']);
    expect(components[0].parameters[0].text).toBe('tok');
  });

  it('ur for an Urdu teacher', async () => {
    install(switchRow(NAME));
    await WindowTemplate.sendWindowClosedTemplate({ user: { ...USER, preferred_language: 'ur' }, link: 'tok' });
    expect(WhatsAppService.sendTemplate.mock.calls[0][2]).toBe('ur');
  });

  it('LP_QUIZ_OFFER_TEMPLATE_DRY_RUN=1 ⇒ logs what it would send and NEVER calls Meta', async () => {
    process.env.LP_QUIZ_OFFER_TEMPLATE_DRY_RUN = '1';
    install(switchRow(NAME));
    const res = await WindowTemplate.sendWindowClosedTemplate({ user: USER, link: 'tok' });
    expect(res).toEqual({ sent: 0, reason: 'dry_run', template: NAME, lang: 'en_US' });
    expect(WhatsAppService.sendTemplate).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith('lp_quiz_offer.template_dry_run', { template: NAME, lang: 'en_US' });
  });

  it('Meta refuses (no such template) ⇒ skip as template_missing, logged at error', async () => {
    WhatsAppService.sendTemplate.mockResolvedValue(false);
    install(switchRow(NAME));
    const res = await WindowTemplate.sendWindowClosedTemplate({ user: USER, link: 'tok' });
    expect(res).toEqual({ sent: 0, reason: 'template_missing', template: NAME, lang: 'en_US' });
    expect(logToFile.mock.calls.some((c) => c[2] === 'error')).toBe(true);
  });

  it('no link token (no signing secret here) ⇒ nothing sent', async () => {
    install(switchRow(NAME));
    const res = await WindowTemplate.sendWindowClosedTemplate({ user: USER, link: null });
    expect(res).toMatchObject({ sent: 0, reason: 'no_link' });
    expect(WhatsAppService.sendTemplate).not.toHaveBeenCalled();
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
    phone_number: '920000000000', preferred_language: 'en',
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

  it('switch names a template ⇒ the template is sent with a signed portal link, recorded as window_closed_template {sent}', async () => {
    install(world());
    const tpl = stub(NAME, { sent: 1, template: NAME, lang: 'en_US' });
    const res = await Offer.send(row(), { now: SEND_AT, windowTemplate: tpl });
    expect(tpl.sendWindowClosedTemplate).toHaveBeenCalledTimes(1);
    const arg = tpl.sendWindowClosedTemplate.mock.calls[0][0];
    expect(arg.user.id).toBe(T1);
    expect(typeof arg.link).toBe('string');
    expect(arg.link.length).toBeGreaterThan(10);
    expect(res).toEqual({ skipped: 'window_closed_template', context: { sent: 1, template: NAME, lang: 'en_US' } });
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
    expect(logEvent).toHaveBeenCalledWith('lp_quiz_offer.template_dry_run', { template: NAME, lang: 'en_US' });
  });

  it('window_closed_template is a reason the store accepts and the offer declares', () => {
    expect(RealStore.SKIP_REASONS).toContain('window_closed_template');
    expect(Offer.SKIP_REASONS_USED).toContain('window_closed_template');
  });
});
