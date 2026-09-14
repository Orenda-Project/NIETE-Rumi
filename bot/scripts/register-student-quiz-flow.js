#!/usr/bin/env node
/**
 * Register the CHILD's /quiz Flow (docs/flows/student-quiz-flow.json) on one WABA.
 *
 * Flows are per-WABA assets: run this once per environment (sandbox, staging,
 * production), then put the printed id in that environment's STUDENT_QUIZ_FLOW_ID.
 * The endpoint must already be live at <FLOW_ENDPOINT_BASE>/api/flows/student-quiz
 * — Meta health-checks it at publish time.
 *
 *   WABA_ID=… WHATSAPP_TOKEN=… FLOW_ENDPOINT_BASE=https://<bot host> \
 *     node bot/scripts/register-student-quiz-flow.js [--name "Student Quiz v1"] [--no-publish]
 *
 * Every underscore-prefixed key except __example__ is stripped before upload
 * (Meta rejects _comment and friends, and a rejected upload leaves the Flow
 * in DRAFT). Uses the same Graph endpoints as register-attendance-flows.js.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const API_VERSION = process.env.WHATSAPP_API_VERSION || 'v21.0';
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;
const WABA_ID = process.env.WABA_ID;
const TOKEN = process.env.WHATSAPP_TOKEN;
const ENDPOINT_BASE = (process.env.FLOW_ENDPOINT_BASE || '').replace(/\/$/, '');

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const NAME = arg('--name', 'Student Quiz v1');
const PUBLISH = !args.includes('--no-publish');

if (!WABA_ID || !TOKEN || !ENDPOINT_BASE) {
  console.error('WABA_ID, WHATSAPP_TOKEN and FLOW_ENDPOINT_BASE are required (env names only — never print values).');
  process.exit(1);
}

function stripDocKeys(node) {
  if (Array.isArray(node)) return node.map(stripDocKeys);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('_') && k !== '__example__') continue;
      out[k] = stripDocKeys(v);
    }
    return out;
  }
  return node;
}

async function api(url, init) {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('Graph error:', JSON.stringify(data).slice(0, 800));
    throw new Error(data.error?.message || `HTTP ${res.status}`);
  }
  return data;
}

async function findFlowByName(name) {
  const data = await api(`${BASE_URL}/${WABA_ID}/flows?fields=id,name,status&limit=200`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  return (data.data || []).find((f) => f.name === name) || null;
}

async function main() {
  const flowJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../docs/flows/student-quiz-flow.json'), 'utf8'));
  const clean = stripDocKeys(flowJson);

  let flow = await findFlowByName(NAME);
  if (flow) {
    console.log(`Flow exists: ${NAME} (${flow.id}, ${flow.status})`);
  } else {
    flow = await api(`${BASE_URL}/${WABA_ID}/flows`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: NAME, categories: ['OTHER'] }),
    });
    console.log(`Flow created: ${flow.id}`);
  }

  const form = new FormData();
  form.append('name', 'flow.json');
  form.append('asset_type', 'FLOW_JSON');
  form.append('file', new Blob([JSON.stringify(clean)], { type: 'application/json' }), 'flow.json');
  const up = await api(`${BASE_URL}/${flow.id}/assets`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: form,
  });
  if (up.validation_errors && up.validation_errors.length) {
    console.error('Validation errors:', JSON.stringify(up.validation_errors, null, 2));
    process.exit(2);
  }
  console.log('Flow JSON uploaded');

  await api(`${BASE_URL}/${flow.id}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint_uri: `${ENDPOINT_BASE}/api/flows/student-quiz` }),
  });
  console.log('Endpoint set');

  if (PUBLISH) {
    await api(`${BASE_URL}/${flow.id}/publish`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` } });
    console.log('Published');
  }
  const status = await api(`${BASE_URL}/${flow.id}?fields=id,name,status,validation_errors`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  console.log(`STUDENT_QUIZ_FLOW_ID=${status.id}  status=${status.status}`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
