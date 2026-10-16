'use strict';
/**
 * Fixed inputs for the maker page's byte-identity golden: the page rendered with no addons must hash exactly as the
 * page before the addon hook existed (the hashes in maker.tour.test.js were taken from that page).
 */
const qid = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TREE = Object.freeze({
  4: { maths: [{ quizId: qid(2), topic: 'Fractions', qlang: 'en' }, { quizId: qid(13), topic: 'Shapes', qlang: null }] },
  5: { science: [{ quizId: qid(11), topic: 'Magnets', qlang: 'ur' }] },
});
const READY = { grade: '4', subject: 'maths', topic: 'Fractions', qlang: 'en', message: 'Play the quiz', preview: 'First question of Fractions', total: 10, shareCodeId: qid(77) };
const CASES = Object.freeze({
  en_menu: { token: 'tok.en', lang: 'en', via: 'menu', tree: TREE },
  ur_door: { token: 'tok.ur', lang: 'ur', via: 'door', tree: TREE },
  bi_switch: { token: 'tok.bi', lang: 'ur', switchTo: 'en', via: 'empty', tree: TREE },
  en_prefill: { token: 'tok.pf', lang: 'en', via: 'menu', tree: TREE, pf: 'grade_4|maths' },
  ur_ready: { token: 'tok.rd', lang: 'ur', via: 'door', tree: TREE, ready: READY },
  en_view: { token: 'tok.vw', lang: 'en', via: 'menu', tree: TREE, view: { screen: 'topic', grade: '4', subject: 'maths' } },
});
module.exports = { CASES, TREE };
