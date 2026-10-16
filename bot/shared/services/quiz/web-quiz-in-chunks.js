'use strict';
/**
 * `.in()` on a list that can grow: at most IN_CHUNK ids per request.
 *
 * PostgREST echoes the whole query into the Content-Location response header, and Node's fetch caps response headers at
 * 16 KB, so a supabase-js `.in()` holding more than ~390 UUIDs fails the request ("TypeError: fetch failed", cause
 * UND_ERR_HEADERS_OVERFLOW) after four retries (~9 s) — to the caller, a silent empty read. This is the one home for the
 * rule: every read whose id list is data-sized goes through here.
 *
 *   inChunks(make, column, ids, size = IN_CHUNK)  make() builds a FRESH query each time (select + its other filters; a
 *                                               supabase-js builder is single-use); each chunk runs `make().in(column,
 *                                               chunk)`; the rows come back concatenated in chunk order. A `.limit()`
 *                                               inside make() caps each chunk, not the whole. An empty list makes no
 *                                               request and returns []. An error on any chunk throws (as the callers'
 *                                               own rows() helpers do), so a partial read never passes as a whole one.
 *   chunks(ids, size)                           the list in slices of at most `size`.
 */
const IN_CHUNK = 200;

function chunks(ids, size = IN_CHUNK) {
  const list = Array.isArray(ids) ? ids : [];
  const n = Math.max(1, Number(size) || IN_CHUNK);
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

async function inChunks(make, column, ids, size = IN_CHUNK) {
  const out = [];
  for (const part of chunks(ids, size)) {
    const { data, error } = await make().in(column, part);
    if (error) throw new Error(error.message || 'read failed');
    if (Array.isArray(data)) out.push(...data);
  }
  return out;
}

module.exports = { inChunks, chunks, IN_CHUNK };
