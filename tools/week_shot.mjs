/* tools/week_shot.mjs —— 首页周条「选中 / 今天 / 无课」的 computed 与截图
   跑法：node tools/week_shot.mjs [pro|classic] [selIdx]
   输出：tools/shots-week/<theme>-sel<N>.png + 七格的 computed 摘要 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const THEME = process.argv[2] || 'pro';
const SEL = process.argv[3] === undefined ? 5 : Number(process.argv[3]);
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const OUT = path.join(root, 'tools', 'shots-week');
fs.mkdirSync(OUT, { recursive: true });

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = path.join(os.tmpdir(), 'edge-week-' + Date.now());
const dbgPort = 9900 + Math.floor(Math.random() * 80);
const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--mute-audio', '--hide-scrollbars',
  '--window-size=430,932', '--remote-debugging-port=' + dbgPort,
  '--user-data-dir=' + profile, 'about:blank'
], { stdio: 'ignore', detached: true });
child.unref();
let ws;
const cleanup = () => {
  try { ws && ws.close(); } catch (e) {}
  try { server.close(); } catch (e) {}
  try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {}
};
process.on('exit', cleanup);

let msgId = 0, sessionId = null;
const pending = new Map();
function send(method, params = {}, useSession = true) {
  const id = ++msgId;
  const msg = { id, method, params };
  if (useSession && sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
  return r.result.value;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const v = await fn(); if (v) return v; } catch (e) {}
    await sleep(150);
  }
  throw new Error('timeout');
}

try {
  const ver = await waitFor(async () => {
    try { const r = await fetch('http://127.0.0.1:' + dbgPort + '/json/version'); return await r.json(); } catch (e) { return null; }
  });
  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    }
  };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, false);
  sessionId = (await send('Target.attachToTarget', { targetId, flatten: true }, false)).sessionId;
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: 'http://127.0.0.1:' + port + '/index.html' });
  await waitFor(async () => (await evaluate('document.readyState')) === 'complete');
  await evaluate("S.onboarded = true; try{ save(); }catch(e){}; var _o=document.getElementById('onboard'); if(_o)_o.classList.remove('show');");
  await evaluate("try{ S.uiTheme='" + THEME + "'; S.uiGlass='clear'; applyLook(); }catch(e){}");
  await sleep(400);
  await evaluate("go('home'); pickDay(" + SEL + ");");
  await sleep(500);

  const info = await evaluate(`(function(){
    return [].map.call(document.querySelectorAll('#week .day'), function(d, i){
      var c = getComputedStyle(d);
      return {
        i: i, cls: d.className.trim(),
        bg: c.backgroundImage !== 'none' ? ('img:' + c.backgroundImage.slice(0, 46)) : c.backgroundColor,
        border: c.borderTopColor,
        shadow: c.boxShadow.slice(0, 54),
        blur: c.backdropFilter || c.webkitBackdropFilter || 'none'
      };
    });
  })()`);
  console.log('皮肤 ' + THEME + ' · 选中 ' + SEL + '（周' + '一二三四五六日'[SEL] + '）与今天=' +
    await evaluate('todayI'));
  info.forEach(x => {
    console.log('  [' + x.i + '] ' + x.cls.padEnd(22)
      + ' bg=' + x.bg + ' | 边=' + x.border + ' | 阴影=' + x.shadow + ' | blur=' + x.blur);
  });

  /* 到底哪几条规则命中了第 SEL 格、谁最后写 background */
  const rules = await evaluate(`(function(){
    var el = document.querySelectorAll('#week .day')[${SEL}];
    var hits = [];
    for (var si = 0; si < document.styleSheets.length; si++){
      var sh = document.styleSheets[si], rs;
      try { rs = sh.cssRules; } catch(e){ continue; }
      for (var i = 0; i < rs.length; i++){
        var r = rs[i];
        if (!r.selectorText) continue;
        try{ if (el.matches(r.selectorText) && /background|border|box-shadow/.test(r.style.cssText)) hits.push(r.selectorText + ' { ' + r.style.cssText.slice(0,110) + ' }'); }catch(e){}
      }
    }
    return { n: hits.length, hits: hits.slice(-8) };
  })()`);
  console.log('');
  console.log('命中第 ' + SEL + ' 格且涉及 background/border/shadow 的规则（末尾 8 条 = 最后生效的）：');
  rules.hits.forEach(h => console.log('  · ' + h));

  const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 120, width: 430, height: 220, scale: 2 } });
  const file = path.join(OUT, THEME + '-sel' + SEL + '.png');
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  console.log('截图：' + path.relative(root, file));
} catch (e) {
  console.error('失败：' + e.message);
  process.exitCode = 2;
} finally {
  cleanup();
}
