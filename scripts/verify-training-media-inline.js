#!/usr/bin/env node
/**
 * bd-2666 / sheet R3 — verify, against LIVE data and the real wire, that
 * training videos now open inline instead of prompting a download.
 *
 * The fixture test (tests/training/legacy-s3-media-rehosted.test.js) locks the
 * delivery RULE. This checks the DATA, which is where the bug actually lived:
 * it walks every active module, resolves the URL the bot would really send
 * (presigning it exactly as content-delivery.service.js does), and fetches the
 * response headers a teacher's browser would receive.
 *
 * Pass condition for a video: Content-Type is a real video type, never
 * `binary/octet-stream`. PDFs are reported but not failed — they ship as
 * WhatsApp document cards, so their header never reaches a browser.
 *
 *   node scripts/verify-training-media-inline.js
 *   node scripts/verify-training-media-inline.js --sample=10
 */

const path = require('path');
const fromBot = (mod) => require(path.join(__dirname, '..', 'bot', 'node_modules', mod));
fromBot('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const https = require('https');
const { createClient } = fromBot('@supabase/supabase-js');
const {
  isPdfModule,
  effectiveMediaUrl,
  isControlledMediaHost,
} = require('../bot/shared/services/training/media-host');
const { getPresignedUrl } = require('../bot/shared/storage/r2');

const SAMPLE = Number((process.argv.find((a) => a.startsWith('--sample=')) || '').split('=')[1]) || 0;

/** Fetch just the headers, following redirects, without pulling the body. */
function headersOf(url, redirectsLeft = 5) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 45000 }, (res) => {
      const { statusCode, headers } = res;
      res.destroy(); // headers are all we need — never download the payload
      if ([301, 302, 303, 307, 308].includes(statusCode) && headers.location && redirectsLeft > 0) {
        return resolve(headersOf(new URL(headers.location, url).toString(), redirectsLeft - 1));
      }
      resolve({ status: statusCode, type: headers['content-type'], disposition: headers['content-disposition'] });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 'TIMEOUT' }); });
    req.on('error', (e) => resolve({ status: 'ERR', type: e.message }));
  });
}

(async () => {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await sb
    .from('training_modules')
    .select('id,title,video_url,source_media_url,is_active')
    .eq('is_active', true)
    .order('id')
    .limit(2000);
  if (error) throw new Error(error.message);

  let videos = data.filter((m) => !isPdfModule(m) && effectiveMediaUrl(m));
  if (SAMPLE) videos = videos.slice(0, SAMPLE);

  console.log(`\nbd-2666 — inline-playback verification`);
  console.log(`  checking ${videos.length} video module(s) on the live wire\n`);

  const bad = [];
  let okCount = 0;

  for (const [i, m] of videos.entries()) {
    const raw = effectiveMediaUrl(m);
    const url = isControlledMediaHost(raw) ? await getPresignedUrl(raw, 600) : raw;
    const h = await headersOf(url);
    const renderable = h.status === 200 && /^video\//i.test(h.type || '');
    const forcesDownload = /attachment/i.test(h.disposition || '');

    if (renderable && !forcesDownload) {
      okCount += 1;
      process.stdout.write(`\r  ✅ ${i + 1}/${videos.length} verified`);
    } else {
      process.stdout.write('\r');
      const why = h.status !== 200 ? `HTTP ${h.status}` : forcesDownload ? 'Content-Disposition: attachment' : `Content-Type: ${h.type}`;
      console.log(`  ❌ module ${m.id} · ${String(m.title).slice(0, 40)} — ${why}`);
      bad.push({ id: m.id, why });
    }
  }

  console.log(`\n\n  inline-playable: ${okCount}/${videos.length}`);
  if (bad.length) {
    console.log(`  still broken:    ${bad.length}`);
    for (const b of bad) console.log(`    module ${b.id}: ${b.why}`);
    process.exitCode = 1;
  } else {
    console.log(`  R3 verified — every training video serves a renderable Content-Type.`);
  }
  console.log('');
})().catch((e) => {
  console.error(`\n❌ ${e.message}\n`);
  process.exit(1);
});
