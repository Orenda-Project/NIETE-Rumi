// web-quiz-child-page/audio — what the child hears and what the page does when it cannot: the phone's voice when a
// clip fails or is missing, the sound button, silence on leaving, the feedback lines and their words on screen,
// hints and the stuck nudge, numbers written out, telemetry of answers and page sessions. Recording clips through
// the voice vendor is OFF on this lane (no cassette for the quiz voice): every scenario about the recording job says so.
'use strict';
const L = require('./lib.cjs');
const { expect, WAIT, CODES, text, inner, count, boot, onScreen, openQuiz, startAsNew, play, toResults, sleep, q } = L;
const M = (m) => onScreen(m);
const modes = {}, runs = {};
const on = (id, mode, fn) => { modes[id] = mode; runs[id] = fn; };
const NO_VENDOR = 'read-aloud clips are recorded through the voice vendor (web-quiz-publish.service → tts.synthesize, Soniox Grace/Ishita); this lane replays cassettes and holds none for the quiz voice, so web_quiz_audio_enabled is off in the demo seed';

// A quiz row "recorded" with clips at keys that do not exist in this run's file store: the signed URLs answer 404.
async function fakeClips(ctx, code, perQuestion) {
  const quizId = await L.one(ctx, 'select quiz_id from quiz_share_codes where code = ' + q(code));
  const qids = (await L.rows(ctx, 'select id from quiz_questions where quiz_id = ' + q(quizId) + ' order by sort_order')).map((r) => r[0]);
  const audio = {}; qids.forEach((id, i) => { audio[id] = perQuestion(id, i); });
  await ctx.sql("update quizzes set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('web', jsonb_build_object('audio_v', 6, 'audio_voice', 'sx-grace', 'audio', " + q(JSON.stringify(audio)) + "::jsonb)) where id = " + q(quizId));
  return { quizId, qids };
}
const clearClips = (ctx, quizId) => ctx.sql("update quizzes set meta = meta - 'web' where id = " + q(quizId));
const voice = (page) => page.evaluate(() => ({ speaking: window.speechSynthesis ? speechSynthesis.speaking : false, voices: window.speechSynthesis ? speechSynthesis.getVoices().length : 0, audios: [...document.querySelectorAll('audio')].map((a) => ({ paused: a.paused, src: (a.currentSrc || a.src || '').slice(-40) })), cls: document.getElementById('wq').className }));

on('WQ008', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const { quizId } = await fakeClips(ctx, 'IT34CD', (id) => ({ q: 'quiz-audio/missing/' + id + '/q.ogg', opts: [null, null, null, null], why: null }));
  try {
    const ev = L.events(page);
    const b = await startAsNew(page, ctx, 'IT34CD', 'Clip8');
    expect(b.quiz.questions[0].audio && b.quiz.questions[0].audio.q, 'the payload carries no clip for question 1');
    await sleep(4000);
    const v = await voice(page);
    expect(/wq-phonevoice|wq-novoice/.test(v.cls), 'the page did not fall back to the phone\'s voice: ' + v.cls);
    await ev.flush();
    const fb = ev.of('audio_fallback');
    expect(fb.length >= 1 && fb.every((e) => typeof e.reason === 'string' && e.reason), 'no audio_fallback event with a reason (events: ' + [...new Set(ev.list.map((e) => e.n))].join(', ') + ')');
    return { reasons: [...new Set(fb.map((e) => e.reason))], page: v.cls };
  } finally { await clearClips(ctx, quizId); }
});

on('WQ010', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  // a clip that never starts (a URL that hangs): the child taps at once
  await page.route('**/quiz-audio/**', () => {});
  const { quizId } = await fakeClips(ctx, 'IT34CD', (id) => ({ q: 'quiz-audio/slow/' + id + '/q.ogg', opts: [null, null, null, null], why: null }));
  try {
    const ev = L.events(page);
    const clipAsks = [];                                             // every fetch of the question's clip: one before the tap, none after
    page.on('request', (r) => { if (/\/quiz-audio\/slow\//.test(r.url())) clipAsks.push({ at: Date.now(), url: r.url().split('/').slice(-2).join('/') }); });
    const b = await startAsNew(page, ctx, 'IT34CD', 'Quick10');
    const qq = await L.current(page, b.quiz.questions);
    await sleep(1500);
    const tapAt = Date.now();
    await L.answerRight(page, qq);                                   // kind-aware: a multi-select needs Check
    await page.waitForSelector('#wq-next', { state: 'visible', timeout: WAIT });
    await sleep(6000);
    await ev.flush();
    const fb = ev.of('audio_fallback').filter((e) => e.qid === qq.qid && e.part !== 'why');
    expect(fb.length === 0, 'audio_fallback was logged for the stopped clip: ' + JSON.stringify(fb));
    const again = clipAsks.filter((a) => a.at > tapAt + 300);
    expect(again.length === 0, 'the old question\'s clip was asked for again after the tap: ' + JSON.stringify(again));
    expect(/#wq-fb|wq-fb/.test(await page.content()) && (await inner(page, '#wq-fb')).length > 0, 'no feedback shown');
    return { fallbacks: 0, clipAsksBeforeTap: clipAsks.length, afterTap: 0 };
  } finally { await page.unroute('**/quiz-audio/**'); await clearClips(ctx, quizId); }
});

on('WQ024', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const b = await startAsNew(page, ctx, CODES.OPEN, 'Voice24');
  const qq = await L.current(page, b.quiz.questions);
  const right = qq.options.find((o) => o.slot === qq.correct_slot).text;
  await page.click('.wq-opt[data-slot="' + L.wrongSlot(qq) + '"]');
  await page.waitForSelector('#wq-fb .wq-no', { state: 'visible', timeout: WAIT });
  const line = await page.$eval('#wq-fb .wq-fb', (e) => e.childNodes[0].textContent.trim());
  // the shared library's "not yet" set: eight lines, every one ending "The answer is", then the right answer by name
  expect(new RegExp('The answer is "' + right + '"\\.$').test(line), 'the not-yet line reads "' + line + '"');
  const fbText = await inner(page, '#wq-fb');
  expect(!/Well done|Great|Brilliant|Correct|Yes!/.test(fbText), 'praise is shown after a wrong answer: ' + fbText);
  expect(await page.$('#wq-fb .wq-why'), 'no reason after the wrong answer');
  await page.click('#wq-next');
  const q2 = await L.current(page, b.quiz.questions);
  await page.click('.wq-opt[data-slot="' + q2.correct_slot + '"]');
  await page.waitForSelector('#wq-fb .wq-ok', { state: 'visible', timeout: WAIT });
  const praise = await page.$eval('#wq-fb .wq-fb', (e) => e.childNodes[0].textContent.trim());
  expect(/Yes|right|Correct|Spot on|Brilliant|Well done|got it/i.test(praise), 'the right answer is not praised: "' + praise + '"');
  return { wrong: line, right: praise, note: 'the recorded "why" clip (vendor) is not driven here: ' + NO_VENDOR };
});

on('WQ025', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  await startAsNew(page, ctx, CODES.OPEN, 'Hush25');
  await sleep(500);
  await page.evaluate(() => { window.dispatchEvent(new Event('pagehide')); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(300);
  const v = await voice(page);
  expect(!v.speaking && v.audios.every((a) => a.paused), 'sound is still playing after the page hid: ' + JSON.stringify(v));
  await sleep(2500);
  const v2 = await voice(page);
  expect(!v2.speaking && v2.audios.every((a) => a.paused), 'something started again without a tap');
  return { silenced: true, note: 'a lesson video is not in the demo quizzes' };
});

on('WQ026', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const ev = L.events(page);
  const b = await startAsNew(page, ctx, CODES.OPEN, 'Snd26');
  const snd = await page.$eval('#wq-snd', (e) => ({ pressed: e.getAttribute('aria-pressed'), text: e.innerText.trim() }));
  expect(snd.pressed === 'true' && snd.text === '🔔', 'sound is not on by default: ' + JSON.stringify(snd));
  expect((await L.stored(page, 'wq_sound')) === null || (await L.stored(page, 'wq_sound')) === true, 'a sound setting was already stored');
  // no recorded clip: the page logs audio_missing with the question and the part; no voices: the words are shown big
  await sleep(1500);
  await ev.flush();
  const missing = ev.of('audio_missing');
  expect(missing.length && missing.every((e) => e.qid && e.part), 'no audio_missing {qid, part} (events: ' + [...new Set(ev.list.map((e) => e.n))].join(', ') + ')');
  const v = await voice(page);
  if (v.voices === 0) expect(/wq-novoice/.test(v.cls), 'no voice for the language, but the words are not shown big');
  await page.click('#wq-snd'); await sleep(300);
  const off = await page.$eval('#wq-snd', (e) => ({ pressed: e.getAttribute('aria-pressed'), text: e.innerText.trim() }));
  expect(off.pressed === 'false' && off.text === '🔕', 'the button does not show sound off: ' + JSON.stringify(off));
  expect((await L.stored(page, 'wq_sound')) === false, 'the phone did not remember sound off');
  const after = ev.list.length;
  const qq = await L.current(page, b.quiz.questions); await page.click('.wq-opt[data-slot="' + L.wrongSlot(qq) + '"]');
  await page.waitForSelector('#wq-fb .wq-no', { state: 'visible', timeout: WAIT });
  const line = await inner(page, '#wq-fb .wq-fb');
  expect(!/\.\.|\.\s*\./.test(line.split('\n')[0]), 'the not-yet line ends with a doubled full stop: "' + line.split('\n')[0] + '"');
  await sleep(1500);
  const v2 = await voice(page);
  expect(!v2.speaking && v2.audios.every((a) => a.paused), 'a clip or the phone\'s voice played with sound off');
  await ev.flush();
  const spoke = ev.list.slice(after).filter((e) => /^audio_/.test(e.n));
  expect(spoke.length === 0, 'audio events after sound off: ' + JSON.stringify(spoke.slice(0, 2)));
  return { default: 'on', missing: missing.length, off: true };
});

on('WQ053', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const VOICE = await page.evaluate(() => null);
  const b = await startAsNew(page, ctx, CODES.OPEN, 'Lines53');
  const sets = await page.evaluate(() => (window.__wqVoice ? window.__wqVoice : null));
  const leads = [];
  for (let i = 0; i < 5; i++) {
    const qq = await L.current(page, b.quiz.questions);
    await page.click('.wq-opt[data-slot="' + (i === 1 ? L.wrongSlot(qq) : qq.correct_slot) + '"]');
    await page.waitForSelector('#wq-fb .wq-fb', { state: 'visible', timeout: WAIT });
    leads.push(await page.$eval('#wq-fb .wq-fb', (e) => e.childNodes[0].textContent.trim()));
    await page.click('#wq-next');
    await page.waitForSelector(M('M6') + ' .wq-opt, #wq-fix, ' + M('M9'), { state: 'attached', timeout: WAIT });
  }
  const rights = leads.filter((l, i) => i !== 1);
  expect(rights.every((l, i) => i === 0 || l !== rights[i - 1]), 'the same right line twice in a row: ' + rights.join(' | '));
  expect(/The answer is "/.test(leads[1]), 'the wrong answer\'s lead is "' + leads[1] + '"');
  // a picture answer: "Not yet. Look, this one is right." with no empty quotes
  await page.evaluate(() => localStorage.clear());
  const b2 = await startAsNew(page, ctx, CODES.G3, 'Pic53');            // the picture-only item lives in the grade-3 quiz
  // the options are only pictures (no names): the page's "notyetpic" line; a NAMED picture ("Cat") is quoted like any option
  const pic = b2.quiz.questions.find((x) => x.text === 'Which picture shows a circle?');
  expect(pic && pic.options.every((o) => !o.text && !o.name), 'the picture-only item has named options: ' + JSON.stringify(pic && pic.options.map((o) => o.text)));
  for (;;) { const cur = await L.current(page, b2.quiz.questions); if (cur === pic) break; await L.answerRight(page, cur); await L.nextQ(page); await page.waitForSelector(M('M6') + ' .wq-item', { state: 'visible', timeout: WAIT }); }
  await page.click('.wq-opt[data-slot="' + L.wrongSlot(pic) + '"]');
  await page.waitForSelector('#wq-fb .wq-fb', { state: 'visible', timeout: WAIT });
  const picLine = await page.$eval('#wq-fb .wq-fb', (e) => e.childNodes[0].textContent.trim());
  expect(!/""/.test(picLine) && !/The answer is "/.test(picLine), 'the picture not-yet line reads "' + picLine + '" (a picture answer is pointed at, never quoted)');
  void VOICE; void sets;
  return { leads, picture: picLine, note: 'the Urdu bubble fit at 360 px is not measured here' };
});

on('WQ055', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const qid = await L.one(ctx, "select id from quiz_questions where question_text = 'Is a whale a fish?'");
  const fb = { wrong: { 1: 'B) Good try! You mixed up a mammal and a fish. The correct answer is A) No, because a whale breathes air. Keep going!' } };
  await ctx.sql('update quiz_questions set option_feedback = ' + q(JSON.stringify(fb)) + '::jsonb where id = ' + q(qid));
  try {
    const b = await startAsNew(page, ctx, 'IT34CD', 'Mix55');
    const target = b.quiz.questions.find((x) => x.qid === qid);
    expect(target, 'the whale question is not served');
    for (;;) { const cur = await L.current(page, b.quiz.questions); if (cur === target) break; await L.answerRight(page, cur); await L.nextQ(page); await page.waitForSelector(M('M6') + ' .wq-item', { state: 'visible', timeout: WAIT }); }
    await page.click('.wq-opt[data-slot="B"]');
    await page.waitForSelector('#wq-fb .wq-fb', { state: 'visible', timeout: WAIT });
    const shown = await inner(page, '#wq-fb .wq-fb');
    // the lead is one of the page's eight recorded not-yet lines; the spec quotes the first
    expect(/(Not yet|Not quite|Not this one|Let's learn it together|That one was tricky|Not this time|Hmm, not yet|No problem, let's see)\. The (right )?answer is "No"\./.test(shown), 'no not-yet lead naming the right option: ' + shown);
    expect(/You mixed up a mammal and a fish\./.test(shown), 'the mix-up is missing: ' + shown);
    expect(!/correct answer is|Good try|Keep going|\bB\)|\bA\)/.test(shown), 'letters, praise or "the correct answer is" remain: ' + shown);
    return { shown: shown.split('\n').slice(0, 3) };
  } finally { await ctx.sql('update quiz_questions set option_feedback = null where id = ' + q(qid)); }
});

on('WQ056', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const b = await startAsNew(page, ctx, 'IT34CD', 'Tf56');
  const tf = b.quiz.questions.find((x) => x.text === 'Ice is a solid.');
  for (;;) { const cur = await L.current(page, b.quiz.questions); if (cur === tf) break; await L.answerRight(page, cur); await L.nextQ(page); await page.waitForSelector(M('M6') + ' .wq-item', { state: 'visible', timeout: WAIT }); }
  await page.click('.wq-opt.wq-tfn');
  await page.waitForSelector('#wq-fb .wq-fb', { state: 'visible', timeout: WAIT });
  const line = await page.$eval('#wq-fb .wq-fb', (e) => e.childNodes[0].textContent.trim());
  expect(line === 'Not yet. This sentence is true.', 'the line reads "' + line + '"');
  await L.openQuiz(page, ctx, CODES.OPEN);
  const meta = await inner(page, '#wq .wq-small');
  expect(/5 questions · about 3 minutes/.test(meta), 'the landing meta reads "' + meta + '"');
  return { line, meta, note: 'the demo has no 1–2 question quiz for "about 1 minute"' };
});

on('WQ057', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const b = await startAsNew(page, ctx, CODES.OPEN, 'Num57');
  await play(page, b.quiz.questions, 1, -1);
  await page.waitForSelector(M('M6') + ' .wq-opt', { state: 'visible', timeout: WAIT });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#wq-cont', { state: 'visible', timeout: WAIT });
  const cont = await inner(page, '#wq-cont');
  expect(cont === 'Go on: question 2 of 5', 'the resume reads "' + cont + '"');
  await page.click('#wq-cont'); await play(page, b.quiz.questions, 4, -1); await toResults(page);
  await page.click('#wq-class'); await page.waitForSelector('#wq-next', { state: 'visible', timeout: WAIT });
  expect((await inner(page, '#wq-next')) === 'My scores', 'no "My scores"');
  await page.click('#wq-next'); await page.waitForSelector(M('M13'), { state: 'attached', timeout: WAIT });
  const hist = await text(page);
  expect(/\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/.test(hist), 'no "6 Oct"-style date: ' + hist.slice(0, 160));
  expect(!/\d{4}-\d{2}-\d{2}/.test(hist), 'an ISO date is shown');
  return { cont, history: 'day month' };
});

// ── hints ─────────────────────────────────────────────────────────────────────────────────────────────────────────
async function withHint(ctx, hint) {
  const qid = await L.one(ctx, "select id from quiz_questions where question_text = 'Ice is a solid.'");
  await ctx.sql("update quiz_questions set media = jsonb_set(media, '{web,hint}', " + q(JSON.stringify(hint)) + '::jsonb) where id = ' + q(qid));
  return qid;
}
const dropHint = (ctx, qid) => ctx.sql("update quiz_questions set media = media #- '{web,hint}' where id = " + q(qid));
async function reachTf(page, ctx, name) {
  const b = await startAsNew(page, ctx, 'IT34CD', name);
  const tf = b.quiz.questions.find((x) => x.text === 'Ice is a solid.');
  for (;;) { const cur = await L.current(page, b.quiz.questions); if (cur === tf) return { b, tf }; await L.answerRight(page, cur); await L.nextQ(page); await page.waitForSelector(M('M6') + ' .wq-item', { state: 'visible', timeout: WAIT }); }
}

on('WQ061', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const qid = await withHint(ctx, { text: 'Think about what you can pour into a glass.' });
  try {
    const { b, tf } = await reachTf(page, ctx, 'Hint61');
    expect(tf.hint && tf.hint.text, 'the payload carries no hint');
    expect((await inner(page, '#wq-jhelp-t')) === 'Need a hint?', 'no "Need a hint?"');
    await page.click('#wq-jhelp');
    await page.waitForSelector('#wq-hintbox .wq-say', { state: 'visible', timeout: WAIT });
    const shown = await inner(page, '#wq-hintbox .wq-say');
    expect(shown === 'Think about what you can pour into a glass.', 'the hint shows "' + shown + '"');
    expect(await page.$('#wq-hintbox .wq-hintjug img'), 'no thinking Jugnu beside the hint');
    expect(!/True|False|solid/i.test(shown), 'the hint names an option');
    await page.click('.wq-opt.wq-tfy'); await page.waitForSelector('#wq-next', { state: 'visible', timeout: WAIT }); await page.click('#wq-next');
    await play(page, b.quiz.questions, b.quiz.questions.length - b.quiz.questions.indexOf(tf) - 1, -1); const got = await toResults(page);
    expect(/You got 7 out of 7/.test(got), 'using the hint changed the score: ' + got);
    return { hint: shown, score: got, note: 'the hint\'s own recorded clip: ' + NO_VENDOR };
  } finally { await dropHint(ctx, qid); }
});

on('WQ062', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const qid = await withHint(ctx, { text: 'Think about what you can pour into a glass.' });
  try {
    await reachTf(page, ctx, 'Nudge62');
    // the 20 s start once the question has been read; with no voice in this browser each spoken part waits its
    // safety timer (3 s + 110 ms a character, wq.js speak) first, so the nudge lands at 20 s plus that
    const t0 = Date.now();
    await page.waitForSelector('#wq-jhelp.wq-nudge', { state: 'attached', timeout: 60000 }).catch(() => {});
    const nudgeMs = Date.now() - t0;
    const nudge = await page.$eval('#wq-jhelp', (e) => ({ cls: e.className, text: e.querySelector('#wq-jhelp-t').innerText.trim() }));
    expect(/wq-nudge/.test(nudge.cls) && nudge.text === 'Stuck? Tap me for a hint.', 'no nudge within 60 s: ' + JSON.stringify(nudge));
    expect(nudgeMs >= 19000, 'the nudge came after only ' + nudgeMs + ' ms');
    await sleep(3000);
    expect((await page.$$('#wq-jhelp.wq-nudge')).length === 1, 'more than one nudge');
    await dropHint(ctx, qid);
    await page.evaluate(() => localStorage.clear());
    await startAsNew(page, ctx, CODES.OPEN, 'Nohint62');
    const t1 = Date.now();
    await page.waitForSelector('#wq-help .wq-hint', { state: 'attached', timeout: 60000 }).catch(() => {});
    const againMs = Date.now() - t1;
    expect(/Shall we listen again\?/.test(await inner(page, '#wq-help')), 'a question with no hint does not offer "Shall we listen again?" within 60 s');
    return { nudge: nudge.text, nudgeMs, noHint: 'Shall we listen again?', againMs };
  } finally { await dropHint(ctx, qid).catch(() => {}); }
});

on('WQ063', 'off', async () => ({ blocked: 'the giveaway filter runs when a quiz is authored (web-quiz-items normaliseItem → web-quiz-hint hintFor), downstream of the author LLM — no cassette for an authoring run on this lane; the page trusts media.web.hint' }));

// ── recording clips (the vendor) ──────────────────────────────────────────────────────────────────────────────────
on('WQ074', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  // off (the seed): a fresh quiz opens, nothing is recorded, the words are shown big
  const before = (L.botLog(ctx) + L.workerLog(ctx)).split('\n').filter((l) => /tts\.synthesize|web_quiz_audio\./.test(l)).length;
  await startAsNew(page, ctx, CODES.G2, 'Cap74');
  await sleep(2500);
  const v = await voice(page);
  if (v.voices === 0) expect(/wq-novoice/.test(v.cls), 'the words are not shown big with no voice');
  const after = (L.botLog(ctx) + L.workerLog(ctx)).split('\n').filter((l) => /tts\.synthesize/.test(l)).length;
  expect(after === before, 'a recording was attempted with the switch off');
  // on, but the day's cap is reached: logged as capped, nothing recorded
  await L.setFlag(ctx, page, 'web_quiz_audio_enabled', 'true'); await L.setFlag(ctx, page, 'web_quiz_audio_daily_cap', '0');
  // the bot asks for a quiz's clips at most once in 10 min (web-quiz-publish REQUEST_AGAIN_MS): a quiz nobody opened yet
  const src = await L.one(ctx, "select quiz_id from quiz_share_codes where code = 'GR3ABC'");
  const fresh = await L.one(ctx, "insert into quizzes (id, teacher_id, quiz_source, topic, grade, subject, status, language, total_students_sent, created_at) select gen_random_uuid(), teacher_id, quiz_source, 'Cap quiz (WQ074)', grade, subject, status, language, 0, now() from quizzes where id = " + q(src) + ' returning id');
  await ctx.sql('insert into quiz_questions (id, quiz_id, question_text, option_a, option_b, option_c, option_d, correct_option, explanation, difficulty_level, sort_order, media, option_feedback) select gen_random_uuid(), ' + q(fresh) + ', question_text, option_a, option_b, option_c, option_d, correct_option, explanation, difficulty_level, sort_order, media, option_feedback from quiz_questions where quiz_id = ' + q(src));
  await ctx.sql("insert into quiz_share_codes (id, code, quiz_id, teacher_user_id, teacher_name, topic, language, active, uses_count, expires_at, created_at) select gen_random_uuid(), 'CAP74X', " + q(fresh) + ", teacher_user_id, teacher_name, 'Cap quiz (WQ074)', language, true, 0, null, now() from quiz_share_codes where code = 'GR3ABC'");
  try {
    await sleep(31000);                                     // the worker keeps the switch settings 60 s (SETTINGS_CACHE_MS); setFlag waited 31 s
    await page.evaluate(() => localStorage.clear());
    await startAsNew(page, ctx, 'CAP74X', 'Cap74b');
    let log = '';
    for (let i = 0; i < 20 && !/web_quiz_audio\.capped/.test(log); i++) { await sleep(1000); log = L.botLog(ctx) + '\n' + L.workerLog(ctx); }
    expect(/web_quiz_audio\.capped/.test(log), 'reaching the cap was not logged as web_quiz_audio.capped within 20 s (bot + worker logs; publish_audio lines: ' + log.split('\n').filter((l) => /"reason"|reason:/.test(l)).slice(-2).join(' | ') + ')');
    expect(log.split('\n').filter((l) => /tts\.synthesize/.test(l)).length === after, 'a clip was recorded over the cap');
  } finally {
    await L.setFlag(ctx, page, 'web_quiz_audio_enabled', 'false'); await L.setFlag(ctx, page, 'web_quiz_audio_daily_cap', null);
    await ctx.sql("delete from quiz_sessions where share_code_id in (select id from quiz_share_codes where code = 'CAP74X'); delete from quiz_share_codes where code = 'CAP74X'; delete from quiz_questions where quiz_id = " + q(fresh) + '; delete from quizzes where id = ' + q(fresh));
  }
  return { off: 'nothing recorded', capped: 'logged' };
});

for (const [id, why] of [
  ['WQ023', 'the clip is what the vendor says: ' + NO_VENDOR],
  ['WQ054', 'the background recording job calls the vendor: ' + NO_VENDOR],
  ['WQ070', 'one voice per language is a property of the recorded clips: ' + NO_VENDOR],
  ['WQ071', 'a vendor outage during recording cannot be staged: ' + NO_VENDOR],
  ['WQ073', 'the bucket path is written by the recording job: ' + NO_VENDOR + '; WEB_QUIZ_AUDIO_BUCKET is not set on this lane'],
  ['WQ160', 'the feedback lines\' language follows quiz.voice_lang; the shared library is served (WQ053), the per-quiz clips are not recorded here: ' + NO_VENDOR],
  ['WQ176', 'needs a quiz whose clips land during the play: ' + NO_VENDOR],
  ['WQ185', 'library (bank) questions with recorded clips need the video lesson bank, absent from the demo seed'],
  ['WQ186', 'a listen-and-identify library item needs the lesson bank\'s clips, absent from the demo seed'],
  ['WQ187', 'the recording job and the bank clips: ' + NO_VENDOR + '; no lesson bank in the demo seed'],
  ['WQ201', 'the ten figure pointer lines are served from the shared library (dashboard/public/wq/voice); which one plays before a figure is audible, not visible — and the phone voice for an own wording is headless silence'],
  ['WQ202', 'a transcribed, checked explanation clip is lesson-bank data, absent from the demo seed'],
  ['WQ203', 'the voice text of a sum is what the recording job sends the vendor: ' + NO_VENDOR],
  ['WQ193', 'a library quiz that starts with its lesson video needs the lesson bank, absent from the demo seed'],
  ['WQ195', 'library lessons in another language need the lesson bank, absent from the demo seed'],
  ['WQ196', 'needs a finished library lesson in another language (lesson bank), absent from the demo seed'],
]) on(id, 'off', async () => ({ blocked: why }));

on('WQ072', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  // a clip that takes long to start: the words show big, the phone's voice does not speak; after 8 s it is let go as stalled
  let release = null; await page.route('**/quiz-audio/**', (r) => { release = () => r.abort(); });
  const { quizId } = await fakeClips(ctx, 'IT34CD', (id) => ({ q: 'quiz-audio/slow/' + id + '/q.ogg', opts: [null, null, null, null], why: null }));
  try {
    const ev = L.events(page);
    await startAsNew(page, ctx, 'IT34CD', 'Slow72');
    await sleep(3000);
    const v = await voice(page);
    expect(/wq-novoice/.test(v.cls), 'the words are not shown big while the clip loads: ' + v.cls);
    expect(!v.speaking && !/wq-phonevoice/.test(v.cls), 'the phone\'s voice spoke instead of waiting');
    await sleep(6500);
    await ev.flush();
    const stalled = ev.of('audio_fallback').filter((e) => e.reason === 'stalled');
    expect(stalled.length >= 1, 'the clip was not let go as stalled (events: ' + JSON.stringify(ev.of('audio_fallback')) + ')');
    if (release) release();
    return { big: true, stalled: stalled.length, note: 'the autoplay refusal (reason "reject", pulsing speaker) needs a browser that blocks autoplay; headless Chromium allows it' };
  } finally { await page.unroute('**/quiz-audio/**'); await clearClips(ctx, quizId); }
});

on('WQ192', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const { quizId, qids } = await fakeClips(ctx, 'IT34CD', (id, i) => (i === 4 ? { q: 'quiz-audio/t/' + id + '/q.ogg', opts: ['quiz-audio/t/' + id + '/a.ogg', 'quiz-audio/t/' + id + '/b.ogg', 'quiz-audio/t/' + id + '/c.ogg', null], why: null, stim: 'quiz-audio/t/' + id + '/s.ogg' } : { q: null, opts: [null, null, null, null], why: null }));
  try {
    const b = await startAsNew(page, ctx, 'IT34CD', 'Tiles92');
    const listen = b.quiz.questions.find((x) => x.qid === qids[4]);
    expect(listen && listen.audio && listen.audio.opts.filter(Boolean).length === 3, 'the listen item carries no option clips');
    for (;;) { const cur = await L.current(page, b.quiz.questions); if (cur === listen) break; await L.answerRight(page, cur); await L.nextQ(page); await page.waitForSelector(M('M6') + ' .wq-item', { state: 'visible', timeout: WAIT }); }
    const tiles = await page.$$eval('.wq-stile', (els) => els.map((e) => ({ hear: Boolean(e.querySelector('.wq-shear')), answer: e.querySelector('.wq-sthis') && e.querySelector('.wq-sthis').innerText.trim(), h: e.getBoundingClientRect().height })));
    expect(tiles.length === 3 && tiles.every((t) => t.hear && t.answer === 'This one'), 'tiles: ' + JSON.stringify(tiles));
    await page.click('.wq-stile .wq-shear'); await sleep(800);
    expect(!(await page.$('#wq-next')), 'tapping a tile\'s sound answered the question');
    await page.click('.wq-stile .wq-sthis'); await page.waitForSelector('#wq-next', { state: 'visible', timeout: WAIT });
    // an item with an option that has no sound keeps its ordinary buttons (every other question here)
    await page.click('#wq-next'); await page.waitForSelector(M('M6') + ' .wq-item, #wq-fix, ' + M('M9'), { state: 'attached', timeout: WAIT });
    if (await page.$(M('M6') + ' .wq-item')) expect(await page.$('.wq-opts .wq-opt'), 'an item without sounds lost its ordinary buttons');
    return { tiles: tiles.length };
  } finally { await clearClips(ctx, quizId); }
});

on('WQ194', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const qid = await L.one(ctx, "select id from quiz_questions where question_text = 'Is a whale a fish?'");
  await ctx.sql("update quiz_questions set media = coalesce(media, '{}'::jsonb) || '{\"stimulus_audio\": \"http://127.0.0.1:9/whale.mp3\"}'::jsonb where id = " + q(qid));
  try {
    const b = await startAsNew(page, ctx, 'IT12AB', 'Stim94');
    const snd = b.quiz.questions.find((x) => x.text === 'Which animal do you hear?');
    for (;;) { const cur = await L.current(page, b.quiz.questions); if (cur === snd) break; await L.answerRight(page, cur); await L.nextQ(page); await page.waitForSelector(M('M6') + ' .wq-item', { state: 'visible', timeout: WAIT }); }
    expect(await page.$('#wq-stim'), 'the listen item has no "Play the sound"');
    await page.evaluate(() => localStorage.clear());
    const b2 = await startAsNew(page, ctx, 'IT34CD', 'Stim94b');
    const whale = b2.quiz.questions.find((x) => x.qid === qid);
    for (;;) { const cur = await L.current(page, b2.quiz.questions); if (cur === whale) break; await L.answerRight(page, cur); await L.nextQ(page); await page.waitForSelector(M('M6') + ' .wq-item', { state: 'visible', timeout: WAIT }); }
    expect(!(await page.$('#wq-stim')), 'an ordinary question plays a clip before the answer');
    return { listen: 'Play the sound', ordinary: 'no clip' };
  } finally { await ctx.sql("update quiz_questions set media = media - 'stimulus_audio' where id = " + q(qid)); }
});

on('WQ204', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const ev = L.events(page);
  const b = await startAsNew(page, ctx, CODES.OPEN, 'Log204');
  const qq = await L.current(page, b.quiz.questions);
  await page.click('.wq-opt[data-slot="' + L.wrongSlot(qq) + '"]'); await page.waitForSelector('#wq-next', { state: 'visible', timeout: WAIT }); await page.click('#wq-next');
  const q2 = await L.current(page, b.quiz.questions);
  await page.click('.wq-opt[data-slot="' + q2.correct_slot + '"]'); await page.waitForSelector('#wq-next', { state: 'visible', timeout: WAIT });
  await ev.flush();
  const answers = ev.of('answer'); const fbs = ev.of('feedback_view');
  expect(answers.length >= 2 && answers.some((e) => e.ok === 0 || e.ok === false) && answers.some((e) => e.ok === 1 || e.ok === true), 'answer events do not say right/wrong: ' + JSON.stringify(answers));
  expect(fbs.length >= 2 && fbs.every((e) => 'ok' in e), 'feedback_view events do not say right/wrong: ' + JSON.stringify(fbs));
  await sleep(2000);
  const logged = L.botLog(ctx).split('\n').filter((l) => /"event":"web_quiz\.answer"/.test(l)).slice(-2);
  expect(logged.length && logged.every((l) => /"ok":(true|false|0|1)/.test(l)), 'the bot log lacks ok on web_quiz.answer: ' + logged.map((l) => l.slice(0, 160)).join(' | '));
  return { answers: answers.map((e) => e.ok), feedback: fbs.map((e) => e.ok) };
});

on('WQ205', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const batches = [];
  page.on('request', (r) => { if (/\/api\/wq\/e$/.test(r.url()) && r.method() === 'POST') { try { batches.push(JSON.parse(r.postData() || '{}')); } catch (_) { /* */ } } });
  const b = await startAsNew(page, ctx, CODES.OPEN, 'Tele205');
  await play(page, b.quiz.questions, 2, -1);
  await sleep(32000);                                       // one heartbeat while visible and idle
  await page.evaluate(() => { window.dispatchEvent(new Event('pagehide')); });
  await sleep(1500);
  const events = batches.flatMap((x) => x.events || []);
  const ps = new Set(events.map((e) => e.ps || (batches.find((x) => (x.events || []).includes(e)) || {}).ps).filter(Boolean));
  const psAll = new Set(batches.map((x) => x.ps).filter(Boolean));
  expect(psAll.size === 1 || ps.size === 1, 'the page load does not carry one page-session id: ' + JSON.stringify([...psAll]));
  const seqs = events.map((e) => e.seq).filter((n) => typeof n === 'number').sort((a, c) => a - c);
  expect(seqs.length && seqs.every((n, i) => i === 0 || n === seqs[i - 1] + 1), 'sequence numbers have gaps: ' + seqs.slice(0, 12).join(','));
  const names = new Set(events.map((e) => e.n));
  for (const want of ['screen_enter', 'screen_leave', 'hb']) expect(names.has(want), 'no ' + want + ' event (seen: ' + [...names].join(', ') + ')');
  const raw = JSON.stringify(batches);
  expect(!/Tele205/.test(raw), 'the child\'s name is in the telemetry');
  expect(!/"st":/.test(raw) && !/"device_ref":/.test(raw), 'the session token or device ref is in the telemetry');
  return { events: events.length, names: [...names] };
});

on('WQ190', 'off', async (page, ctx) => {
  await L.setMode(ctx, page, 'off');
  const browser = page.context().browser();
  const out = {};
  for (const [label, ua] of [['whatsapp', 'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36 [WA4A/2.24.10.74;]'], ['browser', 'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36']]) {
    const context = await browser.newContext({ viewport: { width: 412, height: 915 }, userAgent: ua });
    const p = await context.newPage();
    const opened = [];
    p.on('request', (r) => { if (/\/api\/wq\/e$/.test(r.url()) && r.method() === 'POST') { try { for (const e of JSON.parse(r.postData() || '{}').events || []) if (e.n === 'page_open') opened.push(e); } catch (_) { /* */ } } });
    await p.goto(ctx.baseUrl + '/q/' + CODES.OPEN, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#wq-play', { state: 'visible', timeout: WAIT });
    await sleep(6000);
    await context.close();
    expect(opened.length, label + ': no page_open event');
    out[label] = opened[0];
  }
  const app = (e) => e.app || e.src || e.how || e.ua || '';
  expect(/whatsapp/i.test(JSON.stringify(out.whatsapp)) && (out.whatsapp.iab === true || out.whatsapp.iab === 1), 'the WhatsApp browser is not named/flagged: ' + JSON.stringify(out.whatsapp));
  expect(!(out.browser.iab === true || out.browser.iab === 1) && /browser/i.test(JSON.stringify(out.browser)), 'an ordinary browser is flagged as in-app: ' + JSON.stringify(out.browser));
  void app;
  return out;
});

module.exports = { runs, modes };
