#!/usr/bin/env node
/**
 * tk-of — the teacher's keyed reference (tk) for a users.id: the value the log lines carry instead of the raw id.
 * For finding a teacher's lines in the logs; it prints the value and nothing else, never the key.
 *
 *   WEB_QUIZ_KID_KEY=… node scripts/tk-of.js <users.id>
 *
 * The key comes from the environment (an env file kept outside the repo, deleted after). Without it, or with one
 * shorter than 32 bytes, nothing is printed and the exit code is 2. The value is stable inside one key year
 * (WEB_QUIZ_KID_KEY_V).
 */
const KID = '../bot/shared/services/quiz/web-quiz-kid';
const MIN_KEY_BYTES = 32;

function main(argv, env) {
  const id = String(argv[0] || '').trim();
  if (!id) {
    process.stderr.write('usage: node scripts/tk-of.js <users.id>\n');
    return 1;
  }
  const k = env.WEB_QUIZ_KID_KEY;
  if (typeof k !== 'string' || Buffer.byteLength(k, 'utf8') < MIN_KEY_BYTES) {
    process.stderr.write(`WEB_QUIZ_KID_KEY is not set (or shorter than ${MIN_KEY_BYTES} bytes): no tk.\n`);
    return 2;
  }
  process.stdout.write(`${require(KID).tk(id)}\n`);
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2), process.env);

module.exports = { main };
