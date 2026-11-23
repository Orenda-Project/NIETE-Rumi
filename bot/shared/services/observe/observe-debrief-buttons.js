'use strict';

/**
 * The debrief's button ids and its "Debrief now / Later" choice: pure, no I/O, so a module that only needs to offer
 * the debrief (obs612/summary.js, after a FICO-S review: bd-31ziu8) need not load the debrief service and its model
 * clients. observe-debrief.service.js re-exports all of it unchanged; the ids are the ones its handlers parse.
 */

const BUTTON_NOW_PREFIX = 'observe_debrief_now_';
const BUTTON_LATER_PREFIX = 'observe_debrief_later_';

/**
 * The post-submit choice: debrief now or later.
 * Titles must fit WhatsApp's 20-char reply-button cap.
 */
function buildDebriefChoiceButtons(sessionId, S) {
  return {
    body: S.debrief_choice_body,
    buttons: [
      { id: `${BUTTON_NOW_PREFIX}${sessionId}`, title: S.btn_debrief_now },
      { id: `${BUTTON_LATER_PREFIX}${sessionId}`, title: S.btn_debrief_later },
    ],
  };
}

module.exports = { BUTTON_NOW_PREFIX, BUTTON_LATER_PREFIX, buildDebriefChoiceButtons };
