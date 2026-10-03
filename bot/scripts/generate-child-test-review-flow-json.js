#!/usr/bin/env node
/**
 * Writes the child test end-of-visit review Flow from its generator:
 *   docs/flows/child-test-review.json   (the coach marks only the answers the recording did not settle)
 * tests/child-test/L28/review-flow-contract.test.js fails if the committed file drifts from the
 * generator, so run this after any change to check-flow/review-flow.js or the review copy.
 *
 *   node bot/scripts/generate-child-test-review-flow-json.js
 */
const fs = require('fs');
const path = require('path');
const { buildChildTestReviewFlow } = require('../shared/services/child-test/check-flow/review-flow.js');

const count = (node) => (Array.isArray(node) ? node.reduce((n, c) => n + count(c), 0)
  : node && typeof node === 'object' ? (node.type ? 1 : 0) + ['children', 'then', 'else'].reduce((n, k) => n + count(node[k]), 0) : 0);
const flow = buildChildTestReviewFlow();
const out = path.join(__dirname, '../../docs/flows/child-test-review.json');
fs.writeFileSync(out, JSON.stringify(flow, null, 2) + '\n');
console.log(`wrote ${path.relative(process.cwd(), out)}: ${flow.screens.map((s) => `${s.id} ${count(s.layout.children)}`).join(', ')}`);
