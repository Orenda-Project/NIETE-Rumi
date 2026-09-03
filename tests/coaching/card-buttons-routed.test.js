/**
 * The commitment-card buttons ("Will you commit to trying this in your next
 * class?" → Yes / Maybe later / Not for me) must DO something.
 *
 * RED FIRST. The buttons were sent after every self-serve report with ids
 * `card_yes_<uuid>` / `card_later_<uuid>` / `card_no_<uuid>` and registered
 * nowhere in the router: every tap fell through to generic text handling and
 * was lost — 0 responses on 3,761 prod sessions, and the "Building on your
 * last commitment" prefix that reads teacher_response was unreachable.
 */
const mockSupabase = { from: jest.fn() };
const mockWhatsApp = { sendMessage: jest.fn(async () => true), sendInteractiveButtons: jest.fn(async () => true) };
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/services/whatsapp.service', () => mockWhatsApp);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const svc = require('../../bot/shared/services/coaching/coaching-card/card-response.service');

const SESSION = '11111111-2222-3333-4444-555555555555';
const PHONE = '923000000000';

let updates;
function stubSessions(existing) {
  updates = [];
  mockSupabase.from.mockImplementation(() => {
    const chain = {
      select: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      single: jest.fn(async () => ({ data: { prioritized_action: existing }, error: null })),
      update: jest.fn((payload) => { updates.push(payload); return chain; }),
      then: undefined,
    };
    return chain;
  });
}

beforeEach(() => { jest.clearAllMocks(); stubSessions({ commitment: 'c', action: 'a', _source: 'llm' }); });

describe('handleCardButton — the router entry', () => {
  test('a yes tap records teacher_response=yes on the existing record and acks in the teacher\'s language', async () => {
    const handled = await svc.handleCardButton(`card_yes_${SESSION}`, PHONE, 'ur');
    expect(handled).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0].prioritized_action).toMatchObject({ commitment: 'c', action: 'a', teacher_response: 'yes' });
    expect(typeof updates[0].prioritized_action.responded_at).toBe('string');
    expect(mockWhatsApp.sendMessage).toHaveBeenCalledTimes(1);
    const [to, text] = mockWhatsApp.sendMessage.mock.calls[0];
    expect(to).toBe(PHONE);
    expect(/[؀-ۿ]/.test(text)).toBe(true);
  });

  test('later and no are recorded as themselves; the English ack is English', async () => {
    await svc.handleCardButton(`card_later_${SESSION}`, PHONE, 'en');
    expect(updates[0].prioritized_action.teacher_response).toBe('later');
    expect(/[؀-ۿ]/.test(mockWhatsApp.sendMessage.mock.calls[0][1])).toBe(false);
    await svc.handleCardButton(`card_no_${SESSION}`, PHONE, 'en');
    expect(updates[1].prioritized_action.teacher_response).toBe('no');
  });

  test('an unknown prefix or a malformed id is not ours: returns false, sends nothing, writes nothing', async () => {
    expect(await svc.handleCardButton('coaching_fb_yes_' + SESSION, PHONE, 'en')).toBe(false);
    expect(await svc.handleCardButton('card_yes_not-a-uuid', PHONE, 'en')).toBe(false);
    expect(await svc.handleCardButton(null, PHONE, 'en')).toBe(false);
    expect(updates).toHaveLength(0);
    expect(mockWhatsApp.sendMessage).not.toHaveBeenCalled();
  });

  test('an unset language falls to the catalog floor, never throws', async () => {
    expect(await svc.handleCardButton(`card_yes_${SESSION}`, PHONE, undefined)).toBe(true);
    expect(mockWhatsApp.sendMessage).toHaveBeenCalledTimes(1);
  });
});

describe('the router delegates card_ taps beside the survey buttons', () => {
  const SRC = require('fs').readFileSync(require.resolve('../../bot/whatsapp-bot.js'), 'utf8');
  test('whatsapp-bot.js hands card_ ids to handleCardButton before generic text handling', () => {
    const i = SRC.indexOf("buttonId.startsWith('card_')");
    expect(i).toBeGreaterThan(0);
    expect(SRC.slice(i, i + 600)).toContain('handleCardButton');
    // beside the coaching survey buttons, which live in the same dispatch block
    expect(Math.abs(i - SRC.indexOf("coaching_fb_yes_"))).toBeLessThan(2500);
  });
});

describe('language protocol — the acks live in the one catalog', () => {
  const { resolveUx } = jest.requireActual('../../bot/shared/config/ux-strings');
  const KEYS = ['coachingCardAckYes', 'coachingCardAckLater', 'coachingCardAckNo'];
  test('every ack resolves in both languages and the Urdu is Urdu', () => {
    for (const k of KEYS) {
      for (const lang of ['en', 'ur']) expect(resolveUx(k, { language: lang }).trim().length).toBeGreaterThan(0);
      expect(/[؀-ۿ]/.test(resolveUx(k, { language: 'ur' }))).toBe(true);
    }
  });
  test('the service holds no inline per-language ternary of its own', () => {
    const src = require('fs').readFileSync(require.resolve('../../bot/shared/services/coaching/coaching-card/card-response.service'), 'utf8');
    expect(src).not.toMatch(/=== 'ur'\s*\?/);
    expect(src).toContain('resolveUx');
  });
});
