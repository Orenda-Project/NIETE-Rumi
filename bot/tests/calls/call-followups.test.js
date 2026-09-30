/**
 * Three defects from the FIRST REAL CALL on staging (+92 322 2482222,
 * 2026-08-24). Unit tests were green while all three were broken — each only
 * showed up in a live conversation.
 */

const { unsupportedTypeReply } = require('../../shared/utils/unsupported-message');
const { buildCallContext } = require('../../shared/calls/call-context.service');
const { buildCallPrompt } = require('../../shared/calls/call-prompt.service');

/**
 * DEFECT 1 — after the call, the teacher got:
 *   "میں صرف متن اور آواز کے پیغامات کا جواب دے سکتی ہوں"
 * WhatsApp posts an interactive message of type `call_permission_reply` around a
 * call. It is not a request, it has no handler, so it fell through to the
 * generic fallback — the same bd-fbih0 failure as reacting 👍, in call clothing.
 */
describe('call-related interactive replies are silent (bd-fbih0 class)', () => {
  test('call_permission_reply gets NO reply', () => {
    expect(unsupportedTypeReply('interactive', 'call_permission_reply')).toBeNull();
  });

  test('other call-lifecycle interactive types are silent too', () => {
    expect(unsupportedTypeReply('interactive', 'call_permission_request')).toBeNull();
  });

  test('an unhandled NON-call interactive still gets the generic fallback', () => {
    const reply = unsupportedTypeReply('interactive', 'something_new');
    expect(reply).toContain('I can only reply');
  });

  test('the existing single-argument contract is unchanged', () => {
    expect(unsupportedTypeReply('reaction')).toBeNull();
    expect(unsupportedTypeReply('video')).toContain("can't take videos");
    expect(unsupportedTypeReply('interactive')).toContain('I can only reply');
  });
});

/**
 * DEFECT 2 — she said "میرے پاس رپورٹ کے اندرونی details نہیں ہوتے" / "I can't
 * see your report or system access". The caller HAD a finished coaching session;
 * the repo filtered `status='completed'` only, and his was
 * `observer_review_complete` — 38 fully-analysed sessions on staging were
 * invisible. (Covered at the repo level; the query shape is asserted there.)
 *
 * DEFECT 3 — even when data is genuinely absent, silence reads as incapacity.
 * Absent blocks were simply omitted, so the model had no way to tell "nothing
 * recorded" from "I am not allowed to look" — and it invented the latter, which
 * is false and makes the product look broken.
 */
const USER = { id: 'u-1', first_name: 'Haroon', preferred_language: 'ur' };
const baseDeps = (over = {}) => ({
  fetchUser: async () => USER,
  fetchLatestCoaching: async () => null,
  fetchLpContext: async () => 'Recently delivered: Grade 4 Maths — Ch 3 "Fractions".',
  fetchUpcomingVisit: async () => null,
  fetchTraining: async () => null,
  fetchMemory: async () => null,
  now: () => new Date('2026-08-24T12:00:00Z'),
  ...over,
});

describe('absence is stated, never left silent', () => {
  test('a caller with no coaching gets an explicit "none recorded" line', async () => {
    const { block } = await buildCallContext({ from: '923365709413', deps: baseDeps() });
    expect(block).toMatch(/ON RECORD|nothing recorded|no coaching/i);
    expect(block).toMatch(/coaching/i);
  });

  test('the record summary distinguishes ABSENT from FAILED-to-load', async () => {
    const { block } = await buildCallContext({
      from: '92300',
      deps: baseDeps({ fetchLatestCoaching: async () => { throw new Error('db down'); } }),
    });
    expect(block).toMatch(/could not be loaded|not available right now|temporarily/i);
  });

  test('what she DOES have is still listed as present', async () => {
    const { block } = await buildCallContext({ from: '92300', deps: baseDeps() });
    expect(block).toContain('Fractions');
  });

  test('the prompt forbids claiming lack of access or permission', () => {
    const p = buildCallPrompt({ language: 'ur' });
    expect(p).toMatch(/never say .{0,60}(access|permission)/i);
  });

  test('the prompt tells her how to describe missing data instead', () => {
    const p = buildCallPrompt({ language: 'ur' });
    expect(p).toMatch(/nothing recorded|no .{0,20}recorded/i);
  });

  test('the prompt still forbids inventing data she does not have', () => {
    const p = buildCallPrompt({ language: 'ur' });
    expect(p).toMatch(/never (invent|make up|guess)/i);
  });
});
