'use strict';
/**
 * bd-t7zk3t.12 — a fetch-shaped GET over plain `http` with `Connection: close`, for the FLN route suites.
 *
 * One connection per request, closed after it: no socket outlives its suite's server, whatever else shares the jest
 * worker (global fetch's keep-alive pool is process-wide).
 */
const http = require('http');

module.exports = function httpGet(url, { headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers: { ...headers, connection: 'close' }, agent: false }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: { get: (k) => res.headers[String(k).toLowerCase()] ?? null },
        json: async () => JSON.parse(text),
      }));
    });
    req.on('error', reject);
  });
};
