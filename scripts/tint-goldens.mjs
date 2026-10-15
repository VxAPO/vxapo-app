// Step0 金样：固定场景截图集（重构前后语义对照的裁判）
const CDP = "http://127.0.0.1:9226";
const fs = await import("node:fs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = "D:/APO_Project/VxAPO/vxapo-app/scripts/goldens";
fs.mkdirSync(OUT, { recursive: true });
const targets = await (await fetch(`${CDP}/json/list`)).json();
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
});
await new Promise((r) => ws.addEventListener("open", r));
const send = (method, params = {}) => {
  const i = ++id; ws.send(JSON.stringify({ id: i, method, params }));
  return new Promise((r) => pend.set(i, r));
};
const ev = async (x) => {
  const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true });
  return r.result.value;
};
await send("Page.enable");
await send("Page.navigate", { url: "http://localhost:1420/?golden=" + Date.now() });
let ready = false;
for (let i = 0; i < 40 && !ready; i++) {
  await sleep(1500);
  ready = await ev(`document.body?.innerText?.includes("参数视图") && !!window.__vxTint && [...document.querySelectorAll("button")].some(b => /EDIFIER/.test(b.textContent || ""))`).catch(() => false);
}
for (let i = 0; i < 8; i++) {
  await ev(`([...document.querySelectorAll("button")].find(b => /EDIFIER/.test(b.textContent || "")) || {}).click?.()`);
  await sleep(300);
  await ev(`([...document.querySelectorAll("button")].find(b => /参数视图/.test(b.textContent || "")) || {}).click?.()`);
  await sleep(1100);
  const ok = await ev(`(() => { const e = document.querySelector('.tuning-scroll'); return !!e && e.scrollHeight > e.clientHeight + 100; })()`);
  if (ok) break;
}
console.log("场景:", await ev(`JSON.stringify({scroll: (()=>{const e=document.querySelector('.tuning-scroll');return e.scrollHeight-e.clientHeight})(), cards: document.querySelectorAll('[data-dnd-id]').length})`));

async function shot(name) {
  const s = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(s.data, "base64"));
  console.log("saved", name);
}

for (const pos of [0, 160, 320, 470]) {
  await ev(`(() => { const e = document.querySelector('.tuning-scroll'); if (e) e.scrollTop = ${pos}; return 1; })()`);
  await sleep(1300); // 配色收敛
  await shot(`tint-scroll-${pos}`);
}
// 选中态（工具栏 + 选中描边）
await ev(`(() => {
  const c = [...document.querySelectorAll('[data-dnd-id]')].find((e) => {
    const r = e.getBoundingClientRect();
    return r.top > 120 && r.bottom < window.innerHeight - 200;
  });
  if (c) { c.click(); return 'clicked'; }
  return 'none';
})()`);
await sleep(1300);
await shot("tint-selected");
// 尝试切暗色主题（设置弹窗）——失败则记为 light-only
const theme = await ev(`(async () => {
  const btn = [...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('设置'));
  if (!btn) return 'no-settings-btn';
  btn.click();
  await new Promise(r => setTimeout(r, 600));
  const dark = [...document.querySelectorAll('button, [role="radio"], [role="option"]')]
    .find(b => (b.textContent || '').trim() === '深色');
  if (!dark) return 'no-dark-option';
  dark.click();
  await new Promise(r => setTimeout(r, 900));
  const close = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').includes('关闭'));
  if (close) close.click();
  await new Promise(r => setTimeout(r, 500));
  return 'dark';
})()`);
console.log("theme:", theme);
if (theme === "dark") {
  await ev(`(() => { const e = document.querySelector('.tuning-scroll'); if (e) e.scrollTop = 160; return 1; })()`);
  await sleep(1300);
  await shot("tint-dark-scroll-160");
  await ev(`(() => { const e = document.querySelector('.tuning-scroll'); if (e) e.scrollTop = 400; return 1; })()`);
  await sleep(1300);
  await shot("tint-dark-scroll-400");
}
console.log("done →", OUT);
ws.close();
