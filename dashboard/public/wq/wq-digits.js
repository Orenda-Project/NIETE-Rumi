/*
 * Urdu digits (U+06F0–U+06F9) for a child's Urdu screen and the Urdu link preview: ONE helper for the edge (required by
 * dashboard/routes/web-quiz.routes.js) and the pages (window.WQDigits when loaded). Every ASCII digit becomes its Urdu
 * digit; nothing else changes. null/undefined → ''.
 */
(function (root) {
  'use strict';
  function urDigits(s) {
    return String(s == null ? '' : s).replace(/[0-9]/g, function (d) { return String.fromCharCode(0x06F0 + Number(d)); });
  }
  var api = { urDigits: urDigits };
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else if (root) root.WQDigits = api;
})(typeof window !== 'undefined' ? window : this);
