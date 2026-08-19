/**
 * bd-gipr1 — the report language must never be decided by an STT label that
 * this deployment does not even offer.
 *
 * `generateHeroReport` resolved:
 *   lang = language || analysis.language || session.transcript_language || 'en'
 *
 * `session.transcript_language` is whatever Soniox returned. On prod it has been
 * 'hindi', 'javanese' and 'sindhi' (bd-bfy69) — none of which NIETE offers. That
 * value then chose the template's script branch AND the language the narrative
 * LLM was told to write in, so one bad label mis-rendered the report and
 * mis-wrote its prose.
 *
 * language-protocol invariant 7: never let a language outside the offer take
 * effect. `isOffered()` is the gate; `offerDefaultLanguage()` ('ur' here,
 * deliberately NOT the emergency English floor) is where an unofferable label
 * lands, because NIETE is a single Urdu-medium tenant.
 */

const { resolveReportLanguage } = require('../../bot/shared/services/coaching/report-v2/report-language');

const sess = (transcript_language) => ({ transcript_language });

describe('bd-gipr1 — report language is constrained to the offer', () => {
  it('honours an explicit caller language above everything else', () => {
    expect(resolveReportLanguage({ language: 'en' }, { language: 'ur' }, sess('ur'))).toBe('en');
  });

  it('falls through caller → analysis → transcript, while each is offered', () => {
    expect(resolveReportLanguage({}, { language: 'ur' }, sess('en'))).toBe('ur');
    expect(resolveReportLanguage({}, {}, sess('en'))).toBe('en');
    expect(resolveReportLanguage({}, {}, sess('ur'))).toBe('ur');
  });

  it.each(['hindi', 'javanese', 'sindhi', 'HINDI', 'pa', 'sw', ''])(
    'refuses the unofferable STT label %p and lands on the offer default',
    (label) => {
      expect(resolveReportLanguage({}, {}, sess(label))).toBe('ur');
    },
  );

  it('skips an unofferable label to reach a LATER offered candidate', () => {
    // analysis.language is junk, but the transcript label is a real offer member.
    expect(resolveReportLanguage({}, { language: 'javanese' }, sess('en'))).toBe('en');
  });

  it('never returns a value outside the offer, for any input', () => {
    const { LANGUAGE_OFFER } = require('../../bot/shared/config/languages');
    const junk = [undefined, null, 0, {}, [], 'hindi', 'xx-YY', 'en-US', 'urdu'];
    for (const a of junk) {
      for (const b of junk) {
        expect(LANGUAGE_OFFER).toContain(resolveReportLanguage({ language: a }, { language: b }, sess(a)));
      }
    }
  });

  it('tolerates a missing session/analysis without throwing', () => {
    expect(resolveReportLanguage({}, undefined, undefined)).toBe('ur');
    expect(resolveReportLanguage(undefined, undefined, undefined)).toBe('ur');
  });
});
