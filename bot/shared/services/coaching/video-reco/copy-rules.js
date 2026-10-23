'use strict';
/**
 * Teacher-facing copy rules from the panel's 200 (bd-8hhqhf R7b, COS ruling 20261023T144730 2b; ped/REVIEW_r7_scale.md
 * §2, §4). Pure. select.js validates and builds the card fallback with them; copy.js composes with the digit rule.
 */
const { redactNames } = require('./redact-names');
const LEX = require('./name-lexicon');

// ── the card's vocative (P165 ⛔9; red7 145611 V1–V10, N1–N4) ───────────────────────────────────────────────────────────
// A prod card opens with the teacher's name, often in Urdu script while users.name is Latin, so a name match cannot find
// it and the non-strict redactor knows only its lexicon's names. The vocative is found by its SHAPE: up to three words
// before the first comma that the strict redactor masks as names, with any title or honorific around them.
const TITLE = new Set('سید سیدہ محترم محترمہ mr mrs ms miss madam sir'.split(' '));
// «جی» is an honorific after a name («‹name› جی،», red7 161951); «اچھا جی، / ہاں جی، / تو جی،» are not names because the word
// left after it is a FUNCTION word (below), which no name is.
const HONORIFIC = new Set('بی بیبی صاحب صاحبہ جی sahib sahiba bibi ji'.split(' '));
const PLACEHOLDER_WORD = /^\[(?:a student|CHILD|TEACHER)\]$/;
// red7 REVIEW_3630: a role word is an address, not a name (F2); a word a clause is built from is never part of a name (F1).
const ROLE = new Set('استاد استانی ٹیچر teacher sir madam miss مس میڈم سر'.split(' '));
const FUNCTION = new Set(('میں کے کی کا کو سے نے پر اور یا کہ جب تو ہر یہ وہ ایک آج کل اگلی اگلے پہلے بعد اب پھر ساتھ لیے کلاس سبق بچوں بچے آپ ہم '
  + 'دوران شروع آخر جواب سوال صفحہ the a an in on at for of to and next today tomorrow class lesson when after before dear good '
  + 'اچھا ہاں تو چلیں بیٹا بیٹے بچو شاباش ٹھیک بالکل پڑھیں ok okay yes').split(' '));
const VOC = /^(\s*[⁦-⁩]?\s*)((?:[^\s،,:]+\s+){0,4}[^\s،,:]+?)\s*[⁦-⁩]?\s*[،,:]\s*/u;

/** The words before the first comma are an address to a person: names (strict-masked), titles and honorifics only. */
function vocativeWords(words, { partial = false } = {}) {
  const core = words.filter((w) => !TITLE.has(w.toLowerCase()) && !HONORIFIC.has(w.toLowerCase()));
  const honorific = words.length - core.length;
  if (!core.length || core.length > 3 || core.some((w) => PLACEHOLDER_WORD.test(w) || ROLE.has(w.toLowerCase()) || FUNCTION.has(w.toLowerCase()))) return false;
  const masked = (redactNames(core.join(' '), { placeholders: { child: '[a student]' } }).match(/\[(?:a student|TEACHER)\]/g) || []).length;
  // F1: «‹name› جہاں،» — one masked word and no word a clause is built from is a name made partly of dictionary words
  // (Urdu-script words only: a capitalised English run is not a name)
  const nameLike = partial && masked >= 1 && core.length >= 2 && core.every((w) => /^\p{Script=Arabic}+$/u.test(w));
  return masked === core.length || nameLike || (honorific > 0 && core.length <= 2);
}

/**
 * The length of the leading vocative to drop ("‹name› ‹name›، …", "‹name› بی بی، …", "Sayma, …"), 0 when none. One
 * word before the comma is always the address ([v1.3c-5], unchanged); two or more only when they are a name.
 */
function leadingVocative(text) {
  const m = VOC.exec(String(text || ''));
  if (!m) return 0;
  const words = m[2].split(/\s+/).map((w) => w.replace(/[⁦-⁩]/g, '')).filter(Boolean);
  if (words.length === 1) return m[0].length;
  return vocativeWords(words, { partial: true }) ? m[0].length : 0;
}

/** A reason that quotes a card still opening with a name (two or more words), at its start or after a quote mark. */
function quotedVocative(text) {
  const s = String(text || '');
  const starts = [0, ...[...s.matchAll(/["“«]/g)].map((m) => m.index + 1)];
  return starts.some((i) => {
    const m = VOC.exec(s.slice(i));
    if (!m) return false;
    const words = m[2].split(/\s+/).map((w) => w.replace(/[⁦-⁩]/g, '')).filter(Boolean);
    return words.length >= 2 && vocativeWords(words, { partial: true }); // red7 155809: the same shape on the reason path
  });
}

// ── gender-neutral Urdu (26 panel rows; root CLAUDE.md rule 19) ────────────────────────────────────────────────────────
// A teacher (the reader, or the one in the clip) takes the respectful plural: «استاد … کرتے ہیں», «آپ … کریں». A clause
// whose subject is a teacher and whose verb is singular or feminine is gendered; a clip or a report is not a person
// («یہ کلپ دکھاتا ہے», «آپ کی رپورٹ کہتی ہے» are right).
const FEMININE_TEACHER = /استاذہ|معلمہ|استانی|ٹیچر صاحبہ/u;
// The teacher as SUBJECT: not «استاد کو / کی / کا / کے / سے / نے / پر» (object, possessive, ergative).
const TEACHER_SUBJECT = /(?:^|\s)(?:استاد|استاذ|ٹیچر|معلم|آپ)(?!\s+(?:کو|کی|کا|کے|سے|نے|پر)(?=\s|$))(?=\s|$)/gu;
// Another subject between the teacher and the verb (a clip, the report, the questions, the children) owns the verb; a
// marked object («سوال کو», «سوال میں») does not. After «آپ» a feminine plural verb is always the reader's.
const OTHER_SUBJECT = /(?:^|\s)(?:کلپ|clip|ویڈیو|video|رپورٹ|سوال|سوالات|بچہ|بچے|بچی|طلبہ|طالب|کلاس|جماعت|گروپ)(?!\s+(?:کو|کی|کا|کے|سے|میں|پر|نے)(?=\s|$))(?=\s|$)/iu;
const SINGULAR = /\S(?:تا|تی)\s+(?:ہے|تھا|تھی)(?=$|\s)|\s(?:رہا|رہی)\s+(?:ہے|تھا|تھی)(?=$|\s)|\S\s+(?:گا|گی)(?=$|\s)/u;
// …and a feminine adjective predicate («استاد کھڑی ہیں», red7 REVIEW_3630 G12).
const FEMININE_PLURAL = /\S(?:تی|رہی)\s+(?:ہیں|تھیں)(?=$|\s)|\s(?:رہی|سکتی|چکی)\s+(?:ہیں|تھیں)(?=$|\s)|\S\s+گی(?=$|\s)|\s(?:کھڑی|بیٹھی|تھکی|اچھی)\s+(?:ہیں|تھیں)(?=$|\s)/u;

/** reason_ur speaks of a teacher in a gendered form (a feminine noun, or a singular / feminine verb of a teacher subject). */
function genderedUrdu(text) {
  const s = String(text || '').replace(/[\u2066-\u2069]/g, '').replace(/"[^"]*"|“[^”]*”|«[^»]*»/g, '،');
  if (FEMININE_TEACHER.test(s)) return true;
  return s.split(/[،؛۔.!?؟:]|\sکہ\s|\sاور\s|\sجبکہ\s|\sپھر\s/u).some((clause) => [...clause.matchAll(TEACHER_SUBJECT)].some((m) => {
    const you = m[0].trim() === 'آپ';
    const rest = clause.slice(m.index + m[0].length);
    const verb = (you ? FEMININE_PLURAL : new RegExp(`${SINGULAR.source}|${FEMININE_PLURAL.source}`, 'u')).exec(rest);
    return !!verb && (you || !OTHER_SUBJECT.test(rest.slice(0, verb.index + 1)));
  }));
}

// ── scorer or system text in the teacher line (P003, P005, P013, P014, P016) ───────────────────────────────────────────
const SYSTEM_NOTE = /\bno [\w\s'-]{0,30}?\b(?:was|were) (?:observed|recorded|seen|noted)\b|\bno (?:student|pupil|child|children|material|pair|group|peer)[\w\s'-]{0,30}?\b(?:recorded|referenced|appears?|observed|evident|noted|detected)\b|\bnot (?:recorded|referenced|observed)\b|\(no [^)]{0,60}\)/i;

/** A scorer's or the system's own note («No student activity recorded», «(no material use referenced)»). */
function systemNote(text) {
  return SYSTEM_NOTE.test(String(text || ''));
}

// ── the reason describes what the CLIP shows (≥ 36 panel rows: wait time, cold-call, why-probes it never shows) ────────
// Each claim a reason makes about the clip must have a word for it in the chapter's own title, summary, keywords or moves.
// (red7 REVIEW_3630 F3: keywords carry transcript words; dropping them refuses 805 of 2,200 first answers instead of 343
// on the 3efb501 view, a cost for the COS to choose, so they stay.)
const CLIP_CLAIMS = [
  [/\bwait(?:s|ing)?\b(?! for the (?:answer|class))|\bpaus(?:e|es|ing)\b|\bsilen(?:t|ce)\b|\bthinking time\b/i, /wait|pause|silen|think time|thinking time/i],
  [/\bcold[- ]?call/i, /cold|no hands|names? a (?:student|child)|calls? on/i],
  [/think[- ]pair[- ]share|\bpairs?\b|\bpartners?\b/i, /pair|partner/i],
  [/\bwhy\b|\bhow do you know\b/i, /why|reason|explain|justify|how/i],
  [/\bexit ticket/i, /exit/i],
  [/\broles?\b/i, /role/i],
  [/\btimers?\b/i, /timer/i],
  [/\bsentence (?:starters?|stems?|frames?)\b/i, /starter|stem|frame/i],
  // R7c (panel §3.5, §4: Q045 Q037 Q117): easy and hard sheets, support/stretch sentences, children's summaries
  [/\b(?:easy|easier)\b[^.]{0,40}\b(?:hard|harder|difficult)\b|\bsupport (?:and|or) stretch\b|\bstretch (?:task|question|sentence)s?\b/i, /easy|hard|difficult|level|tier|stretch|support/i],
  [/\b(?:students?|children|child|pupils?) (?:write |give |make )?(?:a )?summar/i, /summar/i],
];

/**
 * reason_en says the clip shows something its chapter does not: the sentence that names the clip, quotes removed, holds
 * a claim with no word for it in the chapter's own text. A phrase "the teacher could say" is a quote and is not a claim.
 */
function unshownClaim(reasonEn, segment) {
  const s = String(reasonEn || '').replace(/[⁦-⁩]/g, '').replace(/"[^"]*"|“[^”]*”|«[^»]*»|'[^']*'/g, ' ');
  const at = s.search(/\b(?:clip|video|chapter)\b/i);
  if (at < 0 || !segment) return false;
  const end = s.slice(at).search(/[.!?;](?:\s|$)/);
  const span = end < 0 ? s.slice(at) : s.slice(at, at + end);
  const doc = [segment.title_en, segment.summary_en, ...(segment.keywords || []), ...(segment.moves || [])].join(' ').replace(/_/g, ' ');
  return CLIP_CLAIMS.some(([claim, evidence]) => claim.test(span) && !evidence.test(doc));
}

// ── a child's name inside the card sentence a fallback quotes (R7c ⛔9, COS 20261023T170515 §1; panel Q168 Q174 Q181 Q193) ─
// The fallback quotes the report's sentence, which can name a child mid-sentence ("when a child like X answers", "before
// calling on X Y or another quiet voice", «کوئی بچہ X کی طرح»). The non-strict output redactor knows only its lexicon, and
// the strict one masks a subject word in 6 of 10 Urdu cards, so a name is found by its SLOT: a placeholder token; a
// capitalised Latin word the strict redactor masks anywhere but the sentence's first word, unless an Urdu word stands
// before it (an English term in an Urdu sentence, «… Think-Pair-Share کرائیں»); the capitalised word after a name or a
// placeholder; an Urdu word after a kinship, praise or example cue, or before «کی طرح / جیسا», that is not an everyday
// or lesson word (red7 H1/H2: «Ask X why…», «بیٹا X سے پوچھیں» with a name no lexicon knows). A comparison that only
// names the child is dropped («like X», «X کی طرح», "X or another" → "another"); any other name refuses the fallback.
const NAME_MARK = '\u0000';
const CHILD_TOKEN = /\[(?:CHILD|a student|STUDENT)\]|‹name›/g;
const CUE_BEFORE = new Set('بیٹا بیٹے بیٹی شاباش مثلاً مثلا جیسے'.split(' '));
// A child noun is a cue too («بچی X نے …», red7 A25), unless the word after it is a verb: «جو بچہ اٹک جائے» (N1)
const CHILD_CUE = new Set('بچہ بچی بچے طالبہ'.split(' '));
const LIGHT_VERB = /^\s*(?:جائے|جاتا|جاتی|جاتے|جائیں|گیا|گئی|گئے|ہو|ہے|ہیں|ہوں|رہا|رہی|رہے|سکے|سکیں|کرے|کریں|دے|دیں|لے|لیں|پائے)(?=\s|$|[،,.۔؟])/u;
const normUr = (t) => t.replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[ةه]/g, 'ہ').replace(/[\u064B-\u0670\u0640\u200C\u200D]/g, '');
const UR_KNOWN = new Set([...LEX.urCommon, ...LEX.vocab]); // everyday and lesson words (name-lexicon.js)
// …but a lexicon name stays a name in a cue slot, even one that is also a word («تبسم», red7 A23/A29)
const UR_NAME = new Set([...LEX.urStrong, ...LEX.urAmbig]);
const CUE_AFTER = /^\s*(?:کی طرح|کے جیسا|کے جیسی|کے جیسے|جیسا|جیسی|جیسے)(?=\s|$|[،,.۔])/u;
const OPENS = /(?:^|[.!?;:—–(\[«"“‘'۔؟]|\s[-–—])\s*$/u;
const LATIN_CAP = /^[A-Z][a-z]+$/;
// Title-case words a card uses mid-sentence that are not people (2,990 r7 cards: 228 «the Taleemabad lesson plan», 25
// «activate Prior Knowledge»)
const NOT_A_NAME = new Set(('taleemabad prior rumi niete bloom checker reporter speaker listener recorder writer explainer scribe '
  + 'reader timekeeper leader manager spotter matcher underliner encourager questioner summariser summarizer').split(' '));
// A Title-case word inside a Title-case term is the term («Subject-Specific Pedagogy», «Use of Technology», «Student-to-Student
// Interaction»: 2,990 r7 cards), unless the word before it opens the sentence («Ask X why …»).
const IN_TERM = /([A-Z][a-z]+)(?:-|\s+(?:of|to|and|&|for|the|in)\s+|\s+)$/;
const N = `${NAME_MARK}N${NAME_MARK}`;
const NAMES = `${N}(?:['’]s)?(?:\\s+(?:and|or|اور)\\s+${N}(?:['’]s)?)*(?:\\s+${N})*`;
const DROPS = [
  [new RegExp(`\\s*,?\\s*\\b(?:like|such as|e\\.g\\.,?|for example,?)\\s+${NAMES}`, 'g'), ''],
  [new RegExp(`${NAMES}\\s+or\\s+(?=another\\b|other\\b|a\\b)`, 'g'), ''],
  [new RegExp(`\\s*${NAMES}\\s+(?:کی طرح|کے جیسا|کے جیسی|کے جیسے|جیسا|جیسی|جیسے)(?=\\s|$|[،,.۔])`, 'gu'), ''],
];

/**
 * The card sentence with every comparison that names a child dropped, or null when a child's name (or a placeholder) is
 * still in it. `vocab`/`oovVocab` as redact-names.js; `teacher` is users.name.
 */
function childFreeCard(sentence, { teacher = null, vocab = [], oovVocab = [], why = null } = {}) {
  const s = String(sentence || '');
  const trace = [];
  redactNames(s, { teacher, placeholders: { child: '[a student]' }, vocab, oovVocab, trace });
  const masked = new Set(trace.filter((t) => t.rep === '[a student]').map((t) => t.word));
  const hit = (k) => { if (why) why.push(k); return N; };
  let marked = s.replace(CHILD_TOKEN, () => hit('token'));
  let nameEnd = -1; // a masked word right after a name is its surname («X Y or another quiet voice», Q174)
  const own = new Set([...vocab, ...oovVocab].map((v) => normUr(String(v))));
  marked = marked.replace(/[A-Za-z]+|[؀-ۿ‌]+/g, (w, at, all) => { // «X's» is X, as the redactor reads it
    if (NOT_A_NAME.has(w.toLowerCase())) return w;
    const before = all.slice(0, at);
    const latin = LATIN_CAP.test(w);
    // after a placeholder, a capitalised word is the rest of the name even when it is also a word («[a student] Rani», Q174)
    const afterName = latin && (new RegExp(`${N}\\s+$`).test(before) || (nameEnd >= 0 && /^\s+$/.test(all.slice(nameEnd, at))));
    if (afterName || (masked.has(w) && nameEnd >= 0 && /^\s+$/.test(all.slice(nameEnd, at)))) { nameEnd = at + w.length; return hit('surname'); }
    if (latin) {
      const first = !/[\p{L}\p{N}]/u.test(before.replace(new RegExp(N, 'g'), ''));
      const prevWord = (before.match(/([\p{L}]+)[^\p{L}]*$/u) || [])[1] || '';
      const term = IN_TERM.exec(before);
      const inTerm = !!term && /[\p{L}]/u.test(before.slice(0, term.index)) && !new RegExp(`${N}$`).test(before.slice(0, term.index + term[1].length));
      if (!masked.has(w) || first || inTerm || /[؀-ۿ]/.test(prevWord)) return w;
      nameEnd = at + w.length;
      return hit(`latin${why && why.words ? `:${w}` : ''}`);
    }
    if (!/[؀-ۿ]/.test(w)) return w;
    const n = normUr(w);
    const unknown = masked.has(w) || UR_NAME.has(n) || (!UR_KNOWN.has(n) && !own.has(n));
    const prev = (before.match(/([؀-ۿ]+)[\s،,]*$/u) || [])[1];
    const childCue = prev && CHILD_CUE.has(prev) && !LIGHT_VERB.test(all.slice(at + w.length));
    if (unknown && prev && (CUE_BEFORE.has(prev) || childCue)) { nameEnd = at + w.length; return hit(`cue:${prev}`); }
    return unknown && CUE_AFTER.test(all.slice(at + w.length)) ? hit('cue:after') : w;
  });
  if (!marked.includes(NAME_MARK)) return s;
  for (const [rx, to] of DROPS) marked = marked.replace(rx, to);
  return marked.includes(NAME_MARK) ? null : marked.replace(/\s{2,}/g, ' ').trim();
}

// ── what the clip IS, and what the cited line IS (R7c, COS 20261023T170515 §5; panel §3.2, §3.5, §4: 51 rows) ─────────
// Most chapters are a conversation, a podcast, a trainer's talk, slides or an animation, not a class: the reason must say
// the clip explains or discusses the move, never that it "shows a teacher" doing it. `mixed` footage is not judged.
const CONVERSATION = /dramatis|conversation|podcast|interview|talk through|two-voice|scripted/i;

/** 'conversation' | 'talk' | 'slides' | 'animation' | 'footage' (mixed or unknown: not judged). */
function clipKind(module) {
  const m = module || {};
  if (CONVERSATION.test(String(m.summary_en || ''))) return 'conversation';
  return { talking_head: 'talk', slides: 'slides', animation: 'animation' }[m.format] || 'footage';
}

const SCENE_EN = /\b(?:shows?|showing|see|watch|models?)\s+(?:a|the|another|one)\s+teacher\b|\b(?:a|the) teacher in the (?:clip|video)\b|\bin (?:the|this) (?:clip|video),? (?:a|the) teacher\b/i;
const SCENE_UR = /(?:کلپ|ویڈیو) میں (?:ایک )?(?:استاد|ٹیچر)|دکھا(?:تا|تی|تے) (?:ہے|ہیں) کہ (?:ایک )?(?:استاد|ٹیچر)/u;

/** A reason that says the clip shows a teacher doing the move, on a chapter that is not classroom footage. */
function sceneClaim(reasonEn, reasonUr, module) {
  if (clipKind(module) === 'footage') return false;
  const bare = (t) => String(t || '').replace(/[⁦-⁩]/g, '').replace(/"[^"]*"|“[^”]*”|«[^»]*»/g, ' ');
  return SCENE_EN.test(bare(reasonEn)) || SCENE_UR.test(bare(reasonUr));
}

const WHY_HOW_Q = /کیوں|کیسے|\bwhy\b|\bhow\b(?! are you)/iu;
// R7d §6 (COS 184404): a what-question is never called "recall" either. Not a refusal (on the 600 that refused 46 shown
// answers, most of them right): the label is rewritten to a plain "question". «کیا» counts only inside the question (at
// its start it is the yes/no particle: «کیا یہ مثلث ہے؟»).
const WHAT_Q = /\bwhat\b|(?<=\S\s+)کیا(?=\s|[؟?]|$)/iu;
const RELABEL = {
  en: [[/\b(?:a |an )?(?:(?:quick|simple|short|basic) )?(?:recall|memory|memori[sz]ation|factual|fact|closed|one-word)(?:[- ]based)? question/gi, 'a question'],
    [/\b(?:asks?|asked|asking) for (?:quick |simple )?recall\b/gi, (m) => m.replace(/for (?:quick |simple )?recall/i, 'a question')],
    [/\b(?:quick |simple )?recall\b/gi, 'question']],
  ur: [[/(?:ایک )?(?:یادداشت|یاد داشت|یاداشت|یاددہانی|ریکال)(?: پر مبنی| والا| کا| کے| کی)? سوال/gu, 'سوال'],
    [/(?:یادداشت|یاد داشت|یاداشت|یاددہانی|ریکال)/gu, 'سوال']],
};

/** The lesson half of a reason with the recall label replaced, when the cited line asks what (en or ur). */
function relabelRecall(text, l, quote) {
  if (typeof text !== 'string' || !WHAT_Q.test(String(quote || '')) || WHY_HOW_Q.test(String(quote || ''))) return text;
  const at = text.search(l === 'ur' ? /کلپ|ویڈیو/u : /\b(?:clip|video|chapter)\b/i);
  const head = at < 0 ? text : text.slice(0, at);
  return (RELABEL[l] || []).reduce((t, [rx, to]) => t.replace(rx, to), head) + (at < 0 ? '' : text.slice(at));
}
const RECALL_EN = /\brecall\b|\bmemori[sz]|\bfact(?:ual)? question|\bclosed question|\byes[/ -]?(?:or[/ -])?no question|\bone-word question/i;
const RECALL_UR = /یادداشت|یاد داشت|یاداشت|یاددہانی|رٹا|ہاں یا نہیں والا|ہاں\/نہیں والا|بند سوال/u;

// Only the lesson side of a reason labels the cited line: the text before it turns to the clip («turn a yes/no question
// into a why question» describes the clip, not the line).
const lessonSide = (t, clip) => { const s = String(t || ''); const i = s.search(clip); return i < 0 ? s : s.slice(0, i); };

/** The cited line asks why or how, and the reason calls it recall (Q146 Q119 Q141 Q149: coaching what the teacher did). */
function recallMislabel(quote, reasonEn, reasonUr) {
  return WHY_HOW_Q.test(String(quote || ''))
    && (RECALL_EN.test(lessonSide(reasonEn, /\b(?:clip|video|chapter)\b/i)) || RECALL_UR.test(lessonSide(reasonUr, /کلپ|ویڈیو/u)));
}

module.exports = { leadingVocative, quotedVocative, genderedUrdu, systemNote, unshownClaim, childFreeCard, clipKind, sceneClaim, recallMislabel, relabelRecall };
