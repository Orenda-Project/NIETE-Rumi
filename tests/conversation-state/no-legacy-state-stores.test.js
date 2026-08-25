/**
 * Static guard: exactly one store owns conversation state.
 *
 * This guard exists because the generic column guard already caught one of these
 * and was overruled. tests/setup/column-completeness.test.js flags
 * `conversations.conversation_state` — a column that has never existed — and an
 * ALLOWLIST entry dismissed it as "a parser artifact of chain proximity". It was
 * not an artifact: bot/shared/handlers/voice-message.handler.js really did
 * `.from('conversations').select('conversation_state')`, which returns PostgREST
 * 42703 in production, so every voice reply read null and no voice reply has ever
 * matched a conversation state.
 *
 * A named guard cannot be waved away the same way: each pattern below is a
 * specific store that must not come back, with the damage it did.
 *
 * Measured on NIETE production before the fix (Axiom, 30 days, service in
 * bot/sqs-worker): the state was written 4,943 times, read 9,763 times, and every
 * single branch that depended on a non-null state fired 0 times.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SCAN_DIRS = [path.join(ROOT, 'bot')];

function sourceFiles() {
  const out = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '__mocks__' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) out.push(full);
    }
  })(SCAN_DIRS[0]);
  return out;
}

/**
 * Strip comments before matching. These patterns describe the bug they forbid, and
 * the fixes carry comments explaining what was removed and why — a guard that trips
 * on prose about the defect would force us to delete the explanation to go green,
 * which is the opposite of what we want. Only code is scanned.
 *
 * Deliberately simple: block comments, then line comments. A `//` inside a string
 * literal would be over-stripped, which can only ever cause a false PASS on that
 * one line, never a false failure — and no `.from(...)` chain lives inside a string.
 */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const FILES = sourceFiles().map((f) => ({
  rel: path.relative(ROOT, f),
  text: stripComments(fs.readFileSync(f, 'utf8')),
}));

/** Collapse whitespace so a pattern still matches when a chain is line-wrapped. */
const flat = (s) => s.replace(/\s+/g, ' ');

const BANNED = [
  {
    what: "reading state off the conversations message log (`conversations.current_state`)",
    why:
      'The incoming message is inserted into `conversations` BEFORE this read runs, so ' +
      '"newest row for this session" is that message — whose current_state is null. ' +
      'The read therefore always returned null and every downstream branch was dead code.',
    re: /\.from\( ?'conversations' ?\)[^;]{0,400}?\.select\( ?'[^']*current_state/,
  },
  {
    what: "reading `conversation_state` off `conversations`",
    why: 'That column has never existed on conversations. PostgREST answers 42703, so voice went state-blind.',
    re: /\.from\( ?'conversations' ?\)[^;]{0,400}?\.select\( ?'[^']*conversation_state/,
  },
  {
    what: "writing state onto the conversations message log",
    why: 'State stamped on a log row survives exactly until the next row is appended — a lifetime nobody chose.',
    re: /\.from\( ?'conversations' ?\)[^;]{0,400}?\.update\( ?\{[^}]{0,200}current_state/,
  },
  {
    what: "clearing state on `chat_sessions.conversation_state`",
    why:
      'State was written to conversations and cleared on chat_sessions — a different table — ' +
      'so the clear was a no-op and state was never actually cleared.',
    re: /\.from\( ?'chat_sessions' ?\)[^;]{0,200}?\.update\( ?\{[^}]{0,120}conversation_state/,
  },
];

describe('one store owns conversation state', () => {
  for (const rule of BANNED) {
    it(`no code ${rule.what}`, () => {
      const offenders = FILES.filter((f) => rule.re.test(flat(f.text))).map((f) => f.rel);
      expect(offenders).toEqual([]);
    });
  }

  it('the column guard no longer allowlists chat_sessions.conversation_state', () => {
    // That entry only ever existed to cover the no-op clear this work deleted, so
    // with the code gone the entry must go too.
    //
    // Its sibling `conversations: ['conversation_state']` legitimately STAYS: the
    // parser chain-attributes a real `.from('coaching_sessions').select(…
    // conversation_state …)` in stale-session.worker.js to `conversations`. The
    // original entry was doing both jobs at once, which is how a live bug hid
    // behind a true statement — the four checks above now cover the code directly,
    // so the allowlist can go back to covering only the artifact.
    const guard = fs.readFileSync(path.join(ROOT, 'tests/setup/column-completeness.test.js'), 'utf8');
    expect(guard).not.toMatch(/chat_sessions: \[ ?'conversation_state' ?\]/);
  });

  it('a plain text message is stored once, not twice', () => {
    // `/menu` was stored by the generic path AND again by its own branch: 2,302 of
    // 3,253 consecutive /menu pairs in production landed under 2s apart, which also
    // duplicates the turn in the AI's context window.
    const handler = FILES.find((f) => f.rel.endsWith('handlers/text-message.handler.js'));
    const stores = flat(handler.text).match(/storeConversation\( ?user\.id, 'user', messageBody/g) || [];
    expect(stores).toHaveLength(1);
  });

  it('feature state never uses raw setex — the 24h ceiling must be unbypassable', () => {
    // setexWithCeiling exists precisely so a stuck key cannot outlive its usefulness.
    // One call site reached past it with a 7-day raw setex.
    const offenders = FILES.filter((f) => /\.setex\( ?[^,]+, ?(\d{6,})/.test(flat(f.text))).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
});
