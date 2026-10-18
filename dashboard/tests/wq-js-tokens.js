'use strict';
/**
 * A small JavaScript tokenizer for the tests (no parser in the dashboard's dependencies): enough of the language for
 * the child pages' own files in public/wq. It gives
 *   - tokens: every significant token (names, numbers, strings, template pieces, regexes, punctuators), comments and
 *     white space dropped, so two sources with the same tokens are the same program;
 *   - lines: the state at the START of each line (index 0 = line 1): 'code', 'block' (inside a /* comment),
 *     'str' (a string continued with a backslash) or 'tmpl' (inside a template literal's text).
 * It throws on what it does not understand (an unterminated string, template, regex or comment), so a file it
 * misreads fails loudly rather than passing.
 */
const KEYWORD_BEFORE_REGEX = /^(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;
const PUNCT = /^(>>>=|\.\.\.|===|!==|\*\*=|<<=|>>=|>>>|\?\?=|&&=|\|\|=|=>|==|!=|<=|>=|&&|\|\||\?\?|\?\.|\+\+|--|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|<<|>>|\*\*|[{}()[\];,<>+\-*/%&|^!~?:=.@#])/;
const NUM = /^(0[xXbBoO][0-9a-fA-F_]+n?|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?n?)/;
const ID_START = /[A-Za-z_$\u0080-￿]/;
const ID_PART = /[A-Za-z0-9_$\u0080-￿]/;

function scanJs(src) {
  const tokens = [];
  const lines = ['code'];
  let i = 0;
  let prev = null;
  const lineOf = (k) => src.slice(0, k).split('\n').length;
  const fail = (why) => { throw new Error(`${why} at line ${lineOf(i)}`); };
  const push = (type, value) => { prev = { type, value }; tokens.push(prev); };

  function regexOk() {
    if (!prev) return true;
    if (prev.type === 'name') return KEYWORD_BEFORE_REGEX.test(prev.value);
    if (prev.type === 'punct') return !/^[)\]}]$/.test(prev.value);
    if (prev.type === 'tmplhead') return true;
    return false;   // after a number, string, template or regex: division
  }

  function template() {
    let s = i;
    i += 1;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { if (src[i + 1] === '\n') lines.push('tmpl'); i += 2; continue; }
      if (c === '`') { i += 1; push('tmpl', src.slice(s, i)); return; }
      if (c === '$' && src[i + 1] === '{') {
        push('tmplhead', src.slice(s, i + 2));
        i += 2;
        code(true);
        s = i - 1;   // the closing } starts the next piece
        continue;
      }
      if (c === '\n') lines.push('tmpl');
      i += 1;
    }
    fail('unterminated template');
  }

  function code(untilBrace) {
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      const d = src[i + 1];
      if (c === '\n') { lines.push('code'); i += 1; continue; }
      if (/\s/.test(c)) { i += 1; continue; }
      if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
      if (c === '/' && d === '*') {
        const end = src.indexOf('*/', i + 2);
        if (end < 0) fail('unterminated comment');
        for (let k = i; k < end; k += 1) if (src[k] === '\n') lines.push('block');
        i = end + 2;
        continue;
      }
      if (c === '\'' || c === '"') {
        const s = i;
        i += 1;
        while (i < src.length && src[i] !== c) {
          if (src[i] === '\\') { if (src[i + 1] === '\n') lines.push('str'); i += 2; continue; }
          if (src[i] === '\n') fail('newline in a string');
          i += 1;
        }
        if (i >= src.length) fail('unterminated string');
        i += 1;
        push('str', src.slice(s, i));
        continue;
      }
      if (c === '`') { template(); continue; }
      if (c === '/' && regexOk()) {
        const s = i;
        let cls = false;
        i += 1;
        for (;;) {
          const e = src[i];
          if (e === undefined || e === '\n') fail('unterminated regex');
          if (e === '\\') { i += 2; continue; }
          if (cls) { if (e === ']') cls = false; } else if (e === '[') cls = true; else if (e === '/') break;
          i += 1;
        }
        i += 1;
        while (i < src.length && /[a-z]/i.test(src[i])) i += 1;
        push('regex', src.slice(s, i));
        continue;
      }
      if (ID_START.test(c)) {
        const s = i;
        while (i < src.length && ID_PART.test(src[i])) i += 1;
        push('name', src.slice(s, i));
        continue;
      }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(d || ''))) {
        const m = NUM.exec(src.slice(i, i + 64));
        push('num', m[0]);
        i += m[0].length;
        continue;
      }
      if (untilBrace) {
        if (c === '{') depth += 1;
        else if (c === '}') {
          if (depth === 0) { i += 1; return; }
          depth -= 1;
        }
      }
      const m = PUNCT.exec(src.slice(i, i + 4));
      if (!m) fail(`unexpected character ${JSON.stringify(c)}`);
      push('punct', m[0]);
      i += m[0].length;
    }
    if (untilBrace) fail('unterminated ${');
  }

  code(false);
  return { tokens, lines };
}

/** The 1-based line numbers whose text starts (after white space) with // but that sit inside a string or template. */
function commentLinesInsideLiterals(src) {
  const { lines } = scanJs(src);
  return src.split('\n')
    .map((text, k) => ({ text, n: k + 1, state: lines[k] }))
    .filter((x) => /^\s*\/\//.test(x.text) && x.state !== 'code' && x.state !== 'block')
    .map((x) => x.n);
}

module.exports = { scanJs, commentLinesInsideLiterals };
