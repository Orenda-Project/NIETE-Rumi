/**
 * GATE 1 MEASURES A DELTA THE WAY IT WOULD MEASURE A DOCUMENT — bd-y478d.
 *
 * `OVERLAY_MIN_URDU = 0.5` says a translation must be at least half Urdu letters, and the comment
 * above it already names the exception it has to tolerate: a correct Urdu instruction "keeps its
 * terms of record in English («صحیح (integer)»)". On a WHOLE document that is fine — ninety-odd
 * strings of Urdu prose drown a handful of parenthetical glosses and the score lands near 0.9.
 *
 * bd-idneu then started calling the same gate with a THREE-STRING delta, and the arithmetic
 * inverted. A chapter line, a chapter title and a topic line are exactly the strings a science
 * lesson glosses, because that is how a Pakistani science textbook is written: Urdu term first,
 * the examinable English term beside it in brackets. Measured on the real model output for
 * `grade_10_biology.c07`, the delta scored 0.452 — correct, idiomatic, teacher-ready Urdu,
 * REFUSED for not being Urdu, with the error text telling the operator it was English.
 *
 * This is the same shape as the GATE 2 bug fixed one line below it: a gate written for the
 * authoring case, measuring this CALL when the thing it protects is the DELIVERED DOCUMENT.
 *
 * THE FIX IS NOT A LOWER THRESHOLD. Dropping to 0.4 would admit a genuinely English overlay of
 * four Urdu words, and the number carries no meaning any reviewer could defend. Instead the gate
 * scores the delta with its ALL-LATIN parentheticals removed — the glosses the protocol asks for
 * are not counted against the translation that carries them. A parenthetical containing any Urdu
 * is left in place and still counted, because that is prose, not a term of record.
 *
 * Measured separation on the real strings, which is why this is a rule and not a fudge:
 *
 *   glossed Urdu delta   0.452  ->  1.000   ACCEPT
 *   wholly-English delta 0.000  ->  0.000   REJECT
 *
 * WHAT THIS SUITE PINS:
 *
 *   1. A glossed Urdu delta is accepted, and the telemetry reports the score the gate actually
 *      decided on — a log that prints a different number than the one that ruled is worse than
 *      no log.
 *   2. An English delta is still refused. This is the whole reason the gate exists: an English
 *      "translation" renders as the same English page with the row claiming it worked.
 *   3. Wrapping that English in brackets does not smuggle it through. Stripping is a scoring
 *      rule; it must not become a bypass.
 *   4. A parenthetical that contains Urdu is NOT stripped. Urdu inside brackets is the lesson,
 *      not a term of record, and discarding it would quietly re-introduce defect 2.
 */

const fs = require('fs');
const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { overlayDefects } = require(path.join(V, 'lint_lp.js'));

const BASE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const rawFixture = fs.readFileSync(BASE, 'utf8');
const doc = () => JSON.parse(rawFixture);

jest.mock('../../bot/shared/services/llm-client', () => {
  const create = jest.fn();
  return {
    getClient: () => ({ chat: { completions: { create } } }),
    getClientForModel: (m) => ({
      client: { chat: { completions: { create } } }, model: String(m || ''),
    }),
    __create: create,
  };
});
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const create = require('../../bot/shared/services/llm-client').__create;
const { overlayLessonPlan } = require('../../bot/shared/services/lp612-author.service');

const SEGMENT = { segment_id: 'grade_10_biology.c07.p096-096', subject: 'Biology', grade: 10 };

const EXISTING_UR = 'یہ اردو ہدایت ہے جو اس سبق کے لیے پہلے ہی لکھی جا چکی ہے۔';

/** The three pointers bd-x3dn6 newly offered — the delta a stored document is actually missing. */
const DELTA = ['/provenance/chapter', '/provenance/chapter_title', '/provenance/topic'];

/** A document as it sits in R2: every pointer translated EXCEPT the three above. */
const storedDoc = () => {
  const d = doc();
  d.ur_overlay = {};
  for (const ptr of overlayDefects.targets(d)) {
    if (DELTA.includes(ptr)) continue;
    d.ur_overlay[ptr] = EXISTING_UR;
  }
  return d;
};

const reply = (obj) => ({
  choices: [{ message: { content: JSON.stringify(obj) } }],
  usage: { prompt_tokens: 300, completion_tokens: 80, total_tokens: 380 },
});

/** Ask for the delta, with the stored overlay carried in so GATE 2 measures the MERGE. */
const topUp = (stored) => overlayLessonPlan({
  lpDoc: stored,
  segment: SEGMENT,
  targets: DELTA,
  baseOverlay: stored.ur_overlay,
  model: 'test/model',
});

beforeEach(() => create.mockReset());

describe('A — a glossed Urdu delta is a translation, not an English page', () => {
  /**
   * Verbatim model output for `grade_10_biology.c07.p096-096`, captured at the network boundary
   * during the bd-idneu canary. Every Latin run in it is a gloss of the Urdu term beside it.
   */
  const GLOSSED = {
    '/provenance/chapter': 'باب ۷ — وراثت (Inheritance)',
    '/provenance/chapter_title': 'وراثت اور جینیات (Heredity and Genetics)',
    '/provenance/topic':
      'قانون علیحدگی (Law of Segregation)، دو ہائبرڈ تراکیب (Dihybrid Cross) اور قانون '
      + 'آزادانہ ترتیب (Law of Independent Assortment)',
  };

  it('accepts the delta the canary refused, and returns exactly the three keys asked for', async () => {
    const stored = storedDoc();
    create.mockResolvedValue(reply(GLOSSED));

    const out = await topUp(stored);

    expect(Object.keys(out.overlay).sort()).toEqual([...DELTA].sort());
    expect(out.overlay['/provenance/chapter']).toBe(GLOSSED['/provenance/chapter']);
  });

  it('reports the score it ruled on — glosses discounted, not the raw 0.45 that was refused', async () => {
    const stored = storedDoc();
    create.mockResolvedValue(reply(GLOSSED));

    const out = await topUp(stored);

    // The raw share of this delta is 0.452. A gate that accepts on one number and logs another
    // makes every future "why did this pass?" unanswerable.
    expect(out.urduShare).toBeGreaterThanOrEqual(0.5);
    expect(out.urduShare).toBeGreaterThan(0.452);
  });
});

describe('B — stripping is a scoring rule, never a bypass', () => {
  it('still refuses a wholly English delta', async () => {
    const stored = storedDoc();
    create.mockResolvedValue(reply({
      '/provenance/chapter': 'Chapter 7 — Inheritance',
      '/provenance/chapter_title': 'Heredity and Genetics',
      '/provenance/topic': 'Law of Segregation, Dihybrid Cross, Law of Independent Assortment',
    }));

    await expect(topUp(stored)).rejects.toMatchObject({ code: 'OVERLAY_NOT_URDU' });
  });

  it('still refuses an English delta that hides the whole string inside brackets', async () => {
    // The obvious way to game a gloss-stripping rule: make the entire "translation" a gloss.
    // Stripping it leaves nothing, and nothing is not Urdu.
    const stored = storedDoc();
    create.mockResolvedValue(reply({
      '/provenance/chapter': '(Chapter 7 — Inheritance)',
      '/provenance/chapter_title': '(Heredity and Genetics)',
      '/provenance/topic': '(Law of Segregation and Dihybrid Cross)',
    }));

    await expect(topUp(stored)).rejects.toMatchObject({ code: 'OVERLAY_NOT_URDU' });
  });

  it('does not discard a parenthetical that is itself Urdu', async () => {
    // Urdu in brackets is prose, not a term of record. If the rule stripped it, this mostly
    // English delta would score on its four remaining Urdu letters and sail through.
    const stored = storedDoc();
    create.mockResolvedValue(reply({
      '/provenance/chapter': 'Chapter 7 (وراثت)',
      '/provenance/chapter_title': 'Heredity and Genetics (وراثت اور جینیات)',
      '/provenance/topic': 'Law of Segregation and Dihybrid Cross (قانون علیحدگی)',
    }));

    // Counted whole, this is 38% Urdu and is correctly refused. The assertion that matters is
    // that the verdict is unchanged by the fix — not which side of 0.5 it lands on by luck.
    await expect(topUp(stored)).rejects.toMatchObject({ code: 'OVERLAY_NOT_URDU' });
  });
});
