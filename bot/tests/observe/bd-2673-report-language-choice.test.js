/**
 * bd-2673 / bd-2674 — the coach chooses the report's language (TDD, red-first).
 *
 * Riffat, R35/R36: "the debrief report sent to the teacher is generated in the
 * same language in which Rumi communicates with the coach… For some teachers,
 * understanding feedback in English can be difficult, even when the coach is
 * comfortable in English."
 *
 * She is describing the real fallback chain in resolveTeacherLang(): the
 * teacher's own saved preference, ELSE THE COACH'S LANGUAGE, else the market
 * default. A teacher who never set a preference — which is every teacher the
 * coach names by hand — inherits the coach's language.
 *
 * Fix: a third button on the send-confirm step that already exists, flipping
 * the report between the market's two languages. The coach's explicit pick wins
 * for THIS report only and never rewrites the teacher's stored preference.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OBSERVE_FRAMEWORK = 'fico';   // NIETE market: ur/en

const {
  resolveTeacherLang, buildSendConfirmButtons, parseSendButtonId, otherLang,
} = require('../../shared/services/observe/observe-send.service');

const S = {
  send_confirm_body: 'Send this report?',
  btn_send_now: 'Send now',
  btn_send_cancel: 'Cancel',
  btn_send_in_ur: 'اردو میں بھیجیں',
  btn_send_in_en: 'Send in English',
};

describe('bd-2673 — the coach\'s pick wins for this report', () => {
  it('honours an explicit override above everything else', async () => {
    // Coach speaks English; without an override this teacher would get English.
    const lang = await resolveTeacherLang({ teacher_phone: '923001234567', lang_override: 'ur' }, 'en');
    expect(lang).toBe('ur');
  });

  it('honours an override in the other direction too', async () => {
    const lang = await resolveTeacherLang({ teacher_phone: '923001234567', lang_override: 'en' }, 'ur');
    expect(lang).toBe('en');
  });

  it('ignores an override outside the market\'s languages (no Kiswahili on NIETE)', async () => {
    // Must NOT return 'sw'. With no DB reachable it falls through to the coach's
    // language, which is the documented behaviour — the point is 'sw' never leaks.
    const lang = await resolveTeacherLang({ teacher_phone: '923001234567', lang_override: 'sw' }, 'en');
    expect(lang).not.toBe('sw');
    expect(['ur', 'en']).toContain(lang);
  });

  it('changes nothing when no override is set', async () => {
    const lang = await resolveTeacherLang({ lang_override: null }, 'en');
    expect(lang).toBe('en');
  });
});

describe('bd-2673 — the button', () => {
  it('offers the OTHER language, not the current one', () => {
    expect(otherLang('en')).toBe('ur');
    expect(otherLang('ur')).toBe('en');
  });

  it('adds a language button to the confirm step without losing send or cancel', () => {
    const p = buildSendConfirmButtons('sess-1', S, 'en');
    const ids = p.buttons.map((b) => b.id);
    expect(ids.some((i) => i.startsWith('observe_send_confirm_'))).toBe(true);
    expect(ids.some((i) => i.startsWith('observe_send_cancel_'))).toBe(true);
    expect(ids.some((i) => i.startsWith('observe_send_lang_'))).toBe(true);
  });

  it('never exceeds the WhatsApp limits (3 buttons, 20-char titles)', () => {
    for (const cur of ['en', 'ur']) {
      const p = buildSendConfirmButtons('sess-1', S, cur);
      expect(p.buttons.length).toBeLessThanOrEqual(3);
      for (const b of p.buttons) {
        // Urdu is measured in CODE POINTS, per the language protocol.
        expect([...b.title].length).toBeLessThanOrEqual(20);
        expect(b.title.length).toBeGreaterThan(0);
      }
    }
  });

  it('labels the button with the language it will switch TO', () => {
    expect(buildSendConfirmButtons('s', S, 'en').buttons.find((b) => b.id.startsWith('observe_send_lang_')).title)
      .toBe(S.btn_send_in_ur);
    expect(buildSendConfirmButtons('s', S, 'ur').buttons.find((b) => b.id.startsWith('observe_send_lang_')).title)
      .toBe(S.btn_send_in_en);
  });

  it('routes the new button back to its own session', () => {
    expect(parseSendButtonId('observe_send_lang_abc-123')).toEqual({ action: 'lang', sessionId: 'abc-123' });
  });

  it('does not break the existing send buttons', () => {
    expect(parseSendButtonId('observe_send_confirm_x')).toEqual({ action: 'confirm', sessionId: 'x' });
    expect(parseSendButtonId('observe_send_cancel_x')).toEqual({ action: 'cancel', sessionId: 'x' });
    expect(parseSendButtonId('observe_send_later_x')).toEqual({ action: 'later', sessionId: 'x' });
    expect(parseSendButtonId('observe_send_start_x')).toEqual({ action: 'start', sessionId: 'x' });
  });
});
