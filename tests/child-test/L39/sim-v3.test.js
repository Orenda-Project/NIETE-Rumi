/**
 * L39 (bd-s1oo0.50.5, CONTRACT §21.8): the simulated coach plays a full battery-v3 visit.
 *
 * runVisitV3 (coach.js) follows the v3 bot as the contract describes it (§19 v2 journey + §21.4):
 *   /egra → list [Start] → setup picture [Start with …] → presence → one plain step text per task → one voice
 *   note per task, the task's own fixture note; a gap task is skipped by the bot; a task the key marks
 *   skipped_by_coach is answered with "skip"; after the last child the results text and the review pages, each
 *   page answered from the fixture key, until "saved".
 * The bot here is fake-bot-v3.js (an in-process transport speaking that protocol) — the same one --dry-run uses.
 * Real: coach.js, fake-bot-v3.js, timeline.js. Fixtures: tiny files in a temp dir (no audio, no child data).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runVisitV3, TASKS_V3 } = require('../../../bot/scripts/e2e/child-test-sim/coach');
const { createFakeBotV3 } = require('../../../bot/scripts/e2e/child-test-sim/fake-bot-v3');
const { createTimeline } = require('../../../bot/scripts/e2e/child-test-sim/timeline');

const GAPS = ['ur.nonwords', 'en.nonwords', 'en.words'];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'l39-sim-'));
function fixture(id, { weak = false } = {}) {
  const dir = path.join(tmp, id);
  fs.mkdirSync(dir, { recursive: true });
  const tasks = {};
  for (const task of TASKS_V3) {
    if (GAPS.includes(task)) { tasks[task] = { task, gap: true, audio: null }; continue; }
    if (weak && task === 'ma.add2') { tasks[task] = { task, skipped_by_coach: true, audio: null }; continue; }
    fs.writeFileSync(path.join(dir, `${task}.ogg`), `note ${id} ${task}`);
    tasks[task] = { task, audio: `${task}.ogg`, items: [{ i: 0, verdict: 'correct' }, { i: 1, verdict: 'wrong' }, { i: 2, verdict: 'none' }] };
  }
  fs.writeFileSync(path.join(dir, 'key.json'), JSON.stringify({ fixture_id: id, grade: 3, tasks }));
  return { id, dir, grade: 3 };
}
const fixtures = [fixture('v3-a'), fixture('v3-b'), fixture('v3-weak', { weak: true }), fixture('v3-c'), fixture('v3-d')];
const titles = Object.fromEntries(TASKS_V3.map((t) => [t, { en: `Title ${t}`, ur: `عنوان ${t}` }]));

test('a five-child v3 visit: 18 steps a child, one note per recorded task, skip for a skipped task, the review paged and answered from the key', async () => {
  const bot = createFakeBotV3({ titles, gaps: GAPS, children: 5, reviewItemsPerChild: 4 });
  const tl = createTimeline(path.join(tmp, 'run', 'timeline.jsonl'));
  const res = await runVisitV3({ transport: bot, timeline: tl, fixtures, titles, timeoutMs: 2000, sleep: async () => {} });
  expect(res).toMatchObject({ ok: true });
  expect(res.children.map((c) => c.fixture)).toEqual(fixtures.map((f) => f.id));
  // every recorded task got exactly its own note, in visit order
  const notes = bot.received.filter((r) => r.kind === 'audio');
  expect(notes).toHaveLength(4 * 15 + 14);
  expect(notes.slice(0, 15).map((n) => path.basename(n.file, '.ogg'))).toEqual(TASKS_V3.filter((t) => !GAPS.includes(t)));
  // the weak child's ma.add2 was skipped by text, not a note
  expect(bot.received.filter((r) => r.kind === 'text' && /^skip$/i.test(r.text))).toHaveLength(1);
  expect(bot.stepsSent).toBe(5 * 18);
  // the review: 20 items over two pages, both submitted, verdicts from the key
  expect(res.review).toMatchObject({ pages: 2, submitted: 2, items: 20 });
  const sub = bot.received.filter((r) => r.kind === 'flow');
  expect(sub).toHaveLength(2);
  expect(sub[0].response.r1).toBe('correct');   // item i0 → key says correct
  expect(sub[0].response.r2).toBe('wrong');
  expect(sub[0].response.r3).toBe('none');
  // the timeline never carries a name
  const lines = fs.readFileSync(path.join(tmp, 'run', 'timeline.jsonl'), 'utf8');
  expect(lines).not.toMatch(/Child Name/);
  expect(lines).toMatch(/"step":"visit_done"/);
});

test('a missing note file stops the run with the fixture and task named', async () => {
  const broken = fixture('v3-broken');
  fs.unlinkSync(path.join(broken.dir, 'ur.letters.ogg'));
  const bot = createFakeBotV3({ titles, gaps: GAPS, children: 1, reviewItemsPerChild: 0 });
  const res = await runVisitV3({ transport: bot, timeline: createTimeline(path.join(tmp, 'run2', 't.jsonl')), fixtures: [broken], titles, timeoutMs: 2000, sleep: async () => {} });
  expect(res.ok).toBe(false);
  expect(res.error).toMatch(/v3-broken.*ur\.letters/);
});
