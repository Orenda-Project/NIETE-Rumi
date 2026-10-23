'use strict';
/**
 * Teacher-facing copy rules from the panel's 200 (bd-8hhqhf R7b, COS ruling 20261023T144730 2b; ped/REVIEW_r7_scale.md
 * §2, §4). Pure. select.js validates and builds the card fallback with them; copy.js composes with the digit rule.
 */
const { redactNames } = require('./redact-names');

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

module.exports = { leadingVocative, quotedVocative, genderedUrdu, systemNote, unshownClaim };
