'use strict';
/**
 * The child and stories switches that read ON only for the JSON boolean `true`, each with the modules that turn it into
 * a boolean (reader names as in tests/quiz/web-quiz/switch-readers-agree.test.js, which runs every pair).
 *
 * One list for every check: the readers-agree test reads every key here through every reader, and the seed scan
 * (switch-seeds-are-booleans) fails on a test that seeds one of these keys as the string "true".
 *
 * The first-touch door and teacher switches (quiz_maker_page, quiz_first_door, quiz_student_join, quiz_one_door,
 * quiz_teacher_home, quiz_test_personas, web_quiz_bind_way_back) are not here: they keep their reading.
 */

// key → the readers that turn it into a boolean
const KEYS = {
  web_quiz_hub: ['hub-flags', 'identity-flags', 'book', 'card', 'sweeper', 'class-round-flags', 'hub-play', 'sample-window', 'story-teacher.flagOn'],
  web_quiz_challenge: ['hub-flags', 'book', 'card', 'calibration', 'sweeper', 'challenge.challengeOn', 'clip-warm', 'class-link-flags', 'class-round-flags',
    'class-week-flags', 'hub-play', 'sample-window', 'trail-page', 'teacher-jugnu-flags'],
  web_quiz_challenge_v2: ['hub-flags', 'book', 'calibration', 'sweeper', 'challenge.settingOn', 'clip-warm', 'class-link-flags', 'class-round-flags',
    'class-week-flags', 'hub-play', 'sample-window', 'trail-page', 'teacher-jugnu-flags'],
  web_quiz_events_v2: ['hub-flags', 'card', 'sweeper', 'class-round-flags', 'hub-play', 'sample-window'],
  web_quiz_library: ['hub-flags', 'library-flag'],
  web_quiz_stories: ['stories.storiesOn', 'home-flags', 'story-teacher.flagOn', 'live-read-keys (stories gate)'],
  web_quiz_stories_teacher: ['story-teacher.flagOn'],
  web_quiz_challenge_realtime: ['challenge.liveOn', 'live-read-v3.liveOn', 'stories.lr3'],
  web_quiz_live_read_v3: ['live-read-v3.on', 'challenge.settingOn', 'stories.lr3'],
  web_quiz_hub_door: ['hub-flags'],
  web_quiz_child_quiz_home: ['hub-flags'],
  web_quiz_home_button: ['hub-flags'],
  web_quiz_back_nav: ['hub-flags'],
  web_quiz_challenge_rungs: ['hub-flags', 'sweeper'],
  web_quiz_readalong: ['hub-flags', 'challenge.settingOn'],
  web_quiz_identity_canon: ['identity-flags'],
  web_quiz_phone_bind: ['identity-flags'],
  web_quiz_guest_home: ['identity-flags'],
  // keys that share a reader with the keys above: the same module reads them the same way
  web_quiz_challenge_story: ['book', 'challenge.settingOn', 'hub-play', 'trail-page'],
  web_quiz_challenge_book: ['book', 'hub-play'],
  web_quiz_class_wall: ['book'],
  web_quiz_challenge_card: ['card'],
  web_quiz_challenge_sweeper: ['sweeper'],
  web_quiz_challenge_audio_purge: ['sweeper'],
  web_quiz_challenge_calibration: ['calibration'],
  web_quiz_hub_challenge_first: ['hub-play'],
  web_quiz_install_prompt: ['hub-play'],
  web_quiz_class_round: ['challenge.settingOn', 'class-round-flags', 'class-week-flags', 'sample-window'],
  web_quiz_class_week: ['challenge.settingOn', 'class-week-flags'],
  web_quiz_class_link: ['class-link-flags', 'class-week-flags'],
  web_quiz_challenge_audio_consent: ['trail-page'],
  web_quiz_challenge_keep_audio: ['challenge.settingOn', 'trail-page'],
  web_quiz_challenge_pool: ['challenge.settingOn', 'trail-page'],
  web_quiz_teacher_jugnu: ['teacher-jugnu-flags'],
  web_quiz_challenge_clip_warm: ['clip-warm'],
  web_quiz_challenge_questions: ['challenge.questionsOn'],
  web_quiz_challenge_listen: ['challenge.listenOn'],
  web_quiz_challenge_record: ['challenge.settingOn'],
  web_quiz_challenge_read_guard: ['challenge.settingOn'],
  web_quiz_challenge_items: ['challenge.settingOn'],
  web_quiz_challenge_trail: ['challenge.settingOn'],
  web_quiz_challenge_missing: ['challenge.settingOn'],
  web_quiz_challenge_option_audio: ['challenge.settingOn'],
  web_quiz_challenge_period: ['challenge.settingOn'],
  web_quiz_challenge_g1: ['challenge.settingOn'],
};

module.exports = { KEYS };
