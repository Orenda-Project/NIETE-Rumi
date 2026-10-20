// coach-disagreement — the hand-written coach-portal scenario (bd-tbprit.10/.11/.14): a teacher's disagreement reaches her
// coach, he opens the card, reads Rifat's one-line score reason, "Is this a pattern?" and the coaching suggestion, and taps
// "The teacher was right", which flags the report for the DC team on the request row. Joined to the generated
// coach-portal driver by .claude/qa/web/gen_page_features.py (EXTRA), so spec and driver still come from one place.
'use strict';
const { DEMO, expect, asRole, watch } = require('../lib.cjs');

const e164 = (p) => '92' + p.slice(1);
const q = (s) => "'" + s + "'";

async function seed(ctx) {
  const [coach, teacher, school, session] = (await ctx.sql(
    'select c.id, t.id, t.school_id, (select s.id from coaching_sessions s where s.user_id = t.id and s.status = ' + q('completed')
    + ' and s.analysis_data is not null order by s.created_at desc limit 1) from users c, users t where c.phone_number = '
    + q(e164(DEMO.coach)) + ' and t.phone_number = ' + q(e164(DEMO.teacher)))).split('|');
  expect(session, 'the demo teacher has no completed DC report to disagree with');
  await ctx.sql('delete from coach_visit_requests where coaching_session_id = ' + q(session));
  const id = await ctx.sql('insert into coach_visit_requests (coaching_session_id, teacher_user_id, coach_user_id, school_id, ab_group, status, reasons) '
    + 'values (' + [session, teacher, coach].map(q).join(', ') + ', ' + (school ? q(school) : 'null') + ", 'C', 'sent', '{score}') returning id");
  return id.split('\n')[0];
}

async function text(page, testId) {
  const el = page.getByTestId(testId);
  await el.waitFor({ state: 'visible', timeout: 20000 }).catch(() => { throw new Error('no ' + testId + ' on the card'); });
  return (await el.innerText()).replace(/\s+/g, ' ').trim();
}

const scenarios = [
  { id: 'CP05', title: "Coach app v2: a teacher's disagreement opens as the card, and The teacher was right flags the report", run: async (page, ctx) => {
    await ctx.sql("insert into app_settings (key, value) values ('coach_disagreement_card', 'true'::jsonb) on conflict (key) do update set value = excluded.value, updated_at = now()");
    const id = await seed(ctx);
    try {
      await asRole(page, ctx, 'coach', 'coachV2');
      const w = watch(page);
      w.errors.length = 0; w.fivexx.length = 0;
      await page.goto(ctx.baseUrl + '/portal/coach/disagreements', { waitUntil: 'domcontentloaded' });
      const row = page.locator('a[href="/portal/coach/disagreements/' + id + '"]');
      await row.waitFor({ state: 'visible', timeout: 20000 }).catch(() => { throw new Error('her request is not on the To do list'); });
      await row.click();
      const score = await text(page, 'reason-score');
      expect(/Score she questions/.test(score) && /Details in B\./.test(score), 'the score reason is not the one line: ' + score.slice(0, 160));
      const pattern = await text(page, 'pattern');
      expect(/Is this a pattern\?/.test(pattern), 'no "Is this a pattern?" section');
      const box = await text(page, 'coaching-box');
      expect(/Coaching suggestion/.test(box), 'no coaching suggestion box');
      await page.getByTestId('coaching-box').getByRole('button', { name: /The teacher was right/ }).click();
      await page.getByText('✓ Report sent to the DC team for review.').waitFor({ state: 'visible', timeout: 15000 })
        .catch(() => { throw new Error('no "Report sent to the DC team" after The teacher was right'); });
      let flagged = '';
      for (let i = 0; i < 20 && flagged !== 't'; i++) {
        flagged = await ctx.sql("select coalesce((coach_plan->>'flagged')::boolean, false) from coach_visit_requests where id = " + q(id));
        if (flagged !== 't') await page.waitForTimeout(250);
      }
      expect(flagged === 't', 'the request row was not flagged (coach_plan.flagged = ' + flagged + ')');
      expect(!w.errors.length, 'uncaught page error — ' + w.errors[0]);
      expect(!w.fivexx.length, 'API returned ' + [...new Set(w.fivexx)].join(', '));
      return { request: id, score, flagged: true };
    } finally {
      await ctx.sql('delete from coach_visit_requests where id = ' + q(id));
    }
  } },
];

module.exports = scenarios;
