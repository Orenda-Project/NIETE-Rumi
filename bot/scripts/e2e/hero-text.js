#!/usr/bin/env node
'use strict';
/**
 * hero-text — the TEXT of a coaching hero report, re-rendered from the session the teacher's image was built from.
 *
 *   node bot/scripts/e2e/hero-text.js <coachingSessionId> [outFile]   → {"ok":true,"caption":"…","text":"…"} (to outFile when given)
 *
 * The FICO report is a PNG (hero-report.service → htmlToImage), so a driver cannot read its words the way it reads
 * a PDF. This runs the SAME renderer on the SAME session and analysis, with the image step replaced by "hand back
 * the HTML", then strips the tags. Mock lane only; refuses the production project.
 */
const path = require('path');
const fs = require('fs');
const root = process.cwd();
const envFile = fs.existsSync(path.join(root, '.env')) ? path.join(root, '.env') : path.join(root, 'bot', '.env');
require(path.join(root, 'bot', 'node_modules', 'dotenv')).config({ path: envFile });
if (String(process.env.SUPABASE_URL || '').includes('ihzciabopbttygxxgrkm')) { console.error('hero-text: refusing the NIETE production project'); process.exit(3); }
const sessionId = process.argv[2];
const outFile = process.argv[3] || null;
const emit = (o) => { const j = JSON.stringify(o); if (outFile) fs.writeFileSync(outFile, j); else console.log(j); };
if (!sessionId) { console.error('usage: hero-text.js <coachingSessionId>'); process.exit(2); }
const h2p = require(path.join(root, 'bot', 'shared', 'utils', 'html-to-pdf'));
h2p.htmlToImage = async (html) => Buffer.from(String(html), 'utf8');   // the renderer gets its HTML back instead of a PNG
(async () => {
  const supabase = require(path.join(root, 'bot', 'shared', 'config', 'supabase'));
  const { data: session, error } = await supabase.from('coaching_sessions').select('*, users!inner(name, phone_number, preferred_language)').eq('id', sessionId).single();
  if (error || !session) { emit({ ok: false, err: 'session not found: ' + (error && error.message) }); process.exit(1); }
  const { generateHeroReport } = require(path.join(root, 'bot', 'shared', 'services', 'coaching', 'report-v2', 'hero-report.service'));
  const analysis = session.analysis_data || {};
  const out = await generateHeroReport(session, analysis, { teacherName: (session.users && session.users.name) || 'Teacher', brand: 'niete' });
  const html = Buffer.isBuffer(out.png) ? out.png.toString('utf8') : String(out.png || '');
  const text = html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  emit({ ok: true, caption: out.caption || '', text, framework: analysis.framework || null });
  process.exit(0);
})().catch((e) => { emit({ ok: false, err: String(e && e.message || e).slice(0, 300) }); process.exit(1); });
