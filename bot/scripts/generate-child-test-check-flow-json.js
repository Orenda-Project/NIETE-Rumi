#!/usr/bin/env node
/**
 * Writes the child test check Flow from its generator:
 *   docs/flows/child-test-check.json   (the coach confirms or corrects the AI's marks for one child)
 * tests/child-test/L6/check-flow-contract.test.js fails if the committed file drifts from the
 * generator, so run this after any change under bot/shared/services/child-test/check-flow/.
 *
 *   node bot/scripts/generate-child-test-check-flow-json.js
 */
const fs = require('fs');
const path = require('path');
const { buildChildTestCheckFlow } = require('../shared/services/child-test/check-flow/flow.js');

const count = (node) => (Array.isArray(node) ? node.reduce((n, c) => n + count(c), 0)
  : node && typeof node === 'object' ? (node.type ? 1 : 0) + ['children', 'then', 'else'].reduce((n, k) => n + count(node[k]), 0) : 0);
const flow = buildChildTestCheckFlow();
const out = path.join(__dirname, '../../docs/flows/child-test-check.json');
fs.writeFileSync(out, JSON.stringify(flow, null, 2) + '\n');
console.log(`wrote ${path.relative(process.cwd(), out)}: ${flow.screens.map((s) => `${s.id} ${count(s.layout.children)}`).join(', ')}`);
