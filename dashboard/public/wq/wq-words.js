/* Urdu word help (bd-0q8b4x): under an English question, each hard word with its short Urdu
 * meaning, as the server sent it in q.words (only while app_settings quiz_word_help is on).
 * Loaded only on a page whose quiz carries words; wq.js calls WQW.html(q) and gets '' otherwise. */
var WQW = (function () {
  'use strict';
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var styled = false;
  function style() {
    if (styled || typeof document === 'undefined') return;
    styled = true;
    var st = document.createElement('style');
    st.textContent = '.wq-words{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 2px;padding:0}' +
      '.wq-word{display:inline-flex;align-items:baseline;gap:8px;background:#FFF7E0;border:1px solid #F2D27A;border-radius:12px;padding:6px 12px;font-size:17px;line-height:1.5}' +
      '.wq-word b{font-weight:700;color:#1F2A44}' +
      // the page's own Nastaliq (wq.css "WQ Nastaliq" via --fu, size-adjusted there), never a system font
      '.wq-word span{font-family:var(--fu,"WQ Nastaliq"),serif;font-size:16px;line-height:2;color:#5A3E00}';
    document.head.appendChild(st);
  }
  function list(q) {
    var w = q && q.words;
    if (!w || !w.length) return [];
    return w.filter(function (x) { return x && typeof x.en === 'string' && typeof x.ur === 'string' && x.en && x.ur; }).slice(0, 3);
  }
  function html(q) {
    var w = list(q);
    if (!w.length) return '';
    style();
    return '<div class="wq-words" dir="ltr" role="note">' + w.map(function (x) {
      return '<span class="wq-word"><b lang="en">' + esc(x.en) + '</b><span lang="ur" dir="rtl">' + esc(x.ur) + '</span></span>';
    }).join('') + '</div>';
  }
  return { html: html, list: list };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = WQW;
