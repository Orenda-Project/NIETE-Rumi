'use strict';
/**
 * Every picture on a Grade 1-2 paper gets its image before the paper is saved
 * (bd-5jmnfj.4.3). An item carries `picture: {kind, ...}`; this sets `picture.src`
 * to a data URI the renderer embeds, so the PDF needs no network.
 *
 *   dots, shapes,         drawn as SVG in place (fde-picture-svg)
 *   clock, plant
 *   object, count, scene  read from R2, or drawn by the image model on a miss,
 *                         shrunk to a 320px grey JPEG and cached:
 *                         fde-pictures/v3/object/<slug>.jpg, fde-pictures/v3/scene-no-text/<slug>-<hash>.jpg
 *
 * A count is its object's picture, repeated by the renderer. A failed drawing is
 * tried once more; a second failure fails the paper PICTURE_FAILED, so a paper
 * never prints an empty box. The image model refuses (429) when called too fast, so
 * a worker draws at most MAX_DRAWS at once across all its papers, and a 429 is
 * tried again after each pause in RATE_WAITS_MS (bd-5jmnfj.4.21).
 *
 * A picture with a grey frame round it is never printed (bd-5jmnfj.4.36): a framed
 * cache hit is drawn again, and a framed drawing counts as a failed one.
 */

const crypto = require('crypto');
const Svg = require('./fde-picture-svg');
const Kie = require('./fde-picture-kie');
const Describe = require('./fde-picture-describe');
const { circuitPicture } = require('./fde-circuit-frame');

// v3: pictures cached under v2 carry arrows and scan edges (bd-5jmnfj.4.30) and are never reused.
const PREFIX = 'fde-pictures/v3';
const CACHE_CONTROL = 'public, max-age=31536000, immutable';
const MODEL_KINDS = ['object', 'count', 'scene'];
const MAX_DRAWS = 2;
const RATE_WAITS_MS = [5000, 15000, 30000];
// Pictures whose cached drawing was rejected on review get a fresh key, so they are drawn again.
// v17: the egg has a curve that reads like a smile (bd-5jmnfj.4.37).
const REDRAWN = { egg: 'r1' };
// v29: a scene rejected on review, by its describe hash. The v28 G2 Urdu Q7 park scene was cut off at the edge (bd-5jmnfj.4.58.5).
const REDRAWN_SCENES = { '72b1e44a': 'r1' };
// v17: the framed sock had 34% of its outer 3px grey; scenes whose ground line touches the edge have under 2%.
const PROMPT_REV = 'r27';
const RING_PX = 3;
const FRAME_SHARE = 0.2;

const slug = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const canon = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Where an image-model picture is cached. A scene's key also hashes its whole description, and its
 * position word when it has one: a scene drawn before bd-5jmnfj.4.50.3 was told no position, and one
 * drawn before bd-5jmnfj.4.55 was told no action or compare hint.
 */
function cacheKey(picture) {
  if (picture.kind === 'scene') {
    const told = canon(picture.describe) + (picture.place ? `|${picture.place}` : '')
      + (picture.show ? `|${JSON.stringify(picture.show)}` : '')
      // v26: a bubble in the describe, and the position and compare wording, changed what is drawn (bd-5jmnfj.4.58.2).
      + (Describe.hasBubble(picture.describe) ? '|nb1' : '') + (picture.place || picture.show ? `|${PROMPT_REV}` : '');
    const hash = crypto.createHash('sha256').update(told).digest('hex').slice(0, 8);
    const rev = REDRAWN_SCENES[hash];
    return `${PREFIX}/scene-no-text/${slug(picture.describe)}-${hash}${rev ? `-${rev}` : ''}.jpg`;
  }
  const name = slug(picture.name);
  // v26: a masculine person was drawn a woman; one drawn before the markers were added is never reused.
  const rev = REDRAWN[name] || (picture.living ? 'l1' : '') || (Describe.genderNote(picture.name) ? 'm1' : ''); // l1: a living figure drawn with its face (bd-5jmnfj.4.58.4)
  return `${PREFIX}/object/${rev ? `${name}-${rev}` : name}.jpg`;
}

/** True when the outer ring of a greyscale image ({data, width, height}) is mostly not white: a frame. */
function framed({ data, width, height }) {
  let ring = 0;
  let dark = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (Math.min(x, y, width - 1 - x, height - 1 - y) >= RING_PX) continue;
      ring += 1;
      if (data[y * width + x] < 235) dark += 1;
    }
  }
  return ring > 0 && dark / ring > FRAME_SHARE;
}

function realDeps() {
  const R2 = require('../../storage/r2');
  const sharp = require('sharp');
  return {
    headObject: R2.headObject,
    downloadFromR2: R2.downloadFromR2,
    uploadBuffer: R2.uploadBuffer,
    generateImage: (prompt) => Kie.generateImage(prompt),
    log: require('../../utils/logger').logToFile,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    shrink: (buf) => sharp(buf).resize(320, 320, { fit: 'inside' }).grayscale().jpeg({ quality: 80 }).toBuffer(),
    gray: async (buf) => {
      const { data, info } = await sharp(buf).grayscale().raw().toBuffer({ resolveWithObject: true });
      return { data, width: info.width, height: info.height };
    },
  };
}

function walk(examJson, fn) {
  for (const branch of ['seen', 'unseen']) {
    for (const types of Object.values((examJson && examJson[branch]) || {})) {
      for (const list of Object.values(types || {})) {
        if (Array.isArray(list)) list.forEach((q) => { if (q && q.picture) fn(q); });
      }
    }
  }
}

function pictureFailed(q, err) {
  const e = new Error('A picture on the paper could not be drawn.');
  e.code = 'PICTURE_FAILED';
  e.slot = q.slot || null;
  e.kind = (q.picture && q.picture.kind) || null;
  e.cause = err.message;
  return e;
}

// Shared by every paper this worker resolves, so five papers at once still draw two pictures at a time.
let drawing = 0;
const waiting = [];
async function limited(fn) {
  if (drawing >= MAX_DRAWS) await new Promise((resolve) => waiting.push(resolve));
  else drawing += 1;
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next(); else drawing -= 1;
  }
}

const isRateLimited = (err) => /\b429\b|call frequency/i.test(String(err && err.message));

/** A 429 waits and tries again (RATE_WAITS_MS); any other failure is tried once more. */
async function draw(prompt, d) {
  let otherRetried = false;
  for (let rate = 0; ; ) {
    try {
      return await limited(() => d.generateImage(prompt));
    } catch (err) {
      if (isRateLimited(err) && rate < RATE_WAITS_MS.length) {
        await d.sleep(RATE_WAITS_MS[rate]);
        rate += 1;
      } else if (!isRateLimited(err) && !otherRetried) {
        otherRetried = true;
      } else {
        throw err;
      }
    }
  }
}

const isFramed = async (buf, d) => framed(await d.gray(buf));

async function modelPicture(picture, d) {
  const key = cacheKey(picture);
  const head = await d.headObject(key);
  if (head && head.exists) {
    const cached = await d.downloadFromR2(key);
    if (!(await isFramed(cached, d))) return cached;
  }
  const prompt = Kie.promptFor(picture);
  for (let tries = 0; tries < 2; tries += 1) {
    const jpg = await d.shrink(await draw(prompt, d));
    if (await isFramed(jpg, d)) continue;
    await d.uploadBuffer(jpg, key, 'image/jpeg', { cacheControl: CACHE_CONTROL });
    return jpg;
  }
  throw new Error('the picture came back with a grey frame twice');
}

/** Sets picture.src on every item that carries a picture. Throws PICTURE_FAILED on the first it cannot draw. */
async function resolvePictures(examJson, deps = null) {
  const items = [];
  walk(examJson, (q) => items.push(q));
  if (!items.length) return examJson;
  const d = deps || realDeps();
  const drawn = new Map(); // cache key -> Promise<Buffer>, so one paper draws a picture once
  await Promise.all(items.map(async (q) => {
    try {
      const place = Kie.placeOf(q); // a position item's picture is told its answer (bd-5jmnfj.4.50.3)
      if (place) q.picture.place = place;
      const show = Kie.showOf(q); // an action or compare picture is told what the key needs (bd-5jmnfj.4.55)
      if (show) q.picture.show = show;
      const svg = Svg.svgFor(q.picture);
      if (svg) { q.picture.src = Svg.dataUri(svg); return; }
      if (!MODEL_KINDS.includes(q.picture.kind)) throw new Error(`unknown picture kind ${q.picture.kind}`);
      const key = cacheKey(q.picture);
      if (!drawn.has(key)) drawn.set(key, modelPicture(q.picture, d));
      const buf = await drawn.get(key);
      q.picture.src = `data:image/jpeg;base64,${Buffer.from(buf).toString('base64')}`;
    } catch (err) {
      // The paper's own failure says only that a picture failed; this line says which and why.
      const p = q.picture || {};
      if (d.log) d.log('[assessment] picture failed', { slot: q.slot || null, kind: p.kind || null, name: p.name || p.describe || null, cause: err.message });
      throw pictureFailed(q, err);
    }
  }));
  return examJson;
}

// The slots of a laid-out paper whose frame is a picture to describe (G5 Urdu Q7, English Q10).
function pictureFrameSlots(examJson) {
  const L = examJson && examJson._layout;
  const slots = ((L && L.sections) || []).flatMap((s) => s.slots || []);
  return new Set(slots.filter((s) => s.frame && s.frame.kind === 'picture').map((s) => s.slot));
}

// G5 Science Q1 (b): a label frame whose key is the five circuit symbols prints them (bd-5jmnfj.4.58.2).
function drawCircuitFrames(examJson) {
  const L = examJson && examJson._layout;
  const labelSlots = new Set(((L && L.sections) || []).flatMap((s) => s.slots || [])
    .filter((s) => s.frame && s.frame.kind === 'diagram').map((s) => s.slot));
  for (const types of Object.values((examJson && examJson.unseen) || {})) {
    for (const list of Object.values(types || {})) {
      for (const q of Array.isArray(list) ? list : []) {
        const picture = q && labelSlots.has(q.slot) ? circuitPicture(q) : null;
        if (!picture) continue;
        q.picture = picture;
        delete q.teacher_note_en;
        delete q.teacher_note_ur;
      }
    }
  }
}

/**
 * A G5 picture-description frame (v24 review) gets a plain black-outline scene drawn from the
 * item's English `describe_en`. Unlike a Grade 1-2 picture this never fails the paper: an item
 * whose drawing fails keeps no picture, so it prints today's empty frame and the "You add" line.
 */
async function resolveFramePictures(examJson, deps = null) {
  drawCircuitFrames(examJson);
  const wanted = pictureFrameSlots(examJson);
  const items = [];
  for (const types of Object.values((examJson && examJson.unseen) || {})) {
    for (const list of Object.values(types || {})) {
      if (!Array.isArray(list)) continue;
      list.forEach((q) => {
        if (q && wanted.has(q.slot) && typeof q.describe_en === 'string' && q.describe_en.trim()) items.push(q);
      });
    }
  }
  if (!items.length) return examJson;
  const d = deps || realDeps();
  await Promise.all(items.map(async (q) => {
    const picture = { kind: 'scene', describe: q.describe_en.trim() };
    try {
      const buf = await modelPicture(picture, d);
      q.picture = { ...picture, src: `data:image/jpeg;base64,${Buffer.from(buf).toString('base64')}` };
      // The pattern's "paste or draw a picture" note no longer holds once a picture is drawn.
      delete q.teacher_note_en;
      delete q.teacher_note_ur;
    } catch (err) {
      delete q.picture;
      if (d.log) d.log('[assessment] frame picture failed', { slot: q.slot || null, describe: picture.describe, cause: err.message });
    }
  }));
  return examJson;
}

module.exports = { resolvePictures, resolveFramePictures, cacheKey, framed, PREFIX };
