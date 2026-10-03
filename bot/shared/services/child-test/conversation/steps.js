'use strict';

/**
 * The v2 coach journey's words (bd-s1oo0.46.2, design/COACH_JOURNEY_V2.md §3.1). Pure: every function
 * builds text from the catalog (childTestL26*, config/ux-strings.js) and the item bank; nothing here
 * sends or stores.
 *
 *   stepMessage(lang, block, { name, grade, form, bankForm? })  1/3 Urdu story · 2/3 English story · 3/3 Maths
 *   presenceBody(lang, { n, total, child, greet })               "Child n of 5 · <child line>" + the greeting
 *   childLine(lang, child) / nameOf(lang, child)                  L25's identity.childLine when it has landed
 *   listMessage(lang, list) / teacherMessages(lang, list)         stand-ins for L25's conversation/list.js
 *   scriptFor(block, bankForm) / greetFor(bankForm)              L27's item-bank v2 fields, else the stand-in
 *
 * The words said TO the child come from the item bank's v2 `script` lines and questions (CONTRACT §19,
 * L27). Until the bank carries them, the design's lines stand in (STUB below) and `stubbed()` says so, so
 * the conversation logs it at warn. The start and stop lines contain the bank's `cue.*` phrases, which the
 * window finder keys on.
 */

const { t } = require('./copy');
const identity = require('./identity');

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥'];

const STUB = {
  urdu: {
    greet: 'السلام علیکم! ہم ایک چھوٹی سی کہانی پڑھیں گے۔ یہ امتحان نہیں ہے۔ کیا آپ تیار ہیں؟',
    start: 'یہ کہانی اونچی آواز میں پڑھیں۔ اب شروع کریں',
    go_on: 'آگے پڑھیں',
    stop: 'بس، شکریہ',
    questions_intro: 'اب کہانی کے بارے میں کچھ سوالات سنیں',
    fallback: 'کوئی بات نہیں۔ اب یہ حروف پڑھیں',
  },
  english: {
    start: 'Please read this story aloud. Please start reading.',
    go_on: 'Go on.',
    stop: 'Stop, thank you.',
    questions_intro: 'Now listen to some questions about the story.',
    fallback: 'That\'s all right. Now read these letters.',
  },
  maths: {
    start: 'اب سوال شروع کریں',
    compare: 'ان میں سے بڑا نمبر کون سا ہے؟',
    sum: 'اس کا جواب بتائیں',
    next: 'اگلا',
    wp_intro: 'اب یہ سوال غور سے سنیں',
    stop: 'بس، شکریہ',
  },
  // CONTRACT §19's table (the May instrument), read aloud by the coach. Set B gets L27's parallel items.
  wordProblems: {
    3: [
      { id: 'stub-m3-wp1', prompt_ur: 'آپ کے پاس ۳ بسکٹ ہیں۔ ثنا آپ کو ۳ اور دیتی ہے۔ اب آپ کے پاس کتنے بسکٹ ہیں؟' },
      { id: 'stub-m3-wp2', prompt_ur: 'عائشہ کے پاس ۱۵ سیب ہیں۔ ان میں سے ۳ لال ہیں، باقی ہرے ہیں۔ ہرے سیب کتنے ہیں؟' },
    ],
    5: [
      { id: 'stub-m5-wp1', prompt_ur: 'آپ کے پاس ۲۵ گیندیں ہیں۔ ان میں سے ۴ گم ہو جاتی ہیں۔ اب کتنی گیندیں باقی ہیں؟' },
      { id: 'stub-m5-wp2', prompt_ur: '۲۵ کیلے ۵ بچوں میں برابر بانٹے جاتے ہیں۔ ہر بچے کو کتنے کیلے ملتے ہیں؟' },
    ],
  },
};

const PART_KEY = { urdu: 'childTestL26PartUrdu', english: 'childTestL26PartEnglish', maths: 'childTestL26PartMaths' };
const SIDE_KEY = { urdu: 'childTestBlockUrdu', english: 'childTestBlockEnglish' };
const B_OF = { urdu: 1, english: 2, maths: 3 };

// A name or class label inside an Urdu line is isolated (language-protocol §9.2); the roster's are Latin.
const iso = (lang, v) => (lang === 'en' ? v : `\u2068${v}\u2069`);
const nameRoom = (lang, name, room) => `${iso(lang, name)} (${iso(lang, room)})`;
const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/** The item bank's form ({ urdu, english, maths }), or null. */
function bankFormFor(grade, form) {
  try {
    return require('../item-bank').getForm(grade, form || 'A');
  } catch (err) {
    return null;
  }
}

/** The bank's v2 script lines for a block, filled from the stand-in where the bank has none. */
function scriptFor(block, bankForm) {
  const b = bankForm && bankForm[block];
  const own = block === 'maths' ? b && b.oral && b.oral.script : b && b.script;
  return { ...STUB[block], ...(own || {}) };
}
const greetFor = (bankForm) => scriptFor('urdu', bankForm).greet;

function wordProblemsFor(grade, bankForm) {
  const own = bankForm && bankForm.maths && bankForm.maths.oral && bankForm.maths.oral.word_problems;
  return own && own.length ? own : (STUB.wordProblems[Number(grade)] || STUB.wordProblems[3]);
}

/** Which v2 fields this form is still missing (the conversation logs them at warn, once per child). */
function stubbed(bankForm) {
  const missing = [];
  if (!(bankForm && bankForm.urdu && bankForm.urdu.script)) missing.push('urdu.script');
  if (!(bankForm && bankForm.english && bankForm.english.script)) missing.push('english.script');
  if (!(bankForm && bankForm.maths && bankForm.maths.oral)) missing.push('maths.oral');
  return missing;
}

function cardName(lang, grade) {
  const g = Number(grade);
  if (g === 3) return t(lang, 'childTestL26CardG3');
  if (g === 5) return t(lang, 'childTestL26CardG5');
  return t(lang, 'childTestL26CardOther', { grade: g || '' });
}

const partName = (lang, block) => t(lang, PART_KEY[block]);
const stepTitle = (lang, block, name) => t(lang, 'childTestL26StepTitle', { b: B_OF[block], part: partName(lang, block), name });

// Said lines (L31, language-protocol §9). Each words-to-the-child line stands alone on its line. When its
// script runs the other way from the message's (Urdu in an English message, English in an Urdu one), the
// guillemets go INSIDE an isolate — RLI «…» PDI or LRI «…» PDI — so a phone paints the quote as one unit
// and a line break can never land between a guillemet and its words (shot_v2 05).
const RLI = '\u2067';
const LRI = '\u2066';
const PDI = '\u2069';
const RTL_TEXT = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

function said(lang, text) {
  const s = clean(text).replace(/^«|»$/g, '');
  const rtl = RTL_TEXT.test(s);
  if (lang === 'en' && rtl) return `${RLI}«${s}»${PDI}`;
  if (lang !== 'en' && !rtl) return `${LRI}«${s}»${PDI}`;
  return `«${s}»`;
}

/** One said line per question or problem; its number sits in its own LTR isolate, never glued to an RTL run. */
const numbered = (lang, lines) => lines.map((s, i) => `   ${LRI}${CIRCLED[i] || '•'}${PDI} ${said(lang, s)}`).join('\n');

/** One step: plain text, no buttons; it stays the last bubble, right above the recorder. */
function stepMessage(lang, block, { name, grade, form, bankForm } = {}) {
  const bf = bankForm === undefined ? bankFormFor(grade, form) : bankForm;
  const title = stepTitle(lang, block, name);
  const card = cardName(lang, grade);
  const s = scriptFor(block, bf);
  if (block === 'maths') {
    const problems = wordProblemsFor(grade, bf).map((p) => p.prompt_ur || p.prompt);
    const q = (k) => said(lang, s[k]);
    return t(lang, 'childTestL26StepMaths', {
      title, card, start: q('start'), compare: q('compare'), sum: q('sum'), next: q('next'), wp_intro: q('wp_intro'), stop: q('stop'),
      problems: numbered(lang, problems),
    });
  }
  const questions = ((bf && bf[block] && bf[block].questions) || []).map((q) => q.prompt);
  const q = (k) => said(lang, s[k]);
  return t(lang, 'childTestL26StepStory', {
    title, card, side: t(lang, SIDE_KEY[block]), start: q('start'), go_on: q('go_on'), stop: q('stop'),
    qintro: q('questions_intro'), fallback: q('fallback'), questions: numbered(lang, questions),
  });
}

// ------------------------------------------------------------------ naming a child (L25 stand-ins)

/** The child's full name, never a roll (CONTRACT §18–19). */
function nameOf(lang, c) {
  return identity.childName(lang, c) || t(lang, 'childTestL26NameMissing');
}
const roomOf = (c) => clean(c && (c.classLabel || (c.grade && c.section ? `${c.grade}-${c.section}` : c.section || '')));

/** "Ayesha Khan · 3-A · Teacher: Saima Bibi": L25's identity.childLine when it has landed. */
function childLine(lang, c) {
  if (typeof identity.childLine === 'function') return identity.childLine(lang, c);
  const name = nameOf(lang, c);
  const room = roomOf(c);
  if (!room) return name;
  const teacher = clean(c.teacherName);
  return teacher ? t(lang, 'childTestL26ChildLine', { name, room, teacher }) : `${iso(lang, name)} · ${iso(lang, room)}`;
}

function presenceBody(lang, { n, total, child, greet }) {
  return t(lang, 'childTestL26Presence', { n, total, line: childLine(lang, child), greet: said(lang, greet) });
}

/** The list's children in collection order: by `classes[]` when the draw gives it, else as listed. */
function collectionOrder(list) {
  const children = (list && list.children) || [];
  if (!list || !Array.isArray(list.classes) || !list.classes.length) return children;
  const byId = new Map(children.map((c) => [c.drawId, c]));
  const ordered = list.classes.flatMap((k) => (k.drawIds || []).map((id) => byId.get(id)).filter(Boolean));
  return [...ordered, ...children.filter((c) => !ordered.includes(c))];
}

/** Rooms in collection order: [{ room, teacherName, teacherUserId, children }]. */
function rooms(list, children) {
  const out = [];
  for (const c of children) {
    const key = c.classId || roomOf(c);
    let r = out.find((x) => x.key === key);
    if (!r) {
      const k = ((list && list.classes) || []).find((x) => x.classId === c.classId) || {};
      r = { key, room: roomOf(c) || clean(k.classLabel), teacherName: clean(k.teacherName || c.teacherName) || null,
        teacherUserId: k.teacherUserId || c.teacherUserId || null, children: [] };
      out.push(r);
    }
    r.children.push(c);
  }
  return out;
}

const INACTIVE = new Set(['absent', 'refused', 'absent_final']);

/** Stand-in for L25 list.buildListMessage(lang, list) → { header, body, buttons }. */
function listMessage(lang, list) {
  const kids = collectionOrder(list).filter((c) => !INACTIVE.has(c.status));
  const lines = [t(lang, 'childTestL26ListIntro')];
  let n = 0;
  for (const r of rooms(list, kids)) {
    lines.push(r.teacherName ? t(lang, 'childTestL26ListRoom', { room: r.room || '—', teacher: r.teacherName })
      : t(lang, 'childTestL26ListRoomNoTeacher', { room: r.room || '—' }));
    for (const c of r.children) { n += 1; lines.push(t(lang, 'childTestL26ListItem', { n, name: nameOf(lang, c) })); }
  }
  const alts = (list.alternates || []).map((c) => (roomOf(c) ? nameRoom(lang, nameOf(lang, c), roomOf(c)) : iso(lang, nameOf(lang, c))));
  if (alts.length) lines.push(t(lang, 'childTestL26ListAlternates', { children: alts.join(lang === 'en' ? ', ' : '، ') }));
  return {
    header: t(lang, 'childTestL26ListHeader', { grade: list.grade, n: kids.length }),
    body: lines.join('\n'),
    buttons: [{ id: 'ctst_start' }, { id: 'ctst_send_teachers' }],
  };
}

/** Stand-in for L25 list.buildTeacherMessages(lang, list) → [{ teacherUserId, body }], one per reachable room teacher. */
function teacherMessages(lang, list) {
  const kids = collectionOrder(list).filter((c) => c.status === 'listed');
  const byTeacher = new Map();
  for (const r of rooms(list, kids)) {
    if (!r.teacherUserId) continue;
    byTeacher.set(r.teacherUserId, [...(byTeacher.get(r.teacherUserId) || []), ...r.children]);
  }
  return [...byTeacher.entries()].map(([teacherUserId, children]) => ({
    teacherUserId,
    body: t(lang, 'childTestL26TeacherMessage', {
      children: children.map((c, i) => t(lang, 'childTestL26ListItem', { n: i + 1, name: nameOf(lang, c) })).join('\n'),
    }),
  }));
}

module.exports = {
  stepMessage, stepTitle, partName, cardName, presenceBody, childLine, nameOf, collectionOrder,
  listMessage, teacherMessages, scriptFor, greetFor, stubbed, bankFormFor, said, B_OF, STUB,
};
