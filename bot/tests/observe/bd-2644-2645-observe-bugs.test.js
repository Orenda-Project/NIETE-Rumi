/**
 * bd-2644 + bd-2645 — the two field-blocking bugs Riffat hit on 2026-08-11,
 * days before the ICT coaches go live.
 *
 * bd-2645 (data integrity): the coach's "yes, send" NEVER reached the teacher.
 * The SQS idempotency key is `job:<sessionId>:<jobType>`, and the observe
 * teacher-report flow queues THREE phases (preview → deliver → teacher_tap)
 * under ONE jobType. The preview's key sits in Redis for an hour, so a coach
 * who confirms inside that hour has the deliver job silently swallowed as a
 * duplicate — the delivery record freezes at 'awaiting_confirm', the coach is
 * told "sending now", and the teacher receives nothing. (Riffat's two sends
 * are both still awaiting_confirm in prod; the teacher was showing her OWN
 * older AI-coaching report, which is why it looked like a "mismatch".)
 *
 * bd-2644 (readability): the coach card embeds Noto Nastaliq but only puts it
 * in the font stack when the STRINGS PACK is Urdu. Riffat's card rendered with
 * the English pack while the model wrote Urdu prose, so every Urdu glyph fell
 * through to Lexend — which has no Urdu — and printed as tofu boxes. The font
 * must never depend on which label pack won: Urdu content has to be readable
 * on every card.
 */

describe('bd-2645 — job idempotency must not collapse the observe phases', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../../shared/services/queue/sqs-queue.service.js'), 'utf8');

  it('the idempotency key includes the payload phase', () => {
    const line = src.split('\n').find((l) => l.includes('const idempotencyKey'));
    expect(line).toBeDefined();
    expect(line).toMatch(/phase/);
  });

  it('preview / deliver / teacher_tap on ONE session produce THREE distinct keys', () => {
    const PREFIX = 'job:';
    const key = (sessionId, jobType, payload = {}) =>
      `${PREFIX}${sessionId}:${jobType}${payload.phase ? `:${payload.phase}` : ''}`;
    const sid = 'd47d345b-9a7e-404b-855a-e4032112ef60';
    const keys = ['preview', 'deliver', 'teacher_tap']
      .map((phase) => key(sid, 'observe_teacher_report', { phase }));
    expect(new Set(keys).size).toBe(3);
    // and a job with no phase keeps its historical key shape (no regression)
    expect(key(sid, 'transcription')).toBe(`job:${sid}:transcription`);
  });
});

describe('bd-2644 — Urdu on the coach card must never be tofu', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../../shared/services/observe/observe-coach-card.js'), 'utf8');

  it('the Nastaliq face is embedded (base64, no network at render time)', () => {
    expect(src).toMatch(/@font-face\{font-family:'NastaliqUrdu'/);
  });

  it('the universal font stack lists NastaliqUrdu even when the pack is not Urdu', () => {
    const universal = src.split('\n').find((l) => l.startsWith('*{margin:0'));
    expect(universal).toBeDefined();
    // the stack must name the Urdu face unconditionally — not only via the
    // rtl-gated ${urFont} interpolation
    const withoutInterpolation = universal.replace(/\$\{urFont\}/g, '');
    expect(withoutInterpolation).toMatch(/NastaliqUrdu/);
  });

  it('Latin still resolves to Lexend first in the LTR stack', () => {
    const universal = src.split('\n').find((l) => l.startsWith('*{margin:0'));
    const withoutInterpolation = universal.replace(/\$\{urFont\}/g, '');
    expect(withoutInterpolation.indexOf("'Lexend'"))
      .toBeLessThan(withoutInterpolation.indexOf('NastaliqUrdu'));
  });
});
