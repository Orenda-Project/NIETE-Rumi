#!/usr/bin/env node
/**
 * Writes the two /observe2 Flows from their generators:
 *   docs/flows/observe2-field-form.json      (the live form, during the lesson)
 *   docs/flows/observe2-evidence-check.json  ("What Rumi heard", after the seal)
 * The contract tests in tests/observe2/ fail if a committed file drifts from its generator,
 * so run this after any change under bot/shared/services/observe/observe2/.
 *
 *   node bot/scripts/generate-observe2-flow-json.js
 */
const fs = require('fs');
const path = require('path');
const { buildFieldFormFlow } = require('../shared/services/observe/observe2/field-form.flow.js');
const { buildEvidenceCheckFlow } = require('../shared/services/observe/observe2/evidence-check.flow.js');

const count = (node) => (Array.isArray(node) ? node.reduce((n, c) => n + count(c), 0)
  : node && typeof node === 'object' ? (node.type ? 1 : 0) + ['children', 'then', 'else'].reduce((n, k) => n + count(node[k]), 0) : 0);
for (const [name, flow] of [['observe2-field-form.json', buildFieldFormFlow()], ['observe2-evidence-check.json', buildEvidenceCheckFlow()]]) {
  const out = path.join(__dirname, '../../docs/flows', name);
  fs.writeFileSync(out, JSON.stringify(flow, null, 2) + '\n');
  console.log(`wrote ${path.relative(process.cwd(), out)}: ${flow.screens.map((s) => `${s.id} ${count(s.layout.children)}`).join(', ')}`);
}
