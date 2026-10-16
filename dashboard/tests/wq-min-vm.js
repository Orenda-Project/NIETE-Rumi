/**
 * Test-only (web_quiz_minify): run the vm-based page suites against the MINIFIED page files.
 *
 * Loaded as an extra Jest setup file, it makes every vm run of code built from a shipped page script
 * (public/wq/*.js except wq-tel.js, which is served raw) run that code minified exactly as the edge minifies it
 * (web-quiz.routes.js minifySource). A harness that patches the source first (wq-page-harness.js replaces wq.js's
 * tail to reach its internals) has the patched source minified, so the same suites drive the minified page.
 * String checks on the files themselves still read the raw files: only what runs in the vm changes.
 *
 *   npx jest --setupFiles ./tests/setup.js ./tests/wq-min-vm.js -- <page suites>
 *
 * WQ_MIN_VM_LOG=<file>: one line per minified run (the file it came from), to prove the hook took.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { minifySource } = require('../routes/web-quiz.routes');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const HEADS = fs.readdirSync(WQ).filter((f) => /\.js$/.test(f) && f !== 'wq-tel.js')
  .map((f) => [f, fs.readFileSync(path.join(WQ, f), 'utf8').slice(0, 400)]);
const done = new Map();

function shipped(code) {
  if (typeof code !== 'string' || code.length < 400) return null;
  const hit = HEADS.find(([, head]) => code.includes(head));
  return hit ? hit[0] : null;
}
// Jest's own module wrapper (a suite that require()s a page file): the wrapper stays, its body is minified.
const JEST_WRAP = /^(\(\{"Object\.<anonymous>":function\([^)]*\)\{)([\s\S]*)(\n\}\}\);?)$/;
function min(code) {
  const file = shipped(code);
  if (!file) return code;
  const w = JEST_WRAP.exec(code);
  if (w) return w[1] + min(w[2]) + w[3];
  if (!done.has(code)) done.set(code, minifySource(code, false));
  if (process.env.WQ_MIN_VM_LOG) fs.appendFileSync(process.env.WQ_MIN_VM_LOG, `${file}\n`);
  return done.get(code);
}

const { runInContext, runInNewContext, runInThisContext, Script } = vm;
vm.runInContext = (code, ...rest) => runInContext.call(vm, min(code), ...rest);
vm.runInNewContext = (code, ...rest) => runInNewContext.call(vm, min(code), ...rest);
vm.runInThisContext = (code, ...rest) => runInThisContext.call(vm, min(code), ...rest);
vm.Script = class MinScript extends Script {
  constructor(code, ...rest) { super(min(code), ...rest); }
};
