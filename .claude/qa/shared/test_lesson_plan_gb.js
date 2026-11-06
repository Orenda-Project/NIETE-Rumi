#!/usr/bin/env node
/* test_lesson_plan_gb.js — lesson-plan L13/L14/L15, the Gilgit-Baltistan lane (bd-rj6w0n.14.9).
 *
 * Run: node .claude/qa/shared/test_lesson_plan_gb.js
 *
 * Pins the pure readers the driver scores with (grade list, the GB shelf, the card-link message) and the
 * driver's safety: it only runs on the local lane, records BLOCKED (not FAIL) when the switch or the seed
 * cannot be set, and ALWAYS restores the driver's region and turns the switch back off — even when a
 * scenario throws. Red-first: fails before lesson-plan-gb.cjs exists.
 */
const assert = require('assert');
const path = require('path');
const G = require(path.join(__dirname, 'lesson-plan-gb.cjs'));

const nav = (text, id, hay) => ({ text, id, kind: 'nav', hay: hay || text });
let n = 0;
const test = async (name, fn) => { await fn(); n += 1; console.log('  ok  ' + name); };

(async () => {
  await test('gradesOf reads the grade picker, nothing else', () => {
    const probe = { items: [nav('Grade 2', '2'), nav('Grade 10', '10'), nav('Back', 'b'), nav('Grade 1', '1')] };
    assert.deepStrictEqual(G.gradesOf(probe), ['Grade 1', 'Grade 2', 'Grade 10']);
    assert.deepStrictEqual(G.gradesOf({}), []);
  });

  await test('shelfOf splits open books from Coming Soon rows (by the row id, any language)', () => {
    const s = G.shelfOf({ items: [nav('English', 'English'), nav('Urdu', 'gb_soon_urdu', 'Urdu\nجلد آ رہا ہے'),
      nav('Mathematics', 'gb_soon_mathematics', 'Mathematics\nComing Soon')] });
    assert.deepStrictEqual(s, { open: ['English'], soon: ['urdu', 'mathematics'] });
  });

  await test('isCardLink: her plan as a link — title, grade line, a hosted .card.html URL; never a PDF', () => {
    const seed = { title: 'QA GB lesson', r2_key: 'gb-k5/qa/x.card.html' };
    const en = { txt: 'QA GB lesson\nGrade 3 · English\nOpen your lesson plan:\nhttps://pub.r2.dev/gb-k5/qa/x.card.html' };
    const ur = { txt: 'QA GB lesson\nجماعت 3 · ⁦English⁩\nاپنا سبق کا منصوبہ کھولیں:\nhttps://pub.r2.dev/gb-k5/qa/x.card.html' };
    assert.ok(G.isCardLink(en, seed) && G.isCardLink(ur, seed));
    assert.ok(!G.isCardLink({ txt: 'QA GB lesson\nGrade 3 · English', pdf: true }, seed));
    assert.ok(!G.isCardLink({ txt: 'Open your lesson plan:\nhttps://pub.r2.dev/other.card.html' }, seed));
  });

  await test('isSoonRefusal matches the refusal in either language', () => {
    assert.ok(G.isSoonRefusal('Lesson plans for this book are coming soon. Please pick another book for now.'));
    assert.ok(G.isSoonRefusal('اس کتاب کے سبق کے منصوبے جلد آ رہے ہیں۔'));
    assert.ok(!G.isSoonRefusal(''));
  });

  const IDS = ['L14', 'L13', 'L15'];   // record order: L14 needs only the switch, L13/L15 the seed too
  const harness = (o = {}) => {
    const recs = []; const seeds = []; const restarts = [];
    const deps = {
      lane: () => (o.lane === undefined ? 'local' : o.lane),
      driverId: () => 'uid-1',
      seed: (cmd, args) => { seeds.push([cmd, ...args]); if (cmd === 'seed' && o.seedFails) throw new Error('seed failed'); return cmd === 'seed' ? { prev_region: null, segment_id: 's', title: 'QA GB lesson', r2_key: 'gb-k5/qa/s.card.html' } : { restored: true }; },
      restart: async (proc, env) => { restarts.push([proc, env.LP_GB_K5_ENABLED]); return { ok: !o.restartFails }; },
      scenarios: o.scenarios || {
        baseline: async () => ['Grade 1'], L14: async () => ['PASS', {}], L13: async () => ['PASS', {}], L15: async () => ['PASS', {}],
      },
    };
    const rec = (id, name, verdict, ev) => recs.push([id, verdict, ev]);
    return { recs, seeds, restarts, run: () => G.runGb({ rec, want: () => true, deps }) };
  };

  await test('happy path: switch on, L14 then L13 on the seeded GB driver, switch off for L15, then restored', async () => {
    const h = harness(); await h.run();
    assert.deepStrictEqual(h.recs.map((r) => r[0] + ':' + r[1]), ['L14:PASS', 'L13:PASS', 'L15:PASS']);
    assert.deepStrictEqual(h.seeds.map((s) => s[0]), ['seed', 'restore']);
    assert.deepStrictEqual(h.restarts.map((r) => r[1]), ['true', 'true', 'false', 'false', 'false', 'false']);
  });

  await test('off the local lane every scenario is BLOCKED and nothing is seeded or restarted', async () => {
    const h = harness({ lane: 'sandbox' }); await h.run();
    assert.deepStrictEqual(h.recs.map((r) => r[0] + ':' + r[1]), IDS.map((i) => i + ':BLOCKED'));
    assert.strictEqual(h.seeds.length + h.restarts.length, 0);
  });

  await test('a failed restart is BLOCKED, not FAIL, and the switch is still put back', async () => {
    const h = harness({ restartFails: true }); await h.run();
    assert.ok(h.recs.every((r) => r[1] === 'BLOCKED'), JSON.stringify(h.recs));
    assert.strictEqual(h.restarts[h.restarts.length - 1][1], 'false');
  });

  await test('a failed seed blocks L13/L15 but still restores the region', async () => {
    const h = harness({ seedFails: true }); await h.run();
    const v = Object.fromEntries(h.recs.map((r) => [r[0], r[1]]));
    assert.deepStrictEqual(v, { L14: 'PASS', L13: 'BLOCKED', L15: 'BLOCKED' });
    assert.deepStrictEqual(h.seeds.map((s) => s[0]), ['seed', 'restore']);
  });

  await test('a scenario that throws still restores the region and the switch', async () => {
    const h = harness({ scenarios: { baseline: async () => [], L14: async () => ['PASS', {}], L13: async () => { throw new Error('boom'); }, L15: async () => ['PASS', {}] } });
    await h.run().catch(() => {});
    assert.deepStrictEqual(h.seeds.map((s) => s[0]), ['seed', 'restore']);
    assert.strictEqual(h.restarts[h.restarts.length - 1][1], 'false');
  });

  console.log(n + ' passed');
})().catch((e) => { console.error(e); process.exit(1); });
