'use strict';
/**
 * Loading the PDF renderer must not take over the process's SIGTERM.
 *
 * html-to-pdf.js used to register `process.on('SIGTERM', () => closeBrowser()
 * .finally(() => process.exit()))`. The sqs-worker has its own SIGTERM handler:
 * a 30-second drain for short jobs and up to ten minutes for a lesson being
 * authored. Both listeners fire; the renderer's closes the browser in ~20 ms and
 * exits, so the worker's drain never gets to run.
 *
 * Measured on production (Railway container logs, sqs-worker, 15 Sep 2026): at
 * five deploys, every replica that had rendered a PDF or card logged "Playwright
 * browser closed" in the same millisecond as "Received SIGTERM" and nothing
 * after. The one replica that had not rendered anything drained a lesson to
 * completion. A killed job waits out its SQS visibility timeout (10-15 minutes)
 * before anyone retries it, and a lesson restarts authoring from round 0.
 *
 * The test runs a real child process, because the bug is between two listeners
 * on the real `process` — nothing short of a real signal shows it.
 */
const { spawn } = require('child_process');
const path = require('path');

const RENDERER = path.join(__dirname, '..', '..', 'bot', 'shared', 'utils', 'html-to-pdf.js');

// A stand-in for sqs-worker.js: load the renderer, then own SIGTERM with a drain.
const CHILD = `
  require(${JSON.stringify(RENDERER)});
  process.on('SIGTERM', async () => {
    process.stdout.write('DRAIN_STARTED\\n');
    await new Promise((r) => setTimeout(r, 1500));
    process.stdout.write('DRAIN_FINISHED\\n', () => process.exit(0));
  });
  setInterval(() => {}, 1000);
  process.stdout.write('READY\\n');
`;

function runAndSigterm() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', CHILD], {
      cwd: path.join(__dirname, '..', '..', 'bot'),
      env: { ...process.env, AXIOM_TOKEN: '', AXIOM_DATASET: '', LOG_LEVEL: 'silent' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const killer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`child hung: ${out}`)); }, 15000);
    child.stdout.on('data', (b) => {
      const before = out;
      out += b.toString();
      if (!before.includes('READY') && out.includes('READY')) child.kill('SIGTERM');
    });
    child.stderr.on('data', (b) => { out += b.toString(); });
    child.on('exit', (code, signal) => { clearTimeout(killer); resolve({ out, code, signal }); });
  });
}

describe('html-to-pdf and SIGTERM', () => {
  test('a process that loaded the renderer still finishes its own drain', async () => {
    const { out } = await runAndSigterm();
    expect(out).toContain('DRAIN_STARTED');
    expect(out).toContain('DRAIN_FINISHED');
  }, 20000);
});
