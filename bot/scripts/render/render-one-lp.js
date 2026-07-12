// Render ONE lesson plan from curriculum_lp_ast into a PDF using Nano Banana Pro
// for the hero + section illustrations.
//
// This is Path A of the "JSON pre-render → PDF" plan: a simple faithful renderer
// that maps our step-array schema (opening/explain/practice/independent_practice/
// conclusion) to a simplified v7-style layout. Cheap, quick, viewable — not a
// full v7 rubric-quality render (that needs an LLM enrichment step first).
//
// Usage:
//   node render-one-lp.js                        # renders default target
//   node render-one-lp.js --uuid=<source_lp_uuid>
//   node render-one-lp.js --dry-run              # skip NB Pro calls; use placeholders

const fs = require('fs');
const path = require('path');
const https = require('https');
const PDFDocument = require('pdfkit');
const { createClient } = require('@supabase/supabase-js');

// ---- env ----
function loadEnv(p) {
  const txt = fs.readFileSync(p, 'utf8');
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
loadEnv(process.env.NIETE_ENV_PATH || path.resolve(__dirname, '..', '..', '..', '.env'));

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const DRY_RUN = !!args['dry-run'];
// Default target: NBF Grade One Islamiyat Ch1 (Urdu → NB Pro path)
const TARGET_SELECTOR = args.uuid
  ? { source_lp_uuid: args.uuid }
  : { publisher: 'NBF', grade: 1, subject: 'islamiyat', chapter_number: 1 };
const OUT_PDF = args.out || `/tmp/rendered-lp-${Date.now()}.pdf`;

// ---- Kie.ai NB Pro caller (inlined so we don't need bot/shared/services deps) ----
const KIE_API_KEY = process.env.KIE_API_KEY;
const KIE_HOST = 'api.kie.ai';

function kieRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: KIE_HOST, port: 443, method, path: apiPath,
      headers: { 'Authorization': `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error(`Bad JSON: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function nbProGenerate({ prompt, label }) {
  console.log(`  [NB Pro] createTask: ${label}`);
  const create = await kieRequest('POST', '/api/v1/jobs/createTask', {
    model: 'nano-banana-pro',
    input: {
      prompt,
      aspect_ratio: '3:4',   // A4-portrait for LP page shape
      output_format: 'png',
    },
  });
  const taskId = create?.data?.taskId;
  if (!taskId) throw new Error(`createTask no taskId: ${JSON.stringify(create).slice(0, 200)}`);

  // Poll
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise(r => setTimeout(r, 8000));
    const info = await kieRequest('GET', `/api/v1/jobs/recordInfo?taskId=${taskId}`, null);
    const state = info?.data?.state;
    const resultJson = info?.data?.resultJson;
    if (state === 'success') {
      const parsed = typeof resultJson === 'string' ? JSON.parse(resultJson) : resultJson;
      const url = parsed?.resultUrls?.[0];
      if (!url) throw new Error(`success but no resultUrls: ${JSON.stringify(info).slice(0, 300)}`);
      console.log(`  [NB Pro] done: ${label} → ${url.slice(0, 60)}...`);
      return url;
    }
    if (state === 'fail') throw new Error(`NB Pro job failed: ${JSON.stringify(info).slice(0, 300)}`);
    if (attempt % 3 === 0) console.log(`  [NB Pro] polling ${label} attempt ${attempt + 1}/60 state=${state}`);
  }
  throw new Error('NB Pro poll timeout after 60 attempts (8 min)');
}

async function downloadImage(url, destPath) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`Download ${url} status ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { fs.writeFileSync(destPath, Buffer.concat(chunks)); resolve(destPath); });
    }).on('error', reject);
  });
}

// ---- LP fetch ----
async function fetchLp() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  let q = sb.from('curriculum_lp_ast').select('*');
  for (const [k, v] of Object.entries(TARGET_SELECTOR)) q = q.eq(k, v);
  const { data, error } = await q.limit(1);
  if (error) throw new Error(`Supabase: ${error.message}`);
  if (!data || data.length === 0) throw new Error(`No LP matches ${JSON.stringify(TARGET_SELECTOR)}`);
  return data[0];
}

// ---- Prompt builders ----
function heroPrompt(lp) {
  const isUrdu = ['urdu', 'islamiyat'].includes(lp.subject);
  const langNote = isUrdu
    ? 'ALL Urdu text MUST use Noto Nastaliq Urdu font (Nastaleeq script). RTL direction. English terms appear in brackets within Urdu text.'
    : 'ALL text in clean Title Case English, no lowercase; use Poppins or Inter sans-serif.';

  return `Textbook-style illustrated cover for a Pakistani primary-school lesson plan.

Grade: ${lp.grade_label}
Subject: ${lp.subject_label}
Chapter: "${lp.chapter_title}"
Topic: "${lp.topic}"

Layout: portrait A4. Top 40% is a clean illustration relevant to the topic — flat vector style, warm Pakistani cultural context (bazaar, cricket, mosque, home, classroom as appropriate). Middle third is a HEADING block that displays:
  Line 1: "${lp.chapter_title}" — 42pt, bold
  Line 2: "${lp.topic}" — 26pt, regular
Bottom third: 4 empty rectangles labelled "Grade" "Subject" "Duration" "Publisher" (rendered as small badges).

Style: friendly, textbook-quality, high-contrast on white background. Muted primary colors (navy #001F3F for headings, warm orange #E86835 accent, mustard #F5B942 highlight). No people faces required in illustration. No handwritten fonts. No watermark.

${langNote}

--no extra digits, mislabeled numbers, duplicated objects, mixed shapes, blurry text, handwritten numbers, grid pattern, watermark, lorem ipsum, fake brand logos, cartoon smileys, corporate stock imagery`;
}

function stepIllustrationPrompt(lp, sectionName, sampleStatements) {
  const joined = sampleStatements.slice(0, 3).join(' / ');
  const isUrdu = ['urdu', 'islamiyat'].includes(lp.subject);
  const langNote = isUrdu
    ? 'ALL Urdu labels MUST use Noto Nastaliq Urdu font. RTL. English terms in brackets.'
    : 'All labels in Title Case sans-serif.';

  return `Textbook illustration for the "${sectionName}" section of a Grade ${lp.grade} ${lp.subject_label} lesson.

Lesson topic: "${lp.topic}"
Section context: ${sampleStatements.length} steps in this section — sample: "${joined.slice(0, 200)}"

Layout: single portrait illustration, 3:4 aspect. A classroom or contextual scene relevant to the topic. Include ONE small "big idea" callout box at bottom-right with 8-12 words summarizing the section's purpose.

Style: flat vector, textbook-friendly, muted primaries (navy, orange, mustard). Pakistani-context characters if any people appear. No brand logos. No copyrighted characters. High-contrast readable text if labels are used.

${langNote}

--no extra digits, mislabeled numbers, duplicated objects, mixed shapes, blurry text, handwritten numbers, grid pattern, watermark, lorem ipsum, fake brand logos, cartoon smileys`;
}

// ---- PDF assembly ----
function totalMinutes(lp) {
  return (lp.opening_time || 0) + (lp.explain_time || 0) + (lp.practice_time || 0)
       + (lp.independent_practice_time || 0) + (lp.conclusion_time || 0);
}

function statementsOf(steps) {
  return (Array.isArray(steps) ? steps : []).map(s => (s && s.statement) ? String(s.statement) : '').filter(Boolean);
}

async function buildPdf(lp, imagePaths) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const stream = fs.createWriteStream(OUT_PDF);
  doc.pipe(stream);

  const NAVY = '#001F3F', ORANGE = '#E86835', MUTED = '#6B7280';

  // ===== Page 1: Title + Hero image =====
  doc.rect(0, 0, doc.page.width, 90).fill(NAVY);
  doc.fillColor('white').fontSize(20).text(`${lp.publisher} · ${lp.grade_label} · ${lp.subject_label}`, 40, 30);
  doc.fontSize(11).fillColor('#FFFFFFCC').text(`Chapter ${lp.chapter_number}: ${lp.chapter_title}   |   Total ${totalMinutes(lp)} min`, 40, 60);

  if (imagePaths.hero) {
    try { doc.image(imagePaths.hero, 40, 110, { width: doc.page.width - 80, fit: [doc.page.width - 80, 400] }); }
    catch (e) { console.warn('  hero image embed failed:', e.message); }
  }

  const titleY = imagePaths.hero ? 540 : 130;
  doc.fillColor(NAVY).fontSize(28).text(lp.topic, 40, titleY, { align: 'center', width: doc.page.width - 80 });
  doc.moveDown(0.5);
  doc.fillColor(MUTED).fontSize(12).text(`LP UUID ${lp.source_lp_uuid}`, { align: 'center' });

  // ===== Pages 2+: sections =====
  const SECTIONS = [
    { key: 'opening_steps',              title: '1. Warm-up (Opening)',           minute: lp.opening_time,               illustrationKey: 'opening' },
    { key: 'explain_steps',              title: '2. Explain — I Do',              minute: lp.explain_time,               illustrationKey: null },
    { key: 'practice_steps',             title: '3. Guided Practice — We Do',     minute: lp.practice_time,              illustrationKey: 'practice' },
    { key: 'independent_practice_steps', title: '4. Independent Practice — You Do', minute: lp.independent_practice_time, illustrationKey: null },
    { key: 'conclusion_steps',           title: '5. Before You Go (Conclusion)',   minute: lp.conclusion_time,            illustrationKey: null },
  ];

  for (const sec of SECTIONS) {
    const steps = Array.isArray(lp[sec.key]) ? lp[sec.key] : [];
    if (steps.length === 0) continue;

    doc.addPage();

    // Section header
    doc.rect(0, 0, doc.page.width, 60).fill(ORANGE);
    doc.fillColor('white').fontSize(18).text(sec.title, 40, 22);
    doc.fontSize(10).fillColor('#FFFFFFCC').text(`${sec.minute || '—'} min  ·  ${steps.length} steps`, 40, 44);

    // Optional illustration in the middle of the page
    let y = 90;
    if (sec.illustrationKey && imagePaths[sec.illustrationKey]) {
      try {
        doc.image(imagePaths[sec.illustrationKey], 40, y, { width: 220, fit: [220, 220] });
        y = 90;
        // Text on the right side of the image
        const textX = 280, textWidth = doc.page.width - 320;
        y = renderSteps(doc, steps, textX, y, textWidth, NAVY, MUTED);
      } catch (e) {
        console.warn(`  ${sec.illustrationKey} image failed, falling back to text-only:`, e.message);
        y = renderSteps(doc, steps, 40, y, doc.page.width - 80, NAVY, MUTED);
      }
    } else {
      y = renderSteps(doc, steps, 40, y, doc.page.width - 80, NAVY, MUTED);
    }
  }

  // ===== Footer page: metadata =====
  doc.addPage();
  doc.rect(0, 0, doc.page.width, 60).fill(NAVY);
  doc.fillColor('white').fontSize(16).text('Lesson Plan Reference', 40, 24);

  doc.fillColor(NAVY).fontSize(12).text('Source', 40, 100, { underline: true });
  const rows = [
    ['Publisher', lp.publisher],
    ['Curriculum', lp.curriculum_key],
    ['Grade', `${lp.grade_label} (grade=${lp.grade})`],
    ['Subject', `${lp.subject_label} (slug=${lp.subject})`],
    ['Chapter', `${lp.chapter_number}: ${lp.chapter_title}`],
    ['Topic', lp.topic],
    ['LP UUID', lp.source_lp_uuid],
    ['Type', `${lp.lp_type} · ${lp.lp_source} · ${lp.lp_category}`],
    ['Videos', String(lp.videos.length)],
    ['SLO codes', String(lp.lp_slo.length)],
    ['Imported', new Date(lp.imported_at).toISOString()],
  ];
  doc.fillColor(MUTED).fontSize(10);
  let yy = 120;
  for (const [k, v] of rows) {
    doc.text(`${k}:`, 40, yy, { continued: true, width: 130 });
    doc.text(String(v), { width: doc.page.width - 200 });
    yy += 18;
  }

  doc.end();
  await new Promise(r => stream.on('finish', r));
  return OUT_PDF;
}

function renderSteps(doc, steps, x, y, width, colorMain, colorMuted) {
  const pageBottom = doc.page.height - 60;
  for (const step of steps) {
    if (y > pageBottom - 40) { doc.addPage(); y = 60; }
    const type = step.type || 'Step';
    const idx = step.index != null ? `${step.index}. ` : '';
    doc.fillColor(colorMain).fontSize(9).text(`[${type.toUpperCase()}]`, x, y);
    doc.fillColor('#111827').fontSize(11).text(`${idx}${step.statement || ''}`, x + 60, y, {
      width: width - 60,
    });
    y = doc.y + 6;
  }
  return y;
}

// ---- main ----
async function main() {
  console.log(`Fetching LP with selector: ${JSON.stringify(TARGET_SELECTOR)}`);
  const lp = await fetchLp();
  console.log(`Found: ${lp.publisher} ${lp.grade_label} ${lp.subject_label} Ch${lp.chapter_number} "${lp.topic}"`);
  console.log(`Steps: opening=${(lp.opening_steps||[]).length}, explain=${(lp.explain_steps||[]).length}, practice=${(lp.practice_steps||[]).length}, indep=${(lp.independent_practice_steps||[]).length}, conclusion=${(lp.conclusion_steps||[]).length}`);
  console.log();

  const imagePaths = {};
  if (!DRY_RUN) {
    console.log('=== NB Pro: hero image ===');
    const heroUrl = await nbProGenerate({ prompt: heroPrompt(lp), label: 'hero' });
    imagePaths.hero = `/tmp/lp-hero-${Date.now()}.png`;
    await downloadImage(heroUrl, imagePaths.hero);
    console.log(`  saved: ${imagePaths.hero}`);

    console.log('\n=== NB Pro: opening illustration ===');
    const openingUrl = await nbProGenerate({
      prompt: stepIllustrationPrompt(lp, 'Warm-up (Opening)', statementsOf(lp.opening_steps)),
      label: 'opening',
    });
    imagePaths.opening = `/tmp/lp-opening-${Date.now()}.png`;
    await downloadImage(openingUrl, imagePaths.opening);
    console.log(`  saved: ${imagePaths.opening}`);

    console.log('\n=== NB Pro: practice illustration ===');
    const practiceUrl = await nbProGenerate({
      prompt: stepIllustrationPrompt(lp, 'Guided Practice — We Do', statementsOf(lp.practice_steps)),
      label: 'practice',
    });
    imagePaths.practice = `/tmp/lp-practice-${Date.now()}.png`;
    await downloadImage(practiceUrl, imagePaths.practice);
    console.log(`  saved: ${imagePaths.practice}`);
  } else {
    console.log('DRY-RUN: skipping NB Pro calls; PDF will render text-only');
  }

  console.log('\n=== Assembling PDF ===');
  const out = await buildPdf(lp, imagePaths);
  console.log(`Wrote: ${out}`);
  const stat = fs.statSync(out);
  console.log(`Size: ${(stat.size / 1024).toFixed(1)} KB`);
}

main().catch(e => { console.error('FATAL:', e.message); console.error(e.stack); process.exit(2); });
