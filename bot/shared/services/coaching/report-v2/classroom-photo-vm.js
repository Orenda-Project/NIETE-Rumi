/**
 * bd-pv2tl — build the hero report's classroom-photo strip.
 *
 * Downloads up to 2 of the teacher's submitted classroom photos, optionally
 * downscales them, and returns them as base64 `data:` URIs the hero template
 * renders in framed cards ("From your classroom"). Dependencies are injected so
 * this is unit-testable without R2 or sharp. Fully defensive: a broken/missing
 * photo is skipped, never allowed to sink the report.
 *
 * @param {Array<{url:string, caption?:string}>} photos - session.classroom_photos
 * @param {object} deps
 * @param {(key:string)=>Promise<Buffer>} deps.downloadFn - R2 download
 * @param {(url:string)=>string} [deps.extractKey] - url → R2 key
 * @param {(buf:Buffer)=>Promise<Buffer>} [deps.downscale] - optional resize
 * @returns {Promise<Array<{src:string, index:number, caption?:string}>>}
 */
async function buildClassroomPhotoVm(photos, deps = {}) {
  const { downloadFn, extractKey = (u) => u, downscale } = deps;
  if (!Array.isArray(photos) || !photos.length || typeof downloadFn !== 'function') return [];

  const out = [];
  // bd-1mcpe: each framed photo carries its ORIGINAL index in session.classroom_photos, so its
  // caption (from "Classroom photo N") lands under the right picture even when an earlier photo
  // failed to download and was skipped.
  for (let index = 0; index < Math.min(photos.length, 2); index++) {
    const p = photos[index];
    if (!p || !p.url) continue;
    try {
      let buf = await downloadFn(extractKey(p.url));
      if (typeof downscale === 'function') {
        try { buf = await downscale(buf); } catch { /* keep the original on downscale failure */ }
      }
      if (buf && buf.length) {
        out.push({ src: `data:image/jpeg;base64,${buf.toString('base64')}`, index, ...(p.caption ? { caption: p.caption } : {}) });
      }
    } catch {
      // Skip a broken/missing photo — never fail the report over a photo.
    }
  }
  return out;
}

module.exports = { buildClassroomPhotoVm };
