'use strict';
/**
 * bd-5j1zaf follow-up (QF-H1): the teacher home's "Quiz reports" row tap posts `teacher_home.step {step:'report', late}`
 * through the portal edge, which keeps a POST field only when it is an allow-listed string. `late` is sent as the string
 * "true" | "false" and the edge's step form admits exactly those two; anything else (a boolean, "yes", "TRUE") is dropped,
 * as every other unknown or malformed field is.
 */
const http = require('http');
const express = require('express');
const { createQuizTeacherRouter } = require('../routes/quiz-teacher.routes');

const TOK = `eyJrIjoidGgifQ.${'A'.repeat(22)}`;
let srv;
let calls;
async function boot() {
  calls = [];
  const callBot = async (method, path, req, body) => { calls.push({ method, path, body }); return { status: 204, bytes: Buffer.alloc(0), contentType: 'text/plain' }; };
  const app = express();
  app.use(createQuizTeacherRouter({ callBot }));
  srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
}
afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));
function post(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'POST', path: '/api/th/step',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    r.on('error', reject);
    r.end(data);
  });
}

test.each(['true', 'false'])('late "%s" reaches the bot with the step', async (late) => {
  await boot();
  await post({ t: TOK, step: 'report', late });
  expect(calls).toHaveLength(1);
  expect(calls[0].body).toEqual({ t: TOK, step: 'report', late });
});

test.each([[true], ['yes'], ['TRUE'], [1]])('late %p is dropped; the step still goes', async (late) => {
  await boot();
  await post({ t: TOK, step: 'report', late });
  expect(calls[0].body).toEqual({ t: TOK, step: 'report' });
});
