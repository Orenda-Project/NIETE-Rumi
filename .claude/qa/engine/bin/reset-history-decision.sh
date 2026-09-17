#!/usr/bin/env bash
# reset-history-decision.sh — the ONE predicate for "archive the driver's prior COMPLETED coaching
# sessions before this run?". Prior feedback from completed sessions is embedded verbatim in the
# analysis LLM prompt, so a growing/varying history makes every run's request unique and defeats the
# e2e cassette (record-once/replay-forever). We archive to a fixed baseline (0 prior) whenever the run
# is cassette-backed. Extracted from run-suite.sh so it can be unit-tested (bd-yjyn0).
#
#   should_reset_history <method> <mode> <e2e_cassette>   → exit 0 (reset) / 1 (skip)
should_reset_history() {
  local method="${1:-}" mode="${2:-}" cassette="${3:-off}"
  # cassette explicitly on, OR the full 'all' run, OR the mock lane (ALWAYS cassette-backed:
  # the bot runs replay-strict and E2E_CASSETTE lives in the bot's env, not this shell — so a
  # named `--features coaching` mock run must still reset, or its prior-feedback block drifts).
  [ "${cassette:-off}" != "off" ] || [ "$mode" = "all" ] || [ "$method" = "mock" ]
}
