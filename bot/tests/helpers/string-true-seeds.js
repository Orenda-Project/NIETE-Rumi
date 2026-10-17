'use strict';
/**
 * Finds test code that seeds a switch key as the string "true" ('true', "true", '"true"', ' TRUE ') instead of the JSON
 * boolean. Used by switch-seeds-are-booleans (bot and portal) with the readers-agree key list.
 *
 * A light lexer, no parser: comments and the text inside strings are never code. A string "true" is a seed of key K
 * when, inside the same innermost bracket ({...}, [...] or (...)), it sits next to the literal 'K', a property
 * `K: 'true'`, or a `key` property (or the first item of a pair) whose value names K: a constant, a list (spreads
 * followed), a module key map (`Mod.KEYS.hub`), the parameter of `LIST.map(...)` (chains like `L.filter(..).map(..)`
 * followed), or the parameter of a row helper `const F = (k) => ({ key: k, value: 'true' })`, which is then reported
 * at each call `F('K')` / `F(LIST)` / `LIST.map(F)`. A comparison (`=== 'true'`) is a read, not a seed.
 * A seed is left alone when the name of its test says it checks the string: a test, describe or table-row label
 * containing "the string" (for a row helper: the name at the call).
 */
const fs = require('fs');
const path = require('path');

const STRICT_NAME = /the string/i;
const TEST_FNS = new Set(['test', 'it', 'describe', 'xit', 'xtest', 'fit', 'xdescribe', 'fdescribe']);
const COMPARE = new Set(['===', '!==', '==', '!=']);
const REGEX_BEFORE = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '=>', '&&', '||', 'return', 'typeof']);
const LIST_CALLS = new Set(['map', 'forEach', 'flatMap', 'filter', 'some', 'every', 'reduce']);

const isStringTrue = (v) => v.trim().replace(/^(["'])(.*)\1$/, '$2').trim().toLowerCase() === 'true';

/** Tokens: { t: 'str'|'id'|'punc', v, line, open?, close?, parent }. */
function lex(src) {
  const toks = [];
  let i = 0;
  let line = 1;
  const n = src.length;
  const push = (t, v, ln) => toks.push({ t, v, line: ln });
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      for (let j = i; j < stop; j++) if (src[j] === '\n') line++;
      i = stop;
      continue;
    }
    if (c === '\'' || c === '"') {
      const ln = line;
      let v = '';
      i++;
      while (i < n && src[i] !== c && src[i] !== '\n') {
        if (src[i] === '\\') { v += src[i + 1] === undefined ? '' : src[i + 1]; i += 2; continue; }
        v += src[i++];
      }
      i++;
      push('str', v, ln);
      continue;
    }
    if (c === '`') {
      const ln = line;
      let v = '';
      i++;
      while (i < n && src[i] !== '`') {
        if (src[i] === '\\') { v += src[i + 1] || ''; i += 2; continue; }
        if (src[i] === '$' && src[i + 1] === '{') {
          let depth = 1;
          v += '${';
          i += 2;
          while (i < n && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            if (src[i] === '\n') line++;
            if (depth > 0) v += src[i];
            i++;
          }
          v += '}';
          continue;
        }
        if (src[i] === '\n') line++;
        v += src[i++];
      }
      i++;
      push('str', v, ln);
      continue;
    }
    if (c === '/') {
      const prev = toks[toks.length - 1];
      if (!prev || (prev.t === 'punc' && REGEX_BEFORE.has(prev.v)) || (prev.t === 'id' && REGEX_BEFORE.has(prev.v))) {
        i++;
        let inClass = false;
        while (i < n && src[i] !== '\n') {
          if (src[i] === '\\') { i += 2; continue; }
          if (src[i] === '[') inClass = true;
          else if (src[i] === ']') inClass = false;
          else if (src[i] === '/' && !inClass) break;
          i++;
        }
        i++;
        while (i < n && /[a-z]/i.test(src[i])) i++;
        push('re', '', line);
        continue;
      }
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[\w$]/.test(src[j])) j++;
      push('id', src.slice(i, j), line);
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < n && /[\w.]/.test(src[j])) j++;
      push('num', src.slice(i, j), line);
      i = j;
      continue;
    }
    const three = src.slice(i, i + 3);
    const two = src.slice(i, i + 2);
    if (three === '===' || three === '!==' || three === '...') { push('punc', three, line); i += 3; continue; }
    if (['=>', '==', '!=', '&&', '||', '??', '?.'].includes(two)) { push('punc', two, line); i += 2; continue; }
    push('punc', c, line);
    i++;
  }
  // brackets: every token knows its innermost open bracket; an open bracket knows its close
  const stack = [];
  toks.forEach((tok, k) => {
    tok.parent = stack.length ? stack[stack.length - 1] : -1;
    if (tok.t !== 'punc') return;
    if (tok.v === '(' || tok.v === '[' || tok.v === '{') stack.push(k);
    else if (tok.v === ')' || tok.v === ']' || tok.v === '}') {
      const open = stack.pop();
      if (open !== undefined) { toks[open].close = k; tok.parent = toks[open].parent; tok.open = open; }
    }
  });
  return toks;
}

/** Index of the token that opens the bracket closed at `k`, or -1. */
const openOf = (toks, k) => (toks[k] && toks[k].open !== undefined ? toks[k].open : -1);

/** Names around `toks[at]` that become its test's full name: test/describe titles and table-row labels. */
function namesAround(toks, at) {
  const names = [];
  for (let p = toks[at].parent; p >= 0; p = toks[p].parent) {
    const open = toks[p];
    if (open.v === '(') {
      let k = p - 1;
      // test(...) / test.only(...) / test.each(table)(...)
      if (toks[k] && toks[k].v === ')') {
        const eachOpen = openOf(toks, k);
        if (eachOpen > 1 && toks[eachOpen - 1].v === 'each') k = eachOpen - 1;
      }
      while (toks[k] && toks[k].t === 'id' && toks[k - 1] && toks[k - 1].v === '.' && !TEST_FNS.has(toks[k].v)) k -= 2;
      if (toks[k] && toks[k].t === 'id' && TEST_FNS.has(toks[k].v)) {
        const first = toks[p + 1];
        if (first && first.t === 'str') names.push(first.v);
      }
      // inside a table: test.each([...rows])('title %s', fn) — the title and the row's own label
      if (toks[p - 1] && toks[p - 1].v === 'each') {
        const next = toks[open.close + 1];
        if (next && next.v === '(' && toks[open.close + 2] && toks[open.close + 2].t === 'str') names.push(toks[open.close + 2].v);
        const table = toks[p + 1];
        if (table && table.v === '[') {
          // the row = the outermost bracket under the table that holds `at`
          let row = at;
          while (row >= 0 && toks[row].parent !== p + 1) row = toks[row].parent;
          if (row >= 0 && toks[row].v === '[' && toks[row + 1] && toks[row + 1].t === 'str') names.push(toks[row + 1].v);
        }
      }
    }
  }
  return names;
}

/** Tokens directly inside the bracket opened at `p` (not inside nested brackets); p = -1: the file's top level. */
function members(toks, p) {
  const out = [];
  const end = p < 0 || toks[p].close === undefined ? toks.length : toks[p].close;
  for (let k = p + 1; k < end; k++) {
    if (toks[k].parent === p) out.push(k);
  }
  return out;
}

/** `const NAME = <init>`: the index of the first init token, or -1 (the first declaration in the file). */
function declOf(toks, name) {
  for (let k = 0; k + 2 < toks.length; k++) {
    if (['const', 'let', 'var'].includes(toks[k].v) && toks[k + 1].v === name && toks[k + 2].v === '=') return k + 3;
  }
  return -1;
}

/**
 * What a value names, as [{ key, at }] (`at` = the call whose test name decides, or null = the seed's own): a key
 * literal, a list literal, a constant or list (`const X = 'K'`, `const L = [..]`, spreads followed), a module key map
 * (`Mod.KEYS.hub` -> a key equal to web_quiz_hub or ending in _hub), the parameter of `LIST.map(...)` (chains such as
 * `L.filter(..).map(..)` followed), or the parameter of a row helper (then each call `F(value)` or `LIST.map(F)`).
 */
function resolveValue(toks, k, keys, seen) {
  const tok = toks[k];
  if (!tok) return [];
  if (tok.t === 'str') return keys.has(tok.v) ? [{ key: tok.v, at: null }] : [];
  if (tok.v === '[') return listKeys(toks, k, keys, seen);
  if (tok.t !== 'id') return [];
  if ((toks[k + 1] || {}).v === '.' && (toks[k - 1] || {}).v !== '.') {
    let j = k;
    while ((toks[j + 1] || {}).v === '.' && (toks[j + 2] || {}).t === 'id') j += 2;
    if (j === k || (toks[j + 1] || {}).v === '(') return [];
    const last = toks[j].v.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
    const exact = `web_quiz_${last}`;
    if (keys.has(exact)) return [{ key: exact, at: null }];
    const tail = [...keys].filter((key) => key.endsWith(`_${last}`)).sort();
    return tail.length ? [{ key: tail[0], at: null }] : [];
  }
  return resolveIdent(toks, k, keys, seen);
}

function resolveIdent(toks, k, keys, seen) {
  const name = toks[k].v;
  if (seen.has(name)) return [];
  seen.add(name);
  const out = [];
  const init = declOf(toks, name);
  if (init >= 0) out.push(...resolveValue(toks, init, keys, seen));
  const owner = paramOwner(toks, k, name);
  if (owner && owner.listCall >= 0) out.push(...resolveList(toks, owner.listCall, keys, seen));
  if (owner && owner.helper) out.push(...helperCalls(toks, owner.helper, keys, seen));
  return out;
}

/** The list before `.map(` etc.: a name, a list literal, or a chain `L.filter(..)`. */
function resolveList(toks, k, keys, seen) {
  const tok = toks[k];
  if (!tok) return [];
  if (tok.v === ']') return listKeys(toks, openOf(toks, k), keys, seen);
  if (tok.v === ')') {
    const open = openOf(toks, k);
    if (open > 2 && LIST_CALLS.has(toks[open - 1].v) && toks[open - 2].v === '.') return resolveList(toks, open - 3, keys, seen);
    return [];
  }
  if (tok.t === 'id') return resolveIdent(toks, k, keys, seen);
  return resolveValue(toks, k, keys, seen);
}

function listKeys(toks, open, keys, seen) {
  const out = [];
  if (open < 0) return out;
  const end = toks[open].close === undefined ? toks.length : toks[open].close;
  for (let j = open + 1; j < end; j++) {
    if (toks[j].t === 'str' && keys.has(toks[j].v)) out.push({ key: toks[j].v, at: null });
    if (toks[j].v === '...' && (toks[j + 1] || {}).t === 'id') out.push(...resolveValue(toks, j + 1, keys, seen));
  }
  return out;
}

/**
 * The function that declares `name` as a parameter and encloses token `k` (an arrow, with or without a bracket body, or
 * `function (...) {`): { listCall: index of LIST in `LIST.map(fn)` etc. or -1, helper: F in `const F = fn` or
 * `function F(...)`, or null }. null when no enclosing function declares it.
 */
function paramOwner(toks, k, name) {
  const declares = (open, close) => {
    for (let j = open + 1; j < close; j++) if (toks[j].t === 'id' && toks[j].v === name && (toks[j - 1] || {}).v !== ':') return true;
    return false;
  };
  for (let child = k, p = toks[k].parent; child >= 0; child = p, p = p >= 0 ? toks[p].parent : -2) {
    const ms = members(toks, p);
    const idx = ms.indexOf(child);
    let fnStart = -1;
    let has = false;
    for (let j = idx - 1; j >= 0; j--) {
      const tok = toks[ms[j]];
      if (tok.v === ',' || tok.v === ';') break;
      if (tok.v !== '=>') continue;
      const pre = j > 0 ? ms[j - 1] : -1;
      if (pre >= 0 && toks[pre].t === 'id') { fnStart = pre; has = toks[pre].v === name; }
      else if (pre >= 0 && toks[pre].v === ')') { fnStart = openOf(toks, pre); has = declares(fnStart, pre); }
      break;
    }
    if (fnStart < 0 && toks[child].v === '{' && idx > 0 && toks[ms[idx - 1]].v === ')') {
      const close = ms[idx - 1];
      const open = openOf(toks, close);
      const before = toks[open - 1] || {};
      if (before.v === 'function') { fnStart = open - 1; has = declares(open, close); }
      else if (before.t === 'id' && (toks[open - 2] || {}).v === 'function') {
        if (declares(open, close)) return { listCall: -1, helper: before.v };
      }
    }
    if (fnStart < 0 || !has) continue;
    if ((toks[fnStart - 1] || {}).v === 'async') fnStart -= 1;
    const before = toks[fnStart - 1] || {};
    if (before.v === '(' && LIST_CALLS.has((toks[fnStart - 2] || {}).v) && (toks[fnStart - 3] || {}).v === '.') {
      return { listCall: fnStart - 4, helper: null };
    }
    if (before.v === '=' && (toks[fnStart - 2] || {}).t === 'id') return { listCall: -1, helper: toks[fnStart - 2].v };
    return { listCall: -1, helper: null };
  }
  return null;
}

/** Each call `helper(value, ...)` or `LIST.map(helper)`: what the value names, decided at the call. */
function helperCalls(toks, helper, keys, seen) {
  const out = [];
  const at = (found, k) => found.map((f) => ({ key: f.key, at: f.at === null ? k : f.at }));
  for (let k = 1; k + 2 < toks.length; k++) {
    if (toks[k].t !== 'id' || toks[k].v !== helper) continue;
    if (['const', 'let', 'var', 'function', '.'].includes(toks[k - 1].v)) continue;
    if (toks[k + 1].v === '(') out.push(...at(resolveValue(toks, k + 2, keys, new Set(seen)), k + 2));
    // LIST.map(helper)
    if (toks[k - 1].v === '(' && toks[k + 1].v === ')' && LIST_CALLS.has((toks[k - 2] || {}).v) && (toks[k - 3] || {}).v === '.') {
      out.push(...at(resolveList(toks, k - 4, keys, new Set(seen)), k));
    }
  }
  return out;
}

/** Child keys the string "true" at `s` is seeded under, each with the token whose test name decides: [{ at, key }]. */
function seedsOf(toks, s, keys) {
  const prev = toks[s - 1];
  const next = toks[s + 1];
  if ((prev && COMPARE.has(prev.v)) || (next && COMPARE.has(next.v))) return [];
  const p = toks[s].parent;
  if (p < 0) return [];
  const out = [];
  const holders = [];
  members(toks, p).forEach((k, idx) => {
    const tok = toks[k];
    if (tok.t === 'str' && keys.has(tok.v)) out.push({ at: s, key: tok.v });
    if (tok.t === 'id' && keys.has(tok.v) && (toks[k + 1] || {}).v === ':') out.push({ at: s, key: tok.v });
    // `key: X` / shorthand `key` / the first item of a pair `[X, 'true']`
    if (tok.t === 'id' && tok.v === 'key' && (toks[k - 1] || {}).v !== '.') {
      if ((toks[k + 1] || {}).v === ':' && (toks[k + 2] || {}).t === 'id') holders.push(k + 2);
      else if ([',', '}'].includes((toks[k + 1] || {}).v)) holders.push(k);
    }
    if (idx === 0 && tok.t === 'id' && toks[p].v === '[') holders.push(k);
  });
  for (const h of holders) {
    for (const f of resolveValue(toks, h, keys, new Set())) out.push({ at: f.at === null ? s : f.at, key: f.key });
  }
  return out;
}

/** Seeds in one file's source: [{ line, key }], sorted, one per (line, key). */
function findStringTrueSeeds(src, keyList) {
  const keys = new Set(keyList);
  const toks = lex(src);
  const seen = new Set();
  const out = [];
  toks.forEach((tok, s) => {
    if (tok.t !== 'str' || !isStringTrue(tok.v)) return;
    for (const { at, key } of seedsOf(toks, s, keys)) {
      if (namesAround(toks, at).some((name) => STRICT_NAME.test(name))) continue;
      const id = `${toks[at].line} ${key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ line: toks[at].line, key });
    }
  });
  return out.sort((a, b) => a.line - b.line || a.key.localeCompare(b.key));
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(c|m)?js$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Seeds in every .js file under the given folders: [{ file, line, key }]. */
function scanTrees(dirs, keyList) {
  const out = [];
  for (const dir of dirs) {
    for (const file of walk(dir).sort()) {
      for (const seed of findStringTrueSeeds(fs.readFileSync(file, 'utf8'), keyList)) out.push({ file, ...seed });
    }
  }
  return out;
}

module.exports = { findStringTrueSeeds, scanTrees };
