// teacher-home-class-link — the hand-written teacher-home scenarios for Home's class link card: the card that shows each class's
// standing link with "Send to class group" and "Copy", folds once the link was sent this term, and (with the evening round on)
// names tonight's round and how many children played it. Joined to the generated teacher-home driver by
// .claude/qa/web/gen_page_features.py (EXTRA).
//
// Spec-only so far: the card needs the bot's class-link switches (app_settings web_quiz_class_link with its parents, and
// web_quiz_evening_round) and a class with children enrolled for the demo teacher, which no scenario here puts in place yet. Each
// scenario is reported BLOCKED, never hidden, so the web lane always shows the whole spec. What proves the card today are the
// unit suites named above the scenarios in the spec.
'use strict';

const NOT_YET = (id) => async () => ({ blocked: 'no driver code yet for ' + id + ': the scenario is written from the built card; its unit suites are named in tests/features/web/teacher-home.feature' });

const scenarios = [
  { id: "TH19", title: "Teacher app v2: with the class link on, Home shows \"Your class link\" with each class, its link, \"Send to class group\" and \"Copy\"", run: NOT_YET("TH19") },
  { id: "TH20", title: "Teacher app v2: once a class's link was sent this term, its block folds to \"Class link sent\" with \"Send again\"", run: NOT_YET("TH20") },
  { id: "TH21", title: "Teacher app v2: tonight's line shows only when the class's round is ready, then how many children played, never who", run: NOT_YET("TH21") },
  { id: "TH22", title: "Teacher app v2: with the class link off, Home is the Home before; a class outside the canary, or another teacher's class, gets no card", run: NOT_YET("TH22") },
  { id: "TH23", title: "Teacher app v2: the class link card reads in Urdu for a teacher whose language is Urdu", run: NOT_YET("TH23") },
];

module.exports = scenarios;
