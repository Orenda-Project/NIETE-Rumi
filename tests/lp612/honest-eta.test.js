/**
 * bd-2ym0h — the wait we promise has to be the wait she gets.
 *
 * The operator, after watching the lane on staging: "The loading interstitials
 * say 2 minutes, but it takes 4-6 minutes yes? Can we tell the teachers this?"
 *
 * He is right. Measured on the post-optimisation lane, a lesson nobody has asked
 * for before takes a median of 313 seconds — a bit over five minutes — with a
 * spread of roughly four to eleven. The copy said two. A teacher who is told two
 * minutes and waits five has been given a reason to think it broke, and the
 * cheapest way to make a working feature look broken is to under-promise the
 * clock.
 *
 * The second-hit case needs no hedging in the copy. `requestLesson` answers a
 * cache hit by delivering the PDF straight from R2 and sending NO interstitial
 * at all (lp612-serving.service.js, the `cache_hit` branch). So every string
 * tested here is only ever read by a teacher who is genuinely waiting on a fresh
 * authoring run, and can quote the fresh-run number without qualification.
 *
 * Urdu stays gender-agnostic in the second person — passive and impersonal
 * throughout, never `رہی ہوں گی` / `رہے ہوں گے` — because the cohort is mixed
 * and the bot cannot know which it is addressing.
 */

const { UX_STRINGS, resolveUx } = require('../../bot/shared/config/ux-strings');

const cps = (s) => [...String(s == null ? '' : s)].length;

/** Every string a teacher can read while a 6-12 lesson is being written. */
const WAIT_KEYS = ['lp612Preparing', 'lp612Restarted', 'lp612StillWorking', 'lp612AlreadyPreparing'];

describe('no interstitial promises two minutes any more', () => {
  test.each(WAIT_KEYS)('%s does not claim a two-minute wait', (key) => {
    const en = UX_STRINGS[key].en;
    const ur = UX_STRINGS[key].ur;
    expect(en).not.toMatch(/\b2 minutes?\b/i);
    expect(en).not.toMatch(/\btwo minutes?\b/i);
    expect(ur).not.toContain('دو منٹ');
  });
});

describe('the strings that DO quote a duration quote the measured one', () => {
  // The ack for a fresh run, and the ack for a run that died and was restarted.
  // Both are the teacher's first and only estimate, so both carry the number.
  test.each(['lp612Preparing', 'lp612Restarted'])('%s tells her 5-6 minutes in English', (key) => {
    expect(UX_STRINGS[key].en).toMatch(/5\s*[–-]\s*6 minutes/);
  });

  test.each(['lp612Preparing', 'lp612Restarted'])('%s tells her the same number in Urdu', (key) => {
    expect(UX_STRINGS[key].ur).toContain('پانچ سے چھ منٹ');
  });

  test('the fresh ack says the estimate is for a lesson written from scratch', () => {
    // Second and later requests for the same lesson are served from R2 in about
    // a second. Saying so is what stops "5-6 minutes" reading as the new normal.
    expect(UX_STRINGS.lp612Preparing.en).toMatch(/brand-new|new lesson|first time/i);
    expect(UX_STRINGS.lp612Preparing.ur).toContain('نئے سبق');
  });
});

describe('the Flow closing screen no longer says "in a moment"', () => {
  test('there is a catalog string for it, in both languages', () => {
    expect(UX_STRINGS.lp612FlowAck).toBeDefined();
    expect(UX_STRINGS.lp612FlowAck.en).toBeTruthy();
    expect(UX_STRINGS.lp612FlowAck.ur).toBeTruthy();
  });

  test('it promises the chat, not a moment', () => {
    expect(UX_STRINGS.lp612FlowAck.en).not.toMatch(/in a moment/i);
    expect(UX_STRINGS.lp612FlowAck.en).toMatch(/chat/i);
  });

  test('an Urdu teacher gets Urdu', () => {
    expect(resolveUx('lp612FlowAck', { language: 'ur' }))
      .toBe(UX_STRINGS.lp612FlowAck.ur);
    expect(resolveUx('lp612FlowAck', { language: 'ur' }))
      .not.toBe(UX_STRINGS.lp612FlowAck.en);
  });
});

describe('Urdu stays gender-agnostic in the second person', () => {
  const GENDERED = ['رہی ہوں گی', 'رہے ہوں گے', 'کر رہی ہیں', 'کر رہے ہیں'];
  test.each([...WAIT_KEYS, 'lp612FlowAck', 'lp612Failed'])('%s addresses her without a gendered verb stem', (key) => {
    const ur = UX_STRINGS[key].ur;
    for (const stem of GENDERED) expect(ur).not.toContain(stem);
  });
});

describe('every one of these fits the WhatsApp body, measured in code points', () => {
  test.each([...WAIT_KEYS, 'lp612FlowAck', 'lp612Failed', 'lp612Held', 'lp612NotFound'])(
    '%s is inside the 1024-code-point body cap in both languages',
    (key) => {
      for (const lang of ['en', 'ur']) expect(cps(UX_STRINGS[key][lang])).toBeLessThanOrEqual(1024);
    },
  );
});

/**
 * bd-86ivw — the post-delivery feedback prompt's own copy.
 *
 * A BUTTON is capped at 20 code points and an emoji costs one code point but two columns of the
 * teacher's screen; the /language outage that made this file's sibling suite necessary was an
 * 87-code-point footer against a 60 cap, and Meta rejected the ENTIRE message with
 * `(#131009) Parameter value is not valid` — the survey would simply never appear, with nothing
 * logged and nothing to notice. Measured in CODE POINTS ([...s].length), never `.length`.
 */
describe('the feedback prompt fits its WhatsApp fields', () => {
  const BUTTON_KEYS = ['lp612FeedbackYes', 'lp612FeedbackNo'];
  const BODY_KEYS = [
    'lp612FeedbackAsk', 'lp612FeedbackThanks', 'lp612FeedbackAskReason', 'lp612FeedbackReasonThanks',
  ];

  test.each(BUTTON_KEYS)('%s is inside the 20-code-point button cap in both languages', (key) => {
    for (const lang of ['en', 'ur']) expect(cps(UX_STRINGS[key][lang])).toBeLessThanOrEqual(20);
  });

  test.each(BODY_KEYS)('%s is inside the 1024-code-point body cap in both languages', (key) => {
    for (const lang of ['en', 'ur']) expect(cps(UX_STRINGS[key][lang])).toBeLessThanOrEqual(1024);
  });

  test.each([...BUTTON_KEYS, ...BODY_KEYS])('%s is a complete map — no language falls back', (key) => {
    expect(UX_STRINGS[key].en).toBeTruthy();
    expect(UX_STRINGS[key].ur).toBeTruthy();
    expect(UX_STRINGS[key].ur).not.toBe(UX_STRINGS[key].en);
  });

  // The SAME four stems the suite above bans, and for the same reason: these conjugate the
  // ADDRESSEE, and the cohort is mixed. A verb agreeing with a NOUN («منصوبہ … رہا», «چیز … آئی»)
  // is correct Urdu and is deliberately not on this list — banning those would force stilted copy
  // to fix a problem that does not exist.
  test.each([...BUTTON_KEYS, ...BODY_KEYS])(
    '%s addresses her without a gendered second-person verb stem',
    (key) => {
      const GENDERED = ['رہی ہوں گی', 'رہے ہوں گے', 'کر رہی ہیں', 'کر رہے ہیں'];
      for (const stem of GENDERED) expect(UX_STRINGS[key].ur).not.toContain(stem);
    },
  );
});
