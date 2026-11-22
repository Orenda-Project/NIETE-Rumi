'use strict';
/**
 * Puts a model's board-pattern output into the pattern's shape.
 *
 * The model is told which slot each item belongs to and how many to write, and
 * mostly does it. This pass handles the rest without ever editing a question's
 * words: a slot tag written loosely, a renamed type ("MCQ"), an untagged item,
 * extra items (dropped and counted, never printed), and the model's own marks
 * (replaced by the pattern's). A slot that came back short is REPORTED, not
 * padded — the caller fails the paper, because a board rehearsal with a
 * missing question is not one.
 *
 * The result carries `_layout`: a copy of the subject's pattern as it stood at
 * generation time, so a later change to the pattern never changes a stored
 * paper, plus the scope, the teacher-supply lines and room for the page counts
 * and notes later stages write.
 *
 * Pure, no I/O.
 */

const { applyLayout } = require('./fde-layout/apply-layout');
const { firstAskNote } = require('./fde-layout/apply-phases');
const { CONCEPTS, LESSON_ONLY, STORY_ITEMS, conceptOf, oneStory, scopeLessons } = require('./fde-layout/names-concepts');
const { takenNote } = require('./fde-layout/notes');
const { slotKey, typeKey, unitWord, verseLines } = require('./fde-layout/scope-frames');

module.exports = {
  applyLayout, takenNote, firstAskNote, verseLines, typeKey, slotKey, unitWord, scopeLessons, conceptOf, oneStory, STORY_ITEMS,
  // The rows a concept is read by on any scope; antonym and synonym are concepts on lessons 4–5 only.
  conceptNames: CONCEPTS.map(([name]) => name).filter((name) => !LESSON_ONLY.has(name)),
};
