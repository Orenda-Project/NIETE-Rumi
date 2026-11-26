/**
 * bd-5rz1v — a lesson being recorded is kept on the phone, not only in memory.
 *
 * The recorder hands over a chunk every few seconds and each one is written to
 * IndexedDB as it arrives. If the page reloads, the app is killed, or the
 * upload fails, the lesson is still here and can be sent — the page tells her
 * "your recording is safe on this phone", and this is what makes that true.
 * A recording is deleted only once it has reached R2 and the analysis started.
 *
 * Two stores: `recordings` (one row per recording) and `chunks` keyed
 * [id, seq], so a chunk is APPENDED, never rewritten with everything before it.
 *
 * Every function is best-effort from the caller's side (private browsing can
 * refuse IndexedDB): the recorder keeps its own copy in memory either way.
 */

import { bytesOf, concatBytes, joinWebmParts } from "./webmJoin";
import { sendLeftoverBeats } from "./recordingBeat";

const DB_NAME = "niete-lesson-recordings";
const VERSION = 1;
const RECORDINGS = "recordings";
const CHUNKS = "chunks";

/**
 * bd-ma9jiy (queue #262; the operator 26 Nov ~15:10: "on the user's device we should note which observation is the one
 * that's being recorded. So they can also store 2 at a time as well.") — what a recording belongs to, kept IN its row:
 * a coach's or principal's visit (lesson) or observation (debrief), a teacher's Digital Coaching attempt (made at Start,
 * with its class). lib/recordingLink reads it; rows saved before have none (the coach's teacher list may still say).
 */
export type RecordingLink = {
  kind: "obs" | "dbrf" | "dc";
  visitId?: string | null;
  observationId?: string | null;
  attemptId?: string | null;
  teacherExtId?: string | null;
  teacherName?: string | null;
  grade?: string | number | null;
  subject?: string | null;
};

export type StoredRecording = {
  id: string;
  mimeType: string;
  ext: string;
  startedAt: string;
  elapsedMs: number;
  finished: boolean;
  link?: RecordingLink;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB is not available"));
        return;
      }
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(RECORDINGS)) db.createObjectStore(RECORDINGS, { keyPath: "id" });
        if (!db.objectStoreNames.contains(CHUNKS)) db.createObjectStore(CHUNKS, { keyPath: ["id", "seq"] });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function createRecording(meta: Omit<StoredRecording, "elapsedMs" | "finished">): Promise<void> {
  const db = await open();
  const tx = db.transaction(RECORDINGS, "readwrite");
  tx.objectStore(RECORDINGS).put({ ...meta, elapsedMs: 0, finished: false });
  await done(tx);
}

/**
 * bd-ma9jiy — what is kept beside a chunk: `beat`, the heartbeat sample taken as it was saved (recordingBeat.ts; sent in
 * small batches, and with the recording), and `first`, set on the first chunk of a MediaRecorder session that continues a
 * cut recording (Resume after a kill): that chunk starts a new WebM file, and reading back joins the parts (webmJoin).
 */
export type ChunkExtra = { beat?: Record<string, unknown>; first?: boolean };

type ChunkRow = { id: string; seq: number; blob: Blob } & ChunkExtra;

export async function appendChunk(id: string, seq: number, blob: Blob, elapsedMs: number, extra?: ChunkExtra): Promise<void> {
  const db = await open();
  const tx = db.transaction([RECORDINGS, CHUNKS], "readwrite");
  const row: ChunkRow = { id, seq, blob };
  if (extra?.beat) row.beat = extra.beat;
  if (extra?.first) row.first = true;
  tx.objectStore(CHUNKS).put(row);
  const recordings = tx.objectStore(RECORDINGS);
  const meta = await request<StoredRecording | undefined>(recordings.get(id));
  if (meta) recordings.put({ ...meta, elapsedMs });
  await done(tx);
}

/**
 * bd-ma9jiy (26 Nov) — tie a kept recording to the observation it is now sent as (an old-recorder copy with no visit, sent
 * from Needs you as its OWN observation). Only the row's link changes; its audio never does.
 */
export async function setLink(id: string, link: RecordingLink): Promise<void> {
  const db = await open();
  const tx = db.transaction(RECORDINGS, "readwrite");
  const recordings = tx.objectStore(RECORDINGS);
  const meta = await request<StoredRecording | undefined>(recordings.get(id));
  if (meta) recordings.put({ ...meta, link });
  await done(tx);
}

export async function markFinished(id: string, elapsedMs: number): Promise<void> {
  const db = await open();
  const tx = db.transaction(RECORDINGS, "readwrite");
  const recordings = tx.objectStore(RECORDINGS);
  const meta = await request<StoredRecording | undefined>(recordings.get(id));
  if (meta) recordings.put({ ...meta, elapsedMs, finished: true });
  await done(tx);
}

/**
 * bd-ma9jiy — a recording's chunks as ONE file. Chunks of one MediaRecorder session are simply its bytes in order. A
 * recording resumed after a kill has more than one session (a chunk flagged `first` starts each later one): those are
 * joined into one WebM (webmJoin), never glued, which a player stops at. A join the code cannot make (not a WebM, codec
 * settings that differ) keeps the bytes in order, as before this change.
 */
export async function assemble(meta: StoredRecording, chunks: ChunkRow[]): Promise<{ blob: Blob; parts: number }> {
  const ordered = [...chunks].sort((a, b) => a.seq - b.seq);
  const groups: Blob[][] = [];
  for (const c of ordered) {
    if (!groups.length || c.first) groups.push([c.blob]);
    else groups[groups.length - 1].push(c.blob);
  }
  if (groups.length > 1) {
    try {
      const parts = await Promise.all(groups.map(async (g) => concatBytes(await Promise.all(g.map(bytesOf)))));
      const joined = joinWebmParts(parts);
      if (!("error" in joined)) return { blob: new Blob([joined.bytes], { type: meta.mimeType }), parts: groups.length };
    } catch { /* the bytes in order, below */ }
  }
  return { blob: new Blob(ordered.map((c) => c.blob), { type: meta.mimeType }), parts: groups.length };
}

export type Beat = Record<string, unknown>;

/** A recording kept on the phone, ready to send or to Resume: one file, where the next chunk goes, every save's beat. */
export type KeptRecording = { meta: StoredRecording; blob: Blob; nextSeq: number; parts: number; beats: Beat[] };

function readChunks(tx: IDBTransaction, id: string): Promise<ChunkRow[]> {
  const range = IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);
  return request<ChunkRow[]>(tx.objectStore(CHUNKS).getAll(range));
}

async function keptOf(meta: StoredRecording, chunks: ChunkRow[]): Promise<KeptRecording | null> {
  if (!chunks.length) return null;
  const { blob, parts } = await assemble(meta, chunks);
  const seqs = chunks.map((c) => c.seq);
  const beats = [...chunks].sort((a, b) => a.seq - b.seq).map((c) => c.beat).filter((b): b is Beat => !!b);
  return { meta, blob, nextSeq: Math.max(...seqs) + 1, parts, beats };
}

/** bd-ma9jiy — one recording by its id, or null (none, or no audio in it). */
export async function readKept(id: string): Promise<KeptRecording | null> {
  const db = await open();
  const tx = db.transaction([RECORDINGS, CHUNKS], "readonly");
  const meta = await request<StoredRecording | undefined>(tx.objectStore(RECORDINGS).get(id));
  if (!meta) return null;
  const chunks = await readChunks(tx, id);
  return keptOf(meta, chunks);
}

/**
 * The newest recording still on the phone (it has chunks), or null. bd-ih6cej: `accept` narrows which recordings count
 * (the coach's screens pass "this teacher's"), so a kept copy is found even when a newer one belongs to someone else.
 * bd-ma9jiy: assembled by `assemble` (a resumed recording is one file), with its beats and next seq.
 */
export async function latestUnsent(accept?: (meta: StoredRecording) => boolean): Promise<KeptRecording | null> {
  const db = await open();
  const tx = db.transaction([RECORDINGS, CHUNKS], "readonly");
  const all = await request<StoredRecording[]>(tx.objectStore(RECORDINGS).getAll());
  const newestFirst = [...all].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  for (const meta of newestFirst) {
    if (accept && !accept(meta)) continue;
    // eslint-disable-next-line no-await-in-loop
    const chunks = await readChunks(tx, meta.id);
    // eslint-disable-next-line no-await-in-loop
    if (chunks.length) return keptOf(meta, chunks);
  }
  return null;
}

/** bd-ma9jiy.3 — a kept recording as a list needs it: its row and its LAST heartbeat (no audio read). */
export type KeptSummary = { meta: StoredRecording; beats: Beat[] };

/**
 * bd-ma9jiy.3 (queue #262; the operator 26 Nov: kept recordings "should also be on the Needs You section") — every
 * recording still on the phone (it has a piece), newest first, each with only its last piece's heartbeat: enough to say
 * paused or not sent (lib/keptOffer) and how long, without assembling any audio.
 */
export async function listKept(): Promise<KeptSummary[]> {
  const db = await open();
  const tx = db.transaction([RECORDINGS, CHUNKS], "readonly");
  const all = await request<StoredRecording[]>(tx.objectStore(RECORDINGS).getAll());
  const newestFirst = [...all].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  const out: KeptSummary[] = [];
  for (const meta of newestFirst) {
    const range = IDBKeyRange.bound([meta.id, 0], [meta.id, Number.MAX_SAFE_INTEGER]);
    // eslint-disable-next-line no-await-in-loop
    const cursor = await request<IDBCursorWithValue | null>(tx.objectStore(CHUNKS).openCursor(range, "prev"));
    if (!cursor) continue;
    const last = cursor.value as ChunkRow;
    out.push({ meta, beats: last.beat ? [last.beat] : [] });
  }
  return out;
}

/**
 * Off the phone (sent, or thrown away). bd-ma9jiy: the heartbeat samples kept with its pieces that never reached us go
 * first (sendLeftoverBeats, best effort, never waited on), so "with the recording" holds for a phone offline all lesson.
 */
export async function deleteRecording(id: string): Promise<void> {
  const db = await open();
  let beats: Beat[] = [];
  try {
    const read = db.transaction(CHUNKS, "readonly");
    const rows = await readChunks(read, id);
    beats = rows.sort((a, b) => a.seq - b.seq).map((c) => c.beat).filter((b): b is Beat => !!b);
  } catch { /* nothing to tell */ }
  const tx = db.transaction([RECORDINGS, CHUNKS], "readwrite");
  tx.objectStore(RECORDINGS).delete(id);
  tx.objectStore(CHUNKS).delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
  await done(tx);
  if (beats.length) void sendLeftoverBeats(id, beats).catch(() => {});
}

/** Tests only: wipe the database. */
export async function __resetForTests(): Promise<void> {
  const db = await open();
  const tx = db.transaction([RECORDINGS, CHUNKS], "readwrite");
  tx.objectStore(RECORDINGS).clear();
  tx.objectStore(CHUNKS).clear();
  await done(tx);
}
