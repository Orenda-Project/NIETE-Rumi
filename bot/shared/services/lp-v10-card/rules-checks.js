/**
 * The individual content gates behind validate() (port of the helper functions in workbench/card/card_rules.py).
 * Pure, no I/O. rules.js composes them; constants and patterns live in rules-patterns.js.
 */
const { cpLen, truthy, pyList, WB } = require('./pytext');
const P = require('./rules-patterns');

const { CORE } = P;
const get = (o, k, d) => (o && Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined ? o[k] : d);
const plain = (s) => cpLen(String(s).replace(/<[^>]+>/g, ''));
const has = (re, s) => { re.lastIndex = 0; return re.test(s); };
const sum = (a) => a.reduce((x, y) => x + y, 0);

/** Every string in a nested card value. */
function texts(o, out = []) {
  if (typeof o === 'string') out.push(o);
  else if (Array.isArray(o)) o.forEach((v) => texts(v, out));
  else if (o && typeof o === 'object') Object.values(o).forEach((v) => texts(v, out));
  return out;
}

/** The text with the card's own key words taken out: "neighbour" taught as a word is not pair talk. */
function unvocab(text, card) {
  let t = text;
  get(card, 'words', []).forEach((w) => {
    if (typeof w === 'string' && w.trim()) {
      const e = w.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      t = t.replace(new RegExp(`${WB}${e}${WB}`, 'giu'), '');
    }
  });
  return t.replace(P.CONTENT_PAIRS, '');
}

function timeBar(mins) {
  const m = (s) => get(mins, s, 0);
  const tot = sum(CORE.map(m));
  if (tot !== P.TOTAL) return [`section minutes add to ${tot}, not ${P.TOTAL}`];
  const errs = [];
  const we = m('we'); const you = m('you'); const ido = m('explain');
  if ((we + you) * 100 < 60 * tot) errs.push(`practice (We Do + You Do) is ${we + you} of ${tot}, under 60%`);
  if (we * 100 < 30 * tot) errs.push(`We Do is ${we} of ${tot}, under 30%`);
  if (you * 100 < 30 * tot) errs.push(`You Do is ${you} of ${tot}, under 30%`);
  if (ido * 100 > 25 * tot) errs.push(`I Do (explain) is ${ido} of ${tot}, over 25%`);
  return errs;
}

function svgOk(svg) {
  const s = svg.trim();
  return s.startsWith('<svg') && s.endsWith('</svg>')
    && !/<script|\son\w+\s*=|javascript:|<foreignObject/i.test(s);
}

function pictures(card, secs) {
  const errs = [];
  get(card, 'pictures', []).forEach((p) => {
    const pid = get(p, 'id', '?');
    const kind = get(p, 'kind');
    if (!P.PIC_KINDS.includes(kind)) errs.push(`picture ${pid}: kind must be one of ${pyList(P.PIC_KINDS)}`);
    if (!secs.includes(get(p, 'after'))) errs.push(`picture ${pid}: after must name a section on the card`);
    if (kind === 'svg' && !svgOk(get(p, 'svg', ''))) errs.push(`picture ${pid}: svg must be one <svg> with no script or event handlers`);
    if (kind === 'svg') {
      const small = [...new Set([...get(p, 'svg', '').matchAll(/font-size\s*[=:]\s*"?\s*([\d.]+)/g)].map((m) => Number(m[1])))]
        .filter((n) => n < 12).sort((a, b) => a - b);
      if (small.length) errs.push(`picture ${pid}: svg text font-size ${small[0]} (min 12, labels 14)`);
    }
    if ((kind === 'faces' || kind === 'steps') && !truthy(get(p, 'items'))) errs.push(`picture ${pid}: needs items`);
  });
  return errs;
}

function written(clause) {
  if (has(P.BOARD, clause)) return false; // the teacher writes on the board; the children still answer aloud
  return has(P.WRITE, clause) || has(P.MARK, clause) || (has(P.IN_BOOK, clause) && !has(P.READING, clause));
}

/** Urdu reviewer 13 Oct, extended to English and Maths: the exit ticket takes no written work; thumbs answer a statement. */
function exitTicket(check) {
  const mv = get(check, 'moves', []);
  const text = mv.flatMap((m) => ['do', 'how', 'say'].map((k) => get(m, k, ''))).join(' ');
  const errs = [];
  if (text.split(P.CLAUSE).some(written)) errs.push('exit ticket: no written work (children answer aloud or with a thumb)');
  if (has(P.THUMBS, text) && mv.some((m) => ['؟', '?'].some((q) => get(m, 'say', '').includes(q)))) {
    errs.push('exit ticket: thumbs up/down need a statement to judge, not a question (say ends with . or ۔)');
  }
  return errs;
}

function turnLines(m, subject) {
  const tn = get(m, 'turn');
  if (!tn || typeof tn !== 'object' || Array.isArray(tn)) {
    return ["neighbour turn: no turn (who goes first, both children's lines, the stop signal)"];
  }
  const errs = [];
  Object.entries(P.TURN_CAPS).forEach(([k, cap]) => {
    const n = plain(truthy(tn[k]) ? tn[k] : '');
    if (!n) errs.push(`neighbour turn: turn.${k} missing`);
    else if (n > cap) errs.push(`neighbour turn: turn.${k} is ${n} characters, too long (max ${cap})`);
  });
  const n = plain(truthy(tn.help) ? tn.help : '');
  if ((subject === 'English' || subject === 'Urdu') && !n) {
    errs.push("neighbour turn: turn.help missing (the teacher's repair line for a stuck child)");
  } else if (n > P.HELP_CAP) errs.push(`neighbour turn: turn.help is ${n} characters, too long (max ${P.HELP_CAP})`);
  return errs;
}

/** 2L recall with its answer, 9F two different turn lines, 6C a home link outside the turn. */
function home(by, subject, mvs) {
  const errs = [];
  const opening = get(get(by, 'open', {}), 'moves', []);
  const maths = subject === 'Maths';
  if (maths && !opening.some((m) => has(P.ANSWERED, get(m, 'yesterday', '')))) {
    errs.push('Maths opening: the yesterday line ends with no expected answer (e.g. "What is 40 + 20? (60)")');
  }
  if (!maths && !opening.some((m) => ['say', 'how'].some((f) => /→|\bexpect/i.test(get(m, f, ''))))) {
    errs.push('opening: the recall names no expected answer (→ “Why.” or Expect: rain, train)');
  }
  mvs.forEach(([, m]) => {
    const tn = get(m, 'chip') === P.NEIGHBOUR ? get(m, 'turn') : null;
    if (tn && typeof tn === 'object' && truthy(tn.a) && truthy(tn.b)) {
      const [a, b] = ['a', 'b'].map((k) => tn[k].replace(/[^\p{L}\p{N}_]+/gu, ' ').trim().toLowerCase());
      if (a === b || a.includes(b)) errs.push('neighbour turn: b repeats a; give each child a different item, or say Controlled practice');
    }
  });
  const rest = mvs.filter(([, m]) => get(m, 'chip') !== P.NEIGHBOUR).flatMap(([, m]) => texts(m));
  ['check', 'you'].forEach((s) => ['ask', 'listen'].forEach((f) => rest.push(get(get(by, s, {}), f, ''))));
  if (!rest.some((t) => has(P.HOME, t))) errs.push("home link: no line brings in the children's home, street or market (outside the neighbour turn)");
  return errs;
}

function names(card) {
  const nm = get(card, 'names');
  if (!nm || typeof nm !== 'object' || Array.isArray(nm)) return ['names: the card names one girl and one boy (names.girl, names.boy)'];
  // the answers box does not count: the judge reads the names in the teaching
  const secs = get(card, 'sections', []).map((s) => Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'answers')));
  const rest = texts({ ...Object.fromEntries(Object.entries(card).filter(([k]) => k !== 'names')), sections: secs }).join(' ');
  const errs = [];
  ['girl', 'boy'].forEach((k) => {
    const w = String(truthy(nm[k]) ? nm[k] : '').trim();
    if (!w) errs.push(`names: no ${k}`);
    else if (!rest.includes(w)) errs.push(`names: ${w} (${k}) is never used in the card`);
  });
  return errs;
}

module.exports = { get, plain, has, texts, unvocab, timeBar, pictures, exitTicket, turnLines, home, names };
