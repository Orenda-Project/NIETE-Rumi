'use strict';
/**
 * The teacher-nudges store as the lp_v8 offer suites need it: an in-memory
 * table with the UNIQUE (user_id, nudge_date, kind) the migration declares,
 * and the conditional `quiz_id is null` claim — because "the second build is a
 * no-op" and "a double tap queues once" are exactly what those two buy.
 *
 * The store's own suite exercises its supabase chains; these suites exercise
 * the offer service against the store's contract, so a store mock that honoured
 * neither guard would let a double-send pass here.
 *
 * `storeFacade(get)` is the jest.mock factory body: static values are real
 * values (the sweeper reads `KINDS` at load, before any beforeEach has run),
 * functions are getters onto whichever store the current test installed.
 */

const RealStore = jest.requireActual('../../../bot/shared/services/nudges/teacher-nudges.store');

const { SKIP_REASONS, KINDS, STATUS, DEFAULT_CLAIM_LIMIT, STUCK_MINUTES, TABLE } = RealStore;
const CHOICE_RE = /^(yes|no|ignored|class:[A-Za-z0-9_]+)$/;

/** An in-memory teacher_nudges honouring the one-per-user-per-day UNIQUE. */
function makeStore(seed = []) {
  const rows = seed.map((r) => ({ status: 'pending', context: {}, quiz_id: null, ...r }));
  let n = rows.length;
  const key = (r) => `${r.user_id}|${r.nudge_date}|${r.kind}`;
  const find = (id) => rows.find((r) => r.id === id) || null;
  const api = {
    rows,
    SKIP_REASONS,
    schedule: jest.fn(async ({ userId, kind, nudgeDate, scheduledAt, context }) => {
      const existing = rows.find((r) => key(r) === `${userId}|${nudgeDate}|${kind}`);
      if (existing) return { row: existing, created: false };
      n += 1;
      const row = {
        id: `nudge-${n}`,
        user_id: userId,
        kind,
        nudge_date: nudgeDate,
        status: 'pending',
        scheduled_at: new Date(scheduledAt).toISOString(),
        sent_at: null,
        answered_at: null,
        choice: null,
        quiz_id: null,
        context: context || {},
        created_at: new Date().toISOString(),
      };
      rows.push(row);
      return { row, created: true };
    }),
    markSkipped: jest.fn(async (id, reason, extra = {}) => {
      if (!SKIP_REASONS.includes(reason)) throw new Error(`unknown skip reason: ${reason}`);
      const row = find(id);
      if (row) {
        row.status = 'skipped';
        row.context = { ...(row.context || {}), ...extra, skip_reason: reason };
      }
      return Boolean(row);
    }),
    markSent: jest.fn(async (id, { messageIds, context } = {}) => {
      const row = find(id);
      if (row) {
        row.status = 'sent';
        row.sent_at = new Date().toISOString();
        row.context = { ...(row.context || {}), ...(context || {}), message_ids: messageIds || [] };
      }
      return Boolean(row);
    }),
    markFailed: jest.fn(async (id, error) => {
      const row = find(id);
      if (row) { row.status = 'failed'; row.context = { ...(row.context || {}), error: String(error && error.message ? error.message : error) }; }
      return Boolean(row);
    }),
    recordAnswer: jest.fn(async (id, { choice, quizId } = {}) => {
      if (!CHOICE_RE.test(String(choice))) throw new Error(`unknown choice: ${choice}`);
      const row = find(id);
      if (row) {
        row.choice = choice;
        row.answered_at = new Date().toISOString();
        if (quizId) row.quiz_id = quizId;
      }
      return Boolean(row);
    }),
    claimQuiz: jest.fn(async (id, quizId) => {
      const row = find(id);
      if (!row || row.quiz_id) return false;
      row.quiz_id = quizId;
      return true;
    }),
    byId: jest.fn(async (id) => find(id)),
    rowsFor: jest.fn(async (userId, { kind, fromDate, toDate } = {}) => rows.filter((r) => r.user_id === userId
      && (!kind || r.kind === kind)
      && (!fromDate || r.nudge_date >= fromDate)
      && (!toDate || r.nudge_date <= toDate))),
    todayRow: jest.fn(async (userId, kind, nudgeDate) => rows.find((r) => key(r) === `${userId}|${nudgeDate}|${kind}`) || null),
    claimDue: jest.fn(async ({ kind } = {}) => {
      const won = rows.filter((r) => r.kind === kind && r.status === 'pending');
      for (const r of won) r.status = 'sending';
      return won;
    }),
    expireStuck: jest.fn(async () => 0),
  };
  return api;
}

const FUNCTIONS = ['schedule', 'markSkipped', 'markSent', 'markFailed', 'recordAnswer', 'claimQuiz',
  'byId', 'rowsFor', 'todayRow', 'claimDue', 'expireStuck'];

function storeFacade(get) {
  const facade = { SKIP_REASONS, KINDS, STATUS, DEFAULT_CLAIM_LIMIT, STUCK_MINUTES, TABLE };
  for (const name of FUNCTIONS) {
    Object.defineProperty(facade, name, { enumerable: true, get: () => get()[name] });
  }
  return facade;
}

module.exports = { makeStore, storeFacade, SKIP_REASONS };
