/**
 * Calendar go-live blockers, found while switching the feature on (19 Aug).
 *
 * 1. SCOPE. The client asked for `.../auth/calendar.events`. That scope is NOT
 *    in this service account's domain-wide delegation grant — minting a token
 *    fails outright with `unauthorized_client`, so EVERY invite would have
 *    failed silently behind the non-blocking catch. Verified against Google, per
 *    scope, with the real key:
 *        GRANTED  drive · documents · spreadsheets · calendar
 *        DENIED   calendar.events
 *    The broader `calendar` scope is granted and does the same job — proven by
 *    creating, patching and deleting a real event on rumi@hellorumi.ai.
 *    This is a one-line fix, NOT a Workspace Admin request.
 *
 * 2. TELEMETRY (operator request). The service logged only failures, so a
 *    working invite left no trace and "did she get it?" was unanswerable.
 *    Every lifecycle op now emits a success line carrying the schedule id, the
 *    event id and the recipient.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const fs = require('fs');
const path = require('path');
const CLIENT = path.join(__dirname, '../../shared/services/observe/google-calendar.client.js');
const SERVICE = path.join(__dirname, '../../shared/services/observe/observe-calendar.service.js');

describe('calendar · the scope must be one this service account actually holds', () => {
  const src = fs.readFileSync(CLIENT, 'utf8');

  it('asks for the GRANTED calendar scope', () => {
    expect(src).toMatch(/auth\/calendar['"`]/);
  });

  it('does not ask for calendar.events — that grant does not exist here', () => {
    // Check the ASSIGNMENT, not any mention: the comment above it names the
    // denied scope on purpose so nobody "tightens" it back.
    const assigned = src.match(/const SCOPE\s*=\s*'([^']+)'/);
    expect(assigned).toBeTruthy();
    expect(assigned[1]).toBe('https://www.googleapis.com/auth/calendar');
  });

  it('still impersonates a real user — without `sub` the events land nowhere', () => {
    expect(src).toMatch(/sub:\s*subject/);
  });
});

describe('calendar · every lifecycle op leaves a trace when it SUCCEEDS', () => {
  const src = fs.readFileSync(SERVICE, 'utf8');
  const body = (fn) => {
    const i = src.indexOf(`async function ${fn}(`);
    const next = src.indexOf('\nasync function ', i + 10);
    return src.slice(i, next === -1 ? src.length : next);
  };

  it('a created invite is logged — in _create, which both entry points share', () => {
    const i = src.indexOf('async function _create(');
    const b = src.slice(i, src.indexOf('\n}', i));
    expect(b).toMatch(/invite sent/i);
    expect(b).toMatch(/scheduleId/);
    expect(b).toMatch(/eventId/);
    expect(b).toMatch(/email/);
  });

  it.each([
    ['onRescheduled', /invite (moved|updated)/i],
    ['onCancelled', /invite (removed|cancelled)/i],
  ])('%s logs a success line', (fn, pattern) => {
    const b = body(fn);
    expect(b).toMatch(/logToFile\(/);
    expect(b).toMatch(pattern);
  });

  it('onScheduled reaches the logged create path', () => {
    expect(body('onScheduled')).toMatch(/_create\(schedule, email\)/);
  });

  it('the success line carries what an operator needs to answer "did she get it?"', () => {
    for (const fn of ['onRescheduled', 'onCancelled']) {
      const b = body(fn);
      expect(b).toMatch(/scheduleId/);
      expect(b).toMatch(/email|recipient|to\b/);
    }
  });

  it('failures are still logged and still non-blocking', () => {
    for (const fn of ['onScheduled', 'onRescheduled', 'onCancelled']) {
      const b = body(fn);
      expect(b).toMatch(/catch \(err\)/);
      expect(b).toMatch(/non-blocking/);
      expect(b).not.toMatch(/throw /);
    }
  });

  it('a skip is not logged as a success — the gate returns before any log', () => {
    for (const fn of ['onScheduled', 'onRescheduled', 'onCancelled']) {
      const b = body(fn);
      const gate = b.indexOf('if (!email) return');
      const firstSuccessLog = b.search(/logToFile\('observe-calendar: invite/);
      expect(gate).toBeGreaterThan(-1);
      if (firstSuccessLog > -1) expect(gate).toBeLessThan(firstSuccessLog);
    }
  });
});
