// teacher-training-capstone — the hand-written teacher-training TT03 (bd-te5lae): the written capstone exam submit. Joined
// to the generated teacher-training driver by .claude/qa/web/gen_page_features.py (EXTRA).
//
// The exam is Beacon House Level 1's real capstone (the first Beacon House level in the demo teacher's niete_standard
// programme, so it is never chain-locked). The exam gate opens once every module of the level is done, so the run marks
// each of the level's modules done for the demo teacher in THIS run's own database (rows it inserts and deletes again).
// The teacher then opens the exam in the teacher app, writes every answer past the server's floor and submits.
//
// Marking is the bot's model call (TrainingRules.scoreCapstoneAnswer → the bot's internal API → Capstone.scoreAnswer).
// This lane's bot replays recorded vendor calls only (E2E_CASSETTE=replay-strict): with no recording for capstone
// marking the bot cannot mark, which is exactly the spec's "marking is unavailable". So the run proves the outage half
// for real — "Not sent", the server's own words that nothing was recorded, her answers still in the form, and no attempt
// row — and reports the "marked and recorded once" half BLOCKED with that reason. If a marking recording is ever added,
// the first submit is marked and the scenario checks the recorded attempt instead.
'use strict';
const { asRole, expect } = require('../lib.cjs');

const TEACHER = "(select id from users where phone_number = '923000000911')";
const VENDOR = 'BEACONHOUSE';
const LEVEL_SQL = 'select l.id from training_levels l join training_vendors v on v.id = l.vendor_id '
  + "join training_grand_quizzes q on q.level_id = l.id and q.quiz_type = 'capstone' and q.is_active "
  + "where v.key = '" + VENDOR + "' and l.is_active order by l.order_index limit 1";
const ANSWER = (n) => ('Answer ' + n + ': in my class I would first ask the children what they already know, then model the '
  + 'idea with a short worked example on the board, then let pairs try two questions while I walk around and listen. '
  + 'I would note who is stuck, bring the class back together, ask two children to explain their thinking aloud, and '
  + 'close with one quick question every child answers on a slate so I can see who understood before the next lesson.');
const NOT_RECORDED = 'We could not mark this exam right now. Nothing has been recorded — please try again.';

async function markLevelDone(ctx, levelId) {
  return String(await ctx.sql('insert into teacher_training_progress (user_id, module_id) '
    + 'select ' + TEACHER + ', m.id from training_modules m join training_courses c on c.id = m.course_id '
    + 'where c.level_id = ' + levelId + ' and c.is_active and m.is_active '
    + 'and not exists (select 1 from teacher_training_progress p where p.user_id = ' + TEACHER + ' and p.module_id = m.id) '
    + 'returning id')).split('\n').filter(Boolean);
}
const attemptsOn = async (ctx, levelId) => Number(await ctx.sql('select count(*) from training_assessment_attempts where user_id = '
  + TEACHER + ' and level_id = ' + levelId + " and quiz_kind = 'capstone'"));

module.exports = [{
  id: 'TT03',
  title: 'A teacher submits the written capstone exam: it is marked and recorded, and a marking outage records nothing',
  run: async (page, ctx) => {
    const levelId = String(await ctx.sql(LEVEL_SQL) || '').trim();
    if (!levelId) return { blocked: "no active Beacon House level with a capstone exam in this run's database" };
    const before = await attemptsOn(ctx, levelId);
    const added = await markLevelDone(ctx, levelId);
    try {
      await asRole(page, ctx, 'teacher', 'teacherV2');
      const answered = [];
      page.on('response', (r) => { if (/\/capstone\/attempts$/.test(new URL(r.url()).pathname)) answered.push(r); });
      await page.goto(ctx.baseUrl + '/portal/teacher/training/provider/' + VENDOR + '/level/' + levelId + '/exam', { waitUntil: 'domcontentloaded' });
      await page.getByTestId('training-exam-start').click({ timeout: 20000 });
      const box = page.getByRole('textbox');
      let n = 0;
      for (;;) {
        await box.waitFor({ timeout: 15000 });
        n += 1;
        await box.fill(ANSWER(n));
        if (await page.getByTestId('training-exam-submit').count()) break;
        await page.getByTestId('training-exam-next').click();
        expect(n < 40, 'the exam never reached its last question');
      }
      await page.getByTestId('training-exam-submit').click();
      const deadline = Date.now() + 130000; // the route's own budget is 120 s
      while (!answered.length && Date.now() < deadline) await page.waitForTimeout(250);
      expect(answered.length === 1, 'Submit should send the exam once, sent ' + answered.length);
      const status = answered[0].status();

      if (status === 200) {
        // marked: the result shows her score, and one attempt row was written
        await page.getByTestId('training-exam-continue').waitFor({ timeout: 20000 });
        const after = await attemptsOn(ctx, levelId);
        expect(after === before + 1, 'one attempt should be recorded, found ' + (after - before));
        return { questions: n, marked: true, recorded: after - before };
      }

      // marking unavailable: "Not sent", the server's own words, her answers kept, nothing recorded
      expect(status === 503, 'a marking outage should answer 503, got ' + status);
      await page.getByText('Not sent', { exact: true }).waitFor({ timeout: 15000 });
      const detail = await page.getByRole('alert').innerText();
      expect(detail.trim() === NOT_RECORDED, 'the screen should give the server\'s words, got: ' + detail);
      expect((await box.inputValue()) === ANSWER(n), 'her last answer should still be in the form');
      expect(await attemptsOn(ctx, levelId) === before, 'a marking outage must record no attempt');
      return {
        blocked: "the 'marked and recorded once' half needs the model to mark: this lane's bot replays recorded vendor calls "
          + 'only (E2E_CASSETTE=replay-strict) and has no recording for capstone marking, so every submit is the outage. '
          + 'The outage half passed: Not sent, "' + NOT_RECORDED + '", answers kept, no attempt row',
        questions: n, status,
      };
    } finally {
      if (added.length) await ctx.sql('delete from teacher_training_progress where id in (' + added.map((id) => "'" + id + "'").join(', ') + ')');
    }
  },
}];
