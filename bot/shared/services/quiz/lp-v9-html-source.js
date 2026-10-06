'use strict';
/**
 * A K-5 lesson plan rendered from HTML (the "v9" renders served from 29 Sep 2026
 * on: version stamps such as `push_29Sep`, `ch37_2Oct`) → the slide-script shape
 * the lesson-plan quiz author reads (lp-quiz-digest.service carry()).
 *
 * The v8 renders were made from a slide script, and that script is stored per
 * served version in `niete_lp_asset_sources`. The v9 renders were made from an
 * authored HTML document instead, so there is no script to store — the HTML IS
 * the lesson the teacher holds. This module reads it into the same shape, so the
 * row it produces goes into the same table under the same exact-version key and
 * every door (the /quiz list, the 15:00 offer, the generate step) reads it
 * unchanged.
 *
 * What is carried, and what never is:
 *   - the topic, chapter, minutes, learning outcome (code + statements);
 *   - the I-Do: the teacher's think-aloud, the worked example, the mistake to fix;
 *   - the You-Do practice PROMPTS (`.pr .q`);
 *   - the key words and what goes on the board, as what the lesson ended on.
 *   - Answers go ONLY where a v8 script keeps them — `youDo.problems[].answer` and
 *     `wrap.exitOptions` — which carry() never forwards to the author and the key
 *     check reads to verify keys. Every other text read drops every `.a` span and
 *     the whole exit ticket. Warm-up answers are not kept at all.
 *
 * Pure: no I/O. `validate` says whether a document is a lesson plan we can use.
 */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW_TEXT = new Set(['style', 'script', 'title']);

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', rarr: '→', larr: '←', ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', times: '×', divide: '÷',
};

function decode(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch (_) { return m; }
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, e.toLowerCase()) ? ENTITIES[e.toLowerCase()] : m;
  });
}

/** A minimal tree of a machine-written document: {tag, cls:Set, attrs, children[]} and strings. */
function parse(html) {
  const root = { tag: '#root', cls: new Set(), attrs: {}, children: [], parent: null };
  let cur = root;
  const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-zA-Z0-9-]+)\s*>|<([a-zA-Z0-9-]+)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/gi;
  let last = 0;
  let m;
  const text = (s) => { if (s) cur.children.push(decode(s)); };
  while ((m = re.exec(html))) {
    text(html.slice(last, m.index));
    last = re.lastIndex;
    if (m[1]) {
      const tag = m[1].toLowerCase();
      let n = cur;
      while (n && n.tag !== tag) n = n.parent;
      if (n && n.parent) cur = n.parent;
    } else if (m[2]) {
      const tag = m[2].toLowerCase();
      const attrs = {};
      const ar = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let a;
      while ((a = ar.exec(m[3] || ''))) attrs[a[1].toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? '');
      const node = { tag, cls: new Set(String(attrs.class || '').split(/\s+/).filter(Boolean)), attrs, children: [], parent: cur };
      cur.children.push(node);
      if (RAW_TEXT.has(tag)) {
        const close = html.toLowerCase().indexOf(`</${tag}`, last);
        const end = close < 0 ? html.length : close;
        if (tag !== 'style' && tag !== 'script') node.children.push(decode(html.slice(last, end)));
        re.lastIndex = close < 0 ? html.length : html.indexOf('>', close) + 1;
        last = re.lastIndex;
      } else if (!VOID.has(tag) && !m[4]) {
        cur = node;
      }
    }
  }
  text(html.slice(last));
  return root;
}

/** The answer spans and the exit ticket: never read, anywhere. */
const isAnswer = (n) => n.cls.has('a') || n.cls.has('exit') || n.cls.has('arow');

// Bidi isolates/marks the renderer puts around numbers in Urdu (U+2066–2069, U+200E/F).
const BIDI = /[⁦-⁩‎‏‪-‮]/g;

function textOf(n) {
  if (typeof n === 'string') return n;
  if (!n || isAnswer(n) || n.tag === 'style' || n.tag === 'script') return '';
  return n.children.map(textOf).join(' ');
}
const clean = (s) => String(s || '').replace(BIDI, '').replace(/\s+/g, ' ').trim();
const say = (n) => clean(textOf(n));

function findAll(n, pred, out = []) {
  if (typeof n === 'string' || !n) return out;
  if (n.tag !== '#root' && isAnswer(n)) return out;
  if (n.tag !== '#root' && pred(n)) out.push(n);
  n.children.forEach((c) => findAll(c, pred, out));
  return out;
}
/** findAll that also enters answer and exit nodes — for the key-check fields only. */
function findAny(n, pred, out = []) {
  if (typeof n === 'string' || !n) return out;
  if (n.tag !== '#root' && pred(n)) out.push(n);
  n.children.forEach((c) => findAny(c, pred, out));
  return out;
}
/** The answer text an item carries in its `.a` spans ('' when none). */
function answerOf(it) {
  const raw = (n) => (typeof n === 'string' ? n : n.children.map(raw).join(' '));
  return clean(findAny(it, (n) => n.cls.has('a')).map(raw).join(' ')).replace(/^→\s*/, '');
}
const byClass = (n, ...cls) => findAll(n, (x) => cls.every((c) => x.cls.has(c)));
const first = (n, ...cls) => byClass(n, ...cls)[0] || null;

const URDU_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const asciiDigits = (s) => String(s || '').replace(/[۰-۹]/g, (d) => String(URDU_DIGITS.indexOf(d)));

const SLO_CODE = /\b[A-Z]-\d{2}-[A-Z]{2,3}-\d{2}\b/g;
const LESSON_ID = /^grade_(\d+)_(.+)_ch(\d+)_seg(\d+)$/;

/** The sections the bars open, in document order: [{sec, nodes[]}] (development = I Do, activity = We Do). */
function sections(root) {
  const out = [];
  let current = null;
  const walk = (n) => {
    if (typeof n === 'string') return;
    if (n.cls.has('bar') && n.attrs['data-sec']) {
      if (!current || current.sec !== n.attrs['data-sec']) {
        current = { sec: n.attrs['data-sec'], nodes: [] };
        out.push(current);
      }
      return;
    }
    if (n.cls.has('blk') || n.tag === 'figure') {
      if (current) current.nodes.push(n);
      return;
    }
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

function htmlLanguage(root) {
  const html = findAll(root, (n) => n.tag === 'html')[0];
  const lang = String((html && html.attrs.lang) || '').toLowerCase();
  if (lang.startsWith('ur')) return 'ur';
  if (lang.startsWith('en')) return 'en';
  return null;
}

/**
 * The slide-script shape of one v9 lesson plan.
 * @param {string} html the raw document
 * @param {{lessonId:string}} key the served lesson (the id the asset row carries)
 * @returns {object} a slide script (meta, goal, sloFull, sloCode, iDo, youDo, wrap)
 */
function toSlideScript(html, { lessonId } = {}) {
  const root = parse(String(html || ''));
  const idm = LESSON_ID.exec(String(lessonId || ''));
  const slo = first(root, 'slo');
  // A list of outcome statements (English, Maths, Science) or one paragraph (Urdu).
  const outcomes = slo ? findAll(slo, (n) => n.tag === 'li' || n.tag === 'p').map(say).filter(Boolean) : [];
  const sloLabel = slo ? say(first(slo, 'lbl')) : '';
  const codes = [...new Set((sloLabel.match(SLO_CODE) || []))];
  const loc = say(first(root, 'h-loc'));
  const minutes = Number((asciiDigits(loc).match(/(\d+)\s*(min|منٹ)/) || [])[1]) || null;

  const secs = sections(root);
  const iDoNodes = secs.filter((s) => s.sec === 'development').flatMap((s) => s.nodes);
  const thinkAloud = iDoNodes
    .filter((n) => n.cls.has('exq') && !n.cls.has('we'))
    .flatMap((n) => byClass(n, 'tn', 'k-say').map(say))
    .filter(Boolean);
  const workedNode = iDoNodes.find((n) => n.cls.has('exq')
    && byClass(n, 'tag').some((t) => /worked example|حل شدہ مثال|مثال/i.test(say(t))));
  const worked = workedNode ? {
    problem: findAll(workedNode, (n) => n.tag === 'li' && !findAll(n, () => true).some((x) => x.cls.has('cfu'))
      && !n.parent.cls.has('kp')).map(say).filter(Boolean).join(' ') || null,
    work: [],
    answer: null,
  } : null;
  const mistakes = byClass(root, 'mis').map(say).map((t) => t.replace(/^✓\s*(You ask|آپ پوچھیں)?\s*/i, '')).filter(Boolean);

  // The practice prompt is what the author may see; its answer sits beside it in the
  // v8 place (youDo.problems[].answer), which carry() never forwards and the key
  // check (lp-quiz-key-check sourceAnswers) reads to verify the quiz's keys.
  const practice = byClass(root, 'pr')
    .flatMap((n) => byClass(n, 'it'))
    .map((it) => ({ prompt: say(first(it, 'q')), answer: answerOf(it) }))
    .filter((p) => p.prompt)
    .map((p, i) => ({ n: i + 1, prompt: p.prompt, ...(p.answer ? { answer: p.answer } : {}) }));
  // The exit ticket, in the v8 place (wrap.exitOptions): read by the key check only.
  const exitOptions = findAny(root, (n) => n.cls.has('exit'))
    .flatMap((ex) => findAny(ex, (n) => n.cls.has('it')))
    .map((it) => ({
      prompt: say(it).replace(/^\d+[.)]\s*/, ''),
      answer: answerOf(it),
    }))
    .filter((o) => o.prompt);

  const keyWords = byClass(root, 'kr').map((kr) => {
    const parts = kr.children.filter((c) => typeof c !== 'string').map(say).filter(Boolean);
    return parts.length >= 2 ? `${parts[0]} — ${parts.slice(1).join(' ')}` : parts[0] || '';
  }).filter(Boolean);
  const board = byClass(root, 'board').flatMap((b) => byClass(b, 'bp').map((bp) => {
    const head = say(first(bp, 'bhd'));
    const items = byClass(bp, 'bx').map(say).filter(Boolean);
    return [head, items.join(' · ')].filter(Boolean).join(': ');
  })).filter(Boolean);

  return {
    meta: {
      lessonId: lessonId || null,
      grade: idm ? Number(idm[1]) : null,
      subject: idm ? idm[2] : null,
      language: htmlLanguage(root),
      topic: say(first(root, 'h-title')) || null,
      chapterTitle: say(first(root, 'h-meta')) || null,
      minutes,
      sloDescriptions: outcomes,
      source: 'v9_html',
      adapterV: ADAPTER_VERSION,
    },
    goal: outcomes[0] || null,
    sloFull: outcomes.join(' ') || null,
    sloCode: codes.join(', '),
    bloom: '',
    iDo: {
      keyFact: thinkAloud.join(' ') || null,
      worked,
      misconception: mistakes[0] ? { slip: '', why: '', fix: mistakes[0] } : null,
    },
    youDo: { problems: practice },
    wrap: { keyFacts: [...keyWords, ...board], exitOptions },
  };
}

const MAX_BYTES = 8 * 1024 * 1024;
const MIN_BODY_CHARS = 600;

/**
 * Is this a lesson plan we can write a quiz from? Never throws.
 * @returns {{ok:boolean, reason?:string, language?:string, bodyChars?:number, bytes:number}}
 */
function validate(html, { lessonId } = {}) {
  const s = String(html || '');
  const bytes = Buffer.byteLength(s, 'utf8');
  if (!bytes) return { ok: false, reason: 'empty', bytes };
  if (bytes > MAX_BYTES) return { ok: false, reason: 'too_large', bytes };
  if (/<script[\s>]/i.test(s)) return { ok: false, reason: 'has_script', bytes };
  const ss = toSlideScript(s, { lessonId });
  const body = say(parse(s).children.find((c) => typeof c !== 'string' && c.tag === 'html') || parse(s));
  if (!ss.meta.language) return { ok: false, reason: 'no_language', bytes };
  if (!ss.meta.topic) return { ok: false, reason: 'no_title', bytes };
  if (body.length < MIN_BODY_CHARS) return { ok: false, reason: 'no_lesson_body', bytes, bodyChars: body.length };
  if (!ss.goal && !ss.iDo.keyFact && !ss.youDo.problems.length) return { ok: false, reason: 'no_lesson_body', bytes };
  return { ok: true, language: ss.meta.language, bodyChars: body.length, bytes };
}

/**
 * Bumped whenever toSlideScript reads a document differently, so the ingester
 * re-reads documents it has already stored (its skip rule is HTML hash + this).
 * 2: practice answers and the exit ticket kept in the v8 key-check places.
 */
const ADAPTER_VERSION = 2;

module.exports = { toSlideScript, validate, parse, ADAPTER_VERSION };
