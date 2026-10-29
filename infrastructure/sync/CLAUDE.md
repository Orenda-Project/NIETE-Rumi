# sync — Maintainer-only config for syncing internal code to the public rumi-platform repo

<!-- kg:meta repo=NIETE-Rumi dir=infrastructure/sync kg=2d313043a21a gen=7feebc308443 overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `manifest.json` — internal-to-public path mappings read by sync-from-internal.sh
- `exclude.txt` — paths never synced; human copy of the manifest exclusions
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `README.md` | Maintainer-only note on how internal code is synced to the public rumi-platform repo; not needed to run the bot |
| `manifest.json` | Maps internal paths to public monorepo paths and exclusions consumed by sync-from-internal.sh |
| `exclude.txt` | Human-readable list of paths never synced to the public repo; companion to the manifest.json exclude list |

## Who reads this (generated)
- (none)

## Never (human)
- exclude.txt is only a human copy; the script reads manifest.json's exclude list, edit both together (exclude.txt:3,8)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `SETUP.md`? · `infrastructure/CLAUDE.md`? · `infrastructure/scripts/CLAUDE.md`? · `infrastructure/sync/README.md`?
