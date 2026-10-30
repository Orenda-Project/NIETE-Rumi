'use strict';
/**
 * G2 Urdu Q8 prints no topic (v29 blocker, bd-5jmnfj.4.58). The slot's instruction is «دیے گئے موضوع پر پانچ
 * جملے لکھیں۔» and the paper prints the item's `question` under it, but the model put the topic in `main_question`
 * («اپنے اسکول کے بارے میں پانچ جملے لکھیں۔») and left `question` empty, so the child saw «the given topic» and no
 * topic. The topic is taken from main_question, else from the marking points («اسکول کے موضوع پر»), and printed as a
 * short line («موضوع: میرا اسکول»). An item with no topic anywhere is not ok: the slot's `answer_ok` returns false,
 * so fde-early-prompt's answerShortfall flags it and the section is asked again.
 *
 * Pure: {examJson, notes}.
 */

const { mapItems } = require('./fde-early-urdu-walk');

const TOPIC_TYPE = 'Topic Sentences';
const GIVEN = /دیے\s+گئے\s+موضوع/u;
const POSSESSIVE = new Map([['اپنے', 'میرا'], ['اپنا', 'میرا'], ['اپنی', 'میری'], ['ہمارے', 'ہمارا']]);

const blank = (s) => !String(s == null ? '' : s).trim();
const strip = (s) => String(s || '').replace(/[۔.؟!:]+$/u, '').trim();

/** The phrase a «X کے بارے میں … جملے» instruction names, with a possessive turned into the nominative. */
function fromInstruction(text) {
  const m = /^(.+?)\s+(?:کے\s+بارے\s+میں|پر)\s+.*جملے/u.exec(strip(text));
  if (!m || /موضوع/u.test(m[1])) return '';
  const words = m[1].trim().split(/\s+/);
  if (POSSESSIVE.has(words[0])) words[0] = POSSESSIVE.get(words[0]);
  return words.join(' ');
}

function fromScheme(q) {
  const texts = [].concat(((q.scheme && q.scheme.points) || []).map((p) => p && p.text), q.scheme && q.scheme.common_error);
  for (const t of texts) {
    const m = /(\S+)\s+کے\s+موضوع\s+پر/u.exec(String(t || ''));
    if (m && !/جملہ|درست/u.test(m[1])) return m[1];
  }
  return '';
}

/** «موضوع: …» for an item, or '' when neither main_question nor the scheme names one. */
function topicLine(q) {
  const topic = (typeof q.topic === 'string' && q.topic.trim()) || fromInstruction(q.main_question) || fromScheme(q);
  return topic ? `موضوع: ${topic}` : '';
}

/** True when `question` already carries a topic, or one can be found for it. */
function topicOk(q) {
  return (!blank(q.question) && !GIVEN.test(q.question)) || topicLine(q) !== '';
}

function fillTopics(examJson) {
  const notes = [];
  const out = mapItems(examJson, (q, type) => {
    if (type !== TOPIC_TYPE || (!blank(q.question) && !GIVEN.test(q.question))) return q;
    const line = topicLine(q);
    if (!line) return q;
    notes.push(`${q.slot}: the topic was missing from the printed stem and was set to «${line}»`);
    return { ...q, question: line };
  });
  return { examJson: out, notes };
}

module.exports = { topicLine, topicOk, fillTopics };
