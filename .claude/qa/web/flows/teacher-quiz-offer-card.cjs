// teacher-quiz-offer-card — the hand-written teacher-home scenarios for Home's quiz card (bd-pdwwk4.2): when the bot
// could not send today's 15:00 lesson-plan quiz offer because the teacher's WhatsApp window was shut, Home's "Ready
// for you" lists "Make today's quiz" (app_settings quiz_offer_closed_window, key app_card). Joined to the generated
// teacher-home driver by .claude/qa/web/gen_page_features.py (EXTRA).
//
// Nothing is faked between the page and the server: the switch is REAL (app_settings on this run's database) and the
// skipped offer is a REAL teacher_nudges row, shaped as the bot's sweeper writes it (status skipped, context.skip_reason
// window_closed, context.classes[].lessons[]). The switch, the row and the saved language are put back afterwards.
// The card's switch has its own 30 s cache in dashboard/services/teacher-notices.service.js (not feature-flags.js, so
// FLAG_CACHE_TTL_MS=0 does not reach it): every scenario polls Home until the server agrees with the switch.
// WEB_SHOTS_DIR set → each scenario also saves its 360 px screen there.
'use strict';
const path = require('path');
const { DEMO, expect, asRole, watch } = require('../lib.cjs');

const e164 = (p) => '92' + p.slice(1);
const q = (s) => (s === null || s === undefined ? 'null' : "'" + String(s).replace(/'/g, "''") + "'");
const SWITCH = 'quiz_offer_closed_window';
const TOPIC = 'Comparing fractions';
const LESSON = 'qa-k5-quiz-card-1';
const SWITCH_WAIT_MS = 40000;

/** Today in Pakistan (no daylight saving), as the bot's sweeper dates the row. */
function pktDate(now = Date.now()) {
  return new Date(now + 5 * 3600e3).toISOString().slice(0, 10);
}

// The demo teacher with the switch `on` (app_card) or off, today's lp_quiz_offer row skipped for a shut window
// (`row` false = no row), and `lang` saved; then all three put back.
async function withQuizOffer(ctx, { on, row, lang }, body) {
  const [id, prevLang] = (await ctx.sql('select id, preferred_language from users where phone_number = ' + q(e164(DEMO.teacher)))).split('|');
  expect(id, 'no demo teacher ' + DEMO.teacher);
  const date = pktDate();
  const where = 'user_id = ' + q(id) + ' and nudge_date = ' + q(date) + "::date and kind = 'lp_quiz_offer'";
  const prevSwitch = await ctx.sql('select value::text from app_settings where key = ' + q(SWITCH));
  const prevRow = await ctx.sql('select row_to_json(t)::text from teacher_nudges t where ' + where);
  const context = { skip_reason: 'window_closed', held_path: 'none',
    classes: [{ key: 'g4', grade: 4, subject: 'Maths', lessons: [{ lesson_id: LESSON, topic: TOPIC }] }] };
  try {
    await ctx.sql('insert into app_settings (key, value) values (' + q(SWITCH) + ', '
      + q(on ? JSON.stringify({ app_card: true }) : JSON.stringify({ trace: true })) + '::jsonb) '
      + 'on conflict (key) do update set value = excluded.value, updated_at = now()');
    await ctx.sql('delete from teacher_nudges where ' + where);
    let nudgeId = null;
    if (row) {
      nudgeId = await ctx.sql('insert into teacher_nudges (user_id, nudge_date, kind, status, scheduled_at, context) values ('
        + q(id) + ', ' + q(date) + "::date, 'lp_quiz_offer', 'skipped', now(), " + q(JSON.stringify(context)) + '::jsonb) returning id');
    }
    await ctx.sql('update users set preferred_language = ' + q(lang || 'en') + ' where id = ' + q(id));
    return await body({ id, nudgeId, where });
  } finally {
    await ctx.sql('delete from teacher_nudges where ' + where);
    if (prevRow) {
      await ctx.sql('insert into teacher_nudges select * from json_populate_record(null::teacher_nudges, ' + q(prevRow) + '::json)');
    }
    if (prevSwitch) {
      await ctx.sql('update app_settings set value = ' + q(prevSwitch) + '::jsonb, updated_at = now() where key = ' + q(SWITCH));
    } else await ctx.sql('delete from app_settings where key = ' + q(SWITCH));
    await ctx.sql('update users set preferred_language = ' + q(prevLang || null) + ' where id = ' + q(id));
  }
}

async function open(page, ctx, p) {
  await page.setViewportSize({ width: 360, height: 740 });
  const w = watch(page);
  w.errors.length = 0; w.fivexx.length = 0;
  await page.goto(ctx.baseUrl + p, { waitUntil: 'domcontentloaded' });
  return w;
}
// Home, reloaded until the quiz card is (want true) or is not (want false) drawn, for at most SWITCH_WAIT_MS:
// the card's switch cache is 30 s. Returns the card's text, or '' when it is not drawn.
async function homeUntil(page, ctx, title, want) {
  const until = Date.now() + SWITCH_WAIT_MS;
  let w = null;
  for (;;) {
    w = await open(page, ctx, '/portal/teacher');
    await page.getByRole('heading', { level: 1 }).first().waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForTimeout(2500);
    const card = page.getByRole('button', { name: new RegExp(title) }).first();
    const drawn = (await card.count()) > 0;
    if (drawn === want || Date.now() > until) {
      return { w, text: drawn ? (await card.innerText()).replace(/\s+/g, ' ').trim() : '', card: drawn ? card : null };
    }
    await page.waitForTimeout(5000);
  }
}
async function shot(page, name) {
  if (!process.env.WEB_SHOTS_DIR) return null;
  const file = path.join(process.env.WEB_SHOTS_DIR, name + '.png');
  await page.screenshot({ path: file, fullPage: true });
  return file;
}
function healthy(w) {
  expect(!w.errors.length, 'page error: ' + w.errors.join(' | '));
  expect(!w.fivexx.length, '5xx: ' + w.fivexx.join(' | '));
}

const scenarios = [
  { id: 'TH16', title: "Teacher app v2: when today's WhatsApp quiz offer could not reach the teacher, Home lists \"Make today's quiz\" and its tap opens the quiz home", run: (page, ctx) =>
    withQuizOffer(ctx, { on: true, row: true }, async ({ where }) => {
      await asRole(page, ctx, 'teacher', 'teacherV2');
      const { w, text, card } = await homeUntil(page, ctx, "Make today's quiz", true);
      expect(card, 'no "Make today\'s quiz" card on Home with the switch on and a skipped offer row');
      expect(text.includes(TOPIC), 'the card does not name the lesson "' + TOPIC + '": ' + text);
      expect(text.includes('Quiz'), 'the card does not say "Quiz": ' + text);
      const file = await shot(page, 'home-quiz-offer-en-360');
      healthy(w);
      await Promise.all([page.waitForURL(/\/quiz\/teacher\//, { timeout: 20000 }), card.click()]);
      const opened = await ctx.sql("select context->>'app_card_opened_at' from teacher_nudges where " + where);
      expect(opened, 'the tap did not stamp context.app_card_opened_at on the row');
      const status = await ctx.sql('select status || \'|\' || (context->>\'skip_reason\') from teacher_nudges where ' + where);
      expect(status === 'skipped|window_closed', 'the tap changed the row\'s status or reason: ' + status);
      const again = await homeUntil(page, ctx, "Make today's quiz", false);
      expect(!again.card, 'the card is still on Home after its tap');
      return { text: text.slice(0, 200), quizHome: page.url().replace(/\/quiz\/teacher\/.*/, '/quiz/teacher/<token>'), shot: file };
    }) },
  { id: 'TH17', title: "Teacher app v2: the quiz card reads in Urdu for a teacher whose language is Urdu", run: (page, ctx) =>
    withQuizOffer(ctx, { on: true, row: true, lang: 'ur' }, async () => {
      await asRole(page, ctx, 'teacher', 'teacherV2');
      const { w, text, card } = await homeUntil(page, ctx, 'آج کا کوئز بنائیں', true);
      expect(card, 'no «آج کا کوئز بنائیں» card on Home in Urdu');
      expect(text.includes('کوئز'), 'the card does not say «کوئز»: ' + text);
      const file = await shot(page, 'home-quiz-offer-ur-360');
      healthy(w);
      return { text: text.slice(0, 200), shot: file };
    }) },
  { id: 'TH18', title: 'Teacher app v2: with the quiz card switch off, a skipped quiz offer adds nothing to Home', run: (page, ctx) =>
    withQuizOffer(ctx, { on: false, row: true }, async () => {
      await asRole(page, ctx, 'teacher', 'teacherV2');
      const { w, card } = await homeUntil(page, ctx, "Make today's quiz", false);
      expect(!card, 'the quiz card is on Home with the switch off');
      healthy(w);
      return { drawn: false };
    }) },
];

module.exports = scenarios;
