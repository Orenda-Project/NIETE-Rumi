#!/usr/bin/env node
'use strict';

/**
 * bd-31ziu8 — writes the FICO-S v1.1 observation form Flow (ICT grades 6-12) from the rubric data:
 *   bot/docs/flows/fico-s-flow.json
 *
 * The screens are built by bot/shared/services/observe/obs612/fico-s-flow.js, which the endpoint
 * (bot/shared/routes/fico-s-endpoint.js) reads too. Never hand-edit the JSON: change the rubric (its own generator,
 * bot/scripts/build-fico-s-rubric.js) or fico-s-flow.js, and re-run. tests/observe/fico-s-flow.test.js fails when the
 * committed JSON drifts from this output.
 *
 *   node bot/scripts/generate-fico-s-flow-json.js            write the JSON
 *   node bot/scripts/generate-fico-s-flow-json.js --check    exit 1 when the JSON is stale
 *
 * Publish: endpoint_uri <base>/api/flows/obs612 (the same endpoint as FDE's form), the Flow ID in FICO_S_FLOW_ID, on
 * every WABA that serves it (whatsapp-flows skill, rule 0). Deploy before publish: Meta probes the endpoint.
 */

const fs = require('fs');
const path = require('path');
const { buildFlow } = require('../shared/services/observe/obs612/fico-s-flow');

const OUT = path.join(__dirname, '..', 'docs', 'flows', 'fico-s-flow.json');

function render() {
  return `${JSON.stringify(buildFlow(), null, 2)}\n`;
}

if (require.main === module) {
  const out = render();
  if (process.argv.includes('--check')) {
    const now = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (now !== out) {
      console.error('fico-s-flow.json is stale: run node bot/scripts/generate-fico-s-flow-json.js');
      process.exit(1);
    }
    console.log('fico-s-flow.json is current');
  } else {
    fs.writeFileSync(OUT, out);
    console.log(`wrote ${path.relative(process.cwd(), OUT)} (${buildFlow().screens.length} screens)`);
  }
}

module.exports = { render, OUT };
