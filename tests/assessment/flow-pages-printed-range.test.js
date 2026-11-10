/**
 * bd-ehz254.7 — the Flow's PAGES screen bounds typed pages on the book's last PRINTED page,
 * not textbooks.total_pages (a count of page rows). G9 Computer Science has 66 page rows but
 * prints pages up to 71, so a teacher typing "65-70" was told "This book has pages 1-66".
 */
const H = require('./helpers/golden-g1-5');

let state;
let Flow;
function load() {
  jest.resetModules();
  state = {
    rows: {}, seq: 0, updates: [], settings: {}, queued: [], redis: new Map(),
    tables: {
      textbooks: [{ id: 'book-3-english', curriculum: 'ict', grade: 3, subject: 'english', total_pages: 66 }],
      textbook_pages: [65, 70, 71].map((n) => ({ textbook_id: 'book-3-english', textbook_page_number: n })),
    },
  };
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
  jest.doMock('../../bot/shared/config/supabase', () => H.fakeDb(state));
  jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
    get: async (k) => (state.redis.has(k) ? JSON.parse(state.redis.get(k)) : null),
    set: async (k, v) => { state.redis.set(k, JSON.stringify(v)); return true; },
    setNX: async (k, v) => (state.redis.has(k) ? false : (state.redis.set(k, JSON.stringify(v)), true)),
    delete: async (k) => { state.redis.delete(k); return true; },
  }));
  jest.doMock('../../bot/shared/services/queue', () => ({ queueJob: async () => ({ messageId: 'm' }) }));
  const Real = jest.requireActual('../../bot/shared/services/assessment/book-content.service');
  jest.doMock('../../bot/shared/services/assessment/book-content.service', () => ({ ...Real, listChapters: async () => [] }));
  Flow = require('../../bot/shared/routes/assessment-gen-endpoint');
}

async function toPages(token) {
  const user = 'u-pages-1';
  await Flow.handleAssessmentGenInit(user, token);
  await Flow.handleAssessmentGenDataExchange(user, 'CLASS', { grade: '3', trigger: 'grade_selected' }, token);
  const pages = await Flow.handleAssessmentGenDataExchange(user, 'CLASS', { grade: '3', subject: 'english' }, token);
  return { user, pages };
}

describe('Flow PAGES screen bounds on the last printed page', () => {
  it('accepts 65-70 on a 66-row book that prints to 71', async () => {
    load();
    const { user } = await toPages('flow-pages-2');
    const out = await Flow.handleAssessmentGenDataExchange(user, 'PAGES', { page_ranges: '65-70' }, 'flow-pages-2');
    expect(out.screen).toBe('QUESTIONS');
  });

  it('refuses 72 and names 71', async () => {
    load();
    const { user } = await toPages('flow-pages-3');
    const out = await Flow.handleAssessmentGenDataExchange(user, 'PAGES', { page_ranges: '70-72' }, 'flow-pages-3');
    expect(out.screen).toBe('PAGES');
    expect(out.data.error).toBe('This book has pages 1-71. You asked for 72.');
    expect(out.data.hint).toBe('This book has pages 1-71.');
  });

  it('a typo still hints the last printed page', async () => {
    load();
    const { user } = await toPages('flow-pages-4');
    const out = await Flow.handleAssessmentGenDataExchange(user, 'PAGES', { page_ranges: 'chapter six' }, 'flow-pages-4');
    expect(out.data.error).toBe('Try something like 4-14, or 4, 9, 12.');
    expect(out.data.hint).toBe('This book has pages 1-71.');
  });
});
