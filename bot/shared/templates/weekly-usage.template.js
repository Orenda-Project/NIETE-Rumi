'use strict';
/**
 * bd-v0toag.32 — the UTILITY templates of the v10 weekly usage report (group B, weekly_usage_*).
 *
 * A template, not free text: most teachers have not messaged the bot in the last 24h on a Saturday, and
 * outside that window Meta only delivers an approved template. There is NO free-form fallback — if a
 * template is not approved the report is skipped (weekly-report/job.js).
 *
 * ONE definition, read by the sender and by whoever submits the templates to Meta, so the approved body
 * and the parameters we fill cannot drift. Draft and submission notes:
 *   ICT NIETE/ab-test-v10-coaching/versions/v22_weekly_usage_report/TEMPLATE.md
 *
 * weekly_usage_v1 parameters, in order:
 *   {{1}} first name · {{2}} the week (12–16 Oct) · {{3}} lesson plans opened · {{4}} days used
 *   {{5}} recordings sent · {{6}} reports agreed with (a phrase)
 *   (no thing-to-try line: Amena, 16 Oct — group B's report does not carry it)
 * weekly_usage_quiet_v1 (a week with nothing to count — said kindly, no numbers):
 *   {{1}} first name · {{2}} the week
 *
 * Keys are META language codes (`en_US`, not `en` — config/languages.templateCodeFor).
 * NEVER delete-and-recreate a name — Meta locks a deleted name+language for ~4 weeks. Bump to _v2.
 */

const TEMPLATE = {
  name: 'weekly_usage_v1',
  bodies: {
    en_US:
      'Assalam o Alaikum {{1}}!\n\nHere is your week with Rumi ({{2}}):\n\n'
      + 'Lesson plans opened: {{3}}\nDays you used Rumi: {{4}}\nClass recordings sent: {{5}}\n'
      + 'Reports you agreed with: {{6}}\n\n'
      + 'Thank you for your teaching this week. Reply here any time for a lesson plan or to send a class recording.',
    ur:
      'السلام علیکم {{1}}!\n\nRumi کے ساتھ آپ کا ہفتہ ({{2}}):\n\n'
      + 'کھولے گئے سبق کے منصوبے: {{3}}\nجن دنوں آپ نے Rumi استعمال کیا: {{4}}\nبھیجی گئی کلاس ریکارڈنگز: {{5}}\n'
      + 'جن رپورٹس سے آپ متفق تھے: {{6}}\n\n'
      + 'اس ہفتے کی تدریس کا شکریہ۔ سبق کا منصوبہ لینے یا کلاس ریکارڈنگ بھیجنے کے لیے کسی بھی وقت یہاں جواب دیں۔',
  },
  examples: {
    en_US: ['Ayesha', '12–16 Oct', '4', '3', '2', '2 of 3'],
    ur: ['عائشہ', '12 تا 16 اکتوبر', '4', '3', '2', '3 میں سے 2'],
  },
};

const QUIET_TEMPLATE = {
  name: 'weekly_usage_quiet_v1',
  bodies: {
    en_US:
      'Assalam o Alaikum {{1}}!\n\nThis is your weekly Rumi update for {{2}}. We did not receive a lesson plan '
      + 'request or a class recording from you this week, and that is completely fine.\n\n'
      + 'Whenever you are ready, Rumi can send you a lesson plan or listen to a class recording and share '
      + 'feedback. Just reply here.',
    ur:
      'السلام علیکم {{1}}!\n\nیہ {{2}} کے لیے آپ کی ہفتہ وار Rumi اپڈیٹ ہے۔ اس ہفتے ہمیں آپ کی طرف سے سبق کے '
      + 'منصوبے کی درخواست یا کلاس ریکارڈنگ نہیں ملی، اور یہ بالکل ٹھیک ہے۔\n\n'
      + 'جب بھی آپ تیار ہوں، Rumi آپ کو سبق کا منصوبہ بھیج سکتا ہے یا کلاس ریکارڈنگ سن کر رائے دے سکتا ہے۔ '
      + 'بس یہاں جواب دیں۔',
  },
  examples: {
    en_US: ['Ayesha', '12–16 Oct'],
    ur: ['عائشہ', '12 تا 16 اکتوبر'],
  },
};

const NAMES = [TEMPLATE.name, QUIET_TEMPLATE.name];

module.exports = { TEMPLATE, QUIET_TEMPLATE, NAMES };
