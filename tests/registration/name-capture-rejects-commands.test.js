/**
 * The text-name registration path must not store a chat message as the teacher's name.
 *
 * Evidence (measured 2026-08-10, tallying 8,911 users shared between the legacy
 * database and this one): 49 names disagree, and 15 of those are the target
 * holding a *message* where the legacy row holds a real name —
 *
 *   'Muhammad Safdar Ameen Khan' -> '/training'
 *   'SHAZMNA SHARIF'             -> '/menu'
 *   'Anum'                       -> '/assessments'
 *   'Hashir'                     -> '/exam'
 *   'Shazia Naseem'              -> 'Ok'
 *   'ABDUL KHALIQ'               -> 'Hi'
 *   'Fatima Rahman'              -> 'What'
 *   'Hareem Abid'                -> 'Can'
 *   'Durat.ul.Ain'               -> 'Ys'
 *
 * All 15 are source='direct' (WhatsApp registration), not migrated rows. The cause
 * is that extractFirstName() strips prefixes and returns the first word with NO
 * rejection step: every non-empty string is accepted as a name, so whatever the
 * teacher happened to send while registration_pending_name was set got written to
 * both `first_name` and `name`.
 *
 * A slash command is the unambiguous case — it can never be a name, and it also
 * means her actual command was swallowed by the name prompt.
 */

// extractFirstName is a pure static, but requiring the service pulls in the bot's
// Supabase/WhatsApp/uuid deps, which the ROOT test run does not install. Mock them
// virtually — the same pattern the repo's other root-level bot tests use.
// dotenv is mocked inline rather than via moduleNameMapper: that mapping exists on
// develop but NOT on main, and this test must pass on either base (it is
// cherry-picked to main directly, since develop carries unreleased work).
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }), { virtual: true });
jest.mock('uuid', () => ({ v4: () => 'test-uuid' }), { virtual: true });
jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: () => ({}) }) }), { virtual: true });
jest.mock('../../bot/shared/config/supabase', () => ({ from: () => ({}) }));
// whatsapp.service / audio.service reach R2 (@aws-sdk) and ffmpeg; extractFirstName
// touches neither, so stub them rather than installing bot deps in the root run.
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn() }));
jest.mock('../../bot/shared/services/audio.service', () => ({}));

const FeatureRegistrationService = require('../../bot/shared/services/feature-registration.service');

describe('extractFirstName rejects non-names', () => {
  describe('slash commands (a command is never a name)', () => {
    it.each(['/menu', '/training', '/assessments', '/exam', '/language', '/help', '/START'])(
      'rejects %s',
      (input) => {
        expect(FeatureRegistrationService.extractFirstName(input)).toBeNull();
      },
    );
  });

  describe('conversational filler observed in production', () => {
    it.each([
      'Ok', 'ok', 'OK', 'Okay', 'Hi', 'hi', 'Hello', 'Hey',
      'What', 'Can', 'Ys', 'Yes', 'No', 'Menu', 'Sorry', 'Whatever',
      'Give', 'Make', "Don't", 'Thanks', 'Thank you', 'Test', 'Salam', 'Assalam o alaikum',
    ])('rejects %s', (input) => {
      expect(FeatureRegistrationService.extractFirstName(input)).toBeNull();
    });
  });

  describe('structurally impossible names', () => {
    it.each(['', '   ', '123', '4567', '?', '!!!', '...', '-', '@#$'])(
      'rejects %s',
      (input) => {
        expect(FeatureRegistrationService.extractFirstName(input)).toBeNull();
      },
    );

    it('rejects a single character', () => {
      expect(FeatureRegistrationService.extractFirstName('A')).toBeNull();
    });

    it('rejects a URL', () => {
      expect(FeatureRegistrationService.extractFirstName('https://example.com')).toBeNull();
    });
  });

  describe('real names still work — this must not get stricter than reality', () => {
    it.each([
      ['Asima Irfan', 'Asima'],
      ['Hareem Abid', 'Hareem'],
      ['Muhammad Safdar Ameen Khan', 'Muhammad'],
      ['SHAZMNA SHARIF', 'Shazmna'],
      ['ramisha', 'Ramisha'],
      ['Anum', 'Anum'],
      ['Hashir', 'Hashir'],
      ['Ali', 'Ali'],
    ])('accepts %s -> %s', (input, expected) => {
      expect(FeatureRegistrationService.extractFirstName(input)).toBe(expected);
    });

    it('still strips the "my name is" style prefixes', () => {
      expect(FeatureRegistrationService.extractFirstName('My name is Hareem Abid')).toBe('Hareem');
      expect(FeatureRegistrationService.extractFirstName('mera naam Fatima hai')).toBe('Fatima');
      expect(FeatureRegistrationService.extractFirstName("I'm Sana")).toBe('Sana');
    });

    it('accepts a non-Latin name (Urdu/Arabic script)', () => {
      // 'عائشہ' (Ayesha) — must not be rejected for having no A-Z characters.
      expect(FeatureRegistrationService.extractFirstName('عائشہ')).toBe('عائشہ');
    });

    it('accepts a name that merely CONTAINS a filler word', () => {
      // 'Oktai', 'Noor', 'Yasmeen' start with rejected substrings; only whole-token
      // matches may be rejected.
      expect(FeatureRegistrationService.extractFirstName('Noor Fatima')).toBe('Noor');
      expect(FeatureRegistrationService.extractFirstName('Yasmeen')).toBe('Yasmeen');
      expect(FeatureRegistrationService.extractFirstName('Oktai')).toBe('Oktai');
    });

    it('accepts a hyphenated or apostrophed name', () => {
      expect(FeatureRegistrationService.extractFirstName("Zain-ul-Abideen")).toBe('Zain-ul-abideen');
    });
  });
});
