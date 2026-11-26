/**
 * "Played" in the reminder funnel: a quiz page opened from the child reminder (the push's url carries ?from=push, the
 * same test the edge uses for push_landed) says so on its page_open: via 'push'. The daily read counts those. Every other
 * page_open keeps today's via. Runs the whole shipped page in the harness's vm, then the bot's allow-list over what the
 * page sent. Invented children only.
 */
const { page } = require('./wq-page-harness');

jest.mock('../../bot/shared/config/supabase', () => ({}));
process.env.WEB_QUIZ_TOKEN_SECRET = 'test-secret';
const { cleanEvent } = require('../../bot/shared/services/quiz/web-quiz.service');

function sent(p) {
  p.fireWin('pagehide');
  return p.fetches.filter((f) => f.url === '/api/wq/e').flatMap((f) => JSON.parse(f.init.body).events);
}
const opened = (p) => sent(p).filter((e) => e.n === 'page_open')[0];

describe('page_open via push', () => {
  test.each(['en', 'ur'])('?from=push: via push, kept by the allow-list (%s)', (lang) => {
    const o = opened(page({ lang, search: '?from=push' }));
    expect(o.via).toBe('push');
    expect(cleanEvent(o).props.via).toBe('push');
  });
  test('from=push wins over a shared card\'s ?a= (the reminder opened it)', () => {
    expect(opened(page({ lang: 'en', search: '?a=c.abc&from=push' })).via).toBe('push');
  });
  test.each([
    [{ search: '?from=hs' }, 'direct'],
    [{ search: '?from=pushy' }, 'direct'],
    [{ search: '?a=c.abc' }, 'card'],
    [{}, 'direct'],
  ])('anything else keeps today\'s via (%j → %s)', (opts, via) => {
    expect(opened(page({ lang: 'en', ...opts })).via).toBe(via);
  });
});
