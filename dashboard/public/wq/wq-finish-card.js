/*
 * The finish card (window.WQFC; app_settings web_quiz_card_v3): one shareable card after every finish — a teacher's
 * quiz, a read-aloud, a story, a numbers game, a listening story, a storybook, a video. Loaded only when the server
 * says the switch is on (the quiz finish's / the Jugnu menu's `card_v3`); with it off this file is never asked for.
 *
 *   WQFC.mount(stack, o)   the card's block just before `stack` (the host's own buttons): "Send to class" + the Next
 *                          tile (+ Home when o.home). o = {kind, deed, lang, title?, next?, home?,
 *                          auth: {st}|{ct}|{hub, kid}, ev?(name, props)}
 *                          or the one result object: {source: 'quiz'|'read'|'story', ended, pages_read?,
 *                          pages_listened?, stars?, title?, cover?, lang, auth, ev?, next?, home?} — a story card draws
 *                          its own headline (by `ended`), the count-up deed ("3 pages read", Urdu digits) and ONE
 *                          sticker; zero input draws "Let's read it together", no sticker, no count
 *   WQFC.numbersFor(source)  'score' (the quiz's own screen keeps n/10) | 'deed' (a story's count-up) | 'none'
 *   WQFC.unheard(r, words, heard, len)  pure: a read that certifies nothing (0, < a tenth, silent, failed, later)
 *   WQFC.trailEnd(h, o)    the Jugnu page's end cards (wq-trail.js): the card's block, the host's Home soft
 *   WQFC.quizDeedHtml / primeQuiz / shareQuiz   the teacher's quiz card (wq.js M10): the deed line above the score,
 *                          and its "Share to class group" sends the card (deed + topic, no digits)
 *   WQFC.shareText(o)      pure: the deed (+ the title), the link on its own line, the return line last
 *   WQFC.deedFor(kind, r)  pure: the deed a finish earned (the server only accepts these)
 *   WQFC.sheetHtml(o)      pure: the one share's sheet (app_settings web_quiz_share_v4)
 *
 * The one share (web_quiz_share_v4: the host passes o.v4 from its payload's share_v4): o.item {type:'book'|'video', id}
 * names what was finished (the server checks it and seals it into the link, which lands a new child on it), and a tap
 * opens ONE sheet over the page — the card's picture, "Send on WhatsApp" (the words + the link, whose preview is the
 * card), the picture as a file where the phone can share one, "Save picture", "Copy link", Back. A tap before the card
 * is in says "Getting your card…" and waits for it (never words without the card). Off: today's tap.
 *
 * The share never navigates this page (the child would lose it in WhatsApp's own browser): an <a target="_blank"> to
 * wa.me with the text, or navigator.share({files}) with the card's picture where the browser can share a file.
 * The card token is minted once per finish (POST /api/wq/card); the card itself never waits for it — a tap before
 * it arrives shares the words and the return line without the link. First name only, and it comes from the server.
 * Events through the host's ev(): card_shown {src: kind, ok, source, share_ok, tried?}, card_share {src: kind,
 * step: 'card_image', how, source, kind: 'card_image', path} — the events contract's names beside today's.
 * Copy: the deeds are the server's (web-quiz-card-image.js COPY), word for word; native Urdu read in the PR.
 */
(function () {
  'use strict';
  var DEEDS = {
    en: {
      quiz_done: "I finished my teacher's quiz today!",
      read_all: 'I read a whole story out loud today!',
      read_some: 'I read out loud with Jugnu today!',
      read_tried: 'I tried a new story with Jugnu today!',
      listen_done: 'I listened to a story with Jugnu today!',
      story_read: 'I read a story with Jugnu today!',
      answered: 'I answered the story questions today!',
      game_done: 'I played a numbers game with Jugnu today!',
      book_read: 'I read a storybook with Jugnu today!',
      video_watched: 'I watched a video with Jugnu today!',
      // a stop played again (practice, the child home on): no "today", no star, no sticker — the Book is counted runs only
      read_practice: 'I read a whole story out loud!',
      read_some_practice: 'I read out loud with Jugnu!',
      listen_practice: 'I listened to a story with Jugnu!',
      story_practice: 'I read a story with Jugnu!',
      game_practice: 'I played a numbers game with Jugnu!'
    },
    ur: {
      quiz_done: 'میں نے آج ٹیچر کا کوئز مکمل کیا!',
      read_all: 'میں نے آج پوری کہانی اونچی آواز میں پڑھی!',
      read_some: 'میں نے آج جگنو کے ساتھ اونچی آواز میں پڑھا!',
      read_tried: 'میں نے آج جگنو کے ساتھ ایک نئی کہانی پڑھنے کی کوشش کی!',
      listen_done: 'میں نے آج جگنو کے ساتھ کہانی سنی!',
      story_read: 'میں نے آج جگنو کے ساتھ کہانی پڑھی!',
      answered: 'میں نے آج کہانی کے سوالوں کے جواب دیے!',
      game_done: 'میں نے آج جگنو کے ساتھ گنتی کا کھیل کھیلا!',
      book_read: 'میں نے آج جگنو کے ساتھ کہانی کی کتاب پڑھی!',
      video_watched: 'میں نے آج جگنو کے ساتھ ویڈیو دیکھی!',
      read_practice: 'میں نے پوری کہانی اونچی آواز میں پڑھی!',
      read_some_practice: 'میں نے جگنو کے ساتھ اونچی آواز میں پڑھا!',
      listen_practice: 'میں نے جگنو کے ساتھ کہانی سنی!',
      story_practice: 'میں نے جگنو کے ساتھ کہانی پڑھی!',
      game_practice: 'میں نے جگنو کے ساتھ گنتی کا کھیل کھیلا!'
    }
  };
  var W = {
    // sendPlain: a child with no class (the child home on: the menu's no_class / a watch-only Videos door)
    en: { send: 'Share to class group', sendPlain: 'Share', next: 'Next', home: 'Home', sound: 'Sound', mins: function (n) { return n + ' min'; },
      ret: 'Play with Jugnu any day. Tap, then send:', words: 'quiz please', quizDeed: 'You finished the whole quiz!' },
    ur: { send: 'کلاس گروپ میں بھیجیں', sendPlain: 'شیئر کریں', next: 'اگلا', home: 'واپس جائیں', sound: 'آواز', mins: function (n) { return urDigits(n) + ' منٹ'; },
      ret: 'جب دل چاہے جگنو کے ساتھ کھیلیں! یہاں دبائیں، پھر بھیجیں:', words: 'کوئز دکھائیں', quizDeed: 'شاباش! آپ نے پورا کوئز کر لیا!' }
  };
  // The one share's sheet (web_quiz_share_v4).
  var SH = {
    // friends: the Share button of a child with no class (the link brings a friend in, there is no class group)
    en: { wa: 'Send on WhatsApp', file: 'Share picture', save: 'Save picture', copy: 'Copy link', copied: 'Copied!', back: 'Back', getting: 'Getting your card…', again: 'Tap again to share', friends: 'Share with friends' },
    ur: { wa: 'واٹس ایپ پر بھیجیں', file: 'تصویر بھیجیں', save: 'تصویر محفوظ کریں', copy: 'لنک کاپی کریں', copied: 'کاپی ہو گیا!', back: 'واپس', getting: 'آپ کا کارڈ بن رہا ہے…', again: 'بھیجنے کے لیے دوبارہ دبائیں', friends: 'دوستوں کو بھیجیں' }
  };
  var KIND_DEEDS = { quiz: ['quiz_done'], read: ['read_all', 'read_some', 'read_tried', 'read_practice', 'read_some_practice'], listen: ['listen_done', 'listen_practice'],
    story: ['story_read', 'answered', 'read_tried', 'story_practice'], game: ['game_done', 'game_practice'], book: ['book_read', 'listen_done', 'read_tried'], video: ['video_watched'] };
  // The card's own screen lines: zero input (the story reader's own words), a storybook's
  // headline by how it ended, and the count-up deed (on this screen only: never on the picture or in the share).
  var S = {
    en: { together: "Let's read it together", later: 'Just wait a little.', readSome: 'You read with Jugnu!', heardSome: 'You listened with Jugnu!', sticker: 'A new sticker!',
      finished: 'You finished the story!', looked: 'You looked through the whole book.', qsDone: function (s, n) { return s + (n === 1 ? ' question answered' : ' questions answered'); },
      pagesRead: function (s, n) { return s + (n === 1 ? ' page read' : ' pages read'); },
      pagesHeard: function (s, n) { return s + (n === 1 ? ' page heard' : ' pages heard'); } },
    ur: { together: 'آئیں مل کر پڑھیں', later: 'بس تھوڑا سا انتظار کریں۔', readSome: 'آپ نے جگنو کے ساتھ پڑھا!', heardSome: 'آپ نے جگنو کے ساتھ سنا!', sticker: 'ایک نیا اسٹیکر!',
      finished: 'آپ نے کہانی پوری کر لی!', looked: 'آپ نے پوری کتاب دیکھ لی۔', qsDone: function (s, n) { return s + (n === 1 ? ' سوال کا جواب دیا' : ' سوالوں کے جواب دیے'); },
      pagesRead: function (s, n) { return s + (n === 1 ? ' صفحہ پڑھا' : ' صفحے پڑھے'); },
      pagesHeard: function (s, n) { return s + (n === 1 ? ' صفحہ سنا' : ' صفحے سنے'); } }
  };
  // A result not scored yet (the page stopped waiting for the scorer): certified as nothing, but told the truth —
  // "Just wait a little" (no «نتیجہ»: it reads as an exam result), not "Let's read it together" (the child did read).
  // true = the together line.
  var LATER_IS_KIND = false;
  // The one sticker, drawn (the picture's own disc): never a row of stars, never a count.
  var STICKER = '<svg width="56" height="56" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="56" fill="#FDE68A" stroke="#F59E0B" stroke-width="6"/>' +
    '<path d="M60 22l11 23 25 3-18 17 5 25-23-12-23 12 5-25-18-17 25-3z" fill="#F59E0B"/></svg>';

  // Drawn, never emoji (an Android 9 phone draws a newer emoji as an empty box; a symbol can come from the Nastaliq face).
  var PLAY = '<svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><path d="M8 5l15 9-15 9z" fill="currentColor"/></svg>';
  var SND_ON = '<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><path d="M3 9h5l6-5v18l-6-5H3z" fill="currentColor"/><path d="M18 8c2 2 2 8 0 10M21 5c4 4 4 12 0 16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';
  var SND_OFF = '<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><path d="M3 9h5l6-5v18l-6-5H3z" fill="currentColor"/><path d="M18 9l6 8M24 9l-6 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  function urDigits(n) { return String(n).replace(/[0-9]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.charAt(+d); }); }
  function L(l) { return l === 'ur' ? 'ur' : 'en'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---------- pure ---------- */
  // r: {all, some, zero} for a read; anything else maps by kind.
  function deedFor(kind, r) {
    r = r || {};
    if (kind === 'read') return r.zero ? 'read_tried' : (r.all ? 'read_all' : 'read_some');
    if (kind === 'story') return r.answered ? 'answered' : 'story_read';
    return (KIND_DEEDS[kind] || [])[0] || null;
  }
  function deedText(lang, deed) { return DEEDS[L(lang)][deed] || ''; }
  // Which number a card may show, from the source alone (a quiz's own screen keeps its score; a story counts pages up).
  function numbersFor(source) { return source === 'quiz' ? 'score' : source === 'story' ? 'deed' : 'none'; }
  // A read that certifies nothing (no sticker, the try card): no result, a failed recording, not scored yet, ended silent,
  // nothing heard, or under a tenth of the story's words. words: the page's count; heard: the live read's. A live
  // read's own result (wq:liveread:result: words_read of words_total) carries both.
  function unheard(r, words, heard, len) {
    if (!r || r.failed || r.later || r.ended === 'silent') return true;
    var n = heard != null ? heard : words != null ? words : r.words_read != null ? r.words_read : (r.score ? (r.score.attempted != null ? r.score.attempted : r.score.correct) : 0);
    n = Number(n) || 0;
    if (!(len > 0) && r.words_total > 0) len = r.words_total;
    return n <= 0 || (len > 0 && n < 0.1 * len);
  }
  // The one result object (quiz, read or story) as the card's {kind, deed} and its screen lines.
  function fromSource(o) {
    var l = L(o.lang);
    if (o.source === 'story') {
      var rd = Math.max(0, Math.floor(Number(o.pages_read) || 0));
      var hd = Math.max(0, Math.floor(Number(o.pages_listened) || 0));
      var heard = o.ended === 'listened';
      var tried = heard ? hd <= 0 && rd <= 0 : rd <= 0;
      var n = heard ? (hd || rd) : rd;
      // the end of the book reached (o.whole): the finish is the headline, and the questions answered are a deed too
      // (a count, never a score); only answered: the story's own "answered" deed
      var qa = o.whole === true ? Math.max(0, Math.floor(Number(o.answered) || 0)) : 0;
      var qs = qa ? { n: qa, text: S[l].qsDone(l === 'ur' ? urDigits(qa) : String(qa), qa) } : null;
      // nothing heard or read: the server keeps no finish (no ✓, no sticker), so the card says what the shelf will show
      if (tried && qa) return { kind: 'story', deed: 'answered', tried: false, head: o.sticker === true ? S[l].finished : S[l].looked, count: null, qs: qs };
      return { kind: 'book', deed: tried ? 'read_tried' : heard ? 'listen_done' : 'book_read', tried: tried, qs: tried ? null : qs,
        head: tried ? S[l].together : o.whole === true ? S[l].finished : heard ? S[l].heardSome : S[l].readSome,
        count: tried || !n ? null : { n: n, text: function (k) { return S[l][heard ? 'pagesHeard' : 'pagesRead'](l === 'ur' ? urDigits(k) : String(k), k); } } };
    }
    if (o.source === 'quiz') return { kind: 'quiz', deed: 'quiz_done' };
    if (o.source === 'read') {
      var rr = o.result || o;
      var t = unheard(rr, null, null, 0);
      // the whole story: the host says so, or the live read heard nine words in ten (the Trail's own line)
      var whole = o.whole || (rr.words_total > 0 && rr.words_read >= 0.9 * rr.words_total);
      return { kind: 'read', deed: t ? 'read_tried' : (whole ? 'read_all' : 'read_some'), tried: t };
    }
    return null;
  }
  // The title keeps its own script and direction inside the line (U+2068…U+2069 first-strong isolate).
  function titleLine(lang, title) {
    var t = String(title == null ? '' : title).replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!t) return '';
    return L(lang) === 'ur' ? '«⁨' + t + '⁩»' : '“⁨' + t + '⁩”';
  }
  // o: {lang, deed, title?, url?, ret?: {text, href}}. The link stands alone on its line, so an Urdu message never
  // wraps it backwards; the return line is always last (the child's way back tomorrow).
  function shareText(o) {
    var l = L(o.lang);
    var ret = o.ret || {};
    // a stop played again earns no sticker, so its words carry no star
    var lines = [(/_practice$/.test(o.deed) ? '' : '⭐ ') + deedText(l, o.deed)];
    var tl = titleLine(l, o.title);
    if (tl) lines.push(tl);
    if (o.url) lines.push(String(o.url));
    // the one share with no bot chat to name: the link above is the friend's way in, never loose words
    if (o.v4 === true && o.url && !ret.href) return lines.join('\n');
    lines.push(ret.text || W[l].ret);
    lines.push(ret.href || ('“' + (ret.words || W[l].words) + '”'));
    return lines.join('\n');
  }
  function waHref(text) { return 'https://wa.me/?text=' + encodeURIComponent(text); }

  // The Next tile (the ranked next_offer), only with a same-origin path to open; its art: /wq/ art or a storybook cover.
  function nextHtml(lang, nx, lead) {
    if (!nx || typeof nx.href !== 'string' || !/^\/[^/]/.test(nx.href)) return '';
    var l = L(lang);
    var title = (l === 'ur' && nx.title_ur) || nx.title || '';
    var sub = (l === 'ur' && nx.sub_ur) || nx.sub || '';
    if (!title) return '';
    var mins = nx.minutes >= 1 && nx.minutes <= 9 ? '<small class="wqfc-min">' + esc(W[l].mins(Math.round(nx.minutes))) + '</small>' : '';
    var art = typeof nx.art === 'string' && /^\/(wq\/[A-Za-z0-9/_.-]+|s\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+)$/.test(nx.art) ? '<img class="wqfc-art" src="' + esc(nx.art) + '" alt="" width="64" height="64" loading="lazy">' : '<span class="wqfc-art" aria-hidden="true">' + PLAY + '</span>';
    return '<a class="wqfc-next' + (lead ? ' wqfc-lead" id="wqfc-next" data-primary' : '" id="wqfc-next"') + ' data-tap="next" href="' + esc(nx.href) + '">' + art +
      '<span class="wqfc-nt"><small>' + esc(W[l].next) + '</small><b dir="auto">' + esc(title) + '</b>' + (sub ? '<span dir="auto">' + esc(sub) + '</span>' : '') + mins + '</span></a>';
  }
  // The book's cover (a same-origin path only), its title as the words; one that fails to load leaves no box.
  function coverHtml(src, title) {
    if (typeof src !== 'string' || !/^\/[^/\\"'<>\s][^\\"'<>\s]*$/.test(src)) return '';
    return '<img class="wqfc-cov" src="' + esc(src) + '" alt="' + esc(String(title == null ? '' : title).trim()) + '" width="96" height="144" onerror="this.hidden=true">';
  }
  function html(o) {
    var l = L(o.lang);
    // A card that certified nothing (the try card) leads with the next thing to do; sending it is a soft secondary.
    // A host may ask the same (o.lead: a storybook's "More stories" is the child's next thing, never the share).
    var lead = (o.lead === true || o.deed === 'read_tried') && !!nextHtml(l, o.next);
    var tile = nextHtml(l, o.next, lead);
    var text = shareText({ lang: l, deed: o.deed, title: o.title, ret: o.ret });
    return '<div class="wqfc" data-screen="card" lang="' + l + '" dir="' + (l === 'ur' ? 'rtl' : 'ltr') + '">' + (o.top || '') +
      (o.sound === false ? '' : '<button class="wqfc-snd" id="wqfc-snd" type="button" data-tap="sound" aria-label="' + esc(W[l].sound) + '" aria-pressed="' + (muted() ? 'true' : 'false') + '">' + (muted() ? SND_OFF : SND_ON) + '</button>') +
      (lead ? tile : '') +
      // a read that certified nothing (read_tried) is not shared: no Share on the try card
      (o.deed === 'read_tried' ? '' : '<a class="wq-btn ' + (lead ? 'wq-soft' : 'wq-go') + ' wqfc-share" id="wqfc-share"' + (lead ? '' : ' data-primary') + ' data-tap="card_share" target="_blank" rel="noopener" href="' + esc(waHref(text)) + '">' + esc(o.plain === true ? (o.v4 === true ? SH[l].friends : W[l].sendPlain) : W[l].send) + '</a>') +
      (lead ? '' : tile) +
      (o.home && /^\/[^/]/.test(o.home) ? '<a class="wq-btn wq-soft wqfc-home" id="wqfc-home" data-home data-tap="home" href="' + esc(o.home) + '">' + esc(W[l].home) + '</a>' : '') +
      '</div>';
  }

  /* ---------- the page ---------- */
  var CSS = '.wqfc{display:grid;gap:12px;margin:12px 0}.wqfc-head{font-size:24px;font-weight:800;margin:0;text-align:center}' +
    '.wqfc-count{font-size:20px;font-weight:700;margin:0;text-align:center}.wqfc-st{display:flex;align-items:center;justify-content:center;gap:10px;margin:0;font-weight:700;color:#92400E}' +
    '[lang="ur"] .wqfc-head,[lang="ur"] .wqfc-count,[lang="ur"] .wqfc-st{line-height:2}' +
    '.wqfc-share{display:block;text-align:center;text-decoration:none;min-height:56px}' +
    '.wqfc-next{display:flex;align-items:center;gap:12px;padding:12px;border-radius:16px;background:#EFF6FF;border:2px solid var(--brand-ink,#1E3A8A);color:var(--brand-ink,#1E3A8A);text-decoration:none;min-height:72px}' +
    '.wqfc-lead{background:var(--brand,#47BA7D);border-color:var(--brand,#47BA7D);color:#fff}.wqfc-lead .wqfc-art{background:#fff;color:var(--brand-ink,#1E3A8A)}' +
    '.wqfc-cov{display:block;justify-self:center;width:96px;height:144px;object-fit:cover;border-radius:12px;box-shadow:0 2px 8px rgba(15,23,42,.18)}.wqfc-cov[hidden]{display:none}' +
    '.wqfc-art{width:64px;height:64px;flex:0 0 64px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:#DBEAFE;object-fit:cover}' +
    '.wqfc-snd{justify-self:end;width:48px;height:48px;border-radius:24px;border:2px solid #CBD5E1;background:#fff;color:#334155;display:flex;align-items:center;justify-content:center;padding:0}' +
    '.wqfc-nt{display:grid;gap:2px;min-width:0}.wqfc-nt b{font-size:19px}.wqfc-nt small{opacity:.8}' +
    '.wqfc-deed{font-weight:800;font-size:22px;margin:8px 0 0}[lang="ur"] .wqfc-nt b,[lang="ur"] .wqfc-nt small,[lang="ur"] .wqfc-nt span,[lang="ur"] .wqfc-deed,html[lang="ur"] .wqfc-share{font-size:20px;line-height:2}' +
    '@media (prefers-reduced-motion:no-preference){.wqfc{animation:wqfc-in .4s ease-out .3s both}@keyframes wqfc-in{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}}';
  // the sheet's own styles, added only when a sheet opens (the card's CSS above stays today's)
  var SHEET_CSS = '.wqfc-sheet{position:fixed;inset:0;z-index:50;background:rgba(15,23,42,.55);display:flex;align-items:flex-end;justify-content:center;padding:16px;box-sizing:border-box;overflow-y:auto}' +
    '.wqfc-sh-in{width:100%;max-width:480px;display:grid;gap:12px;padding:16px;border-radius:24px;background:var(--bg,#FFF8E7);box-sizing:border-box;box-shadow:0 8px 24px rgba(15,23,42,.25)}' +
    '.wqfc-sh-pic{display:block;width:100%;height:auto;aspect-ratio:1200/630;border-radius:16px;background:#FDE68A;object-fit:cover}' +
    '.wqfc-sh-in .wq-btn{display:flex;align-items:center;justify-content:center;text-align:center;text-decoration:none;min-height:56px;box-sizing:border-box}' +
    '.wqfc-sh-ok{text-align:center;font-weight:700;margin:0;min-height:1.5em}[lang="ur"] .wqfc-sh-in .wq-btn{font-size:20px;line-height:2}' +
    '@media (prefers-reduced-motion:no-preference){.wqfc-sh-in{animation:wqfc-up .25s ease-out both}@keyframes wqfc-up{from{transform:translateY(40px);opacity:0}to{transform:none;opacity:1}}}';
  function css() {
    try {
      if (document.getElementById('wqfc-css')) return;
      var st = document.createElement('style');
      st.id = 'wqfc-css';
      st.textContent = CSS;
      (document.head || document.body).appendChild(st);
    } catch (e) { /* unstyled still works */ }
  }

  // card_shown once per finish: a card drawn again (Back from a share, a re-render) is not another card.
  var shown = {};
  function once(k) { if (shown[k]) return false; shown[k] = 1; return true; }
  // The one sound switch (both keys the pages read: wq.js wq_sound JSON, the kit's wq_snd '1'/'0'); the kit's own toggle when present.
  function muted() {
    try {
      if (window.WQJ && typeof window.WQJ.muted === 'function') return Boolean(window.WQJ.muted());
      return localStorage.getItem('wq_snd') === '0' || localStorage.getItem('wq_sound') === 'false';
    } catch (e) { return false; }
  }
  function toggleSound(btn) {
    if (window.WQJ && typeof window.WQJ.toggle === 'function') { window.WQJ.toggle(btn); return; }
    var off = !muted();
    try { localStorage.setItem('wq_snd', off ? '0' : '1'); localStorage.setItem('wq_sound', off ? 'false' : 'true'); } catch (e) { /* this view only */ }
    try { btn.setAttribute('aria-pressed', off ? 'true' : 'false'); btn.innerHTML = off ? SND_OFF : SND_ON; } catch (e) { /* drawn next time */ }
  }
  // One token per finish (the auth names it), kept for re-renders of the same card.
  var minted = {};
  function authKey(a) { return a ? (a.st || a.ct || ((a.hub || '') + '|' + (a.kid || ''))) : ''; }
  // The item a finish names (the one share): a storybook or a video, its id as the host has it; the server checks it.
  function itemOf(o) {
    var it = o && o.item;
    return it && (it.type === 'book' || it.type === 'video') && typeof it.id === 'string' && /^[0-9A-Za-z-]{8,64}$/.test(it.id) ? { type: it.type, id: it.id } : null;
  }
  function mint(o) {
    var it = o.v4 === true ? itemOf(o) : null;
    var k = authKey(o.auth) + '|' + o.kind + '|' + o.deed + '|' + L(o.lang) + (it ? '|' + it.type + ':' + it.id : '');
    if (minted[k]) return minted[k];
    var body = { kind: o.kind, deed: o.deed, lang: L(o.lang) };
    if (it) body.item = it;
    var a = o.auth || {};
    ['st', 'ct', 'hub', 'kid'].forEach(function (f) { if (typeof a[f] === 'string') body[f] = a[f]; });
    if (typeof fetch !== 'function') { minted[k] = Promise.resolve(null); return minted[k]; }
    minted[k] = fetch('/api/wq/card', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' })
      .then(function (r) { return r && r.ok ? r.text() : null; })
      .then(function (t) { try { return t ? JSON.parse(t) : null; } catch (e) { return null; } })
      .then(function (j) { return j && typeof j.url === 'string' && /^\/(k\/|q\/)/.test(j.url) ? j : null; })
      .catch(function () { return null; });
    return minted[k];
  }
  // The picture as a file, only where the browser can share one (never in WhatsApp's own browser today).
  function fileOf(img) {
    try {
      if (!(navigator.canShare && navigator.share && typeof File === 'function')) return Promise.resolve(null);
    } catch (e) { return Promise.resolve(null); }
    return fetch(img).then(function (r) { return r && r.ok ? r.blob() : null; }).then(function (b) {
      if (!b) return null;
      var f = new File([b], 'jugnu-card.png', { type: 'image/png' });
      try { return navigator.canShare({ files: [f] }) ? f : null; } catch (e) { return null; }
    }).catch(function () { return null; });
  }

  // The share's words now — with the host's own link (o.link: the quiz's class link) until the card's link is in —
  // and the card's link once the token is in (st.text); the picture as a file where one can go.
  function prime(o) {
    css();
    var k = keyOf(o);
    if (primed[k]) return primed[k];
    var st = primed[k] = { text: shareText(o.link ? { lang: o.lang, deed: o.deed, title: o.title, url: o.link } : o), url: o.link || null, file: null, ready: false, settled: false };
    st.wait = mint(o).then(function (j) {
      st.settled = true;
      if (!j) return;
      st.url = location.origin + j.url;
      st.img = j.img;
      st.v4 = j.v4 === true;
      st.text = shareText({ lang: o.lang, deed: o.deed, title: o.title, url: st.url, ret: j.ret, v4: st.v4 });
      st.ready = true;
      try {
        var a = document.getElementById('wqfc-share');
        if (a && a.tagName === 'A') a.setAttribute('href', waHref(st.text));
        // the one share: the button says who it goes to, from the server (no class: friends; else the class group)
        if (a && st.v4 && typeof j.plain === 'boolean') {
          labels[k] = esc(j.plain ? SH[L(o.lang)].friends : W[L(o.lang)].send);
          if (!st.waiting) a.innerHTML = labels[k];
        }
      } catch (e) { /* the tap still shares st.text */ }
      fileOf(j.img).then(function (f) { st.file = f; });
    });
    return st;
  }
  var primed = {};
  function keyOf(o) { var it = o.v4 === true ? itemOf(o) : null; return authKey(o.auth) + '|' + o.kind + '|' + o.deed + '|' + L(o.lang) + (it ? '|' + it.type + ':' + it.id : ''); }

  // A tap: the picture as a file where the browser can share one; else the anchor's own wa.me (new window), or the
  // host's fallback (the quiz's "send it on WhatsApp" screen) for a host's <button>.
  function tapShare(o, e, fallback) {
    var st = prime(o);
    // the one share (o.v4, the host's share_v4): a tap never sends words without the card — it says so while the card
    // is made, and the sheet opens when it is in; no card at all asks for one more tap (which asks the server again),
    // or runs the host's own share (the quiz's: its picture and the class link)
    if (o.v4 === true && !st.ready) {
      if (e && e.preventDefault) e.preventDefault();
      waitCard(o, st, e, fallback);
      return;
    }
    if (o.v4 === true) relabel(o, e);
    // The card's link not in yet: the tap waits for it, at most 2 s (the button soft meanwhile, no new words), then
    // shares what it has — the host's link at least, so the class always gets something to tap.
    if (!st.settled && !st.gaveUp) {
      if (e && e.preventDefault) e.preventDefault();
      if (st.waiting) return;
      st.waiting = true;
      var btn = e && e.currentTarget && typeof e.currentTarget.className === 'string' ? e.currentTarget : null;
      var was = btn ? btn.className : '';
      if (btn) btn.className = was.replace(/\bwq-go\b/, 'wq-soft');
      var t = null;
      var go = function () {
        if (!st.waiting) return;
        st.waiting = false;
        st.gaveUp = true;
        if (t) clearTimeout(t);
        if (btn) btn.className = was;
        if (fallback || !btn) { tapShare(o, null, fallback); return; }
        try { btn.setAttribute('href', waHref(st.text)); btn.click(); } catch (x) { /* the next tap shares */ }
      };
      t = setTimeout(go, 2000);
      st.wait.then(go);
      return;
    }
    var ev = typeof o.ev === 'function' ? o.ev : function () {};
    // The sender's WhatsApp fetches the preview picture a moment after the tap: ask for it now, so it is drawn by then.
    if (st.img && !st.warmed) { st.warmed = true; try { fetch(st.img).catch(function () {}); } catch (x) { /* the preview asks itself */ } }
    // the one share: the sheet with the picture, every way to send it (the host's own fallback screen is not needed)
    if (st.v4 && st.img) {
      if (e && e.preventDefault) e.preventDefault();
      openSheet(o, st);
      return;
    }
    if (st.file) {
      if (e && e.preventDefault) e.preventDefault();
      navigator.share({ files: [st.file], text: st.text }).then(function () { ev('card_share', shareEv(o, 'file')); },
        function (x) { if (!(x && x.name === 'AbortError') && fallback) fallback(st.text, st.url); });
      return;
    }
    ev('card_share', shareEv(o, fallback ? 'sheet' : 'wa'));
    if (fallback) fallback(st.text, st.url);
  }

  var SLOW_MS = 12000;
  // The Share button's own label, kept once per card (a wait or a "tap again" never becomes the label to go back to).
  var labels = {};
  function btnOf(e) { return e && e.currentTarget && typeof e.currentTarget.setAttribute === 'function' ? e.currentTarget : document.getElementById('wqfc-share'); }
  function relabel(o, e) {
    var btn = btnOf(e), k = keyOf(o);
    if (btn && labels[k] != null && btn.innerHTML !== labels[k]) btn.innerHTML = labels[k];
  }
  function waitCard(o, st, e, fallback) {
    if (st.waiting) return;
    st.waiting = true;
    var btn = btnOf(e);
    var w = SH[L(o.lang)];
    var k = keyOf(o);
    if (btn && labels[k] == null) labels[k] = btn.innerHTML;
    var was = labels[k];
    if (btn) { btn.innerHTML = esc(w.getting); btn.setAttribute('aria-busy', 'true'); btn.setAttribute('data-wait', '1'); }
    var t = null;
    var done = function () {
      if (!st.waiting) return;
      st.waiting = false;
      if (t) clearTimeout(t);
      var sheet = st.ready && st.v4 && st.img;
      // no sheet (no card, or a card without the one share's mark: a switch flipped meanwhile): the host's own share
      // where it has one; else "tap again", whose tap shares the card's link (the anchor has it) or asks again
      if (btn) { btn.removeAttribute('aria-busy'); btn.removeAttribute('data-wait'); btn.innerHTML = sheet || fallback ? was : esc(w.again); }
      if (sheet) { openSheet(o, st); return; }
      if (!st.ready) { delete primed[k]; delete minted[k]; }
      if (fallback) fallback(st.text, st.url);
    };
    t = setTimeout(done, SLOW_MS);
    st.wait.then(done, done);
  }

  // The one share's sheet (pure): the picture first, then ONE primary (WhatsApp), the file where it can go, save, copy, back.
  function sheetHtml(o) {
    var l = L(o.lang), w = SH[l];
    var img = typeof o.img === 'string' && /^\/wq\/card\/[A-Za-z0-9_-]+\.png$/.test(o.img) ? o.img : '';
    return '<div class="wqfc-sheet" id="wqfc-sheet" role="dialog" aria-modal="true" data-screen="share_sheet" lang="' + l + '" dir="' + (l === 'ur' ? 'rtl' : 'ltr') + '"><div class="wqfc-sh-in">' +
      (img ? '<img class="wqfc-sh-pic" src="' + esc(img) + '" alt="" width="1200" height="630">' : '') +
      '<a class="wq-btn wq-go" id="wqfc-sh-wa" data-primary data-tap="card_share" target="_blank" rel="noopener" href="' + esc(waHref(o.text || '')) + '">' + esc(w.wa) + '</a>' +
      (o.file ? '<button class="wq-btn wq-soft" id="wqfc-sh-file" type="button" data-tap="card_file">' + esc(w.file) + '</button>' : '') +
      (img ? '<a class="wq-btn wq-soft" id="wqfc-sh-save" data-tap="card_save" href="' + esc(img) + '" download="jugnu-card.png">' + esc(w.save) + '</a>' : '') +
      (o.url ? '<button class="wq-btn wq-soft" id="wqfc-sh-copy" type="button" data-tap="card_copy">' + esc(w.copy) + '</button>' : '') +
      '<p class="wqfc-sh-ok" id="wqfc-sh-ok" aria-live="polite"></p>' +
      '<button class="wq-btn wq-ghost" id="wqfc-sh-back" type="button" data-tap="sheet_back">' + esc(w.back) + '</button></div></div>';
  }
  function openSheet(o, st) {
    var ev = typeof o.ev === 'function' ? o.ev : function () {};
    try {
      if (!document.getElementById('wqfc-sh-css')) {
        var stl = document.createElement('style'); stl.id = 'wqfc-sh-css'; stl.textContent = SHEET_CSS; (document.head || document.body).appendChild(stl);
      }
      var old = document.getElementById('wqfc-sheet');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      document.body.insertAdjacentHTML('beforeend', sheetHtml({ lang: o.lang, img: st.img, text: st.text, url: st.url, file: !!st.file }));
      ev('card_share', shareEv(o, 'sheet'));
      var sh = document.getElementById('wqfc-sheet');
      var close = function () { try { if (sh && sh.parentNode) sh.parentNode.removeChild(sh); } catch (x) { /* gone */ } };
      var bind = function (id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
      bind('wqfc-sh-wa', function () { ev('card_share', shareEv(o, 'wa')); });
      bind('wqfc-sh-file', function () {
        if (!st.file || !navigator.share) return;
        navigator.share({ files: [st.file], text: st.text }).then(function () { ev('card_share', shareEv(o, 'file')); }, function () { /* the WhatsApp button stays */ });
      });
      bind('wqfc-sh-copy', function () {
        var ok = document.getElementById('wqfc-sh-ok');
        var said = function () { if (ok) ok.textContent = SH[L(o.lang)].copied; };
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(st.url).then(said, function () {}); return; }
        } catch (x) { /* the legacy copy below */ }
        try {
          var ta = document.createElement('textarea'); ta.value = st.url; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select(); if (document.execCommand('copy')) said(); document.body.removeChild(ta);
        } catch (x) { /* the link is in the WhatsApp words too */ }
      });
      bind('wqfc-sh-back', close);
      if (sh) sh.addEventListener('click', function (e) { if (e && e.target === sh) close(); });
      var first = document.getElementById('wqfc-sh-wa');
      if (first && first.focus) first.focus();
    } catch (x) { /* the next tap tries again */ }
  }

  // The card's block, before `stack` (the host's own buttons): Share, the Next tile, Home. One listener per control.
  function mount(stack, o) {
    if (o && o.source && !o.kind) {
      var src = o;
      var f = fromSource(o);
      if (!f) return false;
      var l = L(o.lang);
      var top = f.head ? coverHtml(o.cover, o.title) + '<h2 class="wqfc-head" dir="auto">' + esc(f.head) + '</h2>' +
        (f.count ? '<p class="wqfc-count" data-n>' + esc(f.count.text(f.count.n)) + '</p>' : '') +
        (f.qs ? '<p class="wqfc-count" data-qs>' + esc(f.qs.text) + '</p>' : '') +
        // a storybook's sticker only when the server gave one (a book read again, or only looked through, gets none)
        (f.tried || o.source === 'story' && o.sticker !== true ? '' : '<p class="wqfc-st" data-sticker>' + STICKER + '<span>' + esc(S[l].sticker) + '</span></p>') : '';
      o = { kind: f.kind, deed: f.deed, lang: l, title: o.title, next: o.next, lead: o.lead, home: o.home, auth: o.auth, ev: o.ev, top: top, count: f.count };
      if (src.v4 === true) { o.item = src.item; o.v4 = true; }
    }
    if (!stack || typeof stack.insertAdjacentHTML !== 'function' || !o || !KIND_DEEDS[o.kind] || KIND_DEEDS[o.kind].indexOf(o.deed) < 0) return false;
    // drawn first, then the one request for its link: a card never waits for the network (a live read leaves it
    // ~250 ms of its 3 s in Urdu)
    css();
    stack.insertAdjacentHTML('beforebegin', html(o));
    prime(o);
    if (o.count && o.count.n > 1) countUp(o.count);
    var ev = typeof o.ev === 'function' ? o.ev : function () {};
    var a = document.getElementById('wqfc-share');
    if (a) a.addEventListener('click', function (e) { tapShare(o, e, null); });
    var snd = document.getElementById('wqfc-snd');
    if (snd) snd.addEventListener('click', function () { toggleSound(snd); });
    var nx = document.getElementById('wqfc-next');
    if (nx) {
      ev('next_shown', slot(o));
      nx.addEventListener('click', function () { ev('next_tap', slot(o)); });
    }
    if (once('m|' + keyOf(o))) ev('card_shown', shownEv(o));
    return true;
  }

  // The deed counts up to its number (1, 2, 3 pages…), still under reduced motion.
  function countUp(c) {
    try {
      var el = document.querySelector && document.querySelector('.wqfc-count');
      if (!el || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
      var j = 0;
      (function up() { el.textContent = c.text(++j); if (j < c.n) setTimeout(up, 150); })();
    } catch (e) { /* the final number is already drawn */ }
  }

  // The Jugnu page's end cards (wq-trail.js, one guarded line per card): the card's block above the host's buttons,
  // the host's Home soft (green is Share only), the plain "Next: …" line given way to the tile. o = {name, line, r, t,
  // story}: the deed comes from the outcome the host already drew (r.tried: a read that certified nothing). A live
  // read's held card (r.hold: the server's check not back yet) is the card at once, from the words heard — no sticker
  // (the host's), no button the check could change (the host's); the settled card later mounts the same card again,
  // with the held card's deed (one finish, one link) unless the check found nothing read (then the try card).
  var held = null;
  var PRACTICE_OF = { read_all: 'read_practice', read_some: 'read_some_practice', listen_done: 'listen_practice', story_read: 'story_practice', game_done: 'game_practice' };
  function trailEnd(h, o) {
    var d = h.S.data || {};
    var r = o.r || {};
    // o.fold (the child home on): a practice run (Story Time, a stop played again) gets the card too
    if (!(h.md() || {}).card_v3 || d.round_turn || (d.practice_round && !o.fold) || !d.ct) return false;
    var t = o.t || {};
    var kind, deed;
    if (o.name === 'read-result' && !o.story) {
      kind = 'read';
      deed = r.tried || o.line === t.endZeroWords ? 'read_tried' : o.line === t.endReadAll ? 'read_all' : 'read_some';
      if (r.hold) held = deed === 'read_tried' ? null : { ct: d.ct, deed: deed };
      else {
        if (held && held.ct === d.ct && deed !== 'read_tried') deed = held.deed;
        held = null;
      }
    } else if (d.ex === 'listen') { kind = 'listen'; deed = 'listen_done'; }
    else if (o.story) { kind = 'story'; deed = 'story_read'; }
    else { kind = 'game'; deed = 'game_done'; }
    // o.fold: a stop played again (practice) says its own deed — never the counted run's sticker or "today"
    if (o.fold && d.practice_round && PRACTICE_OF[deed]) deed = PRACTICE_OF[deed];
    var ttl = d.title && typeof d.title === 'object' ? (h.L === 'ur' && d.title.ur) || d.title.en || '' : '';
    // o.fold (the child home on): the host's one next thing leads (the share soft under it); none = the host's questions
    var on = mount(document.querySelector('#wq .wq-stack'), { kind: kind, deed: deed, lang: h.L, title: typeof ttl === 'string' ? ttl : '', next: o.fold ? o.fold.next : r.next_offer || d.next_offer, lead: !!o.fold,
      plain: !!o.fold && (h.md() || {}).no_class === true, auth: { ct: d.ct }, ev: h.ev, v4: (h.md() || {}).share_v4 === true || undefined });
    if (!on) return false;
    try {
      var old = document.getElementById('wqfc-next') ? document.getElementById('wqc-next') : null;
      if (old && old.parentNode) old.parentNode.removeChild(old);
      var home = document.getElementById('wqc-menu');
      // the try card with no tile to lead with draws no primary of its own (no Share): the host's Home stays the one
      if (home && /\bwq-go\b/.test(home.className)) {
        if (deed === 'read_tried' && !document.getElementById('wqfc-next')) home.setAttribute('data-primary', '');
        else home.className = home.className.replace(/\bwq-go\b/, 'wq-soft');
      }
    } catch (e) { /* the card still works */ }
    return true;
  }
  // The events, with the contract's names (source ∈ quiz|read|story|challenge; path ∈ file|wa) beside today's.
  function sourceOf(kind) { return kind === 'quiz' ? 'quiz' : kind === 'read' ? 'read' : kind === 'book' || kind === 'story' ? 'story' : 'challenge'; }
  function shownEv(o) {
    var e = { src: o.kind, ok: true, source: sourceOf(o.kind), share_ok: true };
    if (o.deed === 'read_tried') e.tried = true;
    return e;
  }
  function shareEv(o, how) { return { src: o.kind, step: 'card_image', how: how, source: sourceOf(o.kind), kind: 'card_image', path: how === 'file' ? 'file' : 'wa' }; }
  // The headline of a read that certified nothing.
  function together(lang) { return S[L(lang)].together; }
  function triedLine(lang, r) { return r && r.later && !LATER_IS_KIND ? S[L(lang)].later : together(lang); }

  // The slot event: the tile is position 0; the ranked object's own offer/arm/score_v ride along.
  function slot(o) {
    var n = o.next || {};
    var after = 'after_' + (o.deed === 'read_tried' ? 'read_tried' : o.kind);
    var e = { src: after, ctx: after, step: String(n.kind || 'other').replace(/[^a-z0-9_]/g, '').slice(0, 32), pos: 0 };
    ['offer', 'arm', 'score_v', 'rank_src'].forEach(function (k) { if (typeof n[k] === 'string' || typeof n[k] === 'number') e[k] = n[k]; });
    return e;
  }

  // The teacher's quiz card (wq.js M10, which draws the deed line and the tile from these): its own screen keeps n/10
  //; its class share is the card — deed + topic, no score, the link, the return line.
  function quizDeedHtml(lang) { return '<p class="wqfc-deed" id="wqfc-deed">' + esc(W[L(lang)].quizDeed) + '</p>'; }
  function quiz(o) {
    var q = { kind: 'quiz', deed: 'quiz_done', lang: L(o.lang), title: o.topic, auth: o.st ? { st: o.st } : null, ev: o.ev, link: typeof o.url === 'string' ? o.url : null };
    // the one share (the finish's share_v4): the card minted at the finish is the one the Share tap opens in the sheet
    if (o.v4 === true) q.v4 = true;
    return q;
  }
  function primeQuiz(o) {
    var q = quiz(o);
    prime(q);
    if (typeof o.ev === 'function' && once('q|' + keyOf(q))) o.ev('card_shown', shownEv(q));
  }
  function shareQuiz(o, fallback, e) { var q = quiz(o); tapShare(q, q.v4 === true ? e : null, fallback); }
  // wq.js registers this before today's "Share to class group" listener: the class share becomes the card, and
  // today's listener (still there, untouched) does not run for that tap.
  function quizShareTap(o, fallback) {
    return function (e) {
      if (e && typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      shareQuiz(o, fallback, e);
    };
  }

  window.WQFC = { mount: mount, primeQuiz: primeQuiz, shareQuiz: shareQuiz, quizShareTap: quizShareTap, quizDeedHtml: quizDeedHtml, shareText: shareText,
    deedFor: deedFor, deedText: deedText, numbersFor: numbersFor, unheard: unheard, together: together, triedLine: triedLine, trailEnd: trailEnd,
    html: html, nextHtml: nextHtml, sheetHtml: sheetHtml, DEEDS: DEEDS, W: W, S: S, SH: SH, CSS: CSS };
})();
