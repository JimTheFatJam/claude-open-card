// Drives the game's WebView on the emulator through Chrome DevTools Protocol
// (only possible in e2e test builds, which enable WebView debugging).
//   node cdp.mjs eval "<expression>"
//   node cdp.mjs wait "<expression>" <timeoutSeconds>
const [, , cmd, expr, timeoutArg] = process.argv;
const port = process.env.CDP_PORT || '9222';

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((t) => t.type === 'page' && /index\.html/.test(t.url));
      if (page) return page.webSocketDebuggerUrl;
    } catch (_) { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('WebView page not found on CDP');
}

const ws = new WebSocket(await target());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let nextId = 1;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
function evaluate(expression) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  return new Promise((res) => pending.set(id, (msg) => {
    if (msg.result && msg.result.exceptionDetails) res({ error: msg.result.exceptionDetails.text + ' ' + JSON.stringify(msg.result.exceptionDetails.exception || {}) });
    else res({ value: msg.result && msg.result.result ? msg.result.result.value : undefined });
  }));
}

const state = "JSON.stringify(window.OpenCard && OpenCard.updater ? OpenCard.updater.state : null)";
if (cmd === 'eval') {
  const r = await evaluate(expr);
  if (r.error) { console.error('eval error:', r.error); process.exit(1); }
  console.log(typeof r.value === 'string' ? r.value : JSON.stringify(r.value));
} else if (cmd === 'wait') {
  const until = Date.now() + Number(timeoutArg || 60) * 1000;
  let last;
  while (Date.now() < until) {
    const r = await evaluate(`!!(${expr})`);
    if (r.value === true) { console.log('ok:', expr); process.exit(0); }
    const s = (await evaluate(state)).value;
    if (s !== last) { console.log('  updater state:', s); last = s; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error('TIMEOUT waiting for:', expr, '\nlast state:', last);
  process.exit(1);
}
ws.close();
process.exit(0);
