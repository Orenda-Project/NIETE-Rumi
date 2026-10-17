/**
 * No raw person id or phone number on a log line: a log call's properties carry a person's keyed reference (`tk` for a
 * teacher, `kid` for a child, from bot/shared/services/quiz/web-quiz-kid.js) or a masked phone, never `userId: user.id`
 * or `phone`. What counts as a hit is in log-raw-ids-lib.js.
 *
 * Shrink-only allowlist: log-raw-ids.allowlist.json holds, per product file, the count of raw-id log properties when
 * the gate landed (`n`), the file's area, and the hits as they stood then (`at`, for the clean-up; not checked). A file
 * above its count, or a file not on the list with any hit, fails. A file below its count passes with a DOWN/CLEAN line:
 * lower its entry. Regenerate with `node tests/setup/gen-log-raw-ids-allowlist.js` (see its header before `--write`).
 */
const fs = require('fs');
const path = require('path');
const { countVerdict } = require('./ratchet-verdict-lib');
const { rawIdHits } = require('./log-raw-ids-lib');
const { scan } = require('./gen-log-raw-ids-allowlist');
const ALLOW = require('./log-raw-ids.allowlist.json');

const REPO = path.resolve(__dirname, '../..');

describe('raw person ids on log lines', () => {
  test('the pattern: a raw id or phone counts; a keyed reference, a masked phone, a literal and a message do not', () => {
    expect(rawIdHits("logEvent('quiz_menu.reports_shown', { userId: user.id, rows: 3 });")).toEqual(['1 userId: user.id']);
    expect(rawIdHits("logToFile('sent', { phone, quizId });")).toEqual(['1 phone (shorthand)']);
    expect(rawIdHits("console.warn('x', { teacherId: t, studentId: s.id });")).toEqual(['1 teacherId: t', '1 studentId: s.id']);
    expect(rawIdHits("logEvent('x', { tk: tk(user.id), kid: kid(id), phone: phone.slice(-4), from: 'list', userId: null });")).toEqual([]);
    expect(rawIdHits("logEvent('x', { hasPhone: !!phone, n: ids.length });")).toEqual([]);
    expect(rawIdHits("logToFile('userId: phone, from', { ok: true });")).toEqual([]);
    expect(rawIdHits('// logEvent("x", { userId: user.id })\n/* logEvent("x", { phone }) */')).toEqual([]);
    expect(rawIdHits("const o = { userId: user.id }; save(o);")).toEqual([]);
  });

  test('a hit names the line of its log call', () => {
    expect(rawIdHits("/* one\ntwo */\nconst a = 1;\nlogEvent('x', {\n  userId: u.id,\n});")).toEqual(['4 userId: u.id']);
  });

  test('no new raw id on a log line, and no file above its count', () => {
    const now = Object.fromEntries(Object.entries(scan()).map(([f, e]) => [f, e.n]));
    const allowed = Object.fromEntries(Object.entries(ALLOW).map(([f, e]) => [f, e.n]));
    const { failures, warnings } = countVerdict(now, allowed, {
      what: 'raw person id(s) or phone(s) on a log line (log tk()/kid() or a masked phone)', list: 'log-raw-ids.allowlist.json',
      exists: (f) => fs.existsSync(path.join(REPO, f)),
    });
    for (const line of warnings) console.warn(line);
    expect(failures).toEqual([]);
  });

  test('every allowlist entry names its area and a positive count', () => {
    const bad = Object.entries(ALLOW).filter(([, e]) => !(Number.isInteger(e.n) && e.n > 0 && typeof e.area === 'string' && e.area));
    expect(bad.map(([f]) => f)).toEqual([]);
  });
});
