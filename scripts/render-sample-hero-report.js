#!/usr/bin/env node
/**
 * Render a hero coaching report from authored sample data — runs the real
 * pipeline (score adapter → narrative LLM → hero template → Playwright PNG)
 * but does NOT touch the database. Used to produce docs/samples/hero-report-*.png
 * and to let an adopter verify the pipeline works on their machine.
 *
 *   node scripts/render-sample-hero-report.js <framework>
 *     framework ∈ { oecd | hots | teach | fico | mewaka }
 *
 * Modes:
 *   default (offline) — stubs the narrative LLM with a canned celebration payload
 *                        so no OPENAI_API_KEY / OPENROUTER_API_KEY is needed.
 *                        Stubs the Supabase trend query to return []. Sharp +
 *                        Playwright still run for real.
 *   --live           — calls the configured narrative LLM (requires
 *                        GPT5MiniService.openai to be configured via
 *                        OPENAI_API_KEY / OPENROUTER_API_KEY). Useful to verify
 *                        the live pipeline + capture realistic narrative text.
 *
 * The sample data is hand-authored — never pulled from a real DB — so no
 * teacher PII is involved.
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const BOT_ROOT = path.join(ROOT, 'bot');

// Minimum env so requires don't throw.
process.env.NODE_ENV ||= 'production';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'placeholder';
process.env.REDIS_URL ||= 'redis://localhost:6379';
process.env.OPENROUTER_API_KEY ||= 'placeholder';
process.env.OPENAI_API_KEY ||= 'placeholder';

const args = process.argv.slice(2);
const live = args.includes('--live');
const fw = args.find((a) => !a.startsWith('-')) || 'oecd';

const SAMPLES = require('./samples/_index');
const sample = SAMPLES[fw];
if (!sample) {
  console.error(`No sample for framework "${fw}". Available: ${Object.keys(SAMPLES).join(', ')}`);
  process.exit(1);
}

// ─── Offline stub mode ────────────────────────────────────────────────
if (!live) {
  // 1) Stub GPT5MiniService.openai with a canned narrative payload.
  const GPT5MiniService = require(path.join(BOT_ROOT, 'shared/services/gpt5-mini.service'));
  GPT5MiniService.openai = {
    chat: {
      completions: {
        create: async ({ messages }) => {
          // Pull framework out of the prompt so the stub is mildly per-framework.
          const fwMatch = (messages[0].content || '').match(/\b(OECD|HOTS|TEACH|FICO|MEWAKA)\b/);
          const detected = fwMatch ? fwMatch[1] : 'OECD';
          return {
            choices: [{ message: { content: JSON.stringify(cannedNarrative(detected, sample.analysis)) } }],
          };
        },
      },
    },
  };

  // 2) Stub the supabase trend query to return [] so coaching-trend
  //    short-circuits without dialling a real DB.
  const supabase = require(path.join(BOT_ROOT, 'shared/config/supabase'));
  const chain = {
    select: () => chain,
    eq: () => chain,
    neq: () => chain,
    order: () => chain,
    not: () => chain,
    limit: async () => ({ data: [], error: null }),
  };
  Object.assign(supabase, { from: () => chain });
}

// ─── Render ────────────────────────────────────────────────────────────
(async () => {
  const { generateHeroReport } = require(path.join(BOT_ROOT, 'shared/services/coaching/report-v2/hero-report.service'));
  const start = Date.now();
  const { png, caption } = await generateHeroReport(sample.session, sample.analysis, sample.opts);
  const elapsed = Date.now() - start;

  const out = path.join(ROOT, `docs/samples/hero-report-${fw}.png`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, png);
  console.log(`Rendered ${out}`);
  console.log(`  size    : ${Math.round(png.length / 1024)} KB`);
  console.log(`  elapsed : ${elapsed} ms`);
  console.log(`  caption : ${caption}`);
  console.log(`  mode    : ${live ? 'live (real narrative LLM call)' : 'offline (canned narrative stub)'}`);
  process.exit(0);
})().catch((e) => {
  console.error('Render failed:', e);
  process.exit(1);
});

// ─── Canned narrative for offline mode ─────────────────────────────────
function cannedNarrative(fw, analysis) {
  const topic = analysis.topic || 'today\'s lesson';
  const isSwahili = (analysis.language === 'sw');
  if (isSwahili) {
    return {
      topic: topic,
      affirmation: 'Ulijenga lengo wazi tangu mwanzo na ulikiweka hai kupitia somo lote.',
      identity: 'Wewe ni mwalimu anayejenga maana kwa wanafunzi kupitia maswali yenye kina. Watoto walisikilizwa.',
      moments: [
        { title: 'Lengo lilieleweka mara moja', quote: 'Lengo letu leo ni kutambua aina mbalimbali za wanyama wanaopatikana Tanzania.', why: 'Lengo lilikuwa kichocheo cha umakini wa wanafunzi tangu dakika ya kwanza.' },
        { title: 'Sababu ya shingo ndefu', quote: 'Kwa sababu anataka kufikia majani ya juu.', why: 'Mwanafunzi alipata dhana ya adaptation peke yake — hii ndiyo kilele cha somo.' },
        { title: 'Vikundi vilieleza picha zao', quote: 'Twiga ana shingo ndefu. Anakula majani ya miti mirefu.', why: 'Wanafunzi walikuwa walimu kwa wakati huo — uthibitisho wa uelewa.' },
      ],
      strength_name: 'Maswali yenye kina',
      strength_note: 'Maswali yako ya "kwa nini" yalifungua njia ya kufikiri kwa kweli darasani.',
      horizon_title: 'Hitimisho la pamoja',
      horizon_note: 'Hatua ifuatayo ni kufunga somo na muhtasari mfupi wa pamoja — wanafunzi watasema kile walichojifunza.',
      journey_note: 'Somo hili linaonyesha mwelekeo wa kujenga — endelea kujenga juu yake.',
      score_framing: '71% ni hatua nzuri katika safari ya kufundisha — siyo hukumu, ni mwanzo.',
    };
  }
  return {
    topic: topic,
    affirmation: 'You set a crisp goal and held it alive through every minute of the lesson.',
    identity: 'You are a teacher who makes reasoning the lesson\'s currency. Children show up because their thinking is what you came for.',
    moments: [
      { title: 'The reasoning prompt', quote: 'How did you figure that out?', why: 'Asking it consistently turned every right answer into a reasoning moment, not a closing of a door.' },
      { title: 'A student\'s generalisation', quote: 'We doubled, so we doubled.', why: 'The child articulated the underlying rule before you named it — that\'s real understanding.' },
      { title: 'A quiet differentiation move', quote: '...', why: 'You sat with the stuck student without pulling class attention. Skilled teaching, invisibly delivered.' },
    ],
    strength_name: 'Reasoning-first questioning',
    strength_note: '\"How did you figure that out?\" was your through-line — children reciprocated.',
    horizon_title: 'Cold-call the silent half',
    horizon_note: 'Pair-talk surfaced one strong voice; widening to a non-volunteer next time will pull more thinking into the open.',
    journey_note: 'Three sessions in, your rhythm is steadier each time. You keep coming back to depth, not coverage.',
    score_framing: `Today is a stage in a journey, not a verdict. Where you stand today is a teacher who keeps showing up for thinking.`,
  };
}
