// Minimal Workers-runtime stand-ins: WebSocketPair, 101 responses, Durable Object stubs.
const NativeResponse = globalThis.Response;
globalThis.Response = class extends NativeResponse {
  constructor(body, init = {}) {
    const ws = init.webSocket;
    const status = init.status;
    super(body, status === 101 ? { ...init, status: 200 } : init);
    if (status === 101) Object.defineProperty(this, 'status', { value: 101 });
    if (ws) this.webSocket = ws;
  }
  static redirect(url, status = 302) { return new globalThis.Response(null, { status, headers: { location: url } }); }
  static json(d, i) { return NativeResponse.json(d, i); }
};

class Socket extends EventTarget {
  constructor() { super(); this.peer = null; this.readyState = 0; this.accepted = false; this.queue = []; }
  accept() { this.accepted = true; this.readyState = 1; for (const m of this.queue.splice(0)) this._deliver(m); }
  send(data) {
    if (this.readyState !== 1) return;
    const copy = typeof data === 'string' ? data : new Uint8Array(data).slice();
    this.peer._receive(copy);
  }
  _receive(data) { if (!this.accepted) this.queue.push(data); else this._deliver(data); }
  _deliver(data) { const e = new Event('message'); e.data = data; this.dispatchEvent(e); }
  close(code = 1000) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    const e = new Event('close'); e.code = code; this.dispatchEvent(e);
    if (this.peer && this.peer.readyState !== 3) this.peer.close(code);
  }
}
globalThis.WebSocketPair = class {
  constructor() { const a = new Socket(); const b = new Socket(); a.peer = b; b.peer = a; this[0] = a; this[1] = b; }
};

export function memoryStorage() {
  const m = new Map();
  return {
    async get(k) { return m.has(k) ? structuredClone(m.get(k)) : undefined; },
    async put(k, v) { if (typeof k === 'object') { for (const [kk, vv] of Object.entries(k)) m.set(kk, structuredClone(vv)); } else m.set(k, structuredClone(v)); },
    _map: m,
  };
}

/** A namespace whose stub copies arguments/results like real RPC does. */
export function doNamespace(Klass, env) {
  const storage = memoryStorage();
  const ctx = {
    storage,
    _gate: Promise.resolve(),
    blockConcurrencyWhile(fn) { this._gate = Promise.resolve().then(fn); return this._gate; },
  };
  const inst = new Klass(ctx, env);
  const stub = new Proxy({}, { get: (_, name) => async (...args) => { await ctx._gate; return structuredClone(await inst[name](...structuredClone(args))); } });
  return { idFromName: () => 'main', get: () => stub, _inst: inst, _storage: storage };
}
