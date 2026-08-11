/**
 * bd-2486 — isVideoCommand (the /video command matcher, extended to a bare
 * "video" keyword)
 *
 * Regression for a real bug: a teacher/child typing plain "video" (no slash)
 * used to fall all the way through handleTextMessage to intent detection,
 * which routed intent.type==='video' to the legacy AI VideoOrchestrator with
 * the literal word "Video" as a nonsense topic — confirmed via a live Axiom
 * trace (2026-08-04, operator test send). "/video" must keep working exactly
 * as before; only the bare keyword is new.
 */

// Don't load the heavy handler module — just the named export under test.
const { isVideoCommand } = require('../../shared/handlers/text-message.handler');

describe('isVideoCommand (bd-2486)', () => {
  describe('matches', () => {
    test.each([
      ['slash command', '/video'],
      ['slash command with topic (topic ignored downstream)', '/video gravity'],
      ['bare keyword', 'video'],
      ['bare keyword, different case', 'Video'],
      ['bare keyword, all caps', 'VIDEO'],
      ['bare keyword, padded whitespace', '  video  '],
    ])('%s → true', (_label, msg) => {
      expect(isVideoCommand(msg)).toBe(true);
    });
  });

  describe('non-matches (must still fall through to AI video generation / normal chat)', () => {
    test.each([
      ['a real sentence mentioning video', 'make me a video on photosynthesis'],
      ['video as part of another word', 'videos please'],
      ['unrelated text', 'hello'],
      ['empty string', ''],
      ['null', null],
      ['undefined', undefined],
    ])('%s → false', (_label, msg) => {
      expect(isVideoCommand(msg)).toBe(false);
    });
  });
});
