'use strict';
/**
 * G612 cross-contract tests (contracts/tests.md §3). b-config owns them; every later lane keeps them green.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: jest.fn() } } }),
}));

const fs = require('fs');
const path = require('path');

const A = '../../bot/shared/services/assessment';
const SC = require(`${A}/subject-config`);
const Q6 = require(`${A}/question-types-6-12`);
const P6 = require(`${A}/prompts-6-12`);
const SLO = require(`${A}/slo-map`);
const QT = require(`${A}/question-types`);
const Gen = require(`${A}/assessment-generation.service`);
const PROMPTS = require(`${A}/ict-prompts.json`);
const SCHEMA = require('./fixtures/g612/item-tag.schema.json');
const VALID = require('./fixtures/g612/item-tag.valid.json');

const core = SC.rows().filter((r) => r.status === 'core');
const SECONDARY_KEY = /^eg\.ict\.[a-z_]+\.(6_8|9_10|11_12)\.system$/;

it('1 registry <-> prompts: every core prompt_key exists, and no other secondary system key does', () => {
  const want = new Set(core.map((r) => r.prompt_key));
  for (const k of want) expect(typeof PROMPTS[k]).toBe('string');
  expect(new Set(Object.keys(PROMPTS).filter((k) => SECONDARY_KEY.test(k)))).toEqual(want);
});

it('2 registry <-> types: every core type_set x band exists and holds catalogue ids', () => {
  const ids = new Set(Q6.DATA.types.map((t) => t.id));
  for (const r of core) {
    const set = Q6.DATA.type_sets[r.type_set][r.band];
    expect(Array.isArray(set)).toBe(true);
    for (const id of set) expect(ids.has(id)).toBe(true);
  }
});

it('3 registry <-> slo-map: one file per core row; grade <= 8 is policy null', () => {
  const dir = path.join(__dirname, A, 'slo-map');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  expect(files).toEqual(core.map((r) => `${r.grade}_${r.code}.json`).sort());
  for (const r of core) {
    const m = JSON.parse(fs.readFileSync(path.join(dir, `${r.grade}_${r.code}.json`), 'utf8'));
    if (r.grade <= 8) expect(m.policy).toBe('null');
  }
});

// b-import owns BOOKS_6_12 (scripts/assessment/import-ict-textbooks.py); c-patterns owns the 6-12 entries.
it.todo('4 registry <-> importer: BOOKS_6_12 values equal the core book_stem set (when b-import lands)');
it.todo('5 registry <-> patterns: each board/term pattern_entry is registered; no free_only/pending entry (when c-patterns lands)');

it('6 tag <-> types: every example type is a catalogue id; every drift string resolves or rejects', () => {
  const ids = new Set(Q6.DATA.types.map((t) => t.id));
  const walk = (it) => [it.type, ...(it.or || []).flatMap(walk), ...(it.parts || []).flatMap(walk)];
  for (const item of VALID.items) for (const t of walk(item).filter(Boolean)) expect(ids.has(t)).toBe(true);
  const drift = ['mcq_stimulus', 'correct_sentence', 'sequence_text', 'timeline_text', 'tashreeh_prose',
    'tashreeh_poem', 'tashreeh_ghazal', 'timeline', 'other'];
  for (const s of drift) {
    const r = Q6.normaliseType(s, 'islamiat');
    expect(r.ok ? ids.has(r.id) : /TYPE_/.test(r.reason)).toBe(true);
  }
});

it('7 prompt <-> tag: eg.format.secondary names exactly the schema tag keys the model writes', () => {
  const m = PROMPTS['eg.format.secondary'].match(/"tag": \{([^}]*)\}/);
  expect(m).not.toBeNull();
  const named = [...m[1].matchAll(/"([a-z_]+)":/g)].map((x) => x[1]).sort();
  const modelWrites = SCHEMA.$defs.tag.required.filter((k) => k !== 'official_slo').sort();
  expect(named).toEqual(modelWrites);
});

describe('8 no G1-5 reach', () => {
  const spies = () => [
    jest.spyOn(SC, 'resolve'), jest.spyOn(Q6, 'forSubject'), jest.spyOn(Q6, 'categoryOf'),
    jest.spyOn(Q6, 'defaultMix'), jest.spyOn(P6, 'promptFor'), jest.spyOn(SLO, 'officialSloFor'),
  ];
  afterEach(() => jest.restoreAllMocks());

  it('question types and system prompts for every G1-5 subject never touch the 6-12 modules', () => {
    const s = spies();
    const subjects = ['english', 'urdu', 'maths', 'science', 'islamiat', 'general_knowledge', 'social_studies'];
    const prompts = [];
    for (const subject of subjects) {
      prompts.push(Gen.buildSystemPrompt({ subject, includeAnswerKey: true }));
      for (const grade of [1, 2, 3, 4, 5]) {
        const types = QT.forSubject(subject, grade);
        QT.withCounts(types.map((t) => t.id), 15, subject, grade);
        QT.defaultMix(subject, grade, 15);
        QT.parsePerTypeCounts([types[0].id], { count_1: '3' }, subject, grade);
      }
    }
    for (const spy of s) expect(spy).not.toHaveBeenCalled();
    const secondary = Object.keys(PROMPTS).filter((k) => SECONDARY_KEY.test(k) || /6_12|secondary|board_section/.test(k));
    for (const p of prompts) for (const k of secondary) expect(p.includes(PROMPTS[k])).toBe(false);
  });

  it('positive control: a G10 call does reach them, so the spies can see', () => {
    const [resolve, forSubject] = spies();
    QT.forSubject('physics', 10);
    expect(forSubject).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalled();
  });
});
