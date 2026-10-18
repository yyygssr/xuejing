/* tools/press_probe.mjs —— 「我的」页按压反馈的数值验证
   要回答三件事：
     ① 按下时**没有任何遮罩**（卡片/行的 box-shadow 里没有 inset 999px，边框色不变）
     ② 仍然**有缩放**（.press-on 的 scale 生效，或整卡 transform）
     ③ 别的页面（笔记）保持原样（遮罩还在）—— 不能把全局行为改掉
   跑法：node tools/press_probe.mjs */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = path.join(os.tmpdir(), 'edge-press-' + Date.now());
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
const SHOT_DIR = path.join(root, 'tools', 'shots-press');
fs.mkdirSync(SHOT_DIR, { recursive: true });
async function shot(name){
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(r.data, 'base64'));
}
async function waitFor(fn, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const v = await fn(); if (v) return v; } catch (e) {}
    await sleep(150);
  }
  throw new Error('timeout');
}

/* 按下指定 li，返回按下后的 computed 值 */
const PRESS = (sel, idx) => `(function(){
  document.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:51}));
  var li = document.querySelectorAll('${sel}')[${idx}];
  if(!li) return {err:'找不到 ${sel}[${idx}]'};
  var card = li.closest('.list');
  var r = li.getBoundingClientRect();
  var ev = {bubbles:true, cancelable:true, clientX:r.left+30, clientY:r.top+10, pointerId:51, pointerType:'touch', isPrimary:true};
  li.dispatchEvent(new PointerEvent('pointerdown', ev));
  var lc = getComputedStyle(li), cc = card ? getComputedStyle(card) : null;
  var out = {
    clsLi: li.className,
    clsCard: card ? card.className : '(无卡片)',
    liScale: lc.scale,
    liFilter: lc.filter,
    liShadow: lc.boxShadow.slice(0, 70),
    cardTransform: cc ? cc.transform : '-',
    cardShadow: cc ? cc.boxShadow.slice(0, 90) : '-',
    cardBorder: cc ? cc.borderTopColor : '-'
  };
  li.dispatchEvent(new PointerEvent('pointerup', ev));
  return out;
})()`;

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
  await evaluate("S.onboarded = true; try{ save(); }catch(e){}; var _ob = document.getElementById('onboard'); if(_ob) _ob.classList.remove('show');");
  await sleep(600);

  /* 我的页：找出所有卡片，挑「单行卡」和「多行卡」各一个 */
  await evaluate("go('me')");
  await sleep(600);
  const cards = await evaluate(`(function(){
    var out = [];
    [].forEach.call(document.querySelectorAll('#page-me .list'), function(l, i){
      var tap = l.querySelectorAll('.li.tap').length;
      var t = l.querySelector('.li.tap .tx b');
      out.push({ i:i, taps:tap, title: t ? t.textContent.trim() : l.textContent.trim().slice(0,16) });
    });
    return out;
  })()`);
  console.log('我的页卡片清单：');
  cards.forEach(c => console.log('  [' + c.i + '] taps=' + c.taps + ' · ' + c.title));

  const single = cards.find(c => c.taps === 1);
  const multi = cards.find(c => c.taps >= 2);
  console.log('\n用例：单行卡 [' + (single && single.i) + '] ' + (single && single.title)
    + ' · 多行卡 [' + (multi && multi.i) + '] ' + (multi && multi.title));

  let ok = true;
  if (single) {
    await evaluate(`(function(){
      var card = document.querySelectorAll('#page-me .list')[${single.i}];
      var li = card.querySelector('.li.tap');
      var rr = li.getBoundingClientRect();
      var ev = {bubbles:true, cancelable:true, clientX:rr.left+30, clientY:rr.top+10, pointerId:52, pointerType:'touch', isPrimary:true};
      li.dispatchEvent(new PointerEvent('pointerdown', ev));
      return true;
    })()`);
    await sleep(220);   /* 等 scale 的过渡跑完（--m-dur-tap 量级），否则读到的是起点 1 */
    await shot('me-single-pressed.png');
    const r = await evaluate(`(function(){
      var card = document.querySelectorAll('#page-me .list')[${single.i}];
      var li = card.querySelector('.li.tap');
      var lc = getComputedStyle(li), cc = getComputedStyle(card);
      var out = {clsLi:li.className, clsCard:card.className, liScale:lc.scale, liFilter:lc.filter,
        liShadow:lc.boxShadow.slice(0,60), cardTransform:cc.transform, cardShadow:cc.boxShadow.slice(0,80),
        cardBorder:cc.borderTopColor};
      li.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, pointerId:52}));
      return out;
    })()`);
    console.log('\n── 我的页 · 单行卡按下');
    console.log('  类：li=[' + r.clsLi + '] card=[' + r.clsCard + ']');
    console.log('  缩放 li.scale=' + r.liScale + ' · 卡片 transform=' + r.cardTransform);
    console.log('  亮度 filter=' + r.liFilter);
    console.log('  行阴影 ' + r.liShadow);
    console.log('  卡片阴影 ' + r.cardShadow);
    console.log('  卡片边框 ' + r.cardBorder);
    const mask = /999px/.test(r.liShadow) || /999px/.test(r.cardShadow) || /li-press/.test(r.clsLi + r.clsCard);
    const zoom = parseFloat(r.liScale) < 0.99 || (r.cardTransform !== 'none' && /matrix/.test(r.cardTransform));
    const dim = r.liFilter !== 'none';
    console.log('  判定：遮罩=' + (mask ? '有 ✗' : '无 ✓') + ' · 缩放=' + (zoom ? '有 ✓' : '无 ✗') + ' · 压暗=' + (dim ? '有 ✗' : '无 ✓'));
    if (mask || !zoom || dim) ok = false;
  }
  if (multi) {
    await evaluate(`(function(){
      var card = document.querySelectorAll('#page-me .list')[${multi.i}];
      var li = card.querySelectorAll('.li.tap')[1];
      var rr = li.getBoundingClientRect();
      var ev = {bubbles:true, cancelable:true, clientX:rr.left+30, clientY:rr.top+10, pointerId:53, pointerType:'touch', isPrimary:true};
      li.dispatchEvent(new PointerEvent('pointerdown', ev));
      return true;
    })()`);
    await sleep(220);
    await shot('me-multi-pressed.png');
    const r = await evaluate(`(function(){
      var card = document.querySelectorAll('#page-me .list')[${multi.i}];
      var li = card.querySelectorAll('.li.tap')[1];
      var lc = getComputedStyle(li), cc = getComputedStyle(card);
      var out = {clsLi:li.className, clsCard:card.className, liScale:lc.scale, liFilter:lc.filter,
        liShadow:lc.boxShadow.slice(0,60), cardShadow:cc.boxShadow.slice(0,80), cardBorder:cc.borderTopColor};
      li.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, pointerId:53}));
      return out;
    })()`);
    console.log('\n── 我的页 · 多行卡第 2 行按下');
    console.log('  类：li=[' + r.clsLi + '] card=[' + r.clsCard + ']');
    console.log('  缩放 li.scale=' + r.liScale + ' · 亮度 filter=' + r.liFilter);
    console.log('  行阴影 ' + r.liShadow);
    const mask = /999px/.test(r.liShadow) || /999px/.test(r.cardShadow) || /li-press/.test(r.clsLi + r.clsCard);
    const zoom = parseFloat(r.liScale) < 0.99;
    const dim = r.liFilter !== 'none';
    console.log('  判定：遮罩=' + (mask ? '有 ✗' : '无 ✓') + ' · 缩放=' + (zoom ? '有 ✓' : '无 ✗') + ' · 压暗=' + (dim ? '有 ✗' : '无 ✓'));
    if (mask || !zoom || dim) ok = false;
  }

  /* 反证：笔记页/别处的遮罩必须还在 */
  await evaluate("closeView('notes'); go('me'); openView('about');");
  await sleep(700);
  const other = await evaluate(`(function(){
    var li = document.querySelector('#view-about .li.tap');
    if(!li) return {skip:true};
    var card = li.closest('.list');
    var r = li.getBoundingClientRect();
    var ev = {bubbles:true, cancelable:true, clientX:r.left+20, clientY:r.top+8, pointerId:54, pointerType:'touch', isPrimary:true};
    li.dispatchEvent(new PointerEvent('pointerdown', ev));
    var lc = getComputedStyle(li), cc = card ? getComputedStyle(card) : null;
    var out = {clsLi:li.className, clsCard:card?card.className:'', liShadow:lc.boxShadow.slice(0,60),
      cardShadow:cc?cc.boxShadow.slice(0,80):'', cardTransform:cc?cc.transform:'-'};
    li.dispatchEvent(new PointerEvent('pointerup', ev));
    return out;
  })()`);
  console.log('\n── 反证 · 笔记页（遮罩应保留）');
  console.log('  类：li=[' + other.clsLi + '] card=[' + (other.clsCard || '') + ']');
  console.log('  行阴影 ' + (other.liShadow || '-'));
  console.log('  卡片 transform=' + (other.cardTransform || '-'));
  const keep = /li-press/.test((other.clsLi || '') + (other.clsCard || '')) || /999px/.test(other.liShadow || '') || /999px/.test(other.cardShadow || '');
  console.log('  判定：遮罩还在=' + (keep ? '✓' : '✗'));
  if (!keep) ok = false;

  console.log('\n=== ' + (ok ? '全部符合预期' : '有不符合项，见上') + ' ===');
  process.exitCode = ok ? 0 : 1;
} catch (e) {
  console.error('探测失败：' + e.message);
  process.exitCode = 2;
} finally {
  cleanup();
}
