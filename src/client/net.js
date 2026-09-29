// Thin WebSocket wrapper. Handlers are keyed by the server's message type ("welcome", "snap", ...).
// Server messages are treated as untrusted input too: only known handler names are dispatched.

export class Network {
  #handlers;
  #ws = null;

  constructor(handlers) {
    this.#handlers = handlers;
  }

  connect(name) {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    this.#ws = new WebSocket(`${proto}://${window.location.host}/ws`);
    this.#ws.onopen = () => this.send({ t: 'join', name });
    this.#ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg && typeof msg.t === 'string' && Object.hasOwn(this.#handlers, msg.t)) this.#handlers[msg.t](msg);
    };
    this.#ws.onclose = () => this.#handlers.close?.();
  }

  send(obj) {
    if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(JSON.stringify(obj));
  }
}
