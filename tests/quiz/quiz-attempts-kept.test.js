'use strict';
/**
 * bd-v0toag.10 (2a) — every attempt is kept. Each start inserts its own quiz_sessions row
 * (video-quiz.service / web-quiz.service); the report's "N tries" and completion read them.
 * Pinned: no bot code deletes or upserts a quiz_sessions row (an upsert would overwrite an
 * earlier attempt). A source scan, with a positive control so a broken regex cannot pass.
 */
const fs = require('fs');
const path = require('path');

const BOT = path.join(__dirname, '..', '..', 'bot');
const RX = /from\(\s*['"]quiz_sessions['"]\s*\)[^;]{0,300}?\.(delete|upsert)\(/g;

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (['node_modules', 'tests', '.git'].includes(e.name)) return [];
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return jsFiles(p);
    return e.name.endsWith('.js') ? [p] : [];
  });
}

test('the scan catches a delete and an upsert (positive control)', () => {
  expect("supabase.from('quiz_sessions').delete().eq('id', x);".match(RX)).toHaveLength(1);
  expect("supabase\n  .from(\"quiz_sessions\")\n  .upsert(row, { onConflict: 'id' });".match(RX)).toHaveLength(1);
  expect("supabase.from('quiz_sessions').update({ status: 'expired' });".match(RX)).toBeNull();
});

test('no bot code deletes or upserts a quiz_sessions row', () => {
  const hits = jsFiles(BOT).flatMap((f) => (fs.readFileSync(f, 'utf8').match(RX) || []).map((m) => `${path.relative(BOT, f)}: ${m.slice(0, 80)}`));
  expect(hits).toEqual([]);
});

test('both child quiz paths insert a fresh row per attempt', () => {
  ['shared/services/quiz/video-quiz.service.js', 'shared/services/quiz/web-quiz.service.js'].forEach((f) => {
    expect(fs.readFileSync(path.join(BOT, f), 'utf8')).toMatch(/from\(\s*['"]quiz_sessions['"]\s*\)\s*\.insert\(/);
  });
});
