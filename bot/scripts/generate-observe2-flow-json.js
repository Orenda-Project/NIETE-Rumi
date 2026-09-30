#!/usr/bin/env node
/**
 * Writes docs/flows/observe2-field-form.json from the /observe2 field form generator.
 * The contract test (tests/observe2/field-form-flow-contract.test.js) fails if the two drift,
 * so run this after any change to bot/shared/services/observe/observe2/field-form.flow.js.
 *
 *   node bot/scripts/generate-observe2-flow-json.js
 */
const fs = require('fs');
const path = require('path');
const { buildFieldFormFlow } = require('../shared/services/observe/observe2/field-form.flow.js');

const out = path.join(__dirname, '../../docs/flows/observe2-field-form.json');
const flow = buildFieldFormFlow();
fs.writeFileSync(out, JSON.stringify(flow, null, 2) + '\n');
const count = (node) => (Array.isArray(node) ? node.reduce((n, c) => n + count(c), 0)
  : node && typeof node === 'object' ? (node.type ? 1 : 0) + ['children', 'then', 'else'].reduce((n, k) => n + count(node[k]), 0) : 0);
console.log(`wrote ${path.relative(process.cwd(), out)}: ${flow.screens.map((s) => `${s.id} ${count(s.layout.children)}`).join(', ')}`);
