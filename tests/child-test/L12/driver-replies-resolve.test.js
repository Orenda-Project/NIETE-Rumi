'use strict';
/** sandbox.json lives outside the repo ($G/sim/driver): a bare module name resolves next to the driver. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveReplies } = require('../../../bot/scripts/e2e/child-test-sim/driver');

test('a module beside the config wins; otherwise the driver\'s own directory', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'l12-cfg-'));
  const cfg = path.join(d, 'sandbox.json');
  expect(resolveReplies(cfg, './replies-axiom.js')).toBe(path.resolve(__dirname, '../../../bot/scripts/e2e/child-test-sim/replies-axiom.js'));
  fs.writeFileSync(path.join(d, 'replies-local.js'), 'module.exports={poll:async()=>[]}');
  expect(resolveReplies(cfg, './replies-local.js')).toBe(path.join(d, 'replies-local.js'));
});
