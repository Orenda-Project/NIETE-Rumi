'use strict';
/** Test helper: an axios.post-shaped call over real HTTP (axios is stubbed in the root suite). Resolves {status, data}. */
const http = require('http');

module.exports = function httpPost(url, body, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body || {});
    const r = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), ...(opts.headers || {}) } }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; });
      res.on('end', () => { let parsed = null; try { parsed = b ? JSON.parse(b) : null; } catch (_) { parsed = b; } resolve({ status: res.statusCode, data: parsed }); });
    });
    r.on('error', reject); r.end(data);
  });
};
