'use strict';
/**
 * The listen scan's own red fixture (qfix-reminders-listen-host.service.test.js): a harness whose client calls
 * 127.0.0.1 while its servers bind every interface, in both forms the scan refuses. Never required or run.
 */
const express = require('express');

async function bare() {
  const srv = express().listen(0);
  return fetch(`http://127.0.0.1:${srv.address().port}/`);
}
function callback() {
  return new Promise((r) => { const s = express().listen(0, () => r(s)); });
}
// a commented-out host-less site is not code: srv = app.listen(0);
module.exports = { bare, callback };
