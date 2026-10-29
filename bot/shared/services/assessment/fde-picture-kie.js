'use strict';
/**
 * The Grade 1-2 pictures the image model draws (bd-5jmnfj.4.3): an object, the
 * object a count item repeats, and a scene. One Kie nano-banana-pro task per
 * picture: create, poll, download — the same calls video-image.service makes.
 *
 * fetch and sleep are injected so tests make no call.
 */

const Describe = require('./fde-picture-describe');

const KIE_URL = 'https://api.kie.ai/api/v1/jobs';
// Amena, 23 Oct 2026: "worksheet" and "setting" drew worksheets — a banner, a caption giving the answer,
// four objects in one frame (bd-5jmnfj.4.11). A Grade 1 child names one plain thing.
// v14: arrows pointed at the answer and one scene came back a photographed colouring page. Amena, 23 Oct 2026:
// "we want black outlines, plain pictures so theyre easy to print" (bd-5jmnfj.4.30).
const STYLE = 'Simple black and white line drawing for a young child. Thick clean black outlines on pure white, no shading, '
  + 'no colour, child-friendly. No arrows, no pointers, no lines pointing at anything. A clean digital drawing, not a scan '
  + 'or photo of paper: no page edge, no grey, no paper texture, no shadow.';
const ALONE = 'Only one thing in the picture, centred on a plain white background: no other objects, no ground, no people, '
  + 'no text, no letters, no label, no caption, no heading, no border. '
  // v17: the egg came back with a curve that reads like a smile (bd-5jmnfj.4.37).
  + 'Draw only the outline and the parts the thing really has: no face, no eyes, no smile, no shine or highlight lines.';
// v28: G1 Urdu Q7 iii-v (grandfather, monkey, teacher) came back faceless or headless because every object was told
// "no face"; a person or animal (picture.living) is drawn whole with its face (bd-5jmnfj.4.58.4).
const ALONE_LIVING = 'Only one figure in the picture, centred on a plain white background: no other objects, no ground, '
  + 'no text, no letters, no label, no caption, no heading, no border. Draw it whole, head included, with its face: eyes and mouth '
  + 'clearly shown, and the parts it really has: no shine or highlight lines.';
// v22: the clock's hands came back as arrows pointing at 12 and 3 (bd-5jmnfj.4.50.1).
const HANDS = 'Its hands are plain straight lines with round ends: no arrowheads, no pointed tips.';
const hands = (text) => (/\b(clock|watch)/i.test(text) ? ` ${HANDS}` : '');
// v12: a plant with an arrow came back labelled ROOT, a school said SCHOOL; the scene prompt had no text rule.
// v26: G1 English Q13's describe said "next to the printed bubble" and the model drew one; the frame prints the bubble (bd-5jmnfj.4.58.2).
const NO_TEXT = 'No text anywhere: no words, no letters, no label, no caption, no sign, no writing on buildings or boards. '
  + 'No speech bubbles, no thought bubbles, no balloons round anyone.';
// v28: G2 Urdu Q7's park scene came back with the tree canopy cut at both edges of the bitmap (bd-5jmnfj.4.58.4).
const WHOLE = 'The whole scene sits inside the picture with a clear white margin all round it: nothing is cut off at any edge, '
  + 'every tree top and side is drawn to its end.';
const NEGATIVE = 'text, words, letters, typography, captions, labels, watermark, signature, writing, numbers, digits, symbols, '
  + 'colour, photo, grey background, border, frame, worksheet, heading, title, caption, multiple objects, '
  + 'arrow, pointer, scanned page, paper texture, page edge, shadow, face, smile, eyes, highlight, speech bubble, thought bubble';

// v22: G2 English Q10 v said "a bird standing at the back of a wall, partly hidden by it" and drew the bird
// looking over the wall's top, which a child reads as "on"; the key took only "behind" (bd-5jmnfj.4.50.3).
// A scene whose answer is a position word is told that one position, and the ones it must not look like.
const PLACES = {
  in: 'The first thing is completely inside the second, with the second\'s sides and rim all round it. The second stands on the floor. '
    + 'It is not on top of the second.',
  on: 'The first thing rests on the top of the second, its bottom touching the second\'s top edge, and nothing of the first thing hangs below '
    + 'that edge. The second stands on the floor. It is not inside it, under it or behind it.',
  // v26 G2 English Q10 i: a ball "on the floor under a chair" looked on or in the chair (bd-5jmnfj.4.58.2).
  under: 'The second thing stands on the floor on its own legs or base. The first thing sits on the same floor, beneath the second: '
    + 'below its seat or top, with a clear gap of white between the first thing\'s top and the second\'s underside, and none of its '
    + 'lines touching or crossing the second. It is not on, in or behind the second.',
  near: 'The two things are side by side on the same floor, at the same height, with a small gap between them; '
    + 'it is not on, in, under or behind it.',
  behind: 'The first thing is behind the second, seen from the front: the second stands in front and hides most of it, '
    + 'and only a small part of it shows at the second\'s side. It is not on top of the second, not standing on it '
    + 'and not looking over its top edge.',
};

/** The position word a scene item's one-word answer names, or null. */
function placeOf(q) {
  const word = String((q && q.answer) || '').trim().toLowerCase();
  return q && q.picture && q.picture.kind === 'scene' && Object.hasOwn(PLACES, word) ? word : null;
}

// v24: G1 English Q8 "a child swimming in a pool" drew a girl sitting in a puddle, and G1 Maths Q8 "a long
// ribbon and a short ribbon" drew two curls; the key took "swimming" and "the long ribbon" (bd-5jmnfj.4.55).
// A scene whose question asks for the action, or which of two is longer, is told what the child must see.
// v27 G1 English Q8 iii: the "jumping" child had no ground under it and read as kneeling (bd-5jmnfj.4.58.3).
const ACTION = (a) => ` The child is plainly ${a}: the whole body and the place show that action and no other, `
  + `so a child who looks says "${a}" at once. The whole figure is drawn head to feet, and a visible ground line `
  + '(the water surface when the child is in water) runs under the scene, so where the body is against the ground is plain.';
// v26 G1 Maths Q8 iv: the toothbrush was drawn under the spoon, overlapping it (bd-5jmnfj.4.58.2).
const COMPARE = ' Two different kinds of thing, each drawn whole and separate, side by side on one shared base line, not one above or below '
  + 'the other, with a clear empty gap between them. They do not touch or overlap, and neither is in front of the other. '
  + 'Each is laid straight and flat. Neither is curled, coiled, bent, rolled or folded. The difference is plain at a glance.';

/** What a scene item's picture must show for its key: {action} or {compare: true}, or null. */
function showOf(q) {
  if (!q || !q.picture || q.picture.kind !== 'scene') return null;
  const question = String(q.question || '');
  const answer = String(q.answer || '').trim().toLowerCase();
  if (/what is the child doing/i.test(question) && /^[a-z]+ing$/.test(answer)) return { action: answer };
  if (/^which (one )?(is|holds) (longer|shorter|taller|heavier|lighter|more|less)/i.test(question.trim())) return { compare: true };
  return null;
}

/** The image-model prompt for a picture. A count draws one of its object; the paper repeats it. */
function promptFor(picture) {
  const kind = picture && picture.kind;
  if (kind === 'object' || kind === 'count') {
    const name = String(picture.name || '').trim();
    if (!name) throw new Error(`${kind} picture: nothing to draw`);
    const who = Describe.genderNote(name);
    return `${STYLE} The picture: one ${name}. ${picture.living ? ALONE_LIVING : ALONE}${hands(name)}${who ? ` ${who}` : ''}`;
  }
  if (kind === 'scene') {
    const describe = Describe.withoutBubbles(String(picture.describe || '').trim());
    if (!describe) throw new Error('scene picture: nothing to draw');
    const place = Object.hasOwn(PLACES, String(picture.place)) ? ` The position must be plain at a glance. ${PLACES[picture.place]}` : '';
    const show = picture.show || {};
    const told = (show.action ? ACTION(show.action) : '') + (show.compare ? COMPARE : '');
    return `${STYLE} The picture: ${describe}.${place}${told} ${NO_TEXT} ${WHOLE}${hands(describe)}`;
  }
  throw new Error(`${kind}: not an image-model picture`);
}

const NEGATIVE_LIVING = NEGATIVE.replace(', face, smile, eyes,', ', smile,');
/** The negative prompt for a prompt: a living figure keeps its face and eyes. */
const negativeFor = (prompt) => (String(prompt).includes(ALONE_LIVING) ? NEGATIVE_LIVING : NEGATIVE);

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
      input: { prompt, output_format: 'png', aspect_ratio: '1:1', resolution: '1K', negative_prompt: negativeFor(prompt) },
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

module.exports = { promptFor, placeOf, showOf, generateImage, KIE_URL, NEGATIVE, negativeFor };
