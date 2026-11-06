'use strict';
/**
 * Round 10 (the reviewers' 6 Nov list), task design 1: the timed one-minute mental maths has no practice section, behind
 * app_settings sa_r10_fluency_no_practice (OFF by default). ON: that part's practice and its practice line are gone, so
 * the child goes from the instruction to Ready (sa-core instructionDone). Every other part keeps its practice. OFF: the
 * battery byte for byte as before.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const { SWITCHES, applySwitches } = require('../routes/sa-battery-switches');

const DIR = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const coachFiles = fs.readdirSync(DIR).filter((n) => /^sa\.coach\..*\.(en|ur)\.json$/.test(n));
const load = (n) => JSON.parse(fs.readFileSync(path.join(DIR, n), 'utf8'));
const fluency = (b) => b.tasks.find((t) => t.subtask === 'mental_math_fluency');
const W3 = { rdfW3Forms: true };

describe('sa_r10_fluency_no_practice (sa-battery-switches.js)', () => {
  test('named', () => {
    expect(SWITCHES.r10FluencyNoPractice).toBe('sa_r10_fluency_no_practice');
  });

  test.each(coachFiles)('%s: ON, the one-minute sums start with no practice; the other parts keep theirs', (name) => {
    const before = applySwitches(load(name), W3);
    const after = applySwitches(load(name), { ...W3, r10FluencyNoPractice: true });
    expect(fluency(before).practice.length).toBeGreaterThan(0);
    expect(fluency(after).practice).toEqual([]);
    expect(fluency(after).script.practice_intro).toBeUndefined();
    // the instruction, the turn line, Ready and the clock stay as they were
    for (const k of ['intro', 'test_intro', 'begin', 'time_up']) expect(fluency(after).script[k]).toEqual(fluency(before).script[k]);
    expect(fluency(after).time_limit_s).toBe(60);
    const others = (b) => b.tasks.filter((t) => t.subtask !== 'mental_math_fluency').map((t) => t.practice);
    expect(others(after)).toEqual(others(before));
  });

  test('OFF: the battery as before', () => {
    const name = coachFiles[0];
    expect(applySwitches(load(name), { ...W3, r10FluencyNoPractice: false })).toEqual(applySwitches(load(name), W3));
  });

  test('the engine goes from the instruction to Ready on that part (no practice phase)', () => {
    const t = fluency(applySwitches(load(coachFiles[0]), { ...W3, r10FluencyNoPractice: true }));
    const src = fs.readFileSync(path.join(__dirname, '..', 'sa', 'sa-core.js'), 'utf8');
    expect(src).toMatch(/st\.phase = task\(\)\.practice\.length \? 'practice' : 'ready';/);
    expect(t.practice.length ? 'practice' : 'ready').toBe('ready');
  });
});

describe('the engine route reads sa_r10_fluency_no_practice', () => {
  async function served(on) {
    const { createSaEngineRouter } = require('../routes/sa-engine.routes');
    const off = () => false;
    const app = express();
    app.use(createSaEngineRouter({ on: () => true, practiceAllMaths: off, passageRotation: off, voiceV2: off,
      rdfW3Forms: () => true, r10FluencyNoPractice: () => on }));
    const srv = app.listen(0);
    try {
      const name = coachFiles.find((n) => n.endsWith('.ur.json'));
      const r = await fetch(`http://127.0.0.1:${srv.address().port}/sa/batteries/${name}`);
      return await r.json();
    } finally { srv.close(); }
  }
  test('ON: the served one-minute sums have no practice', async () => {
    expect(fluency(await served(true)).practice).toEqual([]);
  });
  test('OFF: the served one-minute sums keep their practice', async () => {
    expect(fluency(await served(false)).practice.length).toBeGreaterThan(0);
  });
});
