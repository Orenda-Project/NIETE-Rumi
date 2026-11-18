/**
 * bd-pw1ccr.38 — a G1-2 topic paper's oral keeps only what the ticked pages can feed (Ramisha's
 * off-topic sheet: the annual oral's fixed themes — likes, mother, holidays, family, project — had
 * nothing to do with the pages). Reading tasks always stay; a poem or story listening task stays only
 * when the pages print one, and is told to use it; speaking tasks go. Marks are recounted.
 */
const { makeOral } = require('../patterns/early/chrome');

const POEM_OR_STORY = /\b(poem|story|rhyme)s?\b|نظم|کہانی|شعر/i;
const FROM_PAGES = 'Use the poem or story printed on these pages, quoting it as the book prints it; never write a new one. ';

function hasPoemOrStory(text) {
  return POEM_OR_STORY.test(String(text || ''));
}

function pagesOnly(oral, pageContent) {
  if (!oral || !Array.isArray(oral.tasks)) return null;
  const listen = hasPoemOrStory(pageContent);
  const tasks = oral.tasks
    .filter((t) => t.kind === 'read_aloud' || (t.kind === 'listening' && listen))
    .map((t) => (t.kind === 'listening' ? { ...t, ask: FROM_PAGES + t.ask } : t));
  if (!tasks.length) return null;
  const { marks, ...rest } = oral;
  return makeOral({ ...rest, tasks });
}

module.exports = { pagesOnly, hasPoemOrStory };
