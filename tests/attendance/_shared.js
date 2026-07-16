/**
 * Shared test helpers for attendance-router tests. Mirrors tests/hcp/_shared.js
 * with the invokeRoute target pointing at attendance.routes instead.
 */

function makeChain(tableName, tableStates) {
  const state = tableStates[tableName] || {};
  const record = {
    table: tableName,
    filters: {},
    orderCol: null,
    orderDir: null,
    insertRows: null,
    updateRow: null,
    upsertRow: null,
  };

  const chain = {};
  const filterRows = (rows) => {
    let out = rows;
    for (const [col, val] of Object.entries(record.filters)) {
      if (val && typeof val === 'object' && Array.isArray(val.in)) {
        out = out.filter((r) => val.in.includes(r[col]));
      } else if (val && typeof val === 'object' && 'gte' in val) {
        out = out.filter((r) => r[col] >= val.gte);
      } else if (val && typeof val === 'object' && 'lte' in val) {
        out = out.filter((r) => r[col] <= val.lte);
      } else {
        out = out.filter((r) => r[col] === val);
      }
    }
    if (record.orderCol) {
      const dir = record.orderDir === 'asc' ? 1 : -1;
      out = [...out].sort((a, b) => {
        const av = a[record.orderCol];
        const bv = b[record.orderCol];
        if (av === bv) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return av < bv ? -1 * dir : 1 * dir;
      });
    }
    return out;
  };

  const finalize = () => {
    if (state.error) return { data: null, error: state.error };

    if (record.upsertRow) {
      const rows = state.rows = state.rows || [];
      const conflictOn = record.upsertConflict || 'id';
      const conflictCols = conflictOn.split(',');
      const idx = rows.findIndex((r) => conflictCols.every((c) => r[c] === record.upsertRow[c]));
      if (idx >= 0) {
        Object.assign(rows[idx], record.upsertRow, { updated_at: new Date().toISOString() });
        return { data: rows[idx], error: null };
      }
      const inserted = {
        id: record.upsertRow.id || `mock-id-${Math.random().toString(36).slice(2, 10)}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...record.upsertRow,
      };
      rows.push(inserted);
      return { data: inserted, error: null };
    }

    if (record.insertRows) {
      const rows = record.insertRows.map((r) => ({
        id: r.id || `mock-id-${Math.random().toString(36).slice(2, 10)}`,
        created_at: r.created_at || new Date().toISOString(),
        updated_at: r.updated_at || new Date().toISOString(),
        ...r,
      }));
      (state.rows = state.rows || []).push(...rows);
      return { data: rows[0] || null, error: null };
    }

    if (record.updateRow) {
      const rows = filterRows(state.rows || []);
      for (const r of rows) Object.assign(r, record.updateRow, { updated_at: new Date().toISOString() });
      return { data: rows[0] || null, error: null };
    }

    const rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    const filtered = filterRows(rows);
    return { data: filtered[0] || null, error: null };
  };

  const finalizeMany = () => {
    if (state.error) return { data: null, error: state.error };
    if (record.upsertRow) {
      const { data } = finalize();
      return { data: [data], error: null };
    }
    if (record.insertRows) {
      const rows = record.insertRows.map((r) => ({
        id: r.id || `mock-id-${Math.random().toString(36).slice(2, 10)}`,
        created_at: r.created_at || new Date().toISOString(),
        updated_at: r.updated_at || new Date().toISOString(),
        ...r,
      }));
      (state.rows = state.rows || []).push(...rows);
      return { data: rows, error: null };
    }
    if (record.updateRow) {
      const rows = filterRows(state.rows || []);
      for (const r of rows) Object.assign(r, record.updateRow, { updated_at: new Date().toISOString() });
      return { data: rows, error: null };
    }
    const rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    return { data: filterRows(rows), error: null };
  };

  chain.select = jest.fn(() => chain);
  ['eq', 'neq', 'like', 'ilike', 'is'].forEach((m) => {
    chain[m] = jest.fn((col, val) => { record.filters[col] = val; return chain; });
  });
  chain.gte = jest.fn((col, val) => { record.filters[col] = { gte: val }; return chain; });
  chain.lte = jest.fn((col, val) => { record.filters[col] = { lte: val }; return chain; });
  chain.gt = jest.fn((col, val) => { record.filters[col] = { gt: val }; return chain; });
  chain.lt = jest.fn((col, val) => { record.filters[col] = { lt: val }; return chain; });
  chain.in = jest.fn((col, vals) => { record.filters[col] = { in: vals }; return chain; });
  chain.order = jest.fn((col, opts) => {
    record.orderCol = col;
    record.orderDir = opts && opts.ascending ? 'asc' : 'desc';
    return chain;
  });
  chain.limit = jest.fn(() => chain);
  chain.range = jest.fn(() => chain);
  chain.insert = jest.fn((rowOrRows) => {
    record.insertRows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
    return chain;
  });
  chain.update = jest.fn((row) => { record.updateRow = row; return chain; });
  chain.upsert = jest.fn((row, opts) => {
    record.upsertRow = row;
    record.upsertConflict = (opts && opts.onConflict) || 'id';
    return chain;
  });
  chain.maybeSingle = jest.fn(async () => finalize());
  chain.single = jest.fn(async () => finalize());
  chain.then = (resolve, reject) => Promise.resolve(finalizeMany()).then(resolve, reject);
  return chain;
}

function resetTableStates() { return {}; }

function installSupabaseMock(tableStates) {
  jest.doMock('../../dashboard/config/supabase', () => ({
    from: jest.fn((tbl) => makeChain(tbl, tableStates)),
    rpc: jest.fn().mockResolvedValue({ error: null }),
  }));
}

function findRoute(router, method, pathToFind) {
  for (const layer of router.stack) {
    if (!layer.route) continue;
    const p = layer.route.path;
    const methods = layer.route.methods || {};
    if (methods[method] && p === pathToFind) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  return null;
}

async function invokeRoute({
  method = 'get',
  path,
  userId = 'user-p',
  params = {},
  query = {},
  body = {},
}) {
  const routes = require('../../dashboard/routes/attendance.routes');
  const stack = findRoute(routes, method, path);
  if (!stack) throw new Error(`Route ${method.toUpperCase()} ${path} not found on attendance router`);

  const req = {
    session: userId ? { portalUserId: userId, id: 'sess-1' } : null,
    params,
    query,
    body,
    method: method.toUpperCase(),
    path,
    ip: '127.0.0.1',
    headers: {},
    get: () => undefined,
  };

  let statusCode = 200;
  let payload = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(b) { payload = b; return this; },
  };

  let advanced = true;
  for (const handler of stack) {
    if (!advanced) break;
    advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      const maybe = handler(req, res, () => { advanced = true; resolve(); });
      if (maybe && typeof maybe.then === 'function') {
        maybe.then(() => resolve(), () => resolve());
      } else if (advanced === false) {
        resolve();
      }
    });
  }
  return { statusCode, payload };
}

module.exports = { installSupabaseMock, invokeRoute, resetTableStates };
