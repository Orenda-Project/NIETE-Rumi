#!/usr/bin/env node
/**
 * WHICH CACHED LESSONS HAVE LOST THEIR DOCUMENT — bd-oak77.18.
 *
 * On every successful run the worker uploads the PDF and then, beside it, the `lp_doc` that made
 * it: `lp612/{tv}/{lang}/{segment}.lp.json`. The second upload's failure is swallowed on purpose
 * (the PDF is the product), so a `ready` row can point at a PDF with nothing beside it. That was
 * found by hand for 3 of 79 v9.1 PDFs. A missing sidecar means the next template bump re-authors
 * that lesson instead of re-rendering it, and any diagnosis of it starts from a raster.
 *
 * DETECTION ONLY. There is no deterministic backfill: the ready row clears its checkpoint, and a
 * PDF cannot be parsed back into the document that made it. Rebuilding a sidecar means authoring
 * the lesson again, which is an LLM call and a new document, so it is not this script's job. It
 * writes nothing to R2 or the DB. The only file it writes is its own summary.
 *
 * The summary goes to a FILE, via `fs`: the bot's Axiom logger patches `console`.
 *
 * Exit: 0 clean · 1 at least one sidecar missing · 2 a probe could not tell (transport, permission).
 *
 * Usage:
 *   node bot/scripts/lp612-sidecar-audit.js --template-version v9.1
 *   node bot/scripts/lp612-sidecar-audit.js --limit 200 --out sidecars.json
 */

const fs = require('fs');
const path = require('path');

const supabase = require('../shared/config/supabase');
const { downloadFromR2 } = require('../shared/storage/r2');
const Serving = require('../shared/services/lp612-serving.service');

const RENDERS = 'niete_lp612_renders';
const DEFAULT_OUT = 'lp612-sidecar-audit-summary.json';

const USAGE = `lp612 sidecar audit — lists ready renders whose PDF has no .lp.json beside it.

  --template-version V   only rows on template version V.
  --limit N              how many rows to walk (default 1000).
  --out PATH             where the JSON summary is written (default ${DEFAULT_OUT}).
  --help                 this.

Read-only. It detects and never backfills: a lost sidecar can only be rebuilt by re-authoring.`;

function parseArgs(argv = []) {
  const opts = { limit: 1000, out: DEFAULT_OUT, help: false };
  const value = (i, flag) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    switch (a) {
      case '--help': case '-h': opts.help = true; break;
      case '--limit': {
        const n = Number(value(i, '--limit'));
        if (!Number.isInteger(n) || n <= 0) throw new Error('--limit must be a positive integer');
        opts.limit = n; i += 1; break;
      }
      case '--template-version': opts.templateVersion = value(i, '--template-version'); i += 1; break;
      case '--out': opts.out = value(i, '--out'); i += 1; break;
      default: throw new Error(`unknown flag: ${a}\n\n${USAGE}`);
    }
  }
  return opts;
}

/** A 404 proves the sidecar is absent. Anything else (a transport error, a 403) proves nothing,
 *  and must not be counted as missing. */
function classifyProbeError(err) {
  const status = err && err.$metadata && err.$metadata.httpStatusCode;
  if ((err && err.name === 'NoSuchKey') || status === 404) return 'missing';
  return 'unreadable';
}

function exitCodeFor(summary) {
  if (summary.unreadable.length) return 2;
  if (summary.missing.length) return 1;
  return 0;
}

async function auditSidecars({ templateVersion, limit = 1000 } = {}) {
  let q = supabase.from(RENDERS)
    .select('id, segment_id, lang, template_version, status, r2_key')
    .eq('status', 'ready');
  if (templateVersion) q = q.eq('template_version', templateVersion);
  const { data, error } = await q.order('segment_id', { ascending: true }).limit(limit);
  if (error) throw new Error(`lp612 sidecar audit could not read ${RENDERS}: ${error.message}`);

  const summary = {
    templateVersion: templateVersion || null,
    scanned: 0, present: 0, missing: [], unreadable: [], skipped: [],
    backfill: 'not attempted: a lost sidecar can only be rebuilt by re-authoring (LLM), bd-oak77.18',
  };

  for (const r of data || []) {
    summary.scanned += 1;
    const ids = { renderId: r.id, segmentId: r.segment_id, lang: r.lang, templateVersion: r.template_version };
    // Probe only the canonical sibling of the canonical PDF key. A row pointing anywhere else has
    // no defined sidecar location, and guessing one would report a miss that is not a miss.
    if (r.r2_key !== Serving.r2KeyFor(r.segment_id, r.lang, r.template_version)) {
      summary.skipped.push({ ...ids, pdfKey: r.r2_key || null, reason: 'non_canonical_r2_key' });
      continue;
    }
    const docKey = Serving.docKeyFor(r.segment_id, r.lang, r.template_version);
    try {
      await downloadFromR2(docKey);
      summary.present += 1;
    } catch (err) {
      const entry = { ...ids, pdfKey: r.r2_key, docKey };
      if (classifyProbeError(err) === 'missing') summary.missing.push(entry);
      else summary.unreadable.push({ ...entry, error: err && err.message });
    }
  }
  return summary;
}

function writeSummary(outPath, summary) {
  const abs = path.resolve(outPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return abs;
}

async function main({ argv = process.argv.slice(2) } = {}) {
  const opts = parseArgs(argv);
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return { summary: null, exitCode: 0, outPath: null };
  }
  const summary = await auditSidecars({ templateVersion: opts.templateVersion, limit: opts.limit });
  const outPath = writeSummary(opts.out, summary);
  const exitCode = exitCodeFor(summary);
  process.stdout.write(
    `lp612 sidecar audit — scanned ${summary.scanned}, present ${summary.present}, `
    + `missing ${summary.missing.length}, unreadable ${summary.unreadable.length}, `
    + `skipped ${summary.skipped.length}\nsummary: ${outPath}\n`,
  );
  return { summary, exitCode, outPath };
}

module.exports = {
  main, parseArgs, auditSidecars, classifyProbeError, exitCodeFor, writeSummary, DEFAULT_OUT, USAGE,
};

if (require.main === module) {
  main()
    .then(({ exitCode }) => { process.exitCode = exitCode; })
    .catch((err) => {
      process.stderr.write(`lp612 sidecar audit failed: ${err.message}\n`);
      process.exitCode = 2;
    });
}
