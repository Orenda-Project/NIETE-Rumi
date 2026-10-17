'use strict';
/**
 * The ONE reading of an app_settings on/off switch for the quiz services: on only when the row's value is JSON `true`.
 * A string ('true', '"true"', ' TRUE '), 'yes', 'on', 1, {enabled:true}, null and anything else read off, so a switch
 * row reads the same in every module that asks for it (a string row is off everywhere, never on in one place and off in
 * another). Value keys ("all", a number, a list) are not switches and are parsed by their own readers.
 */
function isTrue(value) {
  return value === true;
}

module.exports = { isTrue };
