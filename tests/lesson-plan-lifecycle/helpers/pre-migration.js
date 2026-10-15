'use strict';
/**
 * A database that has NOT had migration V1.6.4 (or only part of it): every insert / update / upsert that
 * carries a lifecycle column is refused the way PostgREST refuses an unknown column — PGRST204, nothing
 * written. Wraps an in-memory double's `from`; reads and every other write pass straight through.
 *
 *   mockDb.from.mockImplementation(withoutV164(original))                         // every table
 *   mockDb.from.mockImplementation(withoutV164(original, { tables: ['lesson_plans'] }))  // only these
 */

const LIFECYCLE_COLUMNS = Object.freeze({
  lesson_plan_requests: ['source', 'channel', 'region', 'grade', 'subject', 'artifact_ref', 'generated_at',
    'delivered_at', 'error_code', 'correlation_id'],
  lesson_plans: ['request_id'],
  niete_lp_downloads: ['request_id'],
  niete_lp612_deliveries: ['request_id'],
});

function refused(table, column) {
  const res = {
    data: null,
    count: null,
    error: { code: 'PGRST204', message: `Could not find the '${column}' column of '${table}' in the schema cache` },
  };
  const b = new Proxy({}, {
    get: (_, k) => {
      if (k === 'then') return (ok, bad) => Promise.resolve(res).then(ok, bad);
      if (k === 'single' || k === 'maybeSingle') return async () => res;
      return () => b;
    },
  });
  return b;
}

function offendingColumn(table, payload) {
  const cols = LIFECYCLE_COLUMNS[table];
  if (!cols) return null;
  for (const row of (Array.isArray(payload) ? payload : [payload])) {
    for (const c of cols) if (row && Object.prototype.hasOwnProperty.call(row, c)) return c;
  }
  return null;
}

function withoutV164(from, { tables = Object.keys(LIFECYCLE_COLUMNS) } = {}) {
  const refusing = new Set(tables);
  return (table) => {
    const b = from(table);
    if (!refusing.has(table)) return b;
    const guard = (op) => (payload, ...rest) => {
      const column = offendingColumn(table, payload);
      return column ? refused(table, column) : b[op](payload, ...rest);
    };
    return new Proxy(b, { get: (t, k) => (k === 'insert' || k === 'update' || k === 'upsert' ? guard(k) : t[k]) });
  };
}

module.exports = { withoutV164, LIFECYCLE_COLUMNS };
