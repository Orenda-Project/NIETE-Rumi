'use strict';
/**
 * A tiny in-memory stand-in for the Supabase client.
 *
 * Hand-rolled chain mocks (`select: () => ({ eq: () => ({ ... }) })`) test the
 * shape of the calls rather than the behaviour of the code, and they go stale
 * silently the moment a filter is added. This fake stores rows and actually
 * applies the filters, so a test asserting "the mirror row was reused rather
 * than duplicated" is asserting something real.
 *
 * Supports only what this codebase's services use:
 *   .from(t).select(cols).eq(c,v).in(c,vals).is(c,null).not(c,'is',null)
 *            .order(c,{ascending}).limit(n).maybeSingle() / .single()
 *   .from(t).insert(rowOrRows).select().single()
 *   .from(t).update(patch).eq(c,v)
 *   .from(t).upsert(rowOrRows)
 * A builder is thenable, so `await` without a terminal works like PostgREST.
 */

let idCounter = 0;
function nextId(table) {
  idCounter += 1;
  return `${table}-${idCounter}`;
}

function matches(row, filters) {
  return filters.every(([kind, col, val]) => {
    if (kind === 'eq') return row[col] === val;
    if (kind === 'in') return val.includes(row[col]);
    if (kind === 'isNull') return row[col] === null || row[col] === undefined;
    if (kind === 'notNull') return row[col] !== null && row[col] !== undefined;
    return true;
  });
}

function createFakeSupabase(seed = {}, opts = {}) {
  /** table → rows */
  const tables = {};
  for (const [name, rows] of Object.entries(seed)) {
    tables[name] = rows.map((r) => ({ ...r }));
  }

  /** Tables whose next operation should fail, e.g. { classes: 'boom' }. */
  const failures = { ...(opts.failOn || {}) };

  /** RPCs whose next call should fail, e.g. { roster_import_students: { code: '55P03' } }. */
  const rpcFailures = { ...(opts.failRpc || {}) };

  /** Every rpc call, in order — so a test can assert the write was ONE call. */
  const rpcCalls = [];

  /** Every write, in order — so a test can assert what was actually written. */
  const writes = [];

  function table(name) {
    if (!tables[name]) tables[name] = [];
    return tables[name];
  }

  function builder(name) {
    const filters = [];
    let mode = 'select';
    let payload = null;
    let order = null;
    let limitN = null;

    const fail = () => (failures[name] ? { data: null, error: { message: failures[name] } } : null);

    function resolveRows() {
      const failed = fail();
      if (failed) return failed;

      if (mode === 'insert' || mode === 'upsert') {
        const incoming = Array.isArray(payload) ? payload : [payload];
        const inserted = incoming.map((r) => ({ id: r.id || nextId(name), ...r }));
        for (const row of inserted) {
          if (mode === 'upsert') {
            // Crude but sufficient: replace a row sharing every key of the payload
            // except timestamps. Real upsert conflict targets are not modelled.
            const existing = table(name).find((e) => Object.keys(r0Keys(row)).every((k) => e[k] === row[k]));
            if (existing) {
              Object.assign(existing, row);
              continue;
            }
          }
          table(name).push(row);
        }
        writes.push({ table: name, op: mode, rows: inserted });
        return { data: inserted, error: null };
      }

      if (mode === 'delete') {
        const hit = table(name).filter((r) => matches(r, filters));
        const keep = table(name).filter((r) => !matches(r, filters));
        tables[name] = keep;
        writes.push({ table: name, op: 'delete', count: hit.length });
        return { data: hit, error: null };
      }

      if (mode === 'update') {
        const hit = table(name).filter((r) => matches(r, filters));
        for (const row of hit) Object.assign(row, payload);
        writes.push({ table: name, op: 'update', patch: payload, count: hit.length });
        return { data: hit, error: null };
      }

      let rows = table(name).filter((r) => matches(r, filters));
      if (order) {
        const { col, ascending } = order;
        rows = [...rows].sort((a, b) => {
          if (a[col] === b[col]) return 0;
          const cmp = a[col] > b[col] ? 1 : -1;
          return ascending ? cmp : -cmp;
        });
      }
      if (limitN !== null) rows = rows.slice(0, limitN);
      return { data: rows, error: null };
    }

    function r0Keys(row) {
      const { id, created_at: _c, updated_at: _u, ...rest } = row;
      return rest;
    }

    const api = {
      select() { if (mode === 'select') mode = 'select'; return api; },
      insert(p) { mode = 'insert'; payload = p; return api; },
      upsert(p) { mode = 'upsert'; payload = p; return api; },
      update(p) { mode = 'update'; payload = p; return api; },
      delete() { mode = 'delete'; return api; },  // removes matching rows, see resolveRows
      eq(col, val) { filters.push(['eq', col, val]); return api; },
      in(col, vals) { filters.push(['in', col, vals]); return api; },
      is(col) { filters.push(['isNull', col, null]); return api; },
      not(col) { filters.push(['notNull', col, null]); return api; },
      order(col, o = {}) { order = { col, ascending: o.ascending !== false }; return api; },
      limit(n) { limitN = n; return api; },
      async maybeSingle() {
        const res = resolveRows();
        if (res.error) return res;
        return { data: res.data.length ? res.data[0] : null, error: null };
      },
      async single() {
        const res = resolveRows();
        if (res.error) return res;
        if (res.data.length !== 1) {
          // PostgREST answers PGRST116 when a single-object read matches 0 or >1.
          return { data: null, error: { code: 'PGRST116', message: 'not exactly one row' } };
        }
        return { data: res.data[0], error: null };
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve(resolveRows()).then(onFulfilled, onRejected);
      },
    };
    return api;
  }

  /**
   * Faithful in-memory twin of bot/database/migrations/roster_import_students.sql.
   * The SQL is the truth; this mirrors its OBSERVABLE contract (normalise, in-payload
   * first-occurrence, run-id replay guard, committed-state dedupe by roll-else-name,
   * bulk insert with provenance, list count maintenance) so behavioural tests stay
   * meaningful. The lock itself is proven on the staging DB, not here.
   */
  function rosterImportStudents({ p_class_id, p_list_id, p_run_id, p_enrolled_by, p_students, p_school_id = null }) {
    const students = table('students');
    const enrollments = table('class_enrollments');

    const named = [];
    const seenRolls = new Set();
    const seenNames = new Set();
    for (const raw of p_students || []) {
      const name = String(raw.student_name || '').trim();
      if (!name) continue;
      const rollStr = raw.roll_number === null || raw.roll_number === undefined ? '' : String(raw.roll_number).trim();
      const roll = /^\d{1,3}$/.test(rollStr) ? Number(rollStr) : null;
      const dupInPayload = roll !== null ? seenRolls.has(roll) : seenNames.has(name.toLowerCase());
      if (roll !== null) seenRolls.add(roll); else seenNames.add(name.toLowerCase());
      named.push(dupInPayload ? null : {
        student_name: name,
        father_name: (raw.father_name && String(raw.father_name).trim()) || null,
        parent_phone: (raw.parent_phone && String(raw.parent_phone).trim()) || null,
        admission_no: (raw.admission_no && String(raw.admission_no).trim()) || null,
        date_of_birth: (raw.date_of_birth && String(raw.date_of_birth).trim()) || null,
        roll,
      });
    }

    if (students.some((s) => s.import_run_id === p_run_id)) {
      return { added: 0, skipped: named.length, replay: true };
    }

    const active = enrollments.filter((e) => e.class_id === p_class_id && e.is_active);
    const takenRolls = new Set(active.map((e) => e.roll_number).filter((r) => r !== null && r !== undefined));
    const activeIds = new Set(active.map((e) => e.student_id));
    const takenNames = new Set(students
      .filter((s) => activeIds.has(s.id))
      .map((s) => String(s.student_name || '').trim().toLowerCase()));

    let added = 0;
    for (const v of named) {
      if (!v) continue;
      const hit = v.roll !== null ? takenRolls.has(v.roll) : takenNames.has(v.student_name.toLowerCase());
      if (hit) continue;

      // RECOGNITION (mirrors the SQL): same school + same admission number is
      // the SAME child — enrol her here, fill her blanks, never duplicate or
      // overwrite.
      if (p_school_id && v.admission_no) {
        const known = students.find((s) => s.school_id === p_school_id
          && s.admission_no === v.admission_no
          && (s.status || 'active') === 'active' && s.is_active !== false);
        if (known) {
          const enrolledHere = enrollments.some((e) => e.class_id === p_class_id
            && e.student_id === known.id && e.is_active);
          if (!enrolledHere) {
            if (!known.father_name && v.father_name) known.father_name = v.father_name;
            if (!known.parent_phone && v.parent_phone) known.parent_phone = v.parent_phone;
            if (!known.date_of_birth && v.date_of_birth) known.date_of_birth = v.date_of_birth;
            enrollments.push({
              id: nextId('class_enrollments'), class_id: p_class_id, student_id: known.id,
              roll_number: v.roll, enrolled_on: new Date().toISOString().slice(0, 10), is_active: true,
            });
            if (v.roll !== null) takenRolls.add(v.roll); else takenNames.add(v.student_name.toLowerCase());
            added += 1;
          }
          continue;
        }
      }

      const id = nextId('students');
      students.push({
        id, student_name: v.student_name, father_name: v.father_name,
        parent_phone: v.parent_phone, roll_number: v.roll, list_id: p_list_id,
        enrolled_by_user_id: p_enrolled_by, import_run_id: p_run_id, is_active: true,
        school_id: p_school_id, admission_no: v.admission_no,
        date_of_birth: v.date_of_birth, status: 'active',
      });
      enrollments.push({
        id: nextId('class_enrollments'), class_id: p_class_id, student_id: id,
        roll_number: v.roll, enrolled_on: new Date().toISOString().slice(0, 10), is_active: true,
      });
      if (v.roll !== null) takenRolls.add(v.roll); else takenNames.add(v.student_name.toLowerCase());
      added += 1;
    }

    if (p_list_id) {
      const list = table('student_lists').find((l) => l.id === p_list_id);
      if (list) list.student_count = students.filter((s) => s.list_id === p_list_id && s.is_active).length;
    }
    return { added, skipped: named.length - added, replay: false };
  }

  return {
    from: (name) => builder(name),
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      if (rpcFailures[name]) return { data: null, error: rpcFailures[name] };
      if (name === 'roster_import_students') return { data: rosterImportStudents(args || {}), error: null };
      return { data: null, error: { code: 'PGRST202', message: `unknown rpc ${name}` } };
    },
    /** Test helpers — not part of the Supabase surface. */
    _tables: tables,
    _writes: writes,
    _rpcCalls: rpcCalls,
    _failOn: (t, msg) => { failures[t] = msg; },
    _failRpc: (name, errObj) => { rpcFailures[name] = errObj; },
    _clearFailures: () => {
      for (const k of Object.keys(failures)) delete failures[k];
      for (const k of Object.keys(rpcFailures)) delete rpcFailures[k];
    },
  };
}

module.exports = { createFakeSupabase };
