/**
 * The scope classifier — the HONESTY layer for 6-12 lesson edits.
 *
 * The 12-cell spike (bd-6pxpk) established what this is and is not for. It is NOT a safety
 * control: the `lp_doc` schema already contains abuse. Told "write me an exam paper for this
 * whole chapter", the revision ladder could not produce an exam paper — there is nowhere in the
 * schema to put one — so it added a single MCQ to the existing exam bank and reworded the
 * summary. Two changed paths, every gate clean, no harm done.
 *
 * The harm was that she asked for an exam paper, got a lesson plan back with one more question
 * in it, and was told nothing. THAT is what this classifier exists to prevent: a silent
 * misunderstanding. It buys honesty, not safety, which is why a cheap model is enough and why
 * its failure mode must never be "guess and edit anyway".
 *
 * Four behaviours are load-bearing:
 *
 *   1. GRATITUDE IS FREE. "thanks" must not cost a model call. At $0.27 an edit attempt, a
 *      classifier that bills for "شکریہ" is a bug with an invoice.
 *   2. TONE/LANGUAGE REWRITES ARE OUT OF SCOPE IN v1. The spike's LANG cell touched 43 paths
 *      across every section of the document and produced the fleet's only render failure. It is
 *      not an edit; it is a re-authoring wearing an edit's clothes.
 *   3. FAILURE FALLS TOWARD THE ANSWER, NEVER THE EDIT. If the model is unreachable we return
 *      `question`, so she gets a grounded reply about her lesson. Falling toward `edit` would
 *      spend $0.27 and mutate a document on a guess.
 *   4. THE VERDICT IS CLOSED. Anything the model invents outside the four known kinds is
 *      coerced to `question` — an unknown label must never reach a switch that routes on it.
 */

const PATH = '../../bot/shared/services/lp612-edit-intent.service';

// The NETWORK boundary, and only it. The module under test is never mocked — a red test that
// stubs the thing it is testing proves nothing (root CLAUDE.md, TDD rule).
let mockCreate;
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }),
}));

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: () => {} }));

const reply = (label) => ({
  choices: [{ message: { content: JSON.stringify({ kind: label }) } }],
  usage: { prompt_tokens: 120, completion_tokens: 8 },
});

let svc;
beforeEach(() => {
  jest.resetModules();
  mockCreate = jest.fn().mockResolvedValue(reply('question'));
  svc = require(PATH);
});

describe('lp612 edit-intent classifier', () => {
  describe('the free path — no model call', () => {
    test.each([
      'thanks', 'Thanks!', 'thank you so much', 'ok', 'okay', 'got it', '👍',
      'شکریہ', 'بہت شکریہ', 'ٹھیک ہے',
    ])('%p is gratitude/ack and costs nothing', async (text) => {
      const out = await svc.classifyEditIntent({ text, language: 'ur' });
      expect(out.kind).toBe('gratitude');
      expect(mockCreate).not.toHaveBeenCalled();
    });

    test.each(['', '   ', null, undefined])('%p is not an edit and costs nothing', async (text) => {
      const out = await svc.classifyEditIntent({ text, language: 'en' });
      expect(out.kind).not.toBe('edit');
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('the classified path', () => {
    test('a structural change is an edit', async () => {
      mockCreate.mockResolvedValue(reply('edit'));
      const out = await svc.classifyEditIntent({ text: 'make the homework shorter', language: 'en' });
      expect(out.kind).toBe('edit');
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    test('a question about the lesson is a question, not an edit', async () => {
      mockCreate.mockResolvedValue(reply('question'));
      const out = await svc.classifyEditIntent({ text: 'what does the activity mean?', language: 'en' });
      expect(out.kind).toBe('question');
    });

    test('an out-of-scope ask is named as such — the spike\'s silent-misunderstanding case', async () => {
      mockCreate.mockResolvedValue(reply('out_of_scope'));
      const out = await svc.classifyEditIntent({
        text: 'write me an exam paper for this whole chapter', language: 'en',
      });
      expect(out.kind).toBe('out_of_scope');
    });

    test('the prompt tells the model that tone/language rewrites are out of scope in v1', async () => {
      await svc.classifyEditIntent({ text: 'اسے آسان زبان میں لکھیں', language: 'ur' });
      const sent = JSON.stringify(mockCreate.mock.calls[0][0]);
      expect(sent).toMatch(/out_of_scope/);
      // The v1 exclusion has to be IN the prompt, or the model will happily call it an edit.
      expect(sent.toLowerCase()).toMatch(/simpler language|rewrite|tone|reword/);
    });
  });

  describe('failure falls toward the answer, never the edit', () => {
    test('an LLM outage yields question — never edit', async () => {
      mockCreate.mockRejectedValue(new Error('502 upstream'));
      const out = await svc.classifyEditIntent({ text: 'make the homework shorter', language: 'en' });
      expect(out.kind).toBe('question');
      expect(out.degraded).toBe(true);
    });

    test('an unparseable reply yields question — never edit', async () => {
      mockCreate.mockResolvedValue({ choices: [{ message: { content: 'I think it is an edit!' } }] });
      const out = await svc.classifyEditIntent({ text: 'make it shorter', language: 'en' });
      expect(out.kind).toBe('question');
      expect(out.degraded).toBe(true);
    });

    test('an INVENTED label is coerced to question — the verdict set is closed', async () => {
      mockCreate.mockResolvedValue(reply('please_rewrite_everything'));
      const out = await svc.classifyEditIntent({ text: 'do the thing', language: 'en' });
      expect(out.kind).toBe('question');
    });

    test('an empty content body yields question, not a crash', async () => {
      mockCreate.mockResolvedValue({ choices: [{ message: { content: '' } }] });
      const out = await svc.classifyEditIntent({ text: 'make it shorter', language: 'en' });
      expect(out.kind).toBe('question');
      expect(out.degraded).toBe(true);
    });
  });

  test('every returned kind is one of the four known verdicts', async () => {
    for (const label of ['edit', 'question', 'out_of_scope', 'gratitude', 'nonsense', '']) {
      mockCreate.mockResolvedValue(reply(label));
      const out = await svc.classifyEditIntent({ text: 'something', language: 'en' });
      expect(svc.EDIT_INTENT_KINDS).toContain(out.kind);
    }
  });
});
