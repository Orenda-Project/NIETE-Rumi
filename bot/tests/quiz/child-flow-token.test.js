'use strict';

// bd-2475 — encodes/decodes the phone-keyed flow token an anonymous quiz
// child gets, so the shared /video Student Videos Flow can deliver to a
// child with no `users` row, distinctly from a teacher's `<userId>:...` token.
const ChildFlowToken = require('../../shared/services/quiz/child-flow-token');

describe('child-flow-token', () => {
  describe('build + parse round-trip', () => {
    it('round-trips phone, shareCodeId, studentId, language', () => {
      const token = ChildFlowToken.build({
        phone: '+923001234567',
        shareCodeId: 'sc-uuid-1',
        studentId: 'student-uuid-1',
        language: 'ur',
      });
      const parsed = ChildFlowToken.parse(token);
      expect(parsed).toEqual({
        phone: '923001234567', // leading + stripped, matches STATE_KEY convention elsewhere
        shareCodeId: 'sc-uuid-1',
        studentId: 'student-uuid-1',
        language: 'ur',
      });
    });

    it('defaults language to en when omitted', () => {
      const token = ChildFlowToken.build({
        phone: '923001234567', shareCodeId: 'sc-1', studentId: 'st-1',
      });
      expect(ChildFlowToken.parse(token).language).toBe('en');
    });
  });

  describe('parse rejects non-child tokens', () => {
    it('returns null for a teacher token (no childpick: prefix)', () => {
      expect(ChildFlowToken.parse('user-uuid-123:student-videos:1234567890')).toBeNull();
    });

    it('returns null for garbage input', () => {
      expect(ChildFlowToken.parse('')).toBeNull();
      expect(ChildFlowToken.parse(null)).toBeNull();
      expect(ChildFlowToken.parse(undefined)).toBeNull();
    });

    it('returns null when required fields are missing', () => {
      // missing studentId
      expect(ChildFlowToken.parse('childpick:923001234567:sc-1::en:123')).toBeNull();
      // missing shareCodeId
      expect(ChildFlowToken.parse('childpick:923001234567::st-1:en:123')).toBeNull();
    });
  });
});
