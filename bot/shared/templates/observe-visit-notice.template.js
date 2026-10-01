'use strict';
/**
 * bd-xorfy — the three UTILITY templates that tell a teacher about her own
 * observation visit: booked, moved, cancelled.
 *
 * Templates, not free text: a teacher has usually not messaged the bot in the
 * last 24h, and outside that window Meta only delivers an approved template.
 *
 * ONE definition, read by both the sender (observe-teacher-notice.service) and
 * the registrar (scripts/register-observe-visit-templates.js), so the body Meta
 * approved and the parameters we fill cannot drift apart.
 *
 * Parameters, always in this order:
 *   {{1}} teacher name · {{2}} coach name · {{3}} school · {{4}} date · {{5}} time
 *
 * Keys are META template language codes (`en_US`, not `en` — see
 * config/languages.templateCodeFor).
 *
 * NEVER delete-and-recreate a name — Meta locks a deleted name+language for
 * ~4 weeks (error 2388023). To change a body, bump the name (_v2).
 */

const TEMPLATES = {
  scheduled: {
    name: 'observation_visit_scheduled',
    bodies: {
      en_US:
        'Assalam o Alaikum {{1}}!\n\n{{2}} has scheduled a classroom observation visit at {{3}}.\n\n' +
        '📅 Date: {{4}}\n⏰ Time: {{5}}\n\nWe are letting you know in advance so you can plan your lesson.',
      ur:
        'السلام علیکم {{1}}!\n\n{{2}} نے {{3}} میں آپ کی کلاس کے مشاہدے کا دورہ طے کیا ہے۔\n\n' +
        '📅 تاریخ: {{4}}\n⏰ وقت: {{5}}\n\nہم آپ کو پہلے سے بتا رہے ہیں تاکہ آپ اپنے سبق کی تیاری کر سکیں۔',
    },
  },
  rescheduled: {
    name: 'observation_visit_rescheduled',
    bodies: {
      en_US:
        'Assalam o Alaikum {{1}}!\n\n{{2}} has changed the date or time of your classroom observation visit at {{3}}.\n\n' +
        '📅 New date: {{4}}\n⏰ New time: {{5}}\n\nPlease use this new time.',
      ur:
        'السلام علیکم {{1}}!\n\n{{2}} نے {{3}} میں آپ کی کلاس کے مشاہدے کے دورے کی تاریخ یا وقت تبدیل کر دیا ہے۔\n\n' +
        '📅 نئی تاریخ: {{4}}\n⏰ نیا وقت: {{5}}\n\nبراہِ کرم یہ نیا وقت یاد رکھیں۔',
    },
  },
  cancelled: {
    name: 'observation_visit_cancelled',
    bodies: {
      en_US:
        'Assalam o Alaikum {{1}}!\n\n{{2}} has cancelled the classroom observation visit at {{3}}.\n\n' +
        '📅 Date: {{4}}\n⏰ Time: {{5}}\n\nYou will get a new message if a visit is scheduled again.',
      ur:
        'السلام علیکم {{1}}!\n\n{{2}} نے {{3}} میں آپ کی کلاس کے مشاہدے کا دورہ منسوخ کر دیا ہے۔\n\n' +
        '📅 تاریخ: {{4}}\n⏰ وقت: {{5}}\n\nنیا دورہ طے ہونے پر آپ کو دوبارہ پیغام ملے گا۔',
    },
  },
};

// Meta needs an example value for every variable when a template is submitted.
const EXAMPLES = {
  en_US: ['Ayesha Khan', 'Sana Iqbal', 'IMSG I-8/1', 'Thursday, 8 October 2026', '9:30 AM'],
  ur: ['عائشہ خان', 'ثنا اقبال', 'IMSG I-8/1', 'جمعرات، 8 اکتوبر 2026', 'صبح 9:30'],
};

module.exports = { TEMPLATES, EXAMPLES };
