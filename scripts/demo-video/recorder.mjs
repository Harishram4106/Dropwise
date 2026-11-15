// Drives a Chrome window over the DevTools protocol and records it frame by frame.
// Frames come from Page.startScreencast, so the video is the page itself: no desktop, no other windows.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One browser connection. Commands go to a page session; events are dispatched by method. */
export async function connect(port) {
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((ok, fail) => {
    ws.onopen = ok;
    ws.onerror = fail;
  });
  let next = 1;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (msg) => {
    const data = JSON.parse(typeof msg.data === "string" ? msg.data : msg.data.toString());
    if (data.id && pending.has(data.id)) {
      const { ok, fail } = pending.get(data.id);
      pending.delete(data.id);
      data.error ? fail(new Error(`${data.error.message} ${data.error.data ?? ""}`)) : ok(data.result);
    } else if (data.method) {
      for (const l of listeners) l(data);
    }
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((ok, fail) => {
      const id = next++;
      pending.set(id, { ok, fail });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
    });
  return { send, on: (fn) => listeners.push(fn), close: () => ws.close() };
}

// A cursor and click ripple drawn into the page, so viewers can follow what's clicked.
const OVERLAY = `(() => {
  if (window.__rec) return;
  const make = () => {
    if (document.getElementById("__rec_cursor")) return;
    const c = document.createElement("div");
    c.id = "__rec_cursor";
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 10-7 1.5L8.5 21z" fill="#1a2fd6" stroke="white" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: "fixed", left: "0px", top: "0px", zIndex: 2147483647, pointerEvents: "none", transition: "transform 0.7s cubic-bezier(.22,1,.36,1)", transform: "translate(" + (window.__recX ?? 800) + "px," + (window.__recY ?? 450) + "px)" });
    document.documentElement.appendChild(c);
  };
  window.__rec = {
    move(x, y, ms = 700) {
      make();
      window.__recX = x; window.__recY = y;
      const c = document.getElementById("__rec_cursor");
      c.style.transition = "transform " + ms + "ms cubic-bezier(.22,1,.36,1)";
      c.style.transform = "translate(" + (x - 3) + "px," + (y - 2) + "px)";
    },
    ripple(x, y) {
      const r = document.createElement("div");
      Object.assign(r.style, { position: "fixed", left: x - 18 + "px", top: y - 18 + "px", width: "36px", height: "36px", borderRadius: "50%", border: "3px solid #4b63ff", zIndex: 2147483646, pointerEvents: "none", transition: "all 0.5s ease-out", opacity: "0.9" });
      document.documentElement.appendChild(r);
      requestAnimationFrame(() => Object.assign(r.style, { transform: "scale(1.8)", opacity: "0" }));
      setTimeout(() => r.remove(), 600);
    },
  };
  if (document.readyState !== "loading") make(); else document.addEventListener("DOMContentLoaded", make);
})();`;

/**
 * A recording of one Chrome window. Every frame is saved with the time it arrived; `cuts` marks stretches to shorten
 * (waiting for a model, a page load), and `timeline` turns it all into the final video's times.
 */
export async function recorder({ port, out, label, origin = "http://localhost:3000", width = 1600, height = 900, scale = 1.2 }) {
  const cdp = await connect(port);
  mkdirSync(out, { recursive: true });
  const frames = [];
  let frameNo = 0;
  let recording = false;

  const targets = (await cdp.send("Target.getTargets")).targetInfos.filter((t) => t.type === "page");
  const target = targets.find((t) => t.url.startsWith(origin)) ?? targets[0];
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);

  cdp.on((e) => {
    if (e.method === "Page.screencastFrame" && e.sessionId === sessionId) {
      cdp.send("Page.screencastFrameAck", { sessionId: e.params.sessionId }, sessionId).catch(() => {});
      if (!recording) return;
      const file = join(out, `${label}-${String(frameNo++).padStart(6, "0")}.jpg`);
      writeFileSync(file, Buffer.from(e.params.data, "base64"));
      frames.push({ at: Date.now(), file, kind: "main" });
    }
  });

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: OVERLAY });
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
  // Chrome stops drawing a window that other apps cover. Bringing it to the front, and telling the page it has focus, keeps it rendering.
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await send("Page.bringToFront");
  await send("Page.startScreencast", { format: "jpeg", quality: 80, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 2 });

  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`${expression.slice(0, 80)}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  const overlay = () => evaluate(OVERLAY);

  /** Finds a visible element by a CSS selector or by its text (buttons and links first), scrolls it into view, returns its centre. */
  const locate = async (what, { exact = false, scroll = true } = {}) => {
    const js = `(async () => {
      const what = ${JSON.stringify(what)}, exact = ${exact};
      const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
      let el = null;
      if (/^[#.\\[]|^[a-z-]+[#.\\[]|^(textarea|input|form)/.test(what)) el = [...document.querySelectorAll(what)].find(visible);
      if (!el) {
        const text = (e) => (e.innerText || e.getAttribute("aria-label") || "").trim().replace(/\\s+/g, " ");
        const pool = [...document.querySelectorAll("button, a, [role=button], [role=radio], label, h1, h2, h3, li, p, span, div")].filter(visible);
        el = pool.find((e) => (exact ? text(e) === what : text(e).startsWith(what)) && (e.matches("button, a, [role=button], [role=radio]") || !e.querySelector("button, a")))
          ?? pool.find((e) => text(e).includes(what) && e.matches("button, a, [role=button], [role=radio]"))
          ?? pool.filter((e) => text(e).includes(what)).sort((a, b) => text(a).length - text(b).length)[0];
      }
      if (!el) return null;
      if (${scroll}) { el.scrollIntoView({ block: "center", behavior: "smooth" }); await new Promise((r) => setTimeout(r, 650)); }
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`;
    return evaluate(js);
  };

  const api = {
    send,
    evaluate,
    frames,
    cuts: [],
    async front() {
      await send("Page.bringToFront");
      await sleep(600);
    },
    async start() {
      await api.front();
      recording = true;
    },
    stop() {
      recording = false;
    },
    async nav(path, settle = 2800) {
      await send("Page.navigate", { url: `${origin}${path}` });
      await sleep(settle);
      await overlay();
    },
    async moveTo(what, opts) {
      const p = await api.waitLocate(what, opts);
      await evaluate(`window.__rec.move(${p.x}, ${p.y})`);
      await sleep(750);
      return p;
    },
    async waitLocate(what, { timeout = 15000, ...opts } = {}) {
      const until = Date.now() + timeout;
      for (;;) {
        await overlay();
        const p = await locate(what, opts);
        if (p) return p;
        if (Date.now() > until) throw new Error(`Couldn't find "${what}" on ${await evaluate("location.pathname")}`);
        await sleep(400);
      }
    },
    /** Moves the cursor to the element, then a real (trusted) click. */
    async click(what, opts) {
      const p = await api.moveTo(what, opts);
      await evaluate(`window.__rec.ripple(${p.x}, ${p.y})`);
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", clickCount: 1 });
      await sleep(500);
    },
    async type(what, text, perChar = 40) {
      await api.click(what);
      for (const ch of text) {
        await send("Input.insertText", { text: ch });
        await sleep(perChar);
      }
      await sleep(300);
    },
    async press(key) {
      const code = { Enter: 13, Escape: 27 }[key];
      await send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: code, text: key === "Enter" ? "\r" : undefined });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: code });
    },
    async scrollTo(what) {
      await api.waitLocate(what);
      await sleep(500);
    },
    async scrollBy(y, ms = 1400) {
      await evaluate(`window.scrollBy({ top: ${y}, behavior: "smooth" })`);
      await sleep(ms);
    },
    async scrollTop(ms = 900) {
      await evaluate(`window.scrollTo({ top: 0, behavior: "smooth" })`);
      await sleep(ms);
    },
    hold: (seconds) => sleep(seconds * 1000),
    /** Waits for a condition, and marks the wait to be shortened in the video. */
    async waitFor(expression, { timeout = 120000, keep = 0.8, label: why = expression } = {}) {
      const from = Date.now();
      for (;;) {
        if (await evaluate(`(() => { try { return !!(${expression}); } catch { return false; } })()`).catch(() => false)) break;
        if (Date.now() - from > timeout) throw new Error(`Timed out waiting for: ${why}`);
        await sleep(500);
      }
      const to = Date.now();
      if (to - from > keep * 1000) api.cuts.push({ from: from + keep * 500, to: to - keep * 500 });
    },
    // Case-insensitive: the page uppercases many labels with CSS, and innerText follows that.
    text: (s) => `document.body.innerText.toLowerCase().includes(${JSON.stringify(s.toLowerCase())})`,
    close: () => cdp.close(),
  };
  return api;
}

/**
 * The final video's frames: the recording's frames with marked waits shortened. Returns lines for the encoder
 * and the times of the markers (scenes and spoken lines) in the final video.
 */
export function timeline({ frames, cuts, start, end, markers = [] }) {
  const inCut = (t) => cuts.find((c) => t > c.from && t < c.to);
  const outTime = (t) => {
    let removed = 0;
    for (const c of cuts) if (t > c.from) removed += Math.min(t, c.to) - c.from;
    return (t - start - removed) / 1000;
  };
  const lines = [];
  for (const f of frames) {
    if (f.at < start || f.at > end || inCut(f.at)) continue;
    lines.push({ t: Math.max(outTime(f.at), 0), file: f.file });
  }
  lines.sort((a, b) => a.t - b.t);
  return { lines, marks: markers.map((m) => ({ ...m, t: Math.max(outTime(m.at), 0) })), duration: outTime(end) };
}
