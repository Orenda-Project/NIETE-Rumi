/**
 * bd-2414 (FEAT-106 row 16) — the reflection closing VOICE note must be the
 * contextual acknowledgement in the teacher's language, not a generic English
 * "Thank you for your thoughtful reflections".
 *
 * Yesterday's bd-2374 added a contextual acknowledgement but sent it as TEXT and
 * still VOICED the English-only reflectionsThanks. Row 16: the teacher hears an
 * English voice note. Fix: voice the acknowledgement (in her language); fall
 * back to a LOCALIZED thanks (now translated to Urdu) if generation fails.
 */

const fs = require('fs');
const path = require('path');
const { getCoachingMessage } = require('../../bot/shared/config/coaching-messages');

describe('bd-2414 — localized thanks fallback', () => {
  it('reflectionsThanks has a real Urdu translation (not the English fallback)', () => {
    const en = getCoachingMessage('reflectionsThanks', 'en');
    const ur = getCoachingMessage('reflectionsThanks', 'ur');
    expect(ur).not.toBe(en);
    expect(ur).toMatch(/[؀-ۿ]/); // contains Urdu script
  });
});

describe('bd-2414 — completion branch voices the acknowledgement (source guard)', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../bot/shared/services/coaching/reflective-conversation.service.js'),
    'utf8',
  );

  it('derives the spoken closer from the acknowledgement, falling back to a localized thanks', () => {
    // closingText = ackLine || getCoachingMessage('reflectionsThanks', languageCode)
    expect(src).toMatch(/const\s+closingText\s*=/);
    const idx = src.indexOf('closingText');
    const region = src.slice(idx, idx + 200);
    expect(region).toMatch(/ackLine/);
    expect(region).toMatch(/reflectionsThanks/);
  });

  it('voices the closer (the voice gateway speaks the closer, in the teacher language)', () => {
    expect(src).toMatch(/text:\s*spokenForm,\s*language:\s*languageCode,\s*useCase:\s*'coaching',\s*site:\s*'closer'/);
  });

  it('does NOT also send the acknowledgement as a separate text message (no duplication)', () => {
    expect(src).not.toMatch(/sendMessage\(from,\s*ackLine\)/);
  });
});
