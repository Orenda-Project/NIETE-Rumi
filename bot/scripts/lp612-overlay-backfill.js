/**
 * THE ENTRY POINT FOR THE OVERLAY REPAIR — bd-vrt20, the residue of bd-yhd16.
 *
 * `lp612-overlay-backfill.service` has known how to walk the cache and put the repair back since
 * bd-idneu was filed. Nothing called it. No script, no npm entry, no cron — the pass was "runnable"
 * on paper for a week and was not runnable in fact. This is the thing that runs it.
 *
 * It is deliberately thin. Every decision that matters — what to repair, in what order to write,
 * when to stop — belongs to the service and is tested there. What lives here is only the handful of
 * things a driver can get wrong that cost production:
 *
 *   DRY RUN IS THE DEFAULT AND `--live` IS THE ONLY THING THAT WRITES. The service already defaults
 *   `dryRun: true`; this file must not quietly invert it. A run with no flags reads, classifies and
 *   reports, spends no model tokens, uploads nothing and patches no row. That inventory is the
 *   artifact a live run gets approved from.
 *
 *   THE SUMMARY GOES TO A FILE, WITH `fs`. The bot's Axiom logger patches `console`, so anything
 *   printed to stdout is swallowed or interleaved with JSON log lines — that has already cost one
 *   investigation on this bead. The summary is written where it can be read afterwards with `cat`,
 *   and the path is echoed on the one line that is allowed to go to the terminal.
 *
 *   A HALF-WORKING REPAIR DOES NOT LOOK GREEN. An aborted walk, or any failed row, exits non-zero.
 *   A repair pass that touched the live corpus and partly failed must not pass for a success in
 *   whatever ran it.
 *
 * Usage:
 *   node bot/scripts/lp612-overlay-backfill.js                          # inventory, costs nothing
 *   node bot/scripts/lp612-overlay-backfill.js --limit 81 --out run.json
 *   node bot/scripts/lp612-overlay-backfill.js --live --limit 81 --out run.json
 */

const fs = require('fs');
const path = require('path');

const { backfillUrduOverlays } = require('../shared/services/lp612-overlay-backfill.service');

const DEFAULT_OUT = 'lp612-overlay-backfill-summary.json';

const USAGE = `lp612 overlay backfill — repairs cached Urdu lessons whose overlay is incomplete.

  --live                 actually write. Without it this is an inventory and nothing is touched.
  --limit N              how many rows to walk (default 1000).
  --template-version V   only rows on template version V.
  --model M              override the model used for the top-up.
  --out PATH             where the JSON summary is written (default ${DEFAULT_OUT}).
  --help                 this.

The summary is written to a FILE, not stdout: the Axiom logger patches console.`;

/**
 * Flags to service options. `dryRun` is derived from the PRESENCE of `--live` and nothing else —
 * there is no `--dry-run` to get backwards, and an unrecognised flag is a refusal rather than a
 * silent default, because "the flag I typed did nothing" is how a scoped run becomes a corpus run.
 */
function parseArgs(argv = []) {
  const opts = { dryRun: true, out: DEFAULT_OUT, help: false };
  const value = (i, flag) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    switch (a) {
      case '--live': opts.dryRun = false; break;
      case '--help': case '-h': opts.help = true; break;
      case '--limit': {
        const n = Number(value(i, '--limit'));
        if (!Number.isInteger(n) || n <= 0) throw new Error(`--limit must be a positive integer`);
        opts.limit = n; i += 1; break;
      }
      case '--template-version': opts.templateVersion = value(i, '--template-version'); i += 1; break;
      case '--model': opts.model = value(i, '--model'); i += 1; break;
      case '--out': opts.out = value(i, '--out'); i += 1; break;
      default: throw new Error(`unknown flag: ${a}\n\n${USAGE}`);
    }
  }
  return opts;
}

/** Written with `fs` and nothing else. Parent directories are created; a run must not lose its
 *  report to a missing folder after it has already touched production. */
function writeSummary(outPath, summary) {
  const abs = path.resolve(outPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return abs;
}

/** Non-zero when the walk aborted or any row failed — in either mode. A dry run that could not read
 *  a document has not cleared that document, and a live run that failed halfway has not finished. */
function exitCodeFor(summary) {
  if (summary.aborted) return 2;
  if (summary.failed && summary.failed.length) return 1;
  return 0;
}

async function main({ argv = process.argv.slice(2), run = backfillUrduOverlays } = {}) {
  const opts = parseArgs(argv);
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return { options: opts, summary: null, exitCode: 0, outPath: null };
  }

  const correlationId = `lp612-overlay-backfill-${Date.now()}`;
  const options = {
    dryRun: opts.dryRun,
    correlationId,
    ...(opts.limit === undefined ? {} : { limit: opts.limit }),
    ...(opts.templateVersion === undefined ? {} : { templateVersion: opts.templateVersion }),
    ...(opts.model === undefined ? {} : { model: opts.model }),
  };

  const summary = await run(options);
  const outPath = writeSummary(opts.out, { ...summary, correlationId });
  const code = exitCodeFor(summary);

  // The one line allowed to reach the terminal: where to read the rest.
  process.stdout.write(
    `lp612 overlay backfill ${opts.dryRun ? '(DRY RUN)' : 'LIVE'} — `
    + `scanned ${summary.scanned}, `
    + `${opts.dryRun ? `would repair ${summary.wouldRepair}` : `repaired ${summary.repaired}`}, `
    + `failed ${summary.failed.length}${summary.aborted ? ', ABORTED' : ''}\n`
    + `summary: ${outPath}\n`,
  );

  return { options, summary, exitCode: code, outPath };
}

module.exports = { main, parseArgs, writeSummary, exitCodeFor, DEFAULT_OUT, USAGE };

if (require.main === module) {
  main()
    .then(({ exitCode }) => { process.exitCode = exitCode; })
    .catch((err) => {
      process.stderr.write(`lp612 overlay backfill failed: ${err.message}\n`);
      process.exitCode = 2;
    });
}
