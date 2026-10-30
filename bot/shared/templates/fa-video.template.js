'use strict';
/**
 * bd-pw1ccr.8.3 — the 2 Nov formative-assessment video for group B teachers of the topic-nudge A/B
 * (ICT NIETE/ab-test-assessment-paper, Haroon's broadcast idea v20).
 *
 * A template, not free text: the bot speaks first and most teachers are outside the 24h window.
 * MARKETING, not UTILITY: an explainer video is not a transaction the teacher started, and Meta
 * recategorises a mislabelled UTILITY template anyway.
 *
 * ONE definition, read by the registrar (scripts/register-fa-video-template.js) and the sender
 * (scripts/broadcast-fa-video.js), so what Meta approves is what we send.
 * The header is a VIDEO: at send time it takes the id of the mp4 uploaded to /{PHONE_NUMBER_ID}/media.
 * NEVER delete-and-recreate the name — Meta locks a deleted name+language for ~4 weeks. Bump to _v2.
 */

const TEMPLATE = {
  name: 'niete_fa_video_ab_v1',
  language: 'ur',
  category: 'MARKETING',
  body:
    'السلام علیکم!\n\n'
    + 'ہر موضوع کے بعد پانچ منٹ کا ایک چھوٹا سا پرچہ۔ اس دو منٹ کی ویڈیو میں دیکھیں کہ یہ کیوں مفید ہے، '
    + 'اور ایپ میں صرف پڑھائے گئے موضوعات کا پرچہ کیسے بنتا ہے۔\n\n'
    + 'شکریہ، Rumi',
};

/** The send-time components: the header video, by the media id from /{PHONE_NUMBER_ID}/media. */
function sendComponents(mediaId) {
  if (!mediaId) throw new Error('sendComponents needs the uploaded media id');
  return [{ type: 'header', parameters: [{ type: 'video', video: { id: mediaId } }] }];
}

module.exports = { TEMPLATE, sendComponents };
