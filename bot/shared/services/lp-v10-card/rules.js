/**
 * The v10 card's content gates on card.json (port of workbench/card/card_rules.py validate, bd-v0toag.27.6). Pure.
 *
 * Bar: judge 3A/3B time bar, at most 8 moves, every move names the v9 moves it covers, one neighbour turn in We Do
 * and never in the opening, a written You Do with its clock, answers and likely mistake, an exit ticket with what
 * counts as correct, nothing left design pending; success and stuck lines, neighbour-turn lines, a girl and a boy,
 * a Maths number-sense opening, think aloud, ask/listen, a recall with its answer, a home link.
 * Helpers: rules-checks.js. Constants and patterns: rules-patterns.js.
 */
const { truthy, pyList } = require('./pytext');
const P = require('./rules-patterns');
const K = require('./rules-checks');

const { ORDER, CORE } = P;
const { get, plain, has } = K;

const secOf = (sections) => {
  const by = Object.create(null);
  sections.forEach((s) => { by[String(get(s, 'sec'))] = s; });
  return by;
};

/** Every reason this card.json may not ship; [] means it passes. */
function validate(card) {
  const errs = [];
  const sections = get(card, 'sections', []);
  const secs = sections.map((s) => get(s, 'sec'));
  const inOrder = secs.filter((s) => ORDER.includes(s));
  const want = ORDER.filter((s) => secs.includes(s));
  if (JSON.stringify(inOrder) !== JSON.stringify(want) || secs.some((s) => !ORDER.includes(s))) {
    errs.push(`sections must be a subset of ${pyList(ORDER)}, in that order`);
  }
  CORE.forEach((s) => { if (!secs.includes(s)) errs.push(`missing section: ${s}`); });
  const by = secOf(sections);
  const sec = (k) => get(by, k, {});
  const subject = get(get(card, 'header', {}), 'subject');
  errs.push(...K.timeBar(Object.fromEntries(Object.entries(by).map(([k, v]) => [k, get(v, 'minutes', 0)]))));
  const mvs = sections.flatMap((s) => get(s, 'moves', []).map((m) => [get(s, 'sec'), m]));
  if (!(mvs.length > 0 && mvs.length <= P.MAX_MOVES)) errs.push(`${mvs.length} moves; a card has 1 to ${P.MAX_MOVES} moves`);
  mvs.forEach(([, m], i) => {
    if (!truthy(get(m, 'covers'))) errs.push(`move ${i + 1}: covers must list the v9 move ids it carries`);
    if (!truthy(get(m, 'do'))) errs.push(`move ${i + 1}: no action (do)`);
    Object.entries(P.CAPS).forEach(([k, cap]) => {
      const n = plain(get(m, k, ''));
      if (n > cap) errs.push(`move ${i + 1}: ${k} is ${n} characters, too long (max ${cap})`);
    });
  });
  const turns = mvs.filter(([, m]) => get(m, 'chip') === P.NEIGHBOUR).map(([s]) => s);
  if (!(turns.length === 1 && turns[0] === 'we')) {
    errs.push(`exactly one neighbour turn, in We Do; found it in ${turns.length ? pyList(turns) : 'no section'}`);
  }
  mvs.forEach(([, m]) => { if (get(m, 'chip') === P.NEIGHBOUR) errs.push(...K.turnLines(m, subject)); });
  if (!['English', 'Urdu', 'Maths'].includes(subject)) errs.push('header subject must be English, Urdu or Maths');
  errs.push(...K.names(card));
  errs.push(...K.exitTicket(sec('check')));
  errs.push(...K.home(by, subject, mvs));
  const opening = get(sec('open'), 'moves', []);
  if (subject === 'Maths' && !opening.some((m) => truthy(get(m, 'sense')))) {
    errs.push('Maths opening: no number sense move (sense: true; compose, decompose or estimate with the day\'s numbers)');
  }
  if (!get(sec('explain'), 'moves', []).some((m) => truthy(get(m, 'think')))) {
    errs.push('explain: no think aloud (think: the teacher says what they notice and so what they do)');
  }
  if (subject === 'Maths' && !opening.some((m) => truthy(get(m, 'yesterday')))) {
    errs.push("Maths opening: no yesterday line (yesterday: one line linking today to yesterday's lesson)");
  } else if (subject === 'Maths' && !opening.some((m) => get(m, 'yesterday', '').includes('?'))) {
    errs.push('Maths opening: the yesterday line asks no recall question (end it with one, e.g. "What is 20 + 15?")');
  }
  Object.entries(P.CHECK_CAPS).forEach(([k, cap]) => {
    const v = get(sec('check'), k);
    if (!truthy(v)) errs.push(`Check: no ${k} (ask: one open question; listen: what a good answer sounds like)`);
    else if (plain(v) > cap) errs.push(`Check: ${k} is too long (max ${cap} characters)`);
  });
  [['open', 'opening; warm-ups stay choral'], ['explain', 'explain'], ['check', 'check']].forEach(([s, name]) => {
    if (K.texts(get(sec(s), 'moves', [])).some((t) => has(P.PAIR, K.unvocab(t, card)))) {
      errs.push(`pair talk in the ${name}; peer talk is in We Do only`);
    }
  });
  const you = sec('you');
  if (!get(you, 'moves', []).some((m) => truthy(get(m, 'clock')))) errs.push('You Do: no stop-explaining clock');
  if (!truthy(get(you, 'answers'))) errs.push('You Do: no answers to check books against');
  if (!truthy(get(you, 'mistake'))) errs.push('You Do: no likely mistake');
  else if (plain(you.mistake) > P.MISTAKE_CAP) errs.push(`You Do: mistake is too long (max ${P.MISTAKE_CAP} characters)`);
  if (!truthy(get(you, 'stuck'))) errs.push("You Do: no 'If stuck' line");
  else if (plain(you.stuck) > P.STUCK_CAP) errs.push(`You Do: stuck line is too long (max ${P.STUCK_CAP} characters)`);
  if (get(by, 'check') && !truthy(get(by.check, 'correct'))) errs.push('Check: no line saying what counts as correct');
  const ok = get(sec('check'), 'success', '');
  if (!truthy(ok)) errs.push('Check: no success line ("I can …") for the class to read aloud');
  else if (get(card, 'lang') !== 'ur' && !ok.startsWith('I can')) errs.push('Check: success line must start "I can"');
  else if (plain(ok) > P.SUCCESS_CAP) errs.push(`Check: success line is too long (max ${P.SUCCESS_CAP} characters)`);
  errs.push(...K.pictures(card, secs));
  const all = K.texts(card);
  if (all.some((t) => has(P.SLATE, t))) errs.push('slates: ICT classes work in the book, never on slates');
  if (all.some((t) => has(P.PENDING, t))) errs.push('text still says design pending');
  return errs;
}

module.exports = { validate, ORDER, CORE };
