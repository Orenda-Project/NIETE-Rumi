/**
 * THE TEACHER'S SIDE OF THE TOP-UP — bd-idneu, e2e half.
 *
 * The unit suite proves the delta. This one drives the whole pass on a real document with a real
 * linter and a real renderer-applicability check, and asserts the four things the decision to
 * take this option instead of re-authoring 302 lessons actually rested on:
 *
 *   1. THE MODEL IS ASKED FOR THE DELTA AND NOTHING ELSE. That is the entire cost argument. A
 *      pass that re-sends all 92 strings is a re-authoring of the overlay at overlay prices, and
 *      the three options on bd-yhd16 differ by ~150x on exactly this line.
 *   2. THE LESSON BODY IS NEVER TOUCHED. These documents are lint-clean, rendered, and already in
 *      front of teachers. The reason this option is safe at all is that it cannot regress prose
 *      that has passed every gate — so the suite asserts the document is byte-identical outside
 *      `ur_overlay`, not merely "looks similar".
 *   3. AN EXISTING TRANSLATION IS NEVER OVERWRITTEN. 89 strings a teacher has already read stay
 *      exactly as they are, even if the model volunteers a replacement.
 *   4. THE GATES STILL BITE ON THE DELTA. An English "translation" of three strings is the same
 *      defect as an English translation of ninety-two, and it must fail the same way: loudly,
 *      with the stored document left alone.
 *
 * `lp612-overlay-topup.service` and `lp612-author.service` are the genuine modules here (root
 * CLAUDE.md rule 6); only `llm-client` and the loggers are doubled.
 */

const fs = require('fs');
const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { overlayDefects } = require(path.join(V, 'lint_lp.js'));
const { applyOverlay } = require(path.join(V, 'lib', 'overlay.js'));
const { buildHtml } = require(path.join(V, 'lib', 'template.js'));

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
const {
  topUpOverlay,
  missingOverlayPointers,
} = require('../../bot/shared/services/lp612-overlay-topup.service');

const SEGMENT = { segment_id: 'grade_9_maths.c01.p024-025', subject: 'Mathematics', grade: 9 };

const EXISTING_UR = 'یہ اردو ہدایت ہے جو اس سبق کے لیے پہلے ہی لکھی جا چکی ہے۔';

/** A document as it sits in R2 today: authored before bd-x3dn6, so every pointer BUT provenance. */
const storedDoc = () => {
  const d = doc();
  d.ur_overlay = {};
  for (const ptr of overlayDefects.targets(d)) {
    if (ptr.startsWith('/provenance/')) continue;
    d.ur_overlay[ptr] = EXISTING_UR;
  }
  return d;
};

const reply = (obj, usage = { prompt_tokens: 320, completion_tokens: 90, total_tokens: 410 }) => ({
  choices: [{ message: { content: typeof obj === 'string' ? obj : JSON.stringify(obj) } }],
  usage,
});

/** Answer whatever was asked for, in Urdu. */
const urduFor = (pointers) => Object.fromEntries(
  pointers.map((p, i) => [p, `اردو عنوان نمبر ${i + 1}`]),
);

beforeEach(() => jest.clearAllMocks());

describe('the delta, and only the delta, is sent to the model', () => {
  test('THE RED TEST — exactly one call, carrying the missing pointers and none of the covered ones', async () => {
    const stored = storedDoc();
    const missing = missingOverlayPointers(stored);
    create.mockResolvedValue(reply(urduFor(missing)));

    const out = await topUpOverlay({ lpDoc: stored, segment: SEGMENT });

    expect(out.toppedUp).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);

    const user = create.mock.calls[0][0].messages[1].content;
    for (const ptr of missing) expect(user).toContain(ptr);

    // The cost claim, stated as an assertion: the 89 strings already translated are not re-sent.
    const covered = Object.keys(stored.ur_overlay);
    expect(covered.length).toBeGreaterThan(50);
    for (const ptr of covered) expect(user).not.toContain(`"${ptr}"`);
  });

  test('the prompt carries the ENGLISH string at each missing pointer, so the model has something to translate', async () => {
    const stored = storedDoc();
    const missing = missingOverlayPointers(stored);
    create.mockResolvedValue(reply(urduFor(missing)));

    await topUpOverlay({ lpDoc: stored, segment: SEGMENT });

    const user = create.mock.calls[0][0].messages[1].content;
    expect(user).toContain(doc().provenance.topic);
  });
});

describe('the stored document survives the pass unchanged apart from its overlay', () => {
  test('the lesson body is byte-identical — this is why the option is safe', async () => {
    const stored = storedDoc();
    const before = JSON.parse(JSON.stringify(stored));
    create.mockResolvedValue(reply(urduFor(missingOverlayPointers(stored))));

    const out = await topUpOverlay({ lpDoc: stored, segment: SEGMENT });

    const strip = (d) => { const c = JSON.parse(JSON.stringify(d)); delete c.ur_overlay; return c; };
    expect(JSON.stringify(strip(out.doc))).toBe(JSON.stringify(strip(before)));
  });

  test('every existing translation is preserved exactly', async () => {
    const stored = storedDoc();
    const before = { ...stored.ur_overlay };
    create.mockResolvedValue(reply(urduFor(missingOverlayPointers(stored))));

    const out = await topUpOverlay({ lpDoc: stored, segment: SEGMENT });

    for (const [ptr, ur] of Object.entries(before)) expect(out.doc.ur_overlay[ptr]).toBe(ur);
  });

  test('a model that volunteers a replacement for a COVERED pointer does not get it applied', async () => {
    const stored = storedDoc();
    const missing = missingOverlayPointers(stored);
    const covered = Object.keys(stored.ur_overlay)[0];
    create.mockResolvedValue(reply({ ...urduFor(missing), [covered]: 'ایک اور ترجمہ' }));

    const out = await topUpOverlay({ lpDoc: stored, segment: SEGMENT });

    expect(out.doc.ur_overlay[covered]).toBe(EXISTING_UR);
    expect(out.added).not.toContain(covered);
  });
});

describe('the topped-up document is one the renderer will accept', () => {
  test('it applies with no overlay errors and paints the Urdu title where the template draws it', async () => {
    const stored = storedDoc();
    const missing = missingOverlayPointers(stored);
    const UR_TOPIC = 'دو ۲×۲ میٹرکسوں کا ضرب';
    create.mockResolvedValue(reply({ ...urduFor(missing), '/provenance/topic': UR_TOPIC }));

    const out = await topUpOverlay({ lpDoc: stored, segment: SEGMENT });

    const { doc: applied, errors } = applyOverlay(out.doc, 'ur');
    expect(errors).toEqual([]);

    const { html } = buildHtml(applied, { docDir: path.dirname(BASE), lang: 'ur' });
    expect(html).toContain(UR_TOPIC);
    expect(html).not.toContain(doc().provenance.topic);
  });

  test('a SCIENCE delta that glosses its terms in Latin brackets reaches the teacher — bd-y478d', async () => {
    // The canary's real refusal. Every Latin run here is a gloss of the Urdu term beside it, which
    // is how a Pakistani science textbook writes an examinable term — and what §7b asks for. Scored
    // whole, three such strings are 45.2% Urdu letters and gate 1 called them an English page.
    const stored = storedDoc();
    const missing = missingOverlayPointers(stored);
    const UR_TOPIC = 'قانون علیحدگی (Law of Segregation) اور دو ہائبرڈ تراکیب (Dihybrid Cross)';
    create.mockResolvedValue(reply({
      ...Object.fromEntries(missing.map((p) => [p, 'باب ۷ — وراثت (Inheritance)'])),
      '/provenance/topic': UR_TOPIC,
    }));

    const out = await topUpOverlay({ lpDoc: stored, segment: SEGMENT });

    expect(out.toppedUp).toBe(true);
    expect(out.added.sort()).toEqual([...missing].sort());

    // The teacher's side: the Urdu term AND its English gloss both survive to the page. Stripping
    // is a scoring rule — it must never reach the text the renderer draws.
    const { doc: applied, errors } = applyOverlay(out.doc, 'ur');
    expect(errors).toEqual([]);
    const { html } = buildHtml(applied, { docDir: path.dirname(BASE), lang: 'ur' });
    expect(html).toContain(UR_TOPIC);
    expect(html).toContain('Law of Segregation');
  });
});

describe('the pass refuses the cases where topping up is the wrong operation', () => {
  test('a document with NO overlay is refused by name, and costs no model call', async () => {
    const d = doc();
    delete d.ur_overlay;

    const out = await topUpOverlay({ lpDoc: d, segment: SEGMENT });

    // Three Urdu strings over English prose is a worse page than the bug, and it would report
    // success. That document needs a re-author, which is a different and much more expensive
    // decision than this pass is allowed to make.
    expect(out.toppedUp).toBe(false);
    expect(out.reason).toBe('not_overlaid');
    expect(create).not.toHaveBeenCalled();
  });

  test('a document that needs nothing costs no model call — 302 documents, most of them free', async () => {
    const d = doc();
    d.ur_overlay = Object.fromEntries(overlayDefects.targets(d).map((p) => [p, 'اردو']));

    const out = await topUpOverlay({ lpDoc: d, segment: SEGMENT });

    expect(out.toppedUp).toBe(false);
    expect(out.reason).toBe('already_complete');
    expect(create).not.toHaveBeenCalled();
  });

  test('an ENGLISH "translation" of the delta is rejected, and the stored doc is left alone', async () => {
    const stored = storedDoc();
    const before = JSON.stringify(stored);
    create.mockResolvedValue(reply(
      Object.fromEntries(missingOverlayPointers(stored).map((p) => [p, 'Multiplying two matrices'])),
    ));

    await expect(topUpOverlay({ lpDoc: stored, segment: SEGMENT })).rejects.toThrow(/urdu/i);
    expect(JSON.stringify(stored)).toBe(before);
  });

  test('a model failure throws rather than returning a half-translated document', async () => {
    const stored = storedDoc();
    create.mockRejectedValue(new Error('upstream 503'));

    await expect(topUpOverlay({ lpDoc: stored, segment: SEGMENT })).rejects.toThrow();
  });
});
