'use strict';
/**
 * PostgREST's aliased jsonb path in a select (`story_book:meta->story->>book_id`) over the shared in-memory Supabase,
 * which answers whole rows and ignores the column list: this wraps it so each answered row also carries the alias the
 * way PostgREST would (`->` keeps the json, `->>` the text; a missing key → null), and records every select's columns
 * ({ table, cols }) so a test can check the query itself. Every other call goes to the fake as it is.
 */
const PATH_RX = /^(\w+):(\w+)((?:->>?\w+)+)$/;

function pathsOf(cols) {
  return String(cols || '').split(',').map((c) => PATH_RX.exec(c.trim())).filter(Boolean).map((m) => ({
    alias: m[1], col: m[2], steps: [...m[3].matchAll(/(->>?)(\w+)/g)].map((s) => ({ text: s[1] === '->>', key: s[2] })),
  }));
}
function valueOf(row, p) {
  let v = row[p.col];
  let text = false;
  for (const s of p.steps) { v = v && typeof v === 'object' && v[s.key] != null ? v[s.key] : null; text = s.text; }
  return v == null ? null : (text ? String(v) : v);
}
const project = (data, paths) => {
  const one = (r) => (r && typeof r === 'object' ? paths.reduce((o, p) => ({ ...o, [p.alias]: valueOf(r, p) }), r) : r);
  return Array.isArray(data) ? data.map(one) : one(data);
};

/** → a client over `supabase` (read at call time, so a re-seeded fake is used) with `.selects`. */
function jsonPathSelect(supabase) {
  const selects = [];
  return {
    selects,
    rpc: (...a) => supabase.rpc(...a),
    from(table) {
      const b = supabase.from(table);
      let paths = [];
      const select = b.select;
      b.select = (cols, opts) => { selects.push({ table, cols }); paths = pathsOf(cols); return select.call(b, cols, opts); };
      const then = b.then;
      b.then = (res, rej) => then.call(b, (out) => res(out && out.data && paths.length ? { ...out, data: project(out.data, paths) } : out), rej);
      return b;
    },
  };
}

module.exports = { jsonPathSelect };
