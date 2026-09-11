/**
 * A flow cannot join the conversation store undecided.
 *
 * Nine flows share one row on `users`. Three separate places enumerate what is on
 * that store, and when the attendance rebuild added three flows, ALL THREE drifted:
 *
 *   TASK_LABEL        — attendance and voice were never added, so `/status` rendered
 *                       their raw internal ids ("Continue: attendance_marking") and
 *                       the sweeper silently deleted a half-marked register at TTL
 *                       rather than offering it back.
 *   code comments     — asserted four times over that "attendance was rebuilt as
 *                       Flows and keeps no conversational state, so no row could ever
 *                       carry that id". False, and every exclusion resting on it wrong.
 *   the e2e feature map — claimed the store fanned out to [menu, status, training],
 *                       when `training` writes no state at all.
 *
 * None of that was a hard question. It was three lists nobody had to keep in step.
 *
 * SO THIS DERIVES THE SET FROM THE CODE and makes the decision explicit. A new flow
 * is either offerable, or it is on NOT_OFFERABLE below WITH A STATED REASON. There is
 * no third option, and "nobody thought about it" now fails the build instead of
 * shipping.
 *
 * Static, deliberately: the alternative is booting nine flows to ask them what they
 * wrote, and the repo already uses named source guards for exactly this shape (see
 * no-legacy-state-stores.test.js, whose header explains why a NAMED guard cannot be
 * waved away the way a generic one can).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const BOT = path.join(ROOT, 'bot');

function sourceFiles(dir) {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '__mocks__' || e.name.startsWith('.')) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.js')) out.push(full);
    }
  })(dir);
  return out;
}

/**
 * Every flow id written to the store, however it is spelled at the call site.
 *
 * Three spellings exist and all three are load-bearing, so all three are read:
 *   flow: 'literal'                     — reading, lesson_plan
 *   flow: CONSTANT                      — resolved against `const CONSTANT = '...'`
 *                                         in the same file (quiz, video, attendance x3)
 *   STEP_CONTRACT { flow: 'x', ttl }    — menu, coaching, which never appear as a
 *                                         `flow:` argument at a setState call at all
 */
function flowsWrittenToTheStore() {
  const flows = new Map();   // flow -> where we saw it
  const unresolved = [];     // flow: CONST we could not resolve in that file

  for (const file of sourceFiles(BOT)) {
    const src = fs.readFileSync(file, 'utf8');
    if (!src.includes('setState') && !src.includes('STEP_CONTRACT')) continue;
    const rel = path.relative(ROOT, file);

    // Literal flows, and STEP_CONTRACT entries (same `flow: 'x'` shape).
    //
    // DIGITS ARE ALLOWED IN THE ID and that is load-bearing: with `[a-z_]+` a flow
    // named `lp612_direct` matched nothing at all and joined the store undecided
    // with the guard still green. This repo names things lp612, so a digit in a flow
    // id is the likely case, not the exotic one.
    for (const m of src.matchAll(/flow:\s*'([a-z0-9_]+)'/g)) {
      if (!flows.has(m[1])) flows.set(m[1], rel);
    }

    // flow: SOME_CONSTANT -> resolve against a `const` in the SAME file.
    for (const m of src.matchAll(/flow:\s*([A-Z][A-Z0-9_]+)/g)) {
      const decl = src.match(new RegExp(`const\\s+${m[1]}\\s*=\\s*'([a-z0-9_]+)'`));
      if (decl) {
        if (!flows.has(decl[1])) flows.set(decl[1], rel);
      } else {
        // UNRESOLVED, and it must not be ignored. A constant imported from another
        // module used to be skipped silently, which is the same hole as the digits
        // one: a real flow, no entry, guard green. Record it so the assertion below
        // fails loudly and names the file, rather than quietly under-reporting.
        unresolved.push(`${m[1]}  (flow: ${m[1]} in ${rel}, no const in that file)`);
      }
    }
  }
  return { flows, unresolved };
}

/**
 * Flows that are deliberately NOT offered back, each with the reason.
 *
 * An entry here is a decision on the record, not a parking space. If you are adding
 * one because you have not thought about it yet, say that in the reason and file it,
 * the way the attendance three are below.
 */
const NOT_OFFERABLE = {
  menu:
    'A glance, not work. The busy probe excludes it for the same reason: counting an ' +
    'open menu as busy would defer a teacher\'s quiz report by an hour every time.',
  lesson_plan:
    'Its path dead-ends. The only thing that sets an LP step is the free-text topic ' +
    'prompt, and since freeform generation was retired the answer comes back as ' +
    '"not in the catalog". An offer is a promise; do not make one the code cannot keep.',

  // UNDECIDED, and that is the point of listing them: nobody chose this, the
  // attendance rebuild simply never touched TASK_LABEL. Both hold real teacher work
  // in the payload, so "silently cleared at 1800s" is very likely the wrong answer.
  // Tracked as bd-60056 — resolve it there, not by quietly deleting these lines.
  attendance_marking:
    'UNDECIDED (bd-60056). The payload holds the register itself (absentIds, leaveIds), ' +
    'and it is silently cleared 30 minutes after she walks away from it.',
  attendance_method:
    'UNDECIDED (bd-60056). Only holds the "tap or voice" question, so dropping it is ' +
    'probably right, but it has never actually been decided.',
  attendance_voice:
    'UNDECIDED (bd-60056). Holds the armed wait and then the extraction (transcript, ' +
    'matched and unmatched names). Losing that discards a completed roll call.',
};

describe('every flow on the conversation store is a decision', () => {
  const { flows: written, unresolved } = flowsWrittenToTheStore();
  const resume = fs.readFileSync(
    path.join(BOT, 'shared/services/conversation-resume.service.js'), 'utf8');
  const offerable = new Set(
    [...resume.matchAll(/^\s{2}([a-z_]+):\s*\{/gm)].map((m) => m[1]));

  it('finds the flows by reading the code, not a hand-kept list', () => {
    // If this drops to a handful the extractor has broken and every assertion below
    // becomes vacuously true, which is the failure mode that matters most here.
    expect(written.size).toBeGreaterThanOrEqual(9);
    for (const f of ['menu', 'coaching', 'attendance_marking', 'attendance_voice']) {
      expect([...written.keys()]).toContain(f);
    }
  });

  it('TASK_LABEL is non-empty — the offerable side of the comparison is real', () => {
    expect(offerable.size).toBeGreaterThanOrEqual(4);
    expect([...offerable]).toContain('coaching');
  });

  it('every flow is either offerable or explicitly not, with a reason', () => {
    const undecided = [...written.keys()]
      .filter((f) => !offerable.has(f) && !NOT_OFFERABLE[f])
      .map((f) => `${f}  (written in ${written.get(f)})`);

    // The message names the file so the fix is obvious: add it to TASK_LABEL, or add
    // it to NOT_OFFERABLE with the reason it should not be offered back.
    expect(undecided).toEqual([]);
  });

  it('every flow: CONSTANT resolves — an unresolvable one is a hole, not a pass', () => {
    // If a flow id moves into a shared constants module, the resolver above cannot
    // follow it. That must fail here rather than silently shrink the set the rest of
    // this file checks. Fix by declaring the const beside its setState call, or by
    // teaching the resolver that module.
    expect(unresolved).toEqual([]);
  });

  it('a NOT_OFFERABLE reason is a sentence, not a shrug', () => {
    for (const [flow, reason] of Object.entries(NOT_OFFERABLE)) {
      expect(typeof reason).toBe('string');
      expect(reason.trim().length).toBeGreaterThan(40);
    }
  });

  it('nothing is listed as both offerable and not', () => {
    const both = Object.keys(NOT_OFFERABLE).filter((f) => offerable.has(f));
    expect(both).toEqual([]);
  });

  it('the resume sweeper still uses the guarded write', () => {
    // Locks in the fix for the sweeper overwriting a teacher who came back. Dropping
    // `onlyIfStillExpired` here silently restores an unconditional write, and the only
    // symptom is a rare lost step nobody reports.
    expect(resume).toMatch(/onlyIfStillExpired:\s*true/);
    const idx = resume.indexOf('onlyIfStillExpired');
    const sendIdx = resume.indexOf('sendInteractiveButtons');
    expect(idx).toBeGreaterThan(-1);
    // The write must come BEFORE the send: no state change, no ask.
    expect(idx).toBeLessThan(sendIdx);
  });
});
