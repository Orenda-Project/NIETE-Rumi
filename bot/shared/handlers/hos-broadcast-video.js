'use strict';

/**
 * bd-07cjd — the head-of-school broadcast template (niete_hos_features_v1)
 * carries two QUICK_REPLY buttons. The tap opens the 24-hour window, so the
 * video reply is a free service message, not another template.
 *
 * Match the payload OR the button text: Meta strips the payload on some
 * registrations (see isSelectVideoButton), and with no custom payload it
 * sends the text.
 * The video links are config (HOS_VIDEO_*_URL), set per environment.
 */
const HOS_VIDEO_BUTTONS = {
  lp: { payload: 'hos_video_lp', text: 'lesson plans video', urlEnv: 'HOS_VIDEO_LP_URL' },
  training: { payload: 'hos_video_training', text: 'teacher training video', urlEnv: 'HOS_VIDEO_TRAINING_URL' },
};

const SEND_FAILED_TEXT =
  "Sorry, the video couldn't be sent just now. Please try again in a few minutes by tapping the button.";

/** 'lp' | 'training' | null — pure, so the router can call it cheaply. */
function matchHosVideoButton({ buttonPayload, buttonText } = {}) {
  const norm = (v) => String(v || '').trim().toLowerCase();
  const payload = norm(buttonPayload);
  const text = norm(buttonText);
  for (const [kind, b] of Object.entries(HOS_VIDEO_BUTTONS)) {
    if (payload === b.payload || text === b.text) return kind;
  }
  return null;
}

/**
 * Sends the video for `kind`; on any miss, says so instead of going silent.
 * `resolveUrl` signs a private-bucket link at tap time, so the stored link
 * never expires while the broadcast is still being tapped.
 */
async function sendHosVideo(kind, to, {
  sendVideoByLink, sendMessage, resolveUrl = async (u) => u, env = process.env, log = () => {},
}) {
  const url = env[HOS_VIDEO_BUTTONS[kind].urlEnv];
  if (!url) {
    log('hos.video.unconfigured', { kind, to });
    await sendMessage(to, SEND_FAILED_TEXT);
    return false;
  }
  let link;
  try {
    link = await resolveUrl(url);
  } catch (error) {
    log('hos.video.failed', { kind, to, error: error.message });
    await sendMessage(to, SEND_FAILED_TEXT);
    return false;
  }
  const ok = await sendVideoByLink(to, link);
  log(ok ? 'hos.video.sent' : 'hos.video.failed', { kind, to });
  if (!ok) await sendMessage(to, SEND_FAILED_TEXT);
  return ok;
}

module.exports = { matchHosVideoButton, sendHosVideo, HOS_VIDEO_BUTTONS };
