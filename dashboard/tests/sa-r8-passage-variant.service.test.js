'use strict';
/**
 * The passage result names the rotation variant the child saw (sa-page.js rotate), so the scorer marks the text the
 * child read instead of guessing it from the session id: result.variant = its id, null for a passage without rotation.
 * Data only: nothing on screen changes.
 */
const { createRunner } = require('../sa/sa-core');
const { rotate } = require('../sa/sa-page');
const FULL = require('../../bot/shared/data/child-test/sa/sa.coach.G1.A.ur.json');

function clock() { let t = 1000; const f = () => t; f.go = (ms) => { t += ms; }; return f; }
function storyOnly(b) { return { battery_id: b.battery_id, lang: b.lang, tasks: b.tasks.filter((t) => t.id === 'ur.story') }; }
function finishStory(battery) {
  const now = clock();
  const r = createRunner({ battery, now, wall: () => 'T', session_id: 's1', onEvent: () => {} });
  r.start(); r.instructionDone(); r.begin();
  now.go(10 * 60 * 1000); r.tick();
  if (r.view().phase === 'last_word') r.lastWord(3);
  return r.results().find((x) => x.task_id === 'ur.story');
}

test('a rotated passage records the variant shown (index 1)', () => {
  const story = FULL.tasks.find((t) => t.id === 'ur.story');
  expect(story.variants.length).toBeGreaterThan(1);
  let seed = null; let rotated = null;
  for (let i = 0; i < 200 && !seed; i += 1) {
    const b = rotate(storyOnly(FULL), `seed-${i}`);
    if (b.tasks[0].variant.id === story.variants[1].id) { seed = `seed-${i}`; rotated = b; }
  }
  expect(seed).not.toBeNull();
  expect(finishStory(rotated).variant).toBe(story.variants[1].id);
});

test('a passage without rotation records variant null', () => {
  const b = storyOnly(FULL);
  const plain = { ...b, tasks: b.tasks.map(({ variants: _v, ...t }) => t) };
  const res = finishStory(plain);
  expect(res).toHaveProperty('variant', null);
});

test('a task that is not a passage carries no variant key', () => {
  const b = { battery_id: 'b', tasks: [FULL.tasks.find((t) => t.id === 'ur.story_comp')] };
  const now = clock();
  const r = createRunner({ battery: rotate(b, 's'), now, wall: () => 'T', session_id: 's1', onEvent: () => {} });
  r.start(); r.instructionDone(); r.begin();
  for (let i = 0; i < 20 && r.view().phase === 'running'; i += 1) r.answer('spoken');
  const res = r.results()[0];
  if (res) expect(res).not.toHaveProperty('variant');
});
