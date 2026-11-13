#!/usr/bin/env node
'use strict';

/**
 * bd-pni007 — writes the FDE (obs612) coach form Flow from the rubric data:
 *   bot/docs/flows/obs612-flow.json   ONE Flow for FDE's three tools (General, Maths & Science, English & Urdu)
 *
 * The screens are built by bot/shared/services/observe/obs612/flow.js, which the endpoint
 * (bot/shared/routes/obs612-endpoint.js) reads too. Never hand-edit the JSON: change the rubric (its own generator,
 * bot/scripts/build-obs612-rubric.js) or flow.js, and re-run. tests/observe/obs612-flow-contract.test.js fails when
 * the committed JSON drifts from this output.
 *
 *   node bot/scripts/generate-obs612-flow-json.js            write the JSON
 *   node bot/scripts/generate-obs612-flow-json.js --check    exit 1 when the JSON is stale
 *
 * Publish: endpoint_uri <base>/api/flows/obs612, the Flow ID in OBS612_FLOW_ID, on BOTH the staging and the
 * production WABA (whatsapp-flows skill, rule 0).
 */

const fs = require('fs');
const path = require('path');
const { buildFlow } = require('../shared/services/observe/obs612/flow');
const LessonFlow = require('../shared/services/observe/obs612/lesson-flow');

const OUT = path.join(__dirname, '..', 'docs', 'flows', 'obs612-flow.json');
// bd-ra8xu.50: "Plan my visit" class → grade → subject, its own Flow (endpoint /api/flows/obs612-lesson).
const LESSON_OUT = path.join(__dirname, '..', 'docs', 'flows', 'obs612-lesson-flow.json');

function render() {
  return `${JSON.stringify(buildFlow(), null, 2)}\n`;
}
function renderLesson() {
  return `${JSON.stringify(LessonFlow.buildFlow(), null, 2)}\n`;
}

if (require.main === module) {
  const out = render();
  if (process.argv.includes('--check')) {
    const now = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    const lessonNow = fs.existsSync(LESSON_OUT) ? fs.readFileSync(LESSON_OUT, 'utf8') : '';
    if (now !== out || lessonNow !== renderLesson()) {
      console.error('obs612-flow.json or obs612-lesson-flow.json is stale: run node bot/scripts/generate-obs612-flow-json.js');
      process.exit(1);
    }
    console.log('obs612-flow.json and obs612-lesson-flow.json are current');
  } else {
    fs.writeFileSync(OUT, out);
    fs.writeFileSync(LESSON_OUT, renderLesson());
    const flow = JSON.parse(out);
    const count = (node) => (Array.isArray(node) ? node.reduce((n, c) => n + count(c), 0)
      : node && typeof node === 'object' ? (node.type ? 1 : 0) + ['children', 'then', 'else'].reduce((n, k) => n + count(node[k]), 0) : 0);
    console.log(`wrote ${path.relative(process.cwd(), OUT)}: ${flow.screens.map((s) => `${s.id} ${count(s.layout.children)}`).join(', ')}`);
  }
}

module.exports = { render, renderLesson, OUT, LESSON_OUT };
