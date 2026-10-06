'use strict';
/**
 * Child test battery v3 (CONTRACT §21.2): the full EGRA/EGMA battery as 18 tasks, one voice note and
 * one child_test_blocks row each, in visit order (the May 2026 RWP order, with Urdu made-up words
 * placed where English has them; maths in Core EGMA order). Every lane imports this list.
 */

const READING = ['listening', 'letters', 'nonwords', 'words', 'story'];
const MATHS = ['number_id', 'discrimination', 'missing', 'add1', 'sub1', 'add2', 'sub2', 'word_problems'];
const PREFIX = { urdu: 'ur', english: 'en', maths: 'ma' };
const BLOCK_OF_PREFIX = { ur: 'urdu', en: 'english', ma: 'maths' };

const TASKS_V3 = Object.freeze([
  ...READING.map((k) => `${PREFIX.urdu}.${k}`),
  ...READING.map((k) => `${PREFIX.english}.${k}`),
  ...MATHS.map((k) => `${PREFIX.maths}.${k}`),
]);

/** Storage names: the v1/v2 blocks, then the v3 tasks (migration V1.6.1 widens the CHECK to these). */
const BLOCK_NAMES = Object.freeze(['urdu', 'english', 'maths', ...TASKS_V3]);

const isTask = (id) => TASKS_V3.includes(id);
const blockOf = (id) => (isTask(id) ? BLOCK_OF_PREFIX[id.split('.')[0]] : null);
const kindOf = (id) => (isTask(id) ? id.split('.')[1] : null);
const tasksOfBlock = (block) => TASKS_V3.filter((t) => blockOf(t) === block);

module.exports = { TASKS_V3, BLOCK_NAMES, isTask, blockOf, kindOf, tasksOfBlock };
