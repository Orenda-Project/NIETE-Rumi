# /e2e-mock — Run the NIETE E2E suite on the mock lane with a local database

One command, no Chrome, no WhatsApp number, no sandbox or Railway access. The bot runs locally at the
commit under test behind the mock Graph API, on this run's own clone of the local database, and the
database is dropped when the run ends. The first run on a machine sets the machine up by itself.

**Argument (`$ARGUMENTS`)** — optional:
- *(empty)* → the safe subset, one feature after another
- one feature (`training`, `menu`, `coaching`, …) → every scenario in that feature
- several features, comma-separated (`training,menu`) → those features at once, one slot each
- `all` → every feature at once
- extra options pass through to `run-suite.sh`: `--only 'coaching=COA09,COA20'`, `--commit <sha>`, `--slot N`

Run it from the NIETE-Rumi checkout:

```bash
bash scripts/qa/e2e-mock.sh $ARGUMENTS
```

The same command from a terminal: `npm run e2e:mock -- <args>`.

When it finishes, report the per-feature PASS / FAIL / other line the run prints, list every non-PASS
scenario with its evidence, and give the results folder (`.claude/qa/results/whatsapp/niete/<run>/`).
If it stops with `BLOCKED: this machine cannot run the mock lane yet`, show the commands it printed —
on Linux that is usually `bash bot/scripts/e2e/local-db.sh install-tools`, run once in a terminal.

For the real bot on a linked WhatsApp account, use `/niete-e2e` instead.
