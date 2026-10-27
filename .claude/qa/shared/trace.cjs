/* trace.cjs — the span emitter behind the mock lane's profiling (bd-5zzbvq).
 *
 * One JSON line per finished span, appended to E2E_TRACE_FILE (set per feature by run-suite.sh to
 * <run_dir>/trace-<feature>.jsonl). Nothing is buffered, nothing is awaited, and a write failure is
 * swallowed — a profiler must never fail, slow or reorder the run it measures.
 *
 *   { v, run, feature, span, parent, name, layer, kind, t0, t1, ms, status, attrs }
 *
 *   layer  where the time was spent: scenario · harness · wait · mock · bot · flow · harness-db
 *   kind   what sort of time it is:  primitive · intentional · http · processing · polling · seed · scenario
 *
 * A scenario is recorded at its END from the duration the driver already measures (rec(id, …, ms)),
 * so no feature script changes: the profiler attributes primitives to scenarios by time window.
 */
'use strict';
const fs = require('fs');
const path = require('path');

function createTracer(opts = {}) {
  const file = opts.file !== undefined ? opts.file : process.env.E2E_TRACE_FILE;
  const enabled = !!file;
  const run = opts.run || process.env.RUN_ID || (process.env.RUN_DIR ? path.basename(process.env.RUN_DIR) : null);
  const feature = opts.feature || null;
  const now = opts.now || Date.now;
  let n = 0;
  const nextId = () => `${process.pid.toString(36)}-${(++n).toString(36)}`;
  const write = (row) => {
    if (!enabled) return;
    try { fs.appendFileSync(file, JSON.stringify(row) + '\n'); } catch (_) { /* never fail the run over a trace line */ }
  };
  const row = (base) => ({ v: 1, run, feature, ...base });

  function span(name, o = {}) {
    const id = nextId();
    const parent = o.parent ? (typeof o.parent === 'string' ? o.parent : o.parent.id) : null;
    const t0 = o.t0 != null ? o.t0 : now();
    const attrs = { ...(o.attrs || {}) };
    let done = false;
    const h = {
      id, name, t0,
      /** Add attributes before end() — e.g. the message id once the inject answers. */
      set(more) { Object.assign(attrs, more || {}); return h; },
      end(status = 'ok', more) {
        if (done) return h; done = true;
        const t1 = o.t1 != null ? o.t1 : now();
        Object.assign(attrs, more || {});
        write(row({ span: id, parent, name, layer: o.layer || 'harness', kind: o.kind || 'primitive', t0, t1, ms: t1 - t0, status: String(status), attrs }));
        return h;
      },
      /** A span with KNOWN bounds (from another process's clock, e.g. the mock's outbox timestamps). */
    };
    return h;
  }
  /** A span whose bounds are already known — written at once. */
  function fixed(name, t0, t1, o = {}) {
    const s = span(name, { ...o, t0, t1 });
    return s.end(o.status || 'ok');
  }
  /** The scenario row: ended now, started `ms` ago — the runner has no start hook and needs none. */
  function scenario(id, o = {}) {
    const t1 = o.t1 != null ? o.t1 : now();
    const ms = Number(o.ms || 0);
    write(row({ span: nextId(), parent: null, name: 'scenario', layer: 'scenario', kind: 'scenario', t0: t1 - ms, t1, ms,
      status: String(o.verdict || 'UNKNOWN'), attrs: { id, title: o.title || null, ...(o.attrs || {}) } }));
  }
  function event(name, o = {}) {
    const t = now();
    write(row({ span: nextId(), parent: o.parent ? (typeof o.parent === 'string' ? o.parent : o.parent.id) : null, name,
      layer: o.layer || 'harness', kind: o.kind || 'event', t0: t, t1: t, ms: 0, status: 'ok', attrs: o.attrs || {} }));
  }
  return { enabled, file, run, feature, span, fixed, scenario, event };
}

/** A tracer that writes nothing — what makeMockApi gets when no tracer is passed. */
const NOOP = createTracer({ file: '' });

module.exports = { createTracer, NOOP };
