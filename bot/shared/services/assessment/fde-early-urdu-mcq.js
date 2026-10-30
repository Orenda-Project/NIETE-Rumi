'use strict';
/**
 * Early Urdu Q1 MCQ checks (v29 should-fix, bd-5jmnfj.4.58). Slot `answer_ok` hooks: a false answer sends the item
 * to the writer's existing re-ask (Prompt.answerShortfall).
 *   - G2 Q1 sits under «الفاظ اور قواعد» but vi-viii asked the poet, the event, who said it: recall, not words or grammar.
 *   - G1 Q1 vi and ix were join-letters items («ب + ا + غ»), the construct Q3 already tests.
 * Pure: an item in, a boolean out.
 */

const text = (q) => [q && q.question, q && q.main_question].filter(Boolean).join(' ').normalize('NFC');

const RECALL = [
  /شاعر|شاعرہ|مصنف|لکھاری|نظم\s+کس|سبق\s+کس/u,
  /کس\s+نے\s+(?:کہا|لکھا|بولا|کیا|بنایا)/u,
  /(?:کہانی|سبق|نظم)\s+میں\s+.*(?:کیا\s+(?:کیا|ہوا|کہا)|کون\s+)/u,
  /(?:کہانی|سبق|نظم)\s.*میں\s.*کس\s+نے/u, // v29 vii, viii: «سبق "…" میں … کس نے سکھایا / پکڑ رکھی تھیں»
];
const JOIN = [/\s\+\s/u, /جوڑ\s*کر/u, /ملا\s*کر\s+(?:لفظ|کون)/u];

const recall = (q) => RECALL.some((r) => r.test(text(q)));
const joinLetters = (q) => JOIN.some((r) => r.test(text(q)));

const g2Q1Ok = (q) => !recall(q);
const g1Q1Ok = (q) => !joinLetters(q);

module.exports = { g1Q1Ok, g2Q1Ok, recall, joinLetters };
