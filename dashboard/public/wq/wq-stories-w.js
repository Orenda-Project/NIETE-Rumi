/* The story reader warmed from the shelf (app_settings web_quiz_story_warm: the shelf's answer says warm, and each book
 * its first page's picture p1). wq-stories.js loads this file once the shelf is drawn. While the child looks at the
 * shelf (1.5 s on), the reader's files are fetched ahead at low priority, at exactly the addresses the reader asks; a
 * tap on a book asks for that book's first page picture at once and, if they are not fetched yet, the reader's files
 * side by side. Never the files ahead on Save-Data or a 2G line (the picture of a tapped book is needed anyway). */
(function (W) {
  try {
    var S = W.WQSTORIES, d = document;
    if (!S || S._w) return;
    S._w = 1;
    var RA_V = '64569caa64';   // the player's content hash, as wq-stories.js (a test pins both)
    var c = W.navigator && W.navigator.connection, slow = !!(c && (c.saveData || /2g/.test(String(c.effectiveType || ''))));
    var s = d.querySelector('script[src*="wq-stories.js"]'), v = s && /[?&]v=([\w-]+)/.exec(s.getAttribute('src') || ''), q = v ? '?v=' + v[1] : '';
    var done = {}, seen = {};
    var ahead = function (rel) {
      if (slow) return;
      [['wq-readalong.js?v=' + RA_V, 'script'], ['wq-read-live.js' + q, 'script'], ['wq-liveread.js' + q, 'script'], ['wq-liveread.css' + q, 'style']].forEach(function (f) {
        var href = '/wq/' + f[0];
        if (done[href]) return;
        done[href] = 1;
        var l = d.createElement('link'); l.rel = rel; l.as = f[1]; l.href = href; d.head.appendChild(l);
      });
    };
    W.setTimeout(function () { ahead('prefetch'); }, 1500);
    var tap = function (e) {
      var t = e && e.target;
      while (t && t.getAttribute && t.getAttribute('data-tap') !== 'book') t = t.parentNode;
      if (!t || !t.getAttribute) return;
      var id = t.getAttribute('data-id'), b = ((S.shelf && S.shelf.d && S.shelf.d.books) || []).filter(function (x) { return x && x.id === id; })[0];
      if (b && b.p1 && !seen[b.p1]) { seen[b.p1] = 1; new W.Image().src = b.p1; }
      ahead('preload');
    };
    // pointerdown comes a beat before the tap's click; either one starts the fetches, once
    d.addEventListener('pointerdown', tap, true);
    d.addEventListener('click', tap, true);
  } catch (e) {}
}(window));
