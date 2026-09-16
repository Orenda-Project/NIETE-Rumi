/**
 * bd-60106 — a teacher's reflective answer is recorded no matter how long she
 * took to write it.
 *
 * WHAT BROKE. `text-message.handler` held a legacy "stuck coaching session"
 * gate: if the session row had not been touched for more than an hour, the
 * teacher's message was NOT treated as her answer. It was discarded, and she
 * got "⚠️ I noticed your previous coaching session didn't complete properly …
 * Reply with 1 or 2" instead.
 *
 * That gate measured the WRONG THING. A BEFORE-UPDATE trigger on
 * coaching_sessions bumps `updated_at` on every write, and the last write
 * before her answer is the one that ASKED her the question. So
 * `hoursSinceUpdate > 1` did not mean "this session is broken" — it meant
 * "this teacher thought about her lesson for more than an hour", which is the
 * behaviour the debrief is asking for.
 *
 * And the gate was a dead end in three separate ways:
 *   1. it wrote no state, so `updated_at` never moved and the NEXT message hit
 *      the very same branch — forever;
 *   2. the "1 or 2" it offers is read by a handler further down the file that
 *      is gated on a Redis key (`expecting:recovery`) this branch never sets;
 *   3. that handler sits AFTER this branch's `return`, so it is unreachable
 *      while the session is `conducting_conversation` — the exact and only
 *      state in which this prompt is ever shown.
 *
 * FOUND LIVE (prod, 2026-09-14) — one teacher's debrief, timestamps from her
 * session row and message log:
 *   04:32:34  Q1 asked (asked_at)
 *   06:06:00  "Mein un ko drill krva dn gi"   ← her real answer, 94 min later
 *   06:06:21  "1"        ← tapped the option she was told to reply with
 *   06:06:45  "1"
 *   06:07:14  "1"
 *   06:08:57  "2"
 * Every one of those got the same message back. `questions_answered` stayed 0,
 * the session auto-completed at 16:48, and her report was generated with zero
 * reflections. 507 answers from 343 distinct teachers were swallowed this way
 * between 2026-08-01 and 2026-09-16.
 *
 * The voice handler never had this gate and was always correct: a voice note
 * answered three days late is recorded. Text and voice now agree.
 *
 * NOTE ON TEST SHAPE. Same constraint as bd-2508
 * (tests/handlers/coaching-slash-exit.test.js): text-message.handler requires
 * ~40 services at module load and cannot be booted here. So the ROUTING
 * DECISION is lifted into a pure planner and tested behaviourally, and the
 * handler is pinned with source contracts.
 */
const fs = require('fs');
const path = require('path');

const {
  planReflectiveTextRouting,
  ACTIONS,
} = require('../../bot/shared/services/coaching/reflective-answer-routing');

const openDebrief = (extra = {}) => ({ id: 'sess-1', status: 'conducting_conversation', ...extra });

describe('bd-60106 — planReflectiveTextRouting records a late answer', () => {
  it('routes free text to the coach as her answer', () => {
    expect(planReflectiveTextRouting(openDebrief(), 'Mein un ko drill krva dn gi').action)
      .toBe(ACTIONS.RECORD_ANSWER);
  });

  it('is CLOCK-FREE — elapsed time cannot change the routing', () => {
    // The regression was a time-based branch. The planner takes no clock at
    // all, so there is nowhere for one to come back. Arity is the contract:
    // (session, message) and nothing else.
    expect(planReflectiveTextRouting.length).toBe(2);
  });

  it('records the answer that used to be swallowed (the 94-minute one)', () => {
    // The live case: updated_at is the moment the question was asked, 94
    // minutes before she replied. Under the old gate this returned a dead-end
    // prompt; it must now be her answer.
    const askedAt = new Date('2026-09-14T04:32:34.859Z').toISOString();
    const session = openDebrief({ updated_at: askedAt });
    expect(planReflectiveTextRouting(session, 'Mein un ko drill krva dn gi').action)
      .toBe(ACTIONS.RECORD_ANSWER);
  });

  it('records an answer that is days late rather than dropping it', () => {
    const session = openDebrief({ updated_at: new Date('2026-09-10T04:00:00Z').toISOString() });
    expect(planReflectiveTextRouting(session, 'Bachay concept grab kr rhy hn').action)
      .toBe(ACTIONS.RECORD_ANSWER);
  });

  it('a bare "1" is her answer, not a menu choice — nothing else claims it', () => {
    // She only ever typed "1" because the dead-end prompt told her to. With the
    // prompt gone there is no option list in play, so "1" is just text. It must
    // reach the coach rather than vanish.
    for (const digit of ['1', '2', '3']) {
      expect(planReflectiveTextRouting(openDebrief(), digit).action).toBe(ACTIONS.RECORD_ANSWER);
    }
  });

  it('a slash command still ENDS the session and falls through (bd-2508 preserved)', () => {
    for (const cmd of ['/menu', '/training', '/status']) {
      const plan = planReflectiveTextRouting(openDebrief(), cmd);
      expect(plan.action).toBe(ACTIONS.END_SESSION_AND_FALL_THROUGH);
    }
  });

  it('does not claim the message when there is no open debrief', () => {
    expect(planReflectiveTextRouting(null, 'hello').action).toBe(ACTIONS.NOT_REFLECTIVE);
    for (const status of ['completed', 'analyzing', 'awaiting_lesson_plan', 'abandoned']) {
      expect(planReflectiveTextRouting(openDebrief({ status }), 'hello').action)
        .toBe(ACTIONS.NOT_REFLECTIVE);
    }
  });
});

describe('bd-60106 — the handler no longer carries the 1-hour gate', () => {
  const SRC = fs.readFileSync(
    path.join(__dirname, '../../bot/shared/handlers/text-message.handler.js'), 'utf8');

  /** The coaching interceptor block, as bd-2508 slices it. */
  function interceptor() {
    const anchor = SRC.indexOf('CHECK FOR ACTIVE COACHING SESSION');
    expect(anchor).toBeGreaterThan(-1);
    return SRC.slice(anchor, SRC.indexOf('PAUSE-AND-RESUME', anchor));
  }

  it('the dead-end "didn\'t complete properly" prompt is gone from the whole file', () => {
    // Gone from the FILE, not just the block: moving it a few lines down would
    // reproduce the bug verbatim.
    expect(SRC).not.toMatch(/didn't complete properly/);
  });

  it('no elapsed-time branch decides whether her answer counts', () => {
    expect(interceptor()).not.toMatch(/hoursSinceUpdate/);
  });

  it('the interceptor delegates the decision to the planner', () => {
    expect(interceptor()).toMatch(/planReflectiveTextRouting/);
  });

  it('free text still reaches the coach, and a slash command still ends the session', () => {
    const b = interceptor();
    expect(b).toMatch(/handleReflectiveResponse/);
    expect(b).toMatch(/status:\s*'abandoned'/);
  });
});

describe('bd-60106 — no orphan "reply 1 or 2" prompts are left behind', () => {
  const SRC = fs.readFileSync(
    path.join(__dirname, '../../bot/shared/handlers/text-message.handler.js'), 'utf8');

  it('every prompt asking for a 1/2/3 reply arms the key its handler reads', () => {
    // The root failure was a prompt whose reply had no reader. Any surviving
    // "Reply with 1..." prompt must be accompanied by an
    // `expecting:recovery` write, or its answer goes nowhere again.
    const prompts = SRC.match(/Reply with \*?1\*?/g) || [];
    const arms = SRC.match(/expecting:recovery`?,\s*\d+/g) || [];
    expect(prompts.length).toBeLessThanOrEqual(arms.length);
  });
});
