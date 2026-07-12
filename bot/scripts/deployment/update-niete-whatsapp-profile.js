// Update NIETE-Rumi WhatsApp Business profile picture + About text.
//
// Forked from update-whatsapp-profile.js. Two deltas from the parent:
//   1. Content-Type = image/png (parent hardcoded jpeg; our NIETE logo is PNG)
//   2. Profile copy = NIETE-branded per infrastructure/branding/BRANDING.md
//      (parent uses "Rumi - Your AI teaching companion for Pakistan" which is
//      wrong for the NIETE WABA)
//
// This script updates ONLY:
//   - profile_picture (from niete-logo-300.png)
//   - about text (NIETE full name + Islamabad)
//
// It does NOT touch description / vertical / address / email — those fields
// need NIETE stakeholder sign-off on exact wording (see BRANDING.md).

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });
const axios = require('axios');
const fs = require('fs');

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WABA_ID = process.env.WABA_ID;
// Meta App ID for the Mudareb-adopted NIETE WABA (from NIETE-Rumi/CLAUDE.md).
// Resumable Upload endpoint expects the App ID, not the WABA ID.
const META_APP_ID = process.env.META_APP_ID || '2052724122329740';
const API_VERSION = 'v21.0';

// Default: the dark-fill variant. The plain `niete-logo-300.png` has an
// off-white J element that vanishes on WhatsApp's white chrome — see
// infrastructure/branding/BRANDING.md.
const PROFILE_PICTURE_PATH = process.argv[2]
  || path.resolve(__dirname, '..', '..', '..', 'infrastructure', 'branding', 'niete-logo-300-dark-fill.png');

// From BRANDING.md — 65 chars, well within WhatsApp's 139-char About cap.
const NIETE_ABOUT_TEXT = 'National Institute for Excellence in Teacher Education, Islamabad';

async function main() {
  console.log('=== NIETE-Rumi WhatsApp Profile Update ===');
  console.log(`Phone number ID:  ${PHONE_NUMBER_ID}`);
  console.log(`WABA ID:          ${WABA_ID}`);
  console.log(`Picture file:     ${PROFILE_PICTURE_PATH}`);
  console.log(`About text:       "${NIETE_ABOUT_TEXT}" (${NIETE_ABOUT_TEXT.length} chars)`);
  console.log();

  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID || !WABA_ID) {
    throw new Error('Missing WHATSAPP_TOKEN / PHONE_NUMBER_ID / WABA_ID in .env');
  }
  if (!fs.existsSync(PROFILE_PICTURE_PATH)) {
    throw new Error(`Picture file not found: ${PROFILE_PICTURE_PATH}`);
  }

  // 0. Snapshot current profile (for rollback reference)
  console.log('Step 0: Snapshotting current profile...');
  const before = await axios.get(
    `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/whatsapp_business_profile`,
    {
      params: { fields: 'about,profile_picture_url,description,vertical,email,address,websites' },
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    },
  );
  const snapshotPath = '/tmp/niete-waba-before.json';
  fs.writeFileSync(snapshotPath, JSON.stringify(before.data, null, 2));
  console.log(`  Snapshot saved: ${snapshotPath}`);
  console.log(`  Current about:  "${before.data?.data?.[0]?.about || '(not set)'}"`);
  console.log();

  // 1. Create upload session (image/png content-type)
  console.log('Step 1: Creating upload session...');
  const fileSize = fs.statSync(PROFILE_PICTURE_PATH).size;
  console.log(`  File size: ${fileSize} bytes`);
  const sessionResp = await axios.post(
    `https://graph.facebook.com/${API_VERSION}/${META_APP_ID}/uploads?file_length=${fileSize}&file_type=image/png`,
    {},
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } },
  );
  const sessionId = sessionResp.data.id;
  console.log(`  Session ID: ${sessionId}`);
  console.log();

  // 2. Upload the file
  console.log('Step 2: Uploading picture...');
  const imageBuffer = fs.readFileSync(PROFILE_PICTURE_PATH);
  const uploadResp = await axios.post(
    `https://graph.facebook.com/${API_VERSION}/${sessionId}`,
    imageBuffer,
    {
      headers: {
        Authorization: `OAuth ${WHATSAPP_TOKEN}`,
        file_offset: '0',
        'Content-Type': 'image/png',
      },
    },
  );
  const pictureHandle = uploadResp.data.h;
  console.log(`  Handle: ${pictureHandle}`);
  console.log();

  // 3. Update profile — picture + about ONLY
  console.log('Step 3: Updating WhatsApp Business profile (picture + about only)...');
  const updateResp = await axios.post(
    `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/whatsapp_business_profile`,
    {
      messaging_product: 'whatsapp',
      profile_picture_handle: pictureHandle,
      about: NIETE_ABOUT_TEXT,
    },
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } },
  );
  console.log(`  Response: ${JSON.stringify(updateResp.data)}`);
  console.log();

  // 4. Verify
  console.log('Step 4: Verifying...');
  const after = await axios.get(
    `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/whatsapp_business_profile`,
    {
      params: { fields: 'about,profile_picture_url' },
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    },
  );
  const afterProfile = after.data?.data?.[0] || {};
  console.log(`  About after:            "${afterProfile.about}"`);
  console.log(`  Profile picture URL:    ${afterProfile.profile_picture_url || '(missing)'}`);
  console.log();

  const aboutOk = afterProfile.about === NIETE_ABOUT_TEXT;
  const pictureOk = !!afterProfile.profile_picture_url && afterProfile.profile_picture_url !== (before.data?.data?.[0]?.profile_picture_url);
  console.log(`  About matches:          ${aboutOk ? '✓' : '✗'}`);
  console.log(`  Picture URL changed:    ${pictureOk ? '✓' : '✗ (or no prior URL to compare)'}`);
  console.log();
  console.log(aboutOk ? '=== SUCCESS ===' : '=== ABOUT DID NOT UPDATE — CHECK RESPONSE ===');
}

main().catch(e => {
  console.error('FATAL:', e.response?.data || e.message);
  if (e.response?.data) console.error('Full:', JSON.stringify(e.response.data, null, 2));
  process.exit(2);
});
