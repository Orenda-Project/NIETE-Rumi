'use strict';
/**
 * The Grade 1-2 pictures the image model draws (bd-5jmnfj.4.3): an object, the
 * object a count item repeats, and a scene. One Kie nano-banana-pro task per
 * picture: create, poll, download — the same calls video-image.service makes.
 *
 * fetch and sleep are injected so tests make no call.
 */

const KIE_URL = 'https://api.kie.ai/api/v1/jobs';
// Amena, 23 Oct 2026: "worksheet" and "setting" drew worksheets — a banner, a caption giving the answer,
// four objects in one frame (bd-5jmnfj.4.11). A Grade 1 child names one plain thing.
const STYLE = 'Simple black and white line drawing for a young child. Thick clean outlines, no shading, no colour, child-friendly.';
const ALONE = 'Only one thing in the picture, centred on a plain white background: no other objects, no ground, no people, '
  + 'no text, no letters, no label, no caption, no heading, no border.';
const NEGATIVE = 'text, words, letters, typography, captions, labels, watermark, signature, writing, numbers, digits, symbols, '
  + 'colour, photo, grey background, border, frame, worksheet, heading, title, caption, multiple objects';

/** The image-model prompt for a picture. A count draws one of its object; the paper repeats it. */
function promptFor(picture) {
  const kind = picture && picture.kind;
  if (kind === 'object' || kind === 'count') {
    const name = String(picture.name || '').trim();
    if (!name) throw new Error(`${kind} picture: nothing to draw`);
    return `${STYLE} The picture: one ${name}. ${ALONE}`;
  }
  if (kind === 'scene') {
    const describe = String(picture.describe || '').trim();
    if (!describe) throw new Error('scene picture: nothing to draw');
    return `${STYLE} The picture: ${describe}.`;
  }
  throw new Error(`${kind}: not an image-model picture`);
}

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One task, polled until it finishes; the PNG as a Buffer. Throws on a failed or unfinished task. */
async function generateImage(prompt, {
  apiKey = process.env.KIE_API_KEY, fetchImpl = fetch, sleep = realSleep, pollMs = 4000, maxPolls = 45,
} = {}) {
  if (!apiKey) throw new Error('KIE_API_KEY is not set');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
  const created = await (await fetchImpl(`${KIE_URL}/createTask`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'nano-banana-pro',
      input: { prompt, output_format: 'png', aspect_ratio: '1:1', resolution: '1K', negative_prompt: NEGATIVE },
    }),
  })).json();
  const taskId = created && created.data && created.data.taskId;
  if (!taskId) throw new Error(`image model: no task (${JSON.stringify(created).slice(0, 200)})`);

  for (let i = 0; i < maxPolls; i += 1) {
    await sleep(pollMs);
    const polled = await (await fetchImpl(`${KIE_URL}/recordInfo?taskId=${taskId}`, { headers })).json();
    const data = (polled && polled.data) || {};
    if (data.state === 'success') {
      const url = JSON.parse(data.resultJson || '{}').resultUrls?.[0];
      if (!url) throw new Error('image model: success with no image');
      const res = await fetchImpl(url);
      if (!res.ok) throw new Error(`image model: download ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    }
    if (data.state === 'fail') throw new Error(`image model: ${data.failMsg || 'task failed'}`);
  }
  throw new Error(`image model: task ${taskId} did not finish`);
}

module.exports = { promptFor, generateImage, KIE_URL };
