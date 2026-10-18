/* tools/motion_shot.mjs —— 把转场暂停在中间帧截图
   截图只能看"某一刻长什么样"，所以这里用 WAAPI 的 pause + currentTime
   把动画钉在指定毫秒，而不是靠 sleep 赌时机。
   输出：tools/motion_shots/*.png */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(root, 'tools', 'motion_shots');
fs.mkdirSync(OUT, { recursive: true });

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = path.join(os.tmpdir(), 'edge-mshot-' + Date.now());
const dbgPort = 9800 + Math.floor(Math.random() * 80);
const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--mute-audio', '--hide-scrollbars',
  '--window-size=430,932', '--force-device-scale-factor=2',
  '--remote-debugging-port=' + dbgPort, '--user-data-dir=' + profile, 'about:blank'
], { stdio: 'ignore', detached: true });
child.unref();

let ws, msgId = 0, sessionId = null;
const pending = new Map();
const cleanup = () => {
  try { ws && ws.close(); } catch (e) {}
  try { server.close(); } catch (e) {}
  try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {}
};
process.on('exit', cleanup);

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
  while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch (e) {} await sleep(150); }
  throw new Error('timeout');
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  console.log('  ' + name);
}
/* 把元素上的所有动画钉在 t 毫秒 */
const PIN = `
window.__pin = function(id, t){
  var el = document.getElementById(id);
  var as = el.getAnimations({subtree:true});
  as.forEach(function(a){ a.pause(); a.currentTime = t; });
  return as.length;
};`;

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
  /* 首次启动会弹引导，挡住主页面也会污染采样 —— 先按"已完成引导"跳过 */
  await evaluate("S.onboarded = true; try{ save(); }catch(e){}; var _ob = document.getElementById('onboard'); if(_ob) _ob.classList.remove('show');");
  await sleep(800);
  await evaluate(PIN);

  await evaluate("setUiPro(true)");
  await sleep(400);
  await shot('p1-home.png');

  /* 切页：钉在 0 / 90 / 200 / 320 */
  for (const t of [0, 90, 200, 320]) {
    await evaluate("go('home')");
    await sleep(450);
    const n = await evaluate(`(function(){ go('me'); return window.__pin('page-me', ${t}); })()`);
    await shot(`p2-tab-${t}ms.png`);
  }

  /* 二级页：钉在 0 / 120 / 260 / 430 */
  await evaluate("go('home')");
  await sleep(450);
  for (const t of [0, 120, 260, 430]) {
    await evaluate("try{ closeView('notes'); }catch(e){}");
    await sleep(350);
    await evaluate(`(function(){ openView('notes'); return window.__pin('view-notes', ${t}); })()`);
    await shot(`p3-view-${t}ms.png`);
  }

  /* ---- 几何展开：卡片 / 我的页菜单项 ---- */
  /* 上一段开着的 notes 会盖在 schedule 上（同层，DOM 靠后的赢），先收干净 */
  await evaluate("try{ closeView('notes'); }catch(e){}");
  await sleep(420);
  await evaluate("go('home')");
  await sleep(400);
  const TAP = (sel, call) => `(function(){
    var el = document.querySelector(${JSON.stringify(sel)});
    if(!el) return 'no-el';
    var r = el.getBoundingClientRect();
    try{ el.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, cancelable:true,
      clientX:r.left+r.width/2, clientY:r.top+r.height/2, pointerType:'touch', pointerId:7})); }catch(e){}
    ${call}
    return 'ok';
  })()`;
  for (const t of [0, 120, 260, 460]) {
    await evaluate("try{ closeView('schedule'); }catch(e){}");
    /* pause() 过的动画永远不会 finish，fill:both 会一直把元素钉在可见态。
       截图工具必须自己收尸，否则下一张图里会叠着上一页。 */
    await evaluate("[].forEach.call(document.querySelectorAll('.view'), function(v){ v.getAnimations().forEach(function(a){ a.cancel(); }); });");
    await sleep(350);
    const rr = await evaluate(TAP('.g-tile:nth-of-type(1)', "openView('schedule')"));
    if(rr !== 'ok') console.log('  ⚠️ 点卡片失败:', rr);
    const shown = await evaluate("document.getElementById('view-schedule').classList.contains('show')");
    const n = await evaluate(`window.__pin('view-schedule', ${t})`);
    /* 残影只有 216ms，截图会错过 —— 一起钉住 */
    await evaluate(`(function(){
      [].forEach.call(document.querySelectorAll('.g-tile'), function(g){
        if(g.style.zIndex === '61') g.getAnimations().forEach(function(a){ a.pause(); a.currentTime = ${t}; });
      });
    })()`);
    const st = await evaluate("(function(){ var v=document.getElementById('view-notes'); if(!v) return 'no notes'; return 'show='+v.classList.contains('show')+' inline='+JSON.stringify(v.style.cssText)+' anims='+v.getAnimations().length+' op='+getComputedStyle(v).opacity; })()");
    if(t === 0) console.log('    notes 状态 → ' + st);
    if(!shown || !n) console.log('  ⚠️ schedule 未展开 shown=' + shown + ' anims=' + n);
    if(t === 0){
      console.log('   ghost → ' + await evaluate(`(function(){
        var gs = [].slice.call(document.querySelectorAll('.g-tile')).filter(function(x){
          return x.style.position === 'absolute' && x.style.zIndex === '61'; });
        if(!gs.length) return '没有残影节点';
        var g = gs[0], r = g.getBoundingClientRect(), c = getComputedStyle(g);
        return 'n=' + gs.length + ' rect=' + Math.round(r.left)+','+Math.round(r.top)+' '+Math.round(r.width)+'x'+Math.round(r.height)
          + ' op=' + c.opacity + ' bg=' + c.backgroundColor + ' z=' + c.zIndex;
      })()`));
    }
    await shot(`p4-tile-${t}ms.png`);
  }

  await evaluate("try{ closeView('schedule'); }catch(e){}");
  await sleep(300);
  await evaluate("go('me')");
  await sleep(450);
  for (const t of [120]) {
    await evaluate(TAP('.li.tap[onclick*=\"theme\"]', "openView('theme')"));
    await evaluate(`window.__pin('view-theme', ${t})`);
    await shot(`p5-li-${t}ms.png`);
  }
  await evaluate("try{ closeView('theme'); }catch(e){}");
  await sleep(400);

  /* ---- 全屏输入：输入行长大 ---- */
  await evaluate("try{ closeView('theme'); }catch(e){}");
  await evaluate("try{ closeView('notes'); }catch(e){}");
  await sleep(300);
  await evaluate("go('chat')");
  await sleep(450);
  for (const t of [0, 110, 240, 400]) {
    await evaluate("try{ closeFullInput(); }catch(e){}");
    await sleep(320);
    await evaluate("openFullInput()");
    await evaluate(`(function(){ var b=document.querySelector('#page-chat .composer');
      b.getAnimations().forEach(function(a){ a.pause(); a.currentTime=${t}; }); })()`);
    await shot(`p6-input-${t}ms.png`);
  }
  await evaluate("try{ closeFullInput(); }catch(e){}");
  await sleep(300);

  /* ---- AI 按钮收拢：中途三帧 ---- */
  /* 前面的场景可能留下没关干净的二级页，先硬清一遍 */
  await evaluate("[].forEach.call(document.querySelectorAll('.view'), function(v){"
    + "v.classList.remove('show'); v.getAnimations({subtree:true}).forEach(function(a){ a.cancel(); }); });");
  await evaluate("go('home')");
  await sleep(400);
  await evaluate(`(function(){
    var p = document.getElementById('planWrap'); if(!p) return;
    p.innerHTML = '<div class="empty" style="padding:22px 18px">'
      + '<div class="et">这一天还没有安排</div>'
      + '<div class="ed">AI 会结合课表空档、你的专注习惯和薄弱科目来排一份行程。</div>'
      + '<div class="act"><div class="btn primary" id="_tmpBtn">让 AI 规划</div></div></div>';
  })()`);
  await sleep(200);
  for (const t of [0, 120, 240, 400]) {
    await evaluate(`(function(){
      var el = document.getElementById('_tmpBtn');
      if(!el) return;
      el.className = 'btn primary'; el.removeAttribute('aria-busy');
      el.getAnimations().forEach(function(a){ a.cancel(); });
    })()`);
    await sleep(120);
    await evaluate("spinBtn(document.getElementById('_tmpBtn'), true)");
    await evaluate(`(function(){
      var el = document.getElementById('_tmpBtn'); if(!el) return;
      /* subtree:true 才会带上伪元素（加载环）的动画，否则环停在真实时间的某一刻 */
      el.getAnimations({subtree:true}).forEach(function(a){ a.pause(); a.currentTime = ${t}; });
    })()`);
    if(t === 400){
      console.log('   ::after → ' + await evaluate(`(function(){
        var el = document.getElementById('_tmpBtn');
        var c = getComputedStyle(el, '::after');
        return 'content=' + c.content + ' w=' + c.width + ' h=' + c.height +
          ' op=' + c.opacity + ' border=' + c.borderTopColor + ' disp=' + c.display +
          ' anims=' + (el.getAnimations().length);
      })()`));
    }
    await shot(`p7-btn-${t}ms.png`);
  }
  await evaluate("(function(){ var p=document.getElementById('planWrap'); if(p) p.innerHTML=''; })()");

  console.log('输出目录：' + OUT);
} catch (e) {
  console.error('截图失败：' + e.message);
  process.exitCode = 2;
} finally {
  cleanup();
}
