/* A storybook the teacher sent, opened from the class link (/q/<code>; app_settings web_quiz_stories_teacher). The edge
   loads this file only when the page's boot carries `story`. The page asks who is playing exactly as for a quiz, then:
   the landing names a story (copy), and after the join the child's hub opens on the book (open): the hub door with
   story:1 → /h/<token>?from=link#story/<id>, the book on its first page. A teacher's own preview of the link stays here. */
(function () {
  'use strict';
  var BOOK_RX = /^[0-9a-f-]{36}$/i;
  var COPY = {
    en: { hello: 'Assalam o Alaikum! Let\'s read a story together.', meta: 'A story to listen to and read', play: 'Open the story', playAs: function (n) { return 'Open the story as ' + n; },
      forClass: 'This link opens the story for your class.' },
    ur: { hello: 'السلام علیکم! آئیں، کہانی پڑھیں۔', meta: 'سننے اور پڑھنے کے لیے ایک کہانی', play: 'کہانی کھولیں', playAs: function (n) { return n + '، کہانی کھولیں'; },
      forClass: 'یہ لنک آپ کی کلاس کے لیے کہانی کھولتا ہے۔' },
  };
  function words(lang) { return COPY[lang === 'ur' ? 'ur' : 'en']; }
  /** The page's copy with the story's landing lines. */
  function copy(T, lang) {
    var w = words(lang);
    var out = {};
    for (var k in T) if (Object.prototype.hasOwnProperty.call(T, k)) out[k] = T[k];
    out.hello = w.hello;
    out.meta = function () { return w.meta; };
    out.play = w.play;
    out.playAs = w.playAs;
    return out;
  }
  var going = false;
  /** After the join: the child's hub, on the book. Never a dead end: a refusal shows a kind word and the landing again. */
  function open(c) {
    var story = c.story || {};
    if (!BOOK_RX.test(String(story.id || ''))) { c.toast(c.T.oops); return c.landing(); }
    if (c.preview) { c.toast(words(c.lang).forClass); return c.landing(); }
    if (going) return;
    going = true;
    c.flushQueue().then(function () { return c.api('POST', 'hubdoor', { st: c.st, story: 1 }); }).then(function (r) {
      var href = r && r.ok && r.body && typeof r.body.href === 'string' ? r.body.href : '';
      var ok = /^\/h\/[A-Za-z0-9._-]+$/.test(href);
      c.ev('story_door', { ok: ok });
      c.flushEv(true);
      // The child's hub chip (the fast first page): the hub starts the book from it before the server has answered.
      var kid = r.body.kid && /^[0-9a-f]{16}$/.test(r.body.kid) ? '&kid=' + r.body.kid : '';
      if (ok) { c.go(c.withLang(href + '?from=link' + kid) + '#story/' + story.id); return; }
      going = false;
      c.toast(c.T.oops);
      c.landing();
    }, function () { going = false; c.toast(c.T.offline); c.landing(); });
  }
  window.WQSTORYLINK = { copy: copy, open: open };
}());
