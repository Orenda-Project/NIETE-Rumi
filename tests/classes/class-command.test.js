/**
 * What opens the class manager.
 *
 * Reported from staging: `/classes` worked and `/class` did not. The fix is not
 * just adding one alias — it is deciding the rule, because the interesting half is
 * what must NOT match.
 *
 * Two collisions this has to respect:
 *
 *   1. The attendance router runs LATER in the handler than this check, so
 *      anything matched here shadows attendance. Attendance keys off
 *      `attendance` / `roll call` / `حاضری`, which is why none of those may match.
 *   2. "Classroom Management" is a real training course title. A rule matching the
 *      substring "class" would hijack a teacher asking about it.
 *
 * The rule: slash commands match as a prefix; plain words match only as the WHOLE
 * message. That is what keeps "my class is too noisy" going to the assistant
 * instead of silently opening a form.
 */

const { isClassesCommand } = require('../../bot/shared/services/classes/class-command');

describe('slash forms', () => {
  it.each([
    '/class',
    '/classes',
    '/Class',
    '/CLASSES',
    '  /classes  ',
    '/classes please',
  ])('opens on %s', (input) => {
    expect(isClassesCommand(input)).toBe(true);
  });

  it('does not match a longer word that merely starts with class', () => {
    expect(isClassesCommand('/classroom')).toBe(false);
  });
});

describe('plain-word forms, whole message only', () => {
  it.each([
    'class',
    'classes',
    'Classes',
    'my class',
    'my classes',
    'My Classes',
    'add class',
    'add a class',
    'add new class',
    'add a new class',
    'view class',
    'view classes',
    'show my classes',
    'see my classes',
    'class list',
    'my class list',
    'classes.',
    'my classes!',
  ])('opens on %s', (input) => {
    expect(isClassesCommand(input)).toBe(true);
  });
});

describe('Urdu forms', () => {
  it.each([
    'جماعت',
    'جماعتیں',
    'میری جماعتیں',
    'jamaat',
    'jamat',
  ])('opens on %s', (input) => {
    expect(isClassesCommand(input)).toBe(true);
  });
});

describe('must NOT match', () => {
  it.each([
    // The attendance router owns these, and it runs after this check.
    'attendance',
    '/attendance',
    'mark attendance',
    'roll call',
    'حاضری',
    // A real training course title.
    'classroom management',
    'Classroom Management',
    'tell me about classroom management',
    // Conversation, not a command. Opening a form here would be a hijack.
    'my class is too noisy',
    'how do I manage my class better',
    'what should I teach my class tomorrow',
    'the class did not understand fractions',
    // Junk and empties.
    '',
    '   ',
    'classy',
    'subclass',
    'first class',
  ])('ignores %s', (input) => {
    expect(isClassesCommand(input)).toBe(false);
  });

  it.each([null, undefined, 42, {}, []])('ignores the non-string %s', (input) => {
    expect(isClassesCommand(input)).toBe(false);
  });
});
