'use strict';
/**
 * bd-b3pop.7 — the v2 brief is the Eval 8 holistic2 brief verbatim, and the v2 user message carries the code-measured facts.
 * FIDELITY_BRIEF_V2_MIRROR=<path to eval/out/eval7/brief_holistic2.txt> byte-checks the brief against the gated eval copy.
 */
const fs = require('fs');
const { GRADER_BRIEF_V2, buildUserPromptV2 } = require('../../../bot/shared/services/coaching/fidelity/grader-prompt-v2');
const { pickJudgeFields } = require('../../../bot/shared/services/coaching/fidelity/grader-prompt');

test('the v2 brief carries the reconstruct-first procedure and the v2 output fields', () => {
  for (const marker of ['Step A0 — lesson identity', 'Step A — read the WHOLE transcript', 'Step C — map the stretches',
    'Truncation rule.', 'Compound moves get partial credit.', '"lesson_identity"', '"parts_present"']) {
    expect(GRADER_BRIEF_V2).toContain(marker);
  }
  const mirror = process.env.FIDELITY_BRIEF_V2_MIRROR;
  if (mirror) expect(GRADER_BRIEF_V2).toBe(fs.readFileSync(mirror, 'utf8').replace(/\n$/, ''));
});

test('buildUserPromptV2 = meta, recording facts, plan anchors, the judge fields of every move, then the transcript', () => {
  const moves = [{ move_id: 'm1', phase: 'explain', type: 'x', text: 't', selection: 'none', bucket: 'must_happen' }];
  const u = buildUserPromptV2({ lesson_id: 'L' }, moves, '[00:01] hi', { recording: { stamps: 1 }, anchors: { total: 0, found: [], missing: [] } });
  expect(u).toBe('LESSON META:\n{"lesson_id":"L"}'
    + '\n\nRECORDING FACTS (measured by code — treat as given):\n{"stamps":1}'
    + "\n\nPLAN ANCHORS (code-counted occurrences of the plan's illustrative content in the transcript):\n{\"total\":0,\"found\":[],\"missing\":[]}"
    + '\n\nPRESCRIBED MOVES (judge each one, return JSON):\n' + JSON.stringify(pickJudgeFields(moves), null, 1)
    + '\n\nTRANSCRIPT (teacher teaching this lesson):\n[00:01] hi');
  expect(u).not.toContain('bucket');
});
