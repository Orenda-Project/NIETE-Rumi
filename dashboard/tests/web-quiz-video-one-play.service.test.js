/**
 * The adventure look (<html class="wq-adv">, app_settings web_quiz_adventure_look) on the lesson video page: one play
 * button at 0:00 (the big cover); the player's own controls come only once it plays. Without the look the player has its
 * controls from the start, as today. Invented children only.
 */
const { page } = require('./wq-page-harness');

const ADV = { htmlClass: ['wq-adv'] };

function videoPage(lang, adv) {
  const p = page({ lang, search: '?k=kk&via=videos', video: { url: 'https://r2.example/v.mp4', poster: 'https://r2.example/p.jpg' }, bootExtra: { videos_v3: true, nav: { home: true }, ...(adv ? { adv: true } : {}) }, ...(adv ? ADV : {}) });
  p.wq.S.st = 'st1';
  p.wq.video();
  return p;
}

describe('one play button on the lesson video page at 0:00', () => {
  for (const lang of ['en', 'ur']) {
    test(`${lang}: with the look the player has no controls until it plays, then it has them`, () => {
      const p = videoPage(lang, true);
      expect(p.html()).toContain('<video class="wq-video" playsinline preload="none"');
      expect(p.html()).not.toMatch(/<video[^>]* controls/);
      p.els.video.fire('play');
      expect(p.els.video.attrs.controls).toBe('');
    });
  }
  test('without the look: today\'s player with its controls from the start', () => {
    expect(videoPage('en', false).html()).toContain('<video class="wq-video" controls playsinline preload="none"');
  });
});
