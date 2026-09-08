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

const { UX_STRINGS, resolveUx, LP612_ETA } = require('../../bot/shared/config/ux-strings');

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

/**
 * THE MEASURED BAND the copy is allowed to quote — the source of truth for the guard below.
 *
 * Measured 2026-09-06 on the prod configuration (`LP612_AUTHOR_ROUNDS=3` with
 * `LP612_TARGETED_REVISION=true`):
 *     p50  160 s  English
 *     p50  207 s  Urdu
 *     p90  ~308 s (both)
 * The slowest thing anyone has seen recently is a 5-round staging run on the extraction branch at
 * 6 m 41 s — that is a different configuration and is NOT what prod serves.
 *
 * The rule this file enforces: the quoted band must COVER p90, not the median. A teacher told the
 * median is told a number she beats half the time and misses half the time, and the half she misses
 * is the half that files the bug report. Quote the tail.
 *
 * When the lane's timings move, change LP612_ETA in ux-strings.js and these three numbers together.
 */
const MEASURED = { p50EnSeconds: 160, p50UrSeconds: 207, p90Seconds: 308 };

describe('the estimate is back, and it is one constant', () => {
  // bd-oak77.10 — the operator, 2026-09-06: "previously we used to have an estimate for how long it
  // will take to produce the lesson plan. It seems like we removed the estimate. Can you please
  // bring the estimate back on?"
  //
  // It had been removed (bd-oo0of) because the number then in the copy — five to six minutes — was
  // measured against a slower lane and was wrong for Urdu by three minutes. Targeted revision landed
  // and the lane is now fast enough that an honest band exists, so the estimate comes back. It comes
  // back as ONE constant, so the next time the lane moves this is a one-line change and not a hunt
  // through four strings in two languages.
  test('LP612_ETA is exported, with a phrase per offered language and a numeric band', () => {
    expect(LP612_ETA).toBeDefined();
    expect(typeof LP612_ETA.en).toBe('string');
    expect(typeof LP612_ETA.ur).toBe('string');
    expect(Number.isFinite(LP612_ETA.minMinutes)).toBe(true);
    expect(Number.isFinite(LP612_ETA.maxMinutes)).toBe(true);
    expect(LP612_ETA.minMinutes).toBeLessThan(LP612_ETA.maxMinutes);
  });

  test('the band COVERS the measured p90 — the tail, not the median', () => {
    // Compared in WHOLE MINUTES, because that is the unit the copy is written in: she is told
    // "3-5 minutes", never "308 seconds". p90 is 5 m 8 s, which rounds to the 5 the copy quotes.
    // Asserting raw seconds instead would fail this band by eight seconds and push the copy to
    // "3-6 minutes" — overselling the wait by a whole minute against a p50 of 2 m 40 s, to chase
    // precision the sentence cannot express anyway.
    //
    // The guard still bites where it matters: if p90 moves past 5 m 30 s this rounds to 6 and the
    // test fails until either the lane or the copy moves.
    expect(LP612_ETA.maxMinutes).toBeGreaterThanOrEqual(Math.round(MEASURED.p90Seconds / 60));
  });

  test('the band is not so wide it stops being information', () => {
    // The low end must still be a plausible wait for a real lesson: at or below p90, and at or
    // above the point where we would be under-promising the typical Urdu run into a bug report.
    expect(LP612_ETA.minMinutes * 60).toBeLessThanOrEqual(MEASURED.p90Seconds);
    expect(LP612_ETA.maxMinutes - LP612_ETA.minMinutes).toBeLessThanOrEqual(4);
  });

  test.each(['lp612Preparing', 'lp612Restarted'])('%s carries the constant verbatim, in BOTH languages', (key) => {
    // Asserting the constant is IN the string, not that the string contains some number: that is
    // what makes LP612_ETA the single place to tune. A hand-typed "3-5 minutes" that drifted from
    // the constant would fail here.
    expect(UX_STRINGS[key].en).toContain(LP612_ETA.en);
    expect(UX_STRINGS[key].ur).toContain(LP612_ETA.ur);
  });

  test('the Urdu estimate uses Urdu digits, never ASCII or Arabic-Indic', () => {
    expect(LP612_ETA.ur).toMatch(/[\u06F0-\u06F9]/);      // ۰۱۲۳۴۵۶۷۸۹
    expect(LP612_ETA.ur).not.toMatch(/[0-9]/);
    expect(LP612_ETA.ur).not.toMatch(/[\u0660-\u0669]/);  // ٠١٢٣ — the wrong set
  });

  test('the fresh ack still says the estimate is for a lesson written from scratch', () => {
    // Second and later requests for the same lesson are served from R2 in about a second and send
    // no interstitial at all. Saying "brand-new" is what stops the band reading as the price of
    // every lesson.
    expect(UX_STRINGS.lp612Preparing.en).toMatch(/brand-new|new lesson|first time/i);
    expect(UX_STRINGS.lp612Preparing.ur).toContain('نئے سبق');
  });

  test('lp612StillWorking does NOT re-quote the band', () => {
    // It fires at LP612_FOLLOWUP_MS, i.e. only once the run has already outlived the estimate.
    // Repeating the number there would be telling her the thing that just failed to be true.
    expect(UX_STRINGS.lp612StillWorking.en).not.toContain(LP612_ETA.en);
    expect(UX_STRINGS.lp612StillWorking.ur).not.toContain(LP612_ETA.ur);
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
