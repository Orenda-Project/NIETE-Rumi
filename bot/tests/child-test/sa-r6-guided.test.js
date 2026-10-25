'use strict';
/**
 * Round 6, bar S (DESIGN_R6 §3, RULINGs R6-1, R6-3): the guided tier's content on the RDF forms.
 *   - every W3 task of the Grade 1-3 coach forms carries script.guided (lines, each a clip; a practice plan), and no
 *     Grade 4-5 or game form carries any;
 *   - the plan points only at the task's own practice items, and no practice item it uses is a scored item of the task;
 *   - every guided line is in the voice manifest (so the voice gate can refuse a run without its clips);
 *   - the committed battery files are what the builder makes.
 */
const fs = require('fs');
const path = require('path');
const { buildSaBank, splitSaBankWithRuntime } = require('../../shared/services/child-test/sa/build');
const { voiceManifest } = require('../../shared/services/child-test/sa/voice-manifest');

const DATA = path.join(__dirname, '../../shared/data/child-test');
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const bank = buildSaBank({ v3: read('item-bank.v3.json'), extra: read('item-bank.sa-extra.v1.json'), w3: read('item-bank.sa-w3.v1.json') });
const files = splitSaBankWithRuntime(bank);
const battery = (g, lang) => files[`sa/sa.coach.G${g}.A.${lang}.json`];
const LINE_KEYS = ['demo', 'demo_after', 'turn', 'help_silence', 'help_say_now', 'help_press', 'check', 'retry', 'ready', 'nudge', 'instr_silence', 'next_warm'];

describe('the guided tier on the RDF forms (sa_guided_instructions)', () => {
  test.each([1, 2, 3])('Grade %i: every RDF task carries script.guided, each line a clip in the page\'s language', (g) => {
    for (const lang of ['ur', 'en']) {
      const b = battery(g, lang);
      expect(b.rdf_auto.length).toBe(17);
      for (const id of b.rdf_auto) {
        const gd = b.tasks.find((t) => t.id === id).script.guided;
        expect(gd).toBeTruthy();
        expect(gd.steps.length).toBeGreaterThan(0);
        for (const l of [...gd.steps, ...LINE_KEYS.map((k) => gd[k]).filter(Boolean)]) {
          expect(typeof l.text).toBe('string');
          expect(l.audio).toMatch(new RegExp(`^sa/v1/${lang}/[0-9a-f]{12}\\.mp3$`));
          if (lang === 'ur') expect(l.text).not.toMatch(/[A-Za-z]/);
        }
      }
    }
  });

  test.each([4, 5])('Grade %i: no task carries script.guided', (g) => {
    for (const lang of ['ur', 'en']) for (const t of battery(g, lang).tasks) expect(t.script && t.script.guided).toBeFalsy();
  });

  test('the game forms carry no guided lines', () => {
    for (const [k, b] of Object.entries(files)) if (/sa\.game\./.test(k)) for (const t of b.tasks) expect(t.script && t.script.guided).toBeFalsy();
  });

  test('R6-3: the plan uses only the task\'s own practice items, never a scored item of the task', () => {
    for (const g of [1, 2, 3]) {
      const b = battery(g, 'ur');
      for (const t of b.tasks.filter((x) => x.script && x.script.guided && x.script.guided.plan)) {
        const { plan } = t.script.guided;
        const scored = new Set(t.items.map((it) => String(it.show != null ? it.show : it.target)));
        const scoredSets = new Set(t.items.map((it) => JSON.stringify([it.shown || null, it.options || null, it.target])));
        for (const role of Object.keys(plan)) {
          const p = t.practice[plan[role]];
          expect(p).toBeTruthy();
          if (t.mode === 'tap' || t.response === 'tap' || t.response === 'keypad') expect(scoredSets.has(JSON.stringify([p.shown || null, p.options || null, p.target]))).toBe(false);
          else expect(scored.has(String(p.show != null ? p.show : p.target))).toBe(false);
        }
      }
    }
  });

  test('the record tasks walk demo → helped turn → unaided check, and retry on the demo item', () => {
    const t = battery(2, 'ur').tasks.find((x) => x.id === 'en.words4');
    expect(t.practice.length).toBe(3);
    expect(t.script.guided.plan).toEqual({ demo: 0, turn: 1, check: 2, retry: 0 });
    const n = battery(2, 'ur').tasks.find((x) => x.id === 'ma.number_id8');
    expect(n.script.guided.plan).toEqual({ demo: 0, turn: 0, check: 0, retry: 0 });
  });

  test('every guided line is in the voice manifest', () => {
    const keys = new Set(voiceManifest(bank).map((r) => r.key));
    for (const g of [1, 2, 3]) {
      for (const lang of ['ur', 'en']) {
        for (const t of battery(g, lang).tasks.filter((x) => x.script && x.script.guided)) {
          const gd = t.script.guided;
          for (const l of [...gd.steps, ...LINE_KEYS.map((k) => gd[k]).filter(Boolean)]) expect(keys.has(l.audio)).toBe(true);
        }
      }
    }
  });

  test('the committed battery files are what the builder makes', () => {
    for (const g of [1, 2, 3, 4, 5]) {
      for (const lang of ['ur', 'en']) {
        const rel = `sa/sa.coach.G${g}.A.${lang}.json`;
        expect(fs.readFileSync(path.join(DATA, rel), 'utf8')).toBe(`${JSON.stringify(files[rel])}\n`);
      }
    }
  });
});

describe('the coach API\'s battery payload (sa-api saBattery) never carries the guided lines', () => {
  // The engine runs the switched file from /sa/batteries/ (ui.guided only when sa_guided_instructions is ON); the API's
  // payload stays as before whatever the switch.
  const sa = require('../../shared/services/child-test/app/sa-api.service');
  const committed = require('../../shared/data/child-test/item-bank.sa.v1.json');
  const chain = (data) => { const q = { select: () => q, eq: () => q, in: () => q, gte: () => q, order: () => q, limit: () => q, then: (res, rej) => Promise.resolve({ data, error: null }).then(res, rej) }; return q; };
  test('Grade 3, RDF auto: no task in the payload has script.guided', async () => {
    const SID = 's-guided';
    const session = { id: SID, coach_user_id: 'c1', draw_id: 'd1', visit_key: 'day:x', grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'in_progress', device: {} };
    const deps = {
      enabled: async () => true,
      supabase: { from: (t) => chain(t === 'leader_schools' ? [{ school_id: 'sc1', school_name: 'Testwala School' }] : []) },
      store: { getSession: async () => ({ ok: true, session }), getDraw: async () => ({ ok: true, draw: { id: 'd1', school_id: 'sc1', student_id: 'st1', status: 'tested' } }) },
      saStore: { summary: async () => ({ ok: true, block: 'rdf_auto' }), markSynced: async (id, v) => ({ ok: true, device: { block: v.block } }) },
      bank: committed, now: () => new Date('2026-10-26T05:00:00Z'), log: () => {}, logError: () => {}, blockByHistory: false, rdfW3Forms: true,
    };
    expect(Object.values(committed.tasks).some((t) => t.script && t.script.guided)).toBe(true);
    const out = await sa.saBattery({ userId: 'c1', sessionId: SID }, deps);
    expect(out.status).toBe('ok');
    const tasks = Object.values(out.battery.tasks);
    expect(tasks.length).toBeGreaterThan(0);
    for (const t of tasks) expect(t.script && t.script.guided).toBeFalsy();
  });
});
