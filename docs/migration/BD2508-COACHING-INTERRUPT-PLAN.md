# BD-2508: [NIETE] Confirm before ending a coaching conversation — Execution Ledger

**The one document to follow.** Status: not started. Opened: 2026-08-04 · Tracker: bd-2508 (follow-up)
(All design decisions resolved before this plan was written.)

> Working notes: this file is the plan of record until an equivalent Notion card exists.
> If a card is created later, add the pointer header and execute from the card.

---

## 0. READ FIRST — state & rollback

**Shipped:** nothing yet.

**Rollback anchor:** branch `fix/bd2508-confirm-before-abandoning-coaching`, cut from `main` at
`118194a`. Every change is inside one handler, one worker, one new service, plus one additive
migration. Revert with:

```
git revert <merge-sha>
```

Plus, if the migration shipped:

```sql
-- additive columns only; dropping them restores exactly the old shape
ALTER TABLE coaching_sessions DROP COLUMN IF EXISTS paused_at;
ALTER TABLE coaching_sessions DROP COLUMN IF EXISTS pause_reason;
ALTER TABLE coaching_sessions DROP COLUMN IF EXISTS evening_reminder_sent_at;
UPDATE coaching_sessions SET status = 'abandoned' WHERE status = 'paused';
```

**THE VERY NEXT THING:**
1. Write the §5 tests and prove them RED (T1.1.1).
2. Apply the §9 migration.
3. Work T1.2.1 → T1.2.4 (the pause service + handler fork), then T2.x (the evening reminder).

---

## 1. Why we're doing it

Today a slash command during `conducting_conversation` **silently destroys** the rest of the
coaching reflection. `bot/shared/handlers/text-message.handler.js:1276`:

```js
if (trimmedMessage.startsWith('/')) {
  await supabase.from('coaching_sessions')
    .update({ status: 'abandoned', updated_at: new Date().toISOString() })
    .eq('id', activeCoaching.id);
  // Deliberately no extra chat message
}
```

The teacher gets **no warning, no confirmation, and no way back**. Answers already given survive
(they are written per-turn into `conversation_state.questions`), but every remaining question is
dropped and the session is terminal.

The comment block above it explains *why* it was written that way (bd-2508): `conducting_conversation`
was the only waiting state with no exit, the block swallowed the `/menu` the bot's own help text
recommends, and **one teacher was held for 269 hours**. Ending the session closed the trap.

**The gap:** escaping the trap and destroying the session are now the same action. There is no
third option.

**Live evidence, `RUMI_DB` 2026-08-04 (governed MCP, rule_version v0.22.5):**

| Fact | Value | Why it matters |
|---|---|---|
| Reflective answers on record | **7,644** | the corpus this touches |
| Answers that are a bare digit `1`–`4` | **5** (0.065%) | the digit-collision risk of the chosen fix is negligible |
| Answers ≤ 2 characters | 365 (4.8%) | short answers are common; bare menu digits are not |
| `coaching_sessions` rows | 4,599 | |

That 5-in-7,644 measurement is what makes the design in §2 safe — see §3.

---

## 2. The Big Idea

**Pausing is a third option: warn before switching, keep the questions, and come back in the evening.**

---

## 3. Binding invariants

- **Never silently discard a teacher's session.** Every path that ends or suspends a coaching
  conversation must say so in chat first.
- **The 269-hour trap stays closed.** `/menu` and `/help` must ALWAYS get the teacher out on the
  first try, with no confirmation gate in front of them. A confirmation on the escape hatch is a
  regression, not a feature.
- **`/menu` and `/help` do NOT end the session** (operator decision 2026-08-04). They leave it
  `conducting_conversation` and are handled by a targeted digit exemption — see below.
- **The digit exemption is narrow and measured.** The coaching block ignores a message ONLY when
  it is exactly `1`–`4` AND `conversations.current_state = 'AWAITING_MENU_CHOICE'`. Exposure is
  5 of 7,644 historic answers (§1). A wider exemption (any short message, any digit) is NOT
  acceptable — it would eat real answers.
- **Service commands confirm, then pause.** `/lessonplan`, `/video`, `/quiz`, `/readingtest`,
  `/assessment` prompt first; on YES the session becomes `paused`, never `abandoned`.
- **Mid-analysis statuses are untouched.** `transcribing` / `analyzing` / `generating_report` keep
  working exactly as today — the SQS worker keys off `coaching_sessions.id` and still delivers the
  report and voice debrief. **Do not add `paused` to any query that worker uses.**
- **`paused` must not be auto-completed.** `stale-session.worker.js` auto-completes
  `conducting_conversation` at 12h idle. A paused session is deliberately idle; it MUST be excluded
  from that path or the pause silently becomes a partial report.
- **Additive schema only.** New nullable columns; no column dropped, renamed, or retyped.
- **Evening reminder is once per session, in `Asia/Karachi`.** Never a second ping for the same
  session, never outside the window.

---

## 4. Code to touch — as ACTUAL DIFFS

### NEW FILE — the pause/resume service

```diff
# NEW FILE — bot/shared/services/coaching/coaching-pause.service.js
+++ b/bot/shared/services/coaching/coaching-pause.service.js
+/**
+ * Coaching pause / resume — the third option bd-2508 was missing.
+ *
+ * Before this, a slash command during `conducting_conversation` set the session
+ * to `abandoned` with no warning. Escaping the 269-hour trap and destroying the
+ * reflection were the same action. This service adds the middle ground:
+ *   * confirm  — tell the teacher what she is about to lose, and ask
+ *   * pause    — suspend the session, keeping every answer and the question cursor
+ *   * resume   — pick the questions back up where she left off
+ *
+ * `/menu` and `/help` never come through here. They are the documented escape
+ * hatch and must work on the first try — see the digit exemption in
+ * text-message.handler.js.
+ */
+
+const supabase = require('../../config/supabase');
+const redis = require('../cache/railway-redis.service');
+const WhatsAppService = require('../whatsapp.service');
+const { logToFile } = require('../../utils/logger');
+
+// How long we hold a pending confirmation before it lapses. Short on purpose: a
+// stale "are you sure?" answered an hour later is worse than asking again.
+const CONFIRM_TTL_SECONDS = 10 * 60;
+const CONFIRM_KEY = (userId) => `coaching:confirm_switch:${userId}`;
+
+// Teacher-facing label per command. The prompt must name the service SHE asked
+// for, never a hardcoded example.
+const SERVICE_LABELS = {
+  '/lessonplan':   'a lesson plan',
+  '/lp':           'a lesson plan',
+  '/video':        'a video',
+  '/quiz':         'a quiz',
+  '/readingtest':  'a reading assessment',
+  '/assessment':   'an assessment',
+  '/attendance':   'attendance',
+  '/exam':         'an exam check',
+};
+
+/** Commands that must NEVER be gated — the escape hatch. */
+const ALWAYS_ALLOWED = new Set(['/menu', '/help']);
+
+// Imported, NEVER hardcoded. Verified live 2026-08-04: the value is currently 1
+// (one reflection question per observation, was 3), and coaching-debrief.config.js
+// is the single source that the loop bound, the meta-prompt "question X of N"
+// string, and the few-shot arms all key off. A literal here would go stale the
+// moment that constant changes.
+const { NUM_REFLECTIVE_QUESTIONS } = require('../../config/coaching-debrief.config');
+
+function labelFor(command) {
+  return SERVICE_LABELS[String(command).toLowerCase()] || 'that';
+}
+
+function isAlwaysAllowed(command) {
+  return ALWAYS_ALLOWED.has(String(command).toLowerCase());
+}
+
+/**
+ * Ask the teacher to confirm before we suspend her reflection.
+ * Names the service she asked for and how far through she is.
+ */
+async function askToConfirmSwitch(from, userId, session, command, fullMessage) {
+  const answered = session.conversation_state?.questions_answered
+    ?? (session.conversation_state?.questions || []).filter((q) => q.answer).length;
+  const label = labelFor(command);
+
+  // Stash the original message so YES replays the real command, not just the verb.
+  await redis.setex(
+    CONFIRM_KEY(userId),
+    CONFIRM_TTL_SECONDS,
+    JSON.stringify({ sessionId: session.id, command, fullMessage, label })
+  );
+
+  // Progress line adapts to the real question count. At N=1 (today's value)
+  // "0 of 1 questions" reads badly, so a single outstanding question gets its own
+  // phrasing. Never hardcode either shape.
+  const remaining = Math.max(NUM_REFLECTIVE_QUESTIONS - answered, 0);
+  const progress = NUM_REFLECTIVE_QUESTIONS === 1
+    ? `You're in the middle of your coaching reflection`
+    : `We're ${answered} of ${NUM_REFLECTIVE_QUESTIONS} questions into your coaching reflection`;
+  const keptLine = answered > 0
+    ? `Your ${answered} answer${answered === 1 ? '' : 's'} so far ${answered === 1 ? 'is' : 'are'} kept, and I'll remind you this evening so you can finish.`
+    : `I'll remind you this evening so you can pick it up.`;
+
+  await WhatsAppService.sendMessage(
+    from,
+    `⚠️ Hold on — ${progress}.\n\n` +
+    `If you start ${label} now, the coaching conversation pauses here. ${keptLine}\n\n` +
+    `*YES* — start ${label}\n` +
+    `*NO* — ${remaining === 1 ? 'answer the question' : 'finish the questions'}`
+  );
+
+  logToFile('🎓 Asked teacher to confirm switching away from coaching', {
+    coachingSessionId: session.id, command, answered,
+  });
+}
+
+/** Is a confirmation outstanding for this user? Returns the stashed payload or null. */
+async function getPendingConfirmation(userId) {
+  const raw = await redis.get(CONFIRM_KEY(userId));
+  return raw ? JSON.parse(raw) : null;
+}
+
+async function clearPendingConfirmation(userId) {
+  await redis.del(CONFIRM_KEY(userId));
+}
+
+/**
+ * Suspend the session. `paused` (not `abandoned`) so the questions survive and the
+ * evening reminder can find it. Every answer already lives in
+ * conversation_state.questions, so nothing the teacher said is lost.
+ */
+async function pauseSession(sessionId, reason) {
+  await supabase
+    .from('coaching_sessions')
+    .update({
+      status: 'paused',
+      paused_at: new Date().toISOString(),
+      pause_reason: reason,
+      updated_at: new Date().toISOString(),
+    })
+    .eq('id', sessionId);
+  logToFile('⏸️ Coaching session paused', { coachingSessionId: sessionId, reason });
+}
+
+/**
+ * Put a paused session back into `conducting_conversation` and re-ask the question
+ * she was on. Clears evening_reminder_sent_at so a later pause can ping again.
+ */
+async function resumeSession(sessionId, from) {
+  const { data: session } = await supabase
+    .from('coaching_sessions')
+    .select('id, conversation_state')
+    .eq('id', sessionId)
+    .single();
+  if (!session) return false;
+
+  await supabase
+    .from('coaching_sessions')
+    .update({
+      status: 'conducting_conversation',
+      paused_at: null,
+      pause_reason: null,
+      evening_reminder_sent_at: null,
+      updated_at: new Date().toISOString(),
+    })
+    .eq('id', sessionId);
+
+  const answered = session.conversation_state?.questions_answered
+    ?? (session.conversation_state?.questions || []).filter((q) => q.answer).length;
+
+  // Re-ask from the cursor. Requiring the service here (not at module load) keeps
+  // the circular-deps guard happy — reflective-conversation requires this file too.
+  const ReflectiveConversationService = require('./reflective-conversation.service');
+  await ReflectiveConversationService.conductReflectiveConversation(
+    sessionId, from, answered + 1
+  );
+
+  logToFile('▶️ Coaching session resumed', { coachingSessionId: sessionId, fromQuestion: answered + 1 });
+  return true;
+}
+
+module.exports = {
+  SERVICE_LABELS,
+  ALWAYS_ALLOWED,
+  NUM_REFLECTIVE_QUESTIONS,
+  CONFIRM_KEY,
+  labelFor,
+  isAlwaysAllowed,
+  askToConfirmSwitch,
+  getPendingConfirmation,
+  clearPendingConfirmation,
+  pauseSession,
+  resumeSession,
+};
```

### EDIT — the handler block that currently abandons

```diff
# EDIT — bot/shared/handlers/text-message.handler.js  (locate: grep -n "Slash command during coaching")
--- a/bot/shared/handlers/text-message.handler.js
+++ b/bot/shared/handlers/text-message.handler.js
@@ active coaching session check @@
       if (activeCoaching) {
-        // bd-2508 — a slash command ENDS the conversation and falls through.
-        // ... (existing comment block) ...
-        if (trimmedMessage.startsWith('/')) {
-          logToFile('🎓 Slash command during coaching — ending the session and continuing', {
-            coachingSessionId: activeCoaching.id,
-            command: trimmedMessage.split(/\s+/)[0],
-          });
-          await supabase
-            .from('coaching_sessions')
-            .update({ status: 'abandoned', updated_at: new Date().toISOString() })
-            .eq('id', activeCoaching.id);
-          // Deliberately no extra chat message
-          // Fall through — do NOT return — so the command runs normally.
-        } else {
+        // bd-2508 follow-up — three outcomes, not one.
+        //
+        // BEFORE: any "/" message set the session to `abandoned` and fell through.
+        // The trap was closed but the reflection was destroyed silently.
+        //
+        // NOW:
+        //  1. /menu, /help  -> fall through, session LEFT RUNNING. These are the
+        //     documented escape hatch (the 269-hour teacher's way out) and must
+        //     work first try, so they get no confirmation gate. /menu then sets
+        //     AWAITING_MENU_CHOICE and waits on a bare "1".."4" — the digit
+        //     exemption below stops this block eating that reply.
+        //  2. YES/NO to a pending confirmation -> handled here.
+        //  3. any other "/" command -> ASK FIRST; on YES pause (not abandon).
+        const CoachingPauseService = require('../services/coaching/coaching-pause.service');
+        const command = trimmedMessage.split(/\s+/)[0];
+
+        // (2) A confirmation is outstanding — this message is the answer to it.
+        const pending = await CoachingPauseService.getPendingConfirmation(user.id);
+        if (pending && pending.sessionId === activeCoaching.id) {
+          const reply = trimmedMessage.toLowerCase();
+          if (['yes', 'y', 'haan', 'han', 'ji', '1'].includes(reply)) {
+            await CoachingPauseService.clearPendingConfirmation(user.id);
+            await CoachingPauseService.pauseSession(activeCoaching.id, `switched_to:${pending.command}`);
+            // Replay the ORIGINAL command text so args survive
+            // (e.g. "/lessonplan grade 4 maths"), then let it run normally.
+            messageBody = pending.fullMessage;
+            trimmedMessage = pending.fullMessage.trim();
+            // fall through — the command handler below picks it up
+          } else if (['no', 'n', 'nahi', 'nahin', '2'].includes(reply)) {
+            await CoachingPauseService.clearPendingConfirmation(user.id);
+            typingController.stop();
+            await WhatsAppService.sendMessage(
+              from,
+              "👍 Staying with your coaching reflection. Here's the question again:"
+            );
+            const RCS = require('../services/coaching/reflective-conversation.service');
+            const answered = activeCoaching.conversation_state?.questions_answered || 0;
+            await RCS.conductReflectiveConversation(activeCoaching.id, from, answered + 1);
+            return;
+          } else {
+            // Neither yes nor no. Treat it as a real answer to the question and
+            // drop the pending gate — she has moved on.
+            await CoachingPauseService.clearPendingConfirmation(user.id);
+          }
+        }
+
+        // (1) Escape hatch: never gate these, never end the session.
+        if (CoachingPauseService.isAlwaysAllowed(command)) {
+          logToFile('🎓 Escape-hatch command during coaching — session left running', {
+            coachingSessionId: activeCoaching.id, command,
+          });
+          // Fall through — do NOT return, do NOT touch status.
+        // (3) Any other slash command: confirm before pausing.
+        } else if (trimmedMessage.startsWith('/')) {
+          typingController.stop();
+          await CoachingPauseService.askToConfirmSwitch(
+            from, user.id, activeCoaching, command, messageBody
+          );
+          return; // wait for YES/NO
+        } else {
```

### EDIT — the digit exemption that makes `/menu` actually usable

Without this, `/menu` sets `AWAITING_MENU_CHOICE` (menu.service.js:53) and the teacher's `"2"`
is captured by THIS block, ~1,000 lines before the menu-choice handler at line 2275. She escapes
and is immediately re-caught — the exact failure the original bd-2508 comment predicted.

```diff
# EDIT — bot/shared/handlers/text-message.handler.js  (locate: grep -n "routing as reflective response")
--- a/bot/shared/handlers/text-message.handler.js
+++ b/bot/shared/handlers/text-message.handler.js
@@ inside the else branch, before handleReflectiveResponse @@
+        // bd-2508 follow-up — the menu-digit exemption.
+        //
+        // /menu leaves the coaching session RUNNING (see above), sets
+        // AWAITING_MENU_CHOICE, and waits for a bare "1".."4". This block runs
+        // ~1000 lines BEFORE the menu-choice handler, so without this exemption
+        // it swallows that digit as a reflective answer and the teacher is
+        // trapped again.
+        //
+        // Deliberately NARROW: exactly "1".."4", and only while a menu is
+        // actually pending. Measured on live data 2026-08-04 — 5 of 7,644
+        // reflective answers (0.065%) are a bare 1-4, so the cost is ~1 answer
+        // in 1,500 and only for a teacher who opened a menu mid-reflection.
+        // A looser rule (any digit, any short message) would eat real answers:
+        // 365 of 7,644 answers are <= 2 characters.
+        const isMenuDigit = /^[1-4]$/.test(trimmedMessage);
+        if (isMenuDigit) {
+          const { data: convo } = await supabase
+            .from('conversations')
+            .select('current_state')
+            .eq('user_id', user.id)
+            .order('updated_at', { ascending: false })
+            .limit(1)
+            .single();
+          if (convo?.current_state === 'AWAITING_MENU_CHOICE') {
+            logToFile('🎓 Menu digit during coaching — deferring to the menu handler', {
+              coachingSessionId: activeCoaching.id, digit: trimmedMessage,
+            });
+            // Fall through to the AWAITING_MENU_CHOICE handler at ~line 2275.
+            // The session stays `conducting_conversation`; if she picks a service
+            // there, MenuService's own path pauses it via the same service.
+          } else {
+            // No menu pending — a bare "2" really is her answer.
+            await CoachingService.handleReflectiveResponse(
+              activeCoaching.id, from, messageBody, 'text', responseLanguage
+            );
+            return;
+          }
+        } else {
+
         logToFile('🎓 Active coaching session detected - routing as reflective response', {
           coachingSessionId: activeCoaching.id
         });
@@ @@
         return; // Exit early - coaching flow handled
+        }
         }
       }
```

### EDIT — never auto-complete a paused session

`stale-session.worker.js` auto-completes `conducting_conversation` at 12h idle. A paused session
is *deliberately* idle. Without this guard the pause silently becomes a partial report — the exact
data loss this whole change exists to prevent.

```diff
# EDIT — bot/workers/stale-session.worker.js  (locate: grep -n "eq('status', 'conducting_conversation')")
--- a/bot/workers/stale-session.worker.js
+++ b/bot/workers/stale-session.worker.js
@@ processStaleCoachingSessions @@
-      reminder_sent_at, created_at,
+      reminder_sent_at, created_at, paused_at, pause_reason, evening_reminder_sent_at,
       users!inner(first_name, phone_number)
     `)
     .eq('status', 'conducting_conversation')
+    // `paused` is NOT included on purpose: a paused session is deliberately idle
+    // and must never be auto-completed into a partial report. It is handled by
+    // processPausedCoachingReminders() below.
     .order('created_at', { ascending: true });
```

### EDIT — the evening reminder

```diff
# EDIT — bot/workers/stale-session.worker.js  (locate: grep -n "async function main")
--- a/bot/workers/stale-session.worker.js
+++ b/bot/workers/stale-session.worker.js
@@ thresholds @@
 const USER_ACTIVE_THRESHOLD_MS = 5 * 60 * 1000;  // 5 minutes = user considered active
+
+// bd-2508 follow-up — evening nudge for PAUSED sessions.
+// Window is 20:00-21:59 Asia/Karachi (house timezone). The cron runs every 15
+// minutes, so a session becomes eligible on the first tick inside the window and
+// `evening_reminder_sent_at` guarantees exactly one ping per pause.
+const EVENING_WINDOW_START_HOUR = 20;
+const EVENING_WINDOW_END_HOUR = 22;   // exclusive
+const REMINDER_TZ = 'Asia/Karachi';
@@ main() @@
     const coachingResults = await processStaleCoachingSessions();
     console.log('📊 Coaching results:', coachingResults);
+
+    // bd-2508 follow-up: nudge teachers who paused a reflection today.
+    const pausedResults = await processPausedCoachingReminders();
+    console.log('🌙 Paused-session reminders:', pausedResults);
@@ new function, after processStaleCoachingSessions @@
+/** Current hour (0-23) in the house timezone, independent of server TZ. */
+function currentHourInTz(tz = REMINDER_TZ) {
+  return parseInt(
+    new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', hour12: false })
+      .format(new Date()),
+    10
+  );
+}
+
+/**
+ * Evening reminder for sessions paused because the teacher switched to another
+ * service. One ping per pause, only between 20:00 and 22:00 Asia/Karachi.
+ */
+async function processPausedCoachingReminders() {
+  const hour = currentHourInTz();
+  if (hour < EVENING_WINDOW_START_HOUR || hour >= EVENING_WINDOW_END_HOUR) {
+    return { skipped: 'outside evening window', hour };
+  }
+
+  const { data: paused, error } = await supabase
+    .from('coaching_sessions')
+    .select(`
+      id, user_id, conversation_state, paused_at, evening_reminder_sent_at,
+      users!inner(first_name, phone_number)
+    `)
+    .eq('status', 'paused')
+    .is('evening_reminder_sent_at', null);
+
+  if (error) throw new Error(`Failed to query paused sessions: ${error.message}`);
+
+  let sent = 0;
+  for (const session of paused || []) {
+    // Don't interrupt a teacher mid-conversation.
+    if (await checkUserActivity(session.user_id)) continue;
+
+    const answered = session.conversation_state?.questions_answered || 0;
+    const name = session.users?.first_name ? ` ${session.users.first_name}` : '';
+
+    try {
+      await WhatsAppService.sendMessage(
+        session.users.phone_number,
+        `🌙 Good evening${name}! Earlier today we paused your coaching reflection` +
+        `${answered > 0 ? ` after ${answered} question${answered === 1 ? '' : 's'}` : ''}.\n\n` +
+        `Reply *RESUME* to finish it now — it takes two minutes, and your report ` +
+        `will be richer for it.`
+      );
+      await supabase
+        .from('coaching_sessions')
+        .update({ evening_reminder_sent_at: new Date().toISOString() })
+        .eq('id', session.id);
+      sent++;
+    } catch (err) {
+      logToFile('⚠️ Evening reminder failed (non-fatal)', {
+        coachingSessionId: session.id, error: err.message,
+      });
+    }
+  }
+  return { total: paused?.length || 0, sent, hour };
+}
```

### EDIT — the RESUME keyword

```diff
# EDIT — bot/shared/handlers/text-message.handler.js  (locate: grep -n "MENU SYSTEM INTEGRATION")
--- a/bot/shared/handlers/text-message.handler.js
+++ b/bot/shared/handlers/text-message.handler.js
@@ before the menu block @@
+  // bd-2508 follow-up — RESUME picks a paused reflection back up.
+  // Placed before the menu block so it can never be shadowed by a command match.
+  if (user && /^resume$/i.test(trimmedMessage)) {
+    const CoachingPauseService = require('../services/coaching/coaching-pause.service');
+    const { data: pausedSession } = await supabase
+      .from('coaching_sessions')
+      .select('id')
+      .eq('user_id', user.id)
+      .eq('status', 'paused')
+      .order('paused_at', { ascending: false })
+      .limit(1)
+      .single();
+
+    if (pausedSession) {
+      typingController.stop();
+      await CoachingPauseService.resumeSession(pausedSession.id, from);
+      return;
+    }
+    // No paused session — fall through so "resume" is treated as ordinary text.
+  }
+
```

**No file is deleted.** Files added: 1 service, 1 migration, 1 test suite.
Files edited: `text-message.handler.js`, `stale-session.worker.js`.

---

## 5. Tests — written FIRST, red before green

```js
// NEW — tests/coaching/bd2508-confirm-before-abandon.test.js   (RED before §4)
const CoachingPauseService = require('../../bot/shared/services/coaching/coaching-pause.service');

describe('bd-2508 follow-up: confirm before ending a coaching conversation', () => {
  describe('service labels — the prompt names what SHE asked for', () => {
    it('maps each service command to a teacher-facing label', () => {
      expect(CoachingPauseService.labelFor('/lessonplan')).toBe('a lesson plan');
      expect(CoachingPauseService.labelFor('/video')).toBe('a video');
      expect(CoachingPauseService.labelFor('/quiz')).toBe('a quiz');
      expect(CoachingPauseService.labelFor('/readingtest')).toBe('a reading assessment');
      expect(CoachingPauseService.labelFor('/assessment')).toBe('an assessment');
    });

    it('is case-insensitive and falls back to a neutral word', () => {
      expect(CoachingPauseService.labelFor('/LessonPlan')).toBe('a lesson plan');
      expect(CoachingPauseService.labelFor('/somethingnew')).toBe('that');
    });

    it('never hardcodes "lesson plan" for a different service', () => {
      expect(CoachingPauseService.labelFor('/video')).not.toMatch(/lesson/i);
    });
  });

  describe('the escape hatch stays open (the 269-hour regression guard)', () => {
    it('/menu and /help are never gated', () => {
      expect(CoachingPauseService.isAlwaysAllowed('/menu')).toBe(true);
      expect(CoachingPauseService.isAlwaysAllowed('/help')).toBe(true);
      expect(CoachingPauseService.isAlwaysAllowed('/MENU')).toBe(true);
    });

    it('service commands ARE gated', () => {
      for (const cmd of ['/lessonplan', '/video', '/quiz', '/readingtest', '/assessment']) {
        expect(CoachingPauseService.isAlwaysAllowed(cmd)).toBe(false);
      }
    });
  });

  describe('the confirmation prompt', () => {
    it('names the service, the progress, and both replies', async () => {
      const sent = [];
      jest.spyOn(require('../../bot/shared/services/whatsapp.service'), 'sendMessage')
        .mockImplementation((to, text) => { sent.push(text); });

      await CoachingPauseService.askToConfirmSwitch(
        '92300000000', 'user-1',
        { id: 's-1', conversation_state: { questions_answered: 2 } },
        '/video', '/video volcanoes'
      );

      // NUM_REFLECTIVE_QUESTIONS is 1 today, so assert the SHAPE not a literal count.
      expect(sent[0]).toMatch(/coaching reflection/i);
      expect(sent[0]).toContain('a video');
      expect(sent[0]).toMatch(/\*YES\*/);
      expect(sent[0]).toMatch(/\*NO\*/);
      expect(sent[0]).not.toMatch(/lesson plan/i);   // must not leak the example
      expect(sent[0]).toMatch(/kept|saved/i);        // reassure about answers
    });

    it('stashes the FULL original message so args survive a YES', async () => {
      const redis = require('../../bot/shared/services/cache/railway-redis.service');
      const setex = jest.spyOn(redis, 'setex').mockResolvedValue('OK');
      await CoachingPauseService.askToConfirmSwitch(
        '92300000000', 'user-1',
        { id: 's-1', conversation_state: { questions_answered: 1 } },
        '/lessonplan', '/lessonplan grade 4 maths'
      );
      expect(JSON.parse(setex.mock.calls[0][2]).fullMessage).toBe('/lessonplan grade 4 maths');
    });
  });

  describe('pausing, not abandoning', () => {
    it('sets status to paused and records why', async () => {
      const update = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({}) });
      jest.spyOn(require('../../bot/shared/config/supabase'), 'from')
        .mockReturnValue({ update });
      await CoachingPauseService.pauseSession('s-1', 'switched_to:/video');
      const payload = update.mock.calls[0][0];
      expect(payload.status).toBe('paused');
      expect(payload.status).not.toBe('abandoned');   // the whole point
      expect(payload.pause_reason).toBe('switched_to:/video');
      expect(payload.paused_at).toBeTruthy();
    });
  });

  describe('the menu-digit exemption is narrow', () => {
    const isMenuDigit = (s) => /^[1-4]$/.test(s);
    it('matches only a bare 1-4', () => {
      ['1', '2', '3', '4'].forEach((d) => expect(isMenuDigit(d)).toBe(true));
    });
    it('does not match a real answer that merely starts with a digit', () => {
      ['5', '12', '1.', '1 yes', 'I did 2 things', '2️⃣', ''].forEach(
        (s) => expect(isMenuDigit(s)).toBe(false)
      );
    });
  });

  describe('progress line adapts to the real question count', () => {
    it('never hardcodes a total', () => {
      const src = require('fs').readFileSync(
        require.resolve('../../bot/shared/services/coaching/coaching-pause.service'), 'utf8'
      );
      expect(src).toMatch(/require\(.*coaching-debrief\.config.*\)/);
      expect(src).not.toMatch(/of 4 questions/);
    });
  });

  describe('evening window', () => {
    // 20:00-21:59 Asia/Karachi inclusive of 20 and 21, excluding 22.
    const inWindow = (h) => h >= 20 && h < 22;
    it('fires at 20 and 21 only', () => {
      expect(inWindow(19)).toBe(false);
      expect(inWindow(20)).toBe(true);
      expect(inWindow(21)).toBe(true);
      expect(inWindow(22)).toBe(false);
      expect(inWindow(9)).toBe(false);
    });
  });
});
```

**Cases:** labels per service + fallback · escape hatch never gated · service commands gated ·
prompt names service/progress/both replies and leaks no example · full message stashed so args
survive · `paused` not `abandoned` · digit exemption rejects near-misses · evening window bounds.

**Expected: RED now** — `Cannot find module '.../coaching-pause.service'`.
**GREEN after T1.2.1** (service) and T1.2.2 (handler fork).

**Suite gate:** `npx jest tests/coaching/bd2508-confirm-before-abandon.test.js` green, and
`npm test` no worse than branch-HEAD baseline.

---

## 6. Phases → subphases → tasks

### Phase 1 — confirm + pause (ships: no more silent destruction)

#### Phase 1.1 — tests first

- [ ] **T1.1.1 Write the §5 suite and prove it RED**
  - Files: `tests/coaching/bd2508-confirm-before-abandon.test.js` (new) → §5
  - Gate: fails with "Cannot find module" — a suite that passes on main proves nothing
  - Done when: RED output captured

#### Phase 1.2 — the fix

- [ ] **T1.2.1 Create the pause service**
  - Files: `bot/shared/services/coaching/coaching-pause.service.js` (new) → §4 diff 1
  - Test: label + escape-hatch + prompt + pause cases go green
  - Gate: reviewer · `npx jest tests/coaching/bd2508` green
  - Done when: all §5 service-level cases pass

- [ ] **T1.2.2 Fork the handler block three ways**
  - Files: `bot/shared/handlers/text-message.handler.js` (grep `Slash command during coaching`) → §4 diff 2
  - Test: §5 escape-hatch + confirmation cases
  - Gate: `status: 'abandoned'` no longer appears in this block; `/menu` leaves status untouched
  - Done when: a service command prompts instead of abandoning, verified on staging with a real session

- [ ] **T1.2.3 Add the menu-digit exemption**
  - Files: same handler (grep `routing as reflective response`) → §4 diff 3
  - Test: §5 digit-exemption cases
  - Gate: `/menu` then `2` reaches the menu handler; a bare `2` with NO menu pending is still
    stored as an answer (both verified on staging)
  - Done when: both paths confirmed — this is the trap-closure proof

- [ ] **T1.2.4 Apply the §9 migration**
  - Files: `infrastructure/supabase/migrations/V1.0.12__coaching_pause.sql` (new)
  - Gate: fresh operator "go" (shared DB = prod write); columns present in `information_schema`
  - Done when: `paused_at`, `pause_reason`, `evening_reminder_sent_at` exist and default NULL

#### Phase 1.3 — protect the pause

- [ ] **T1.3.1 Exclude `paused` from auto-complete**
  - Files: `bot/workers/stale-session.worker.js` (grep `eq('status', 'conducting_conversation')`) → §4 diff 4
  - Test: a `paused` row idle >12h is NOT auto-completed
  - Gate: worker dry-run over a seeded paused session reports it untouched
  - Done when: verified — otherwise the pause silently becomes a partial report

### Phase 2 — evening reminder (ships: paused reflections get finished)

- [ ] **T2.1.1 Add `processPausedCoachingReminders()`**
  - Files: `bot/workers/stale-session.worker.js` → §4 diff 5
  - Test: §5 evening-window bounds
  - Gate: outside 20:00–22:00 Karachi it no-ops; inside, it sends exactly once
  - Done when: run at 19:59 sends nothing; at 20:05 sends one; second run sends none

- [ ] **T2.1.2 Wire the RESUME keyword**
  - Files: `bot/shared/handlers/text-message.handler.js` → §4 diff 6
  - Test: RESUME with a paused session resumes; without one, falls through as normal text
  - Gate: staging — pause, receive the evening ping, reply RESUME, get the next question
  - Done when: full round trip verified

---

## 7. Blast radius — other regions & shared services

`text-message.handler.js` and `stale-session.worker.js` are **shared code every region imports**.
A `main` merge redeploys all of them at once.

| Region | Services redeployed | Behaviour change? | Flag-gated? | Shared asset touched |
|---|---|---|---|---|
| PK (NIETE) | web, worker, cron | **Yes** — the intended fix | No | `coaching_sessions`, shared handler |
| PK (main Rumi) | web, worker, cron | Yes, if it shares this handler | No | same handler |
| TZ | web, worker | Only if coaching is enabled there | No | same handler |
| KE | web, worker | Same | No | same handler |
| YE | web, worker | Same | No | same handler |
| PS | web, worker | Same | No | same handler |

- **Shared code path:** yes — this is the main text handler. Every region runs the new branch the
  moment it merges. Mitigation: the change is inert for any user with **no** session in
  `conducting_conversation`, which is the overwhelming majority at any instant. Regions without
  coaching never enter the block.
- **Not flag-gated, deliberately.** A flag would leave the silent-destruction path live in some
  regions. If the operator wants a flag, add it in T1.2.2 as `COACHING_PAUSE_ENABLED` defaulting
  to ON, and say so.
- **Shared Meta Flows / templates:** none touched. All new copy is plain `sendMessage` text.
- **Shared Supabase:** one DB across prod/staging/QA. The migration is additive (3 nullable
  columns), so no write-freeze is needed. The new `paused` status value is **new data**, not a
  schema change — no CHECK constraint exists on `coaching_sessions.status` (verified 2026-08-04).
  ⚠️ There IS a partial index `idx_coaching_sessions_stale ON (status, created_at) WHERE status =
  'conducting_conversation'` — a `paused` row falls out of it. That is correct (the stale worker
  no longer needs to see it) but means the new paused query is a plain scan; at 4,599 total
  sessions that is fine.
- **Queues:** no new message types. The SQS report worker keys off `coaching_sessions.id` and is
  untouched — mid-analysis statuses still deliver their report and voice debrief.

---

## 8. Meta dependencies

`N/A — no Meta assets touched.` Every new teacher-facing string is a plain text message via
`WhatsAppService.sendMessage`. No template, Flow, or form is created, updated, or published, so no
approval lead time applies.

---

## 9. Database schema

### Explored live 2026-08-04

- `coaching_sessions.status` — **no CHECK constraint** in `00_complete-schema.sql`, so adding the
  value `paused` needs no DDL for the column itself.
- `idx_coaching_sessions_stale` is a **partial index** on `(status, created_at) WHERE status =
  'conducting_conversation'` (schema line 3198). Paused rows leave that index by design.
- `reminder_sent_at TIMESTAMPTZ` already exists (schema line 270) and is used by the existing 2h
  stale reminder — so a **separate** column is needed for the evening ping, or the two would
  clobber each other.
- `can_resume BOOLEAN DEFAULT TRUE` exists in `bot/database/migrations/003_classroom_coaching.sql`
  but is **referenced nowhere in bot code**. Deliberately left alone: repurposing a dormant column
  whose original meaning is undocumented is worse than adding a named one.
- Reflective answers live in `conversation_state.questions[]`, written per-turn
  (`reflective-conversation.service.js:237-256`), with `questions_answered` maintained alongside
  (line 288). **This is why pausing loses nothing.**
- `NUM_REFLECTIVE_QUESTIONS` gates completion (line 301) — the "of 4" in the prompt.

### Recommendation, defended against sprawl

Three nullable columns on an existing table. No new table, no view.

| Column | Why not reuse something? |
|---|---|
| `paused_at` | `updated_at` is bumped by every write, so it cannot mean "when did the pause start". |
| `pause_reason` | Diagnostics: which service pulled her away. Nothing else records it. |
| `evening_reminder_sent_at` | `reminder_sent_at` is already owned by the 2h stale reminder. Sharing it would make one ping suppress the other. |

### Migration

```sql
-- V1.0.12__coaching_pause.sql
-- bd-2508 follow-up: pause a coaching reflection instead of abandoning it.
--
-- Additive only: three nullable columns, no default backfill, no existing row
-- written. `status = 'paused'` is a new VALUE, not a schema change — there is no
-- CHECK constraint on coaching_sessions.status (verified live 2026-08-04).
--
-- Shared DB (prod/staging/QA share one Postgres): applying this is global.
-- Idempotent — safe to re-run.
-- UP ------------------------------------------------------------------------
ALTER TABLE coaching_sessions
  ADD COLUMN IF NOT EXISTS paused_at                TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pause_reason             TEXT,
  ADD COLUMN IF NOT EXISTS evening_reminder_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN coaching_sessions.paused_at IS
  'When a conducting_conversation session was paused because the teacher switched '
  'to another service (bd-2508 follow-up). NULL unless status = ''paused''. Distinct '
  'from updated_at, which every write bumps.';

COMMENT ON COLUMN coaching_sessions.pause_reason IS
  'Why the session paused, e.g. ''switched_to:/video''. Diagnostics only.';

COMMENT ON COLUMN coaching_sessions.evening_reminder_sent_at IS
  'When the 20:00-22:00 Asia/Karachi nudge was sent for this pause. Separate from '
  'reminder_sent_at, which the 2h stale reminder owns — sharing one column would '
  'make either ping suppress the other. Cleared on resume.';

-- Paused-session lookup for the evening cron. Partial: only rows awaiting a ping.
CREATE INDEX IF NOT EXISTS idx_coaching_sessions_paused_pending
  ON coaching_sessions (paused_at)
  WHERE status = 'paused' AND evening_reminder_sent_at IS NULL;

-- PostgREST schema-cache reload (house convention — keep last).
NOTIFY pgrst, 'reload schema';

-- DOWN ----------------------------------------------------------------------
-- DROP INDEX IF EXISTS idx_coaching_sessions_paused_pending;
-- UPDATE coaching_sessions SET status = 'abandoned' WHERE status = 'paused';
-- ALTER TABLE coaching_sessions
--   DROP COLUMN IF EXISTS paused_at,
--   DROP COLUMN IF EXISTS pause_reason,
--   DROP COLUMN IF EXISTS evening_reminder_sent_at;
-- NOTIFY pgrst, 'reload schema';
```

⚠️ Per `infrastructure/CLAUDE.md`, a column added to an existing table must ALSO go in the
column-reconcile `ALTER … ADD COLUMN IF NOT EXISTS` section at the bottom of
`00_complete-schema.sql`, keeping the trailing `NOTIFY pgrst` last — otherwise a fresh install
lacks the columns and the `column-completeness` guard fails. **T1.2.4 must do both.**

---

## 10. Railway

`N/A — no new env var.` The evening reminder rides the existing `stale-session.worker.js` cron
service (already deployed, 15-minute schedule) and hard-codes the `Asia/Karachi` window, matching
the house convention used by `attendance-bigquery-export.worker.js`. No service is added and no
value needs provisioning.

If the operator later wants the window tunable, add `COACHING_EVENING_REMINDER_HOURS="20-22"` to
the cron service only, defaulting to 20–22 when unset — a no-op until set.

---

## 11. Rollout, verification & soak

1. **T1.1.1** — capture RED.
2. **Migration** (T1.2.4) → verify columns + the `00_complete-schema.sql` reconcile section, fresh
   operator "go" first.
3. **Staging deploy** → confirm the container **restarted after the push** and the new branch is in
   the deployed code. A failed build keeps the old deploy serving; process-start-after-push is the
   only valid success signal.
4. **Smoke, in this order** (each is a real WhatsApp round trip on staging):
   - Start a coaching session, reach question 2, send `/video` → prompt names "a video" and "2 of 4".
   - Reply `NO` → question 2 is re-asked, status still `conducting_conversation`.
   - Send `/video` again, reply `YES` → status `paused`, the video flow starts.
   - **Trap check:** new session to question 2, send `/menu` → menu arrives, status UNCHANGED.
   - **Digit check:** reply `2` → the menu choice runs, NOT stored as an answer.
   - **Answer check:** new session, send a bare `2` with no menu pending → stored as the answer.
   - Reply `RESUME` on a paused session → next question arrives.
5. **Cron check:** run the worker manually at 19:59 Karachi (no send) and 20:05 (one send), then
   again (no second send).
6. **Auto-complete check:** seed a `paused` row idle 13h, run the worker, confirm it is NOT
   auto-completed.
7. **Soak 48h on staging**, then fresh operator "go" → cherry-pick to main → verify every prod
   service rebooted onto the new build.

---

## 12. Inventory & "what we were wrong about"

| Assumption | Verified live? |
|---|---|
| Slash command sets `abandoned` at handler:1276 | Yes — read the code 2026-08-04 |
| Answers survive in `conversation_state.questions` | Yes — written per-turn, service lines 237-256 |
| `/menu` needs a follow-up digit | Yes — `menu.service.js:53` sets `AWAITING_MENU_CHOICE` |
| Coaching block runs BEFORE the menu handler | Yes — line ~1248 vs line 2275 |
| Bare `1`-`4` is rare as a real answer | Yes — 5 of 7,644 (0.065%), `RUMI_DB` 2026-08-04 |
| No CHECK constraint on `status` | Yes — absent from `00_complete-schema.sql` |
| `stale-session.worker.js` auto-completes at 12h | Yes — worker lines 130-136 |
| A cron service already exists | Yes — Railway cron, every 15 min, per the worker header |
| `can_resume` column is unused in bot code | Yes — only in `003_classroom_coaching.sql` |
| `NUM_REFLECTIVE_QUESTIONS` value | Yes — it is **1**, not 4 (`coaching-debrief.config.js:31`, "one reflection question per observation, was 3"). The service imports it; no literal anywhere. |
| Cron schedule location | **Configured in the Railway dashboard, not in the repo** — no `stale-session` reference in `railpack.json`, `bot/railway.json`, `infrastructure/railway/`, or `docs/railway-operations.md`. The worker header states "every 15 minutes via Railway Cron". T2.1.1 must confirm the live schedule in the Railway UI before relying on the window logic. |

**What we were wrong about (corrected during planning, 2026-08-04):**

1. **First proposed confirming on ALL slash commands, including `/menu`.** That would have partly
   rebuilt the 269-hour trap — `/menu` is the documented escape hatch. Operator chose to exempt
   `/menu` and `/help` and keep the session alive; the digit exemption is what makes that actually
   work.
2. **Assumed exempting `/menu` was enough on its own.** It is not: `/menu` waits on a bare digit
   that this block would have eaten ~1,000 lines earlier. The original bd-2508 comment predicted
   exactly this. Hence §4 diff 3.
3. **Nearly missed that `paused` would be auto-completed.** `stale-session.worker.js` turns a 12h-idle
   session into a partial report. Without §4 diff 4, pausing would have silently produced the same
   data loss this change exists to prevent.
4. **Considered reusing `reminder_sent_at`** for the evening ping. It is already owned by the 2h
   stale reminder, so either ping would suppress the other. Separate column instead.
5. **Considered reusing the dormant `can_resume` column.** Left alone — its original semantics are
   undocumented, and overloading it would be sprawl disguised as thrift.
6. **Drafted the whole prompt around "2 of 4 questions".** Wrong — `NUM_REFLECTIVE_QUESTIONS` is
   **1** (`coaching-debrief.config.js:31`; it was 3, now one question per observation). "0 of 1
   questions" reads badly, so the prompt now imports the constant and switches phrasing at N=1.
   The plan's own §5 test asserts the shape and greps the source to forbid a hardcoded total —
   this is exactly the class of error a literal in a plan produces.
