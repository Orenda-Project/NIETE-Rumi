/**
 * bd-s1oo0.7 — child-test recordings (and the maths strip photo) kept on the phone.
 *
 * The same chunk-append design as recordingStore.ts (the lesson recorder's), in
 * its OWN database so a child's block can never be mistaken for a lesson: each
 * chunk is written as MediaRecorder hands it over, so a reload, a killed app or
 * a failed upload costs nothing. An item is deleted only once it has reached R2
 * and the bot has attached it to the block (uploader.ts).
 *
 * An item is "pending" when it is finished AND tagged with the session and block
 * it belongs to. Tagging a new take of a block replaces the earlier unsent take,
 * so re-recording never sends two.
 *
 * The first four functions are the LessonRecorder's StoreLike; it is reused as is.
 */

const DB_NAME = "niete-child-test-recordings";
const VERSION = 1;
const ITEMS = "items";
const CHUNKS = "chunks";

export type ChildTestBlock = "urdu" | "english" | "maths";
export type ItemKind = "audio" | "photo";

export type BlockTiming = Record<string, unknown>;

export type StoredItem = {
  id: string;
  mimeType: string;
  ext: string;
  startedAt: string;
  elapsedMs: number;
  finished: boolean;
  sessionId?: string;
  block?: ChildTestBlock;
  kind?: ItemKind;
  timing?: BlockTiming;
  blob?: Blob; // photos are stored whole
};

export type PendingItem = { meta: StoredItem; blob: Blob };

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
        if (!db.objectStoreNames.contains(ITEMS)) db.createObjectStore(ITEMS, { keyPath: "id" });
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

function chunkRange(id: string) {
  return IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);
}

export async function createRecording(meta: { id: string; mimeType: string; ext: string; startedAt: string }): Promise<void> {
  const db = await open();
  const tx = db.transaction(ITEMS, "readwrite");
  tx.objectStore(ITEMS).put({ ...meta, elapsedMs: 0, finished: false });
  await done(tx);
}

export async function appendChunk(id: string, seq: number, blob: Blob, elapsedMs: number): Promise<void> {
  const db = await open();
  const tx = db.transaction([ITEMS, CHUNKS], "readwrite");
  tx.objectStore(CHUNKS).put({ id, seq, blob });
  const items = tx.objectStore(ITEMS);
  const meta = await request<StoredItem | undefined>(items.get(id));
  if (meta) items.put({ ...meta, elapsedMs });
  await done(tx);
}

export async function markFinished(id: string, elapsedMs: number): Promise<void> {
  const db = await open();
  const tx = db.transaction(ITEMS, "readwrite");
  const items = tx.objectStore(ITEMS);
  const meta = await request<StoredItem | undefined>(items.get(id));
  if (meta) items.put({ ...meta, elapsedMs, finished: true });
  await done(tx);
}

export async function deleteRecording(id: string): Promise<void> {
  const db = await open();
  const tx = db.transaction([ITEMS, CHUNKS], "readwrite");
  tx.objectStore(ITEMS).delete(id);
  tx.objectStore(CHUNKS).delete(chunkRange(id));
  await done(tx);
}

async function allItems(): Promise<StoredItem[]> {
  const db = await open();
  const tx = db.transaction(ITEMS, "readonly");
  return request<StoredItem[]>(tx.objectStore(ITEMS).getAll());
}

/** Drop any earlier unsent take of the same session/block/kind. */
async function replaceEarlier(keep: string, sessionId: string, block: ChildTestBlock, kind: ItemKind) {
  const earlier = (await allItems()).filter((m) => m.id !== keep && m.sessionId === sessionId && m.block === block && m.kind === kind);
  for (const m of earlier) {
    // eslint-disable-next-line no-await-in-loop
    await deleteRecording(m.id);
  }
}

/** Say which session and block a finished recording is, so it can be sent (and resent). */
export async function tagRecording(
  id: string,
  tag: { sessionId: string; block: ChildTestBlock; kind: "audio"; timing?: BlockTiming },
): Promise<void> {
  const db = await open();
  const tx = db.transaction(ITEMS, "readwrite");
  const items = tx.objectStore(ITEMS);
  const meta = await request<StoredItem | undefined>(items.get(id));
  if (meta) items.put({ ...meta, ...tag });
  await done(tx);
  await replaceEarlier(id, tag.sessionId, tag.block, tag.kind);
}

export async function savePhoto({ id, sessionId, blob }: { id: string; sessionId: string; blob: Blob }): Promise<void> {
  const db = await open();
  const tx = db.transaction(ITEMS, "readwrite");
  const type = blob.type || "image/jpeg";
  tx.objectStore(ITEMS).put({
    id, mimeType: type, ext: type === "image/png" ? ".png" : ".jpg", startedAt: new Date().toISOString(),
    elapsedMs: 0, finished: true, sessionId, block: "maths", kind: "photo", blob,
  } satisfies StoredItem);
  await done(tx);
  await replaceEarlier(id, sessionId, "maths", "photo");
}

async function assemble(meta: StoredItem): Promise<Blob | null> {
  if (meta.blob) return meta.blob;
  const db = await open();
  const tx = db.transaction(CHUNKS, "readonly");
  const chunks = await request<{ seq: number; blob: Blob }[]>(tx.objectStore(CHUNKS).getAll(chunkRange(meta.id)));
  if (!chunks.length) return null;
  return new Blob(chunks.sort((a, b) => a.seq - b.seq).map((c) => c.blob), { type: meta.mimeType });
}

/** Finished, tagged items not yet sent — for one session, or all of them. */
export async function listPending(sessionId?: string): Promise<PendingItem[]> {
  const metas = (await allItems())
    .filter((m) => m.finished && m.sessionId && m.block && m.kind)
    .filter((m) => !sessionId || m.sessionId === sessionId)
    .sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
  const out: PendingItem[] = [];
  for (const meta of metas) {
    // eslint-disable-next-line no-await-in-loop
    const blob = await assemble(meta);
    if (blob) out.push({ meta, blob });
  }
  return out;
}

/** Tests only: wipe the database. */
export async function __resetForTests(): Promise<void> {
  const db = await open();
  const tx = db.transaction([ITEMS, CHUNKS], "readwrite");
  tx.objectStore(ITEMS).clear();
  tx.objectStore(CHUNKS).clear();
  await done(tx);
}
