'use strict';
/**
 * STOP to the window-closed quiz reminder template (teacher_quiz_reminder_v1, whose footer says
 * "Reply STOP to stop reminders"). nudges/reminder-stop.js handleReminderStop({user, text}) claims
 * the text only when ALL of:
 *   - it is exactly STOP (any case, trimmed) or «روکیں»;
 *   - the switch (app_settings.lp_quiz_offer_window_template) names a template;
 *   - the teacher got the template in the last 7 days: a teacher_nudges row of kind lp_quiz_offer,
 *     skipped as window_closed_template, with context.sent = 1 or context.reason = 'dry_run'.
 * Then it records the opt-out (teacher_reminder_optouts) and replies one short line in her language.
 * Anything else → false, and the text goes wherever it went before.
 */

const { makeSupabase } = require('./helpers/filtering-chain');
const { fixturePhone } = require('../../bot/tests/quiz/web-quiz/fixture-phone');

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendTemplate: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const WindowTemplate = require('../../bot/shared/services/nudges/window-closed-template');
const ReminderStop = require('../../bot/shared/services/nudges/reminder-stop');

const cp = (s) => [...String(s)].length;
const NAME = 'teacher_quiz_reminder_v1';
const UID = 'a0000000-0000-4000-8000-0000000000b3';
const USER = { id: UID, phone_number: fixturePhone(31), preferred_language: 'en' };
const NOW = Date.UTC(2026, 9, 20, 10, 0, 0);
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();
const EN = 'You will not get quiz reminders like this again.';
const UR = 'آپ کو اب ایسی کوئز یاد دہانیاں نہیں ملیں گی۔';

const nudge = (over = {}, ctx = {}) => ({
  id: `n-${Math.random()}`, user_id: UID, kind: 'lp_quiz_offer', status: 'skipped',
  nudge_date: daysAgo(1).slice(0, 10), updated_at: daysAgo(1),
  context: { skip_reason: 'window_closed_template', sent: 1, template: NAME, lang: 'en', ...ctx },
  ...over,
});

function install(tables) {
  const db = makeSupabase(tables);
  supabase.from.mockImplementation(db.from);
  return db;
}
const world = ({ on = true, nudges = [nudge()] } = {}) => ({
  ...(on ? { app_settings: [{ key: 'lp_quiz_offer_window_template', value: NAME }] } : {}),
  teacher_nudges: nudges,
});
const optOutInserts = (db) => db.writes.filter((w) => w.table === 'teacher_reminder_optouts' && w.op === 'insert');

beforeEach(() => {
  jest.clearAllMocks();
  WindowTemplate._resetCache();
});

describe('the confirmation copy', () => {
  it('EN and UR as agreed, gender-neutral, well inside 1024 code points', () => {
    expect(ReminderStop.CONFIRM.en).toBe(EN);
    expect(ReminderStop.CONFIRM.ur).toBe(UR);
    expect(cp(EN)).toBeLessThanOrEqual(1024);
    expect(cp(UR)).toBeLessThanOrEqual(1024);
  });
});

describe('isStopText', () => {
  it.each([['STOP'], ['stop'], [' Stop '], ['روکیں'], [' روکیں ']])('%j is a STOP', (t) => {
    expect(ReminderStop.isStopText(t)).toBe(true);
  });
  it.each([['stop it'], ['Stop.'], ['please stop'], [''], [null], ['quiz'], ['STOPP']])('%j is not', (t) => {
    expect(ReminderStop.isStopText(t)).toBe(false);
  });
});

describe('handleReminderStop({user, text})', () => {
  it('switch on + the template went in the last 7 days ⇒ opt-out row + one confirmation, handled', async () => {
    const db = install(world());
    expect(await ReminderStop.handleReminderStop({ user: USER, text: 'STOP', now: NOW })).toBe(true);
    expect(optOutInserts(db)).toEqual([expect.objectContaining({
      row: expect.objectContaining({ user_id: UID, kind: 'quiz_reminder_template', source: 'stop_reply' }),
    })]);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(USER.phone_number, EN);
  });

  it('an Urdu teacher typing «روکیں» is answered in Urdu', async () => {
    install(world());
    expect(await ReminderStop.handleReminderStop({ user: { ...USER, preferred_language: 'ur' }, text: 'روکیں', now: NOW })).toBe(true);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(USER.phone_number, UR);
  });

  it('a dry-run row counts as received (the sandbox proof)', async () => {
    const db = install(world({ nudges: [nudge({}, { sent: 0, reason: 'dry_run' })] }));
    expect(await ReminderStop.handleReminderStop({ user: USER, text: 'stop', now: NOW })).toBe(true);
    expect(optOutInserts(db)).toHaveLength(1);
  });

  it('switch OFF ⇒ not handled, nothing read past the switch, nothing written or sent', async () => {
    const db = install(world({ on: false }));
    expect(await ReminderStop.handleReminderStop({ user: USER, text: 'STOP', now: NOW })).toBe(false);
    expect(db.reads).not.toContain('teacher_nudges');
    expect(db.writes).toEqual([]);
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
  });

  it('a non-STOP text ⇒ not handled, and not even the switch is read', async () => {
    const db = install(world());
    expect(await ReminderStop.handleReminderStop({ user: USER, text: 'Lesson plan', now: NOW })).toBe(false);
    expect(db.reads).toEqual([]);
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['no row at all', []],
    ['a row older than 7 days', [nudge({ updated_at: daysAgo(8) })]],
    ['a plain window_closed skip (no template went)', [nudge({}, { skip_reason: 'window_closed', sent: undefined })]],
    ['a template Meta refused', [nudge({}, { sent: 0, reason: 'template_missing' })]],
    ['an opted-out skip', [nudge({}, { sent: 0, reason: 'opted_out' })]],
    ['a sent offer (the normal buttons, not the template)', [nudge({ status: 'sent' }, { skip_reason: undefined })]],
    ["another teacher's row", [nudge({ user_id: 'someone-else' })]],
    ['another kind', [nudge({ kind: 'coaching_after_lp' })]],
  ])('%s ⇒ not handled', async (_label, nudges) => {
    const db = install(world({ nudges }));
    expect(await ReminderStop.handleReminderStop({ user: USER, text: 'STOP', now: NOW })).toBe(false);
    expect(optOutInserts(db)).toEqual([]);
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
  });

  it('no user ⇒ not handled; a throwing read ⇒ not handled (the text goes on as before)', async () => {
    install(world());
    expect(await ReminderStop.handleReminderStop({ user: null, text: 'STOP', now: NOW })).toBe(false);
    install(world());
    await WindowTemplate.templateName();   // switch cached on
    supabase.from.mockImplementation(() => { throw new Error('db down'); });
    expect(await ReminderStop.handleReminderStop({ user: USER, text: 'STOP', now: NOW })).toBe(false);
  });

  it('after the opt-out, the template is never sent to her again', async () => {
    const tables = world();
    const db = install(tables);
    await ReminderStop.handleReminderStop({ user: USER, text: 'STOP', now: NOW });
    tables.teacher_reminder_optouts = optOutInserts(db).map((w) => w.row);
    install(tables);
    process.env.WEB_QUIZ_TOKEN_SECRET = 'unit-web-quiz-secret-not-a-secret';
    try {
      const res = await WindowTemplate.sendWindowClosedTemplate({ user: USER });
      expect(res).toEqual({ sent: 0, reason: 'opted_out' });
      expect(WhatsAppService.sendTemplate).not.toHaveBeenCalled();
    } finally {
      delete process.env.WEB_QUIZ_TOKEN_SECRET;
    }
  });
});

describe('the table, schema first: bot/database/migrations/teacher_reminder_optouts.sql', () => {
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.join(__dirname, '../..');
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const sql = read('bot/database/migrations/teacher_reminder_optouts.sql');

  it('creates the table with its columns, checks, the unique pair, RLS on and no policy', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.teacher_reminder_optouts/);
    expect(sql).toMatch(/user_id\s+uuid\s+NOT NULL REFERENCES public\.users\(id\)/);
    expect(sql).toMatch(/kind\s+text\s+NOT NULL CHECK \(kind IN \('quiz_reminder_template'\)\)/);
    expect(sql).toMatch(/source\s+text\s+NOT NULL CHECK \(source IN \('stop_reply'\)\)/);
    expect(sql).toMatch(/UNIQUE \(user_id, kind\)/);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).not.toMatch(/CREATE POLICY/);
    expect(sql).toMatch(/NON-DESTRUCTIVE/);
    expect(sql).toMatch(/Owner: notify-org/);
    expect(sql).toMatch(/Retention:/);
    expect(sql).toMatch(/COMMENT ON COLUMN public\.teacher_reminder_optouts\.user_id IS 'PII/);
  });

  it('has a rollback, and the schema mirror has the table', () => {
    expect(read('bot/database/migrations/teacher_reminder_optouts_rollback.sql')).toMatch(/DROP TABLE IF EXISTS public\.teacher_reminder_optouts/);
    expect(read('infrastructure/supabase/00_complete-schema.sql')).toMatch(/CREATE TABLE IF NOT EXISTS (public\.)?teacher_reminder_optouts/);
  });
});
