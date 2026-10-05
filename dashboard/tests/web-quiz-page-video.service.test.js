/**
 * Web quiz page: the lesson video box (M5). A tap anywhere starts it; with no poster a friendly
 * cover (Jugnu + a big play button) shows instead of a dark box.
 */
const { page, rule } = require('./wq-page-harness');

describe('the lesson video box', () => {
  test('tapping anywhere on the box starts a paused video', () => {
    const p = page({ lang: 'en', video: { url: 'https://r2.example/v.mp4' } });
    p.wq.video();
    expect(p.html()).toMatch(/<div class="wq-vbox"><video [^>]*><\/video><button class="wq-vcover/);
    const vid = p.els['video'];
    vid.paused = true;
    p.els['.wq-vcover'].fire('click');
    expect(vid.played).toBe(1);
  });

  test('a tap while it plays does not restart it (the native controls handle pause)', () => {
    const p = page({ lang: 'en', video: { url: 'https://r2.example/v.mp4' } });
    p.wq.video();
    const vid = p.els['video'];
    vid.paused = false;
    p.els['.wq-vcover'].fire('click');
    expect(vid.played).toBeUndefined();
  });

  test('no poster: a friendly cover (Jugnu + a big play button) instead of a dark box', () => {
    const p = page({ lang: 'ur', video: { url: 'https://r2.example/v.mp4' } });
    p.wq.video();
    expect(p.html()).toContain('class="wq-vcover"');
    expect(p.html()).toContain('<img src="/wq/jugnu_hello.webp" alt="" class="wq-vjug">');
    expect(p.html()).toContain('class="wq-vplay"');
  });

  test('with a poster the poster shows under a clear tap-to-play cover (no Jugnu)', () => {
    const p = page({ lang: 'en', video: { url: 'https://r2.example/v.mp4', poster: 'https://r2.example/p.jpg' } });
    p.wq.video();
    expect(p.html()).toContain('poster="https://r2.example/p.jpg"');
    expect(p.html()).toContain('class="wq-vcover wq-vposter"');
    expect(p.html()).not.toContain('/wq/jugnu_hello.webp" alt="" class');
  });

  test('the cover goes away once the video plays', () => {
    const p = page({ lang: 'en', video: { url: 'https://r2.example/v.mp4' } });
    p.wq.video();
    const cover = p.els['.wq-vcover'];
    p.els['video'].fire('play');
    expect(cover.hidden).toBe(true);
  });

  test('the stylesheet has the cover and its big play button', () => {
    expect(rule('.wq-vbox')).toMatch(/position:relative/);
    expect(rule('.wq-vcover')).toMatch(/position:absolute/);
    expect(rule('.wq-vplay')).not.toBeNull();
    expect(rule('.wq-vcover[hidden]')).toMatch(/display:none/);
  });
});
