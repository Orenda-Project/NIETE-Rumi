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

const DB_NAME = "niete-lesson-recordings";
const VERSION = 1;
const RECORDINGS = "recordings";
const CHUNKS = "chunks";

export type StoredRecording = {
  id: string;
  mimeType: string;
  ext: string;
  startedAt: string;
  elapsedMs: number;
  finished: boolean;
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

export async function appendChunk(id: string, seq: number, blob: Blob, elapsedMs: number): Promise<void> {
  const db = await open();
  const tx = db.transaction([RECORDINGS, CHUNKS], "readwrite");
  tx.objectStore(CHUNKS).put({ id, seq, blob });
  const recordings = tx.objectStore(RECORDINGS);
  const meta = await request<StoredRecording | undefined>(recordings.get(id));
  if (meta) recordings.put({ ...meta, elapsedMs });
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

/** The most recently started recording that has audio in it, assembled. */
export async function latestUnsent(): Promise<{ meta: StoredRecording; blob: Blob } | null> {
  const db = await open();
  const tx = db.transaction([RECORDINGS, CHUNKS], "readonly");
  const all = await request<StoredRecording[]>(tx.objectStore(RECORDINGS).getAll());
  const newestFirst = [...all].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  for (const meta of newestFirst) {
    const range = IDBKeyRange.bound([meta.id, 0], [meta.id, Number.MAX_SAFE_INTEGER]);
    // eslint-disable-next-line no-await-in-loop
    const chunks = await request<{ seq: number; blob: Blob }[]>(tx.objectStore(CHUNKS).getAll(range));
    if (chunks.length) {
      const ordered = chunks.sort((a, b) => a.seq - b.seq).map((c) => c.blob);
      return { meta, blob: new Blob(ordered, { type: meta.mimeType }) };
    }
  }
  return null;
}

export async function deleteRecording(id: string): Promise<void> {
  const db = await open();
  const tx = db.transaction([RECORDINGS, CHUNKS], "readwrite");
  tx.objectStore(RECORDINGS).delete(id);
  tx.objectStore(CHUNKS).delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
  await done(tx);
}

/** Tests only: wipe the database. */
export async function __resetForTests(): Promise<void> {
  const db = await open();
  const tx = db.transaction([RECORDINGS, CHUNKS], "readwrite");
  tx.objectStore(RECORDINGS).clear();
  tx.objectStore(CHUNKS).clear();
  await done(tx);
}
