#!/usr/bin/env bash
# make-stand-in-fixtures.sh — the child-test mock lane's stand-in media (bd-q8wt5e.6.1).
#
# Child speech never lives in git, and the lane never records it into a cassette. The conversation
# scenarios only need SOME voice note and SOME photo to reach the bot: what the bot does with the
# bytes (store, claim the block, move on) is what they check — never the marks. So these are
# synthetic and carry no voice at all: a tone and a plain card. Scoring them is answered by a
# scripted vendor failure (child-test.cjs, E2E_CASSETTE_FAULTS), never by an invented transcript.
#
#   bash .claude/qa/fixtures/whatsapp/niete/media/child-test/make-stand-in-fixtures.sh
set -euo pipefail
cd "$(dirname "$0")"
ffmpeg -loglevel error -y -f lavfi -i "sine=frequency=330:duration=3" -ac 1 -ar 16000 -c:a libopus -b:a 16k stand-in-note.ogg
ffmpeg -loglevel error -y -f lavfi -i "color=c=white:s=640x360:d=1" -frames:v 1 -q:v 4 stand-in-strip.jpg
ls -l stand-in-note.ogg stand-in-strip.jpg
