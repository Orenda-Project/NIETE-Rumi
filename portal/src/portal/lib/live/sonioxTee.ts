// bd-v0toag.31 — live moves: the second reader of each recorded chunk.
//
//  · each chunk the recorder saves is also sent to a Soniox real-time stream (protocol as read-aloud
//    live, dashboard/public/wq/wq-read-live.js): the temporary key travels in the first message, never the URL;
//  · it ONLY reads. A drop, a stalled uplink or a refused key never holds a chunk up or touches the
//    recording — `push` cannot throw;
//  · chunk 0 carries the WebM header, so a reconnect (fresh key, backoff 5 s / 15 s / 30 s / then 60 s)
//    sends it first and then the live chunks; what fell in the gap is not replayed;
//  · the window is cut by when tokens ARRIVED: a reconnected stream restarts Soniox's own clock at 0.

export type TeeKey = { ok: boolean; api_key?: string; ws?: string; model?: string; reason?: string };
export type TeeStatus = 'live' | 'paused' | 'off';

type Options = {
  getKey: () => Promise<TeeKey>;
  lang: 'en' | 'ur';
  WebSocketImpl?: typeof WebSocket;
  now?: () => number;
};

type Token = { text?: string; is_final?: boolean; start_ms?: number };

export type SonioxTee = {
  push: (blob: Blob, seq: number) => void;
  windowText: (ms?: number) => string;
  status: () => TeeStatus;
  stats: () => { drops: number; bytesSent: number };
  close: () => void;
};

const BACKOFF_MS = [5_000, 15_000, 30_000, 60_000];
const BACKLOG_BYTES = 64 * 1024;
const WINDOW_MS = 180_000;
const KEEP_MS = 10 * 60_000;

export function createSonioxTee(opts: Options): SonioxTee {
  const WS = opts.WebSocketImpl || WebSocket;
  const now = opts.now || (() => Date.now());
  const hints = opts.lang === 'en' ? ['en', 'ur'] : ['ur', 'en'];
  let state: TeeStatus = 'live';
  let sock: WebSocket | null = null;
  let open = false;
  let header: Blob | null = null;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let drops = 0;
  let bytesSent = 0;
  let finals: Array<{ text: string; start_ms: number; at: number }> = [];
  let pending = '';

  const send = (b: Blob) => {
    sock!.send(b);
    bytesSent += b.size;
  };

  const retry = () => {
    if (state === 'off' || timer) return;
    const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    attempt += 1;
    timer = setTimeout(() => { timer = null; void connect(); }, wait);
  };

  const dropped = (s: WebSocket) => {
    if (s !== sock || state === 'off') return;
    try { s.close(); } catch { /* already closed */ }
    sock = null;
    open = false;
    pending = '';
    if (state === 'live') drops += 1;
    state = 'paused';
    retry();
  };

  const heard = (tokens: Token[]) => {
    let nf = '';
    const at = now();
    for (const t of tokens) {
      const text = String((t && t.text) || '');
      if (text === '<fin>' || text === '<end>') continue;
      if (t.is_final) finals.push({ text, start_ms: Number(t.start_ms) || 0, at });
      else nf += text;
    }
    pending = nf;
    finals = finals.filter((f) => at - f.at <= KEEP_MS);
  };

  async function connect(): Promise<void> {
    let key: TeeKey;
    try { key = await opts.getKey(); } catch { key = { ok: false }; }
    if (state === 'off') return;
    if (!key || !key.ok || !key.ws) {
      // Over the 5-stream cap, or the switch is off: no ticks for the rest of this lesson.
      if (key && (key.reason === 'cap' || key.reason === 'off')) { state = 'off'; return; }
      state = 'paused';
      retry();
      return;
    }
    let s: WebSocket;
    try { s = new WS(key.ws); } catch { state = 'paused'; retry(); return; }
    sock = s;
    s.onopen = () => {
      if (s !== sock || state === 'off') return;
      try {
        s.send(JSON.stringify({ api_key: key.api_key, model: key.model, audio_format: 'auto', language_hints: hints }));
        if (header) send(header);
      } catch { dropped(s); return; }
      open = true;
      attempt = 0;
      state = 'live';
    };
    s.onmessage = (e: MessageEvent) => {
      if (s !== sock) return;
      let m: { tokens?: Token[]; error_code?: unknown } | null = null;
      try { m = JSON.parse(String(e.data)); } catch { return; }
      if (!m) return;
      if (m.error_code) { dropped(s); return; }
      if (Array.isArray(m.tokens)) heard(m.tokens);
    };
    s.onerror = () => dropped(s);
    s.onclose = () => dropped(s);
  }

  void connect();

  return {
    push(blob, seq) {
      try {
        if (!blob || state === 'off') return;
        if (seq === 0) header = blob;
        if (!open || !sock) return;
        if ((sock.bufferedAmount || 0) > BACKLOG_BYTES) return;
        send(blob);
      } catch {
        if (sock) dropped(sock);
      }
    },
    windowText(ms = WINDOW_MS) {
      const from = now() - ms;
      return finals.filter((f) => f.at >= from).map((f) => f.text).join('') + pending;
    },
    status: () => state,
    stats: () => ({ drops, bytesSent }),
    close() {
      state = 'off';
      if (timer) { clearTimeout(timer); timer = null; }
      const s = sock;
      sock = null;
      open = false;
      if (s) {
        try { s.send(''); } catch { /* already gone */ }
        try { s.close(); } catch { /* already closed */ }
      }
    },
  };
}
