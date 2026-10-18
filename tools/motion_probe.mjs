/* tools/motion_probe.mjs —— 动效的可复现验证
   目的：不靠读代码说服自己。直接在无头 Edge 里按帧采样
   getComputedStyle 的 transform / opacity，输出时间序列，回答三个问题：
     ① 元素真的动了没有（首帧位移量）
     ② 位移是不是非线性（每帧位移量是否递减 / 有没有过冲）
     ③ 透明度是不是比位移先收敛（内容先清晰，动感留在边缘）

   跑法：node tools/motion_probe.mjs
   输出：每条是「毫秒 → tx(px)」，以及收敛点、过冲量、帧数。 */
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
const profile = path.join(os.tmpdir(), 'edge-motion-' + Date.now());
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
  if (r.exceptionDetails) {
    throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
  }
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

/* 矩阵里取 tx / scale：matrix(a,b,c,d,tx,ty) */
const PARSER = `
window.__mtx = function(s){
  if(!s || s === 'none') return {tx:0, ty:0, sc:1};
  var m = s.match(/matrix\\(([^)]+)\\)/);
  if(!m) return {tx:0, ty:0, sc:1};
  var v = m[1].split(',').map(parseFloat);
  return {tx:v[4], ty:v[5], sc:v[0]};
};
`;

/* 采样器：先挂 rAF 循环，再动手 —— 顺序反了会漏掉开头几帧，
   而那几帧正好是位移最大的地方。 */
const SAMPLER = `
window.__sample = function(id, act, ms){
  var el = document.getElementById(id);
  var out = [];
  var t0 = performance.now();
  window.__samples = out;
  function tick(){
    var c = getComputedStyle(el);
    var m = window.__mtx(c.transform);
    out.push({t: Math.round(performance.now() - t0), tx: +m.tx.toFixed(2), ty: +m.ty.toFixed(2),
              sc: +m.sc.toFixed(4), op: +parseFloat(c.opacity).toFixed(3),
              rad: +parseFloat(c.borderTopLeftRadius || 0).toFixed(1)});
    if(performance.now() - t0 < ms) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  act();
  return true;
};
`;

const report = [];
function analyze(label, s) {
  if (!s || s.length < 3) { console.log(label + '：采样不足'); return; }
  const first = s[0], last = s[s.length - 1];
  /* 主轴：页面切换是横向接力，二级页是纵向浮起 —— 取位移大的那根轴，
     否则测二级页会得到一个「全 0」的假阴性（它明明动了 14px）。 */
  const ax = Math.abs(s[0].tx) >= Math.abs(s[0].ty) ? 'tx' : 'ty';
  const tx0 = s.find(x => Math.abs(x[ax]) > 0.5) || first;
  const steps = [];
  for (let i = 1; i < s.length; i++) steps.push(Math.abs(s[i][ax] - s[i - 1][ax]));
  const peak = Math.max(...steps);
  const tailAvg = steps.slice(-4).reduce((a, b) => a + b, 0) / 4;
  /* 过冲：位移方向反了一次（越过 0 又回来） */
  const sign0 = Math.sign(tx0.tx) || 1;
  const over = s.some(x => Math.sign(x[ax]) === -sign0 && Math.abs(x[ax]) > 0.3);
  /* 透明度什么时候到 1 */
  const opDone = s.find(x => x.op >= 0.999);
  const moved = Math.abs(tx0[ax]);
  console.log('\n── ' + label);
  console.log('  主轴 ' + ax + ' · 首帧位移 ' + moved.toFixed(1) + 'px · 末帧 ' + last[ax].toFixed(2)
    + 'px · 终点缩放 ' + last.sc + ' · 采样 ' + s.length + ' 帧 / ' + last.t + 'ms');
  console.log('  速度：峰值 ' + peak.toFixed(2) + 'px/帧 → 尾部 ' + tailAvg.toFixed(2) + 'px/帧（比值 ' +
    (tailAvg > 0 ? (peak / tailAvg).toFixed(1) : '∞') + '×，1× 就是线性）');
  console.log('  过冲：' + (over ? '有（越过落点后回弹）' : '无'));
  console.log('  透明度到 1 用时：' + (opDone ? opDone.t + 'ms' : '未在窗口内'));
  console.log('  前 6 帧 ' + ax + '：' + s.slice(0, 6).map(x => x[ax]).join(' → '));
  report.push({ label, moved, peak, tail: tailAvg, over, opDone: opDone ? opDone.t : null, total: last.t });
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
  /* 首次启动会弹引导，挡住主页面也会污染采样 —— 先按"已完成引导"跳过 */
  await evaluate("S.onboarded = true; try{ save(); }catch(e){}; var _ob = document.getElementById('onboard'); if(_ob) _ob.classList.remove('show');");
  await sleep(700);
  await evaluate(PARSER);
  await evaluate(SAMPLER);

  const hasMotion = await evaluate('!!(window.MOTION && MOTION.enter)');
  console.log('MOTION 已载入：' + hasMotion);
  console.log('prefers-reduced-motion：' + await evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"));

  /* ① 底栏切页：首页 → 我的（跨两格，方向应为正，位移 +26） */
  await evaluate("window.__sample('page-me', function(){ go('me'); }, 520)");
  await sleep(900);
  analyze('切页 首页 → 我的（正方向）', await evaluate('window.__samples'));

  /* ② 反方向回到首页：位移必须变成 -26，方向跟着底栏胶囊走 */
  await evaluate("window.__sample('page-home', function(){ go('home'); }, 520)");
  await sleep(900);
  analyze('切页 我的 → 首页（反方向）', await evaluate('window.__samples'));

  /* ③ 二级页：笔记列表的进场（scale 从 0.98 展开） */
  await evaluate("go('home');");
  await sleep(500);
  await evaluate("window.__sample('view-notes', function(){ openView('notes'); }, 520)");
  await sleep(900);
  analyze('二级页 openView(notes)', await evaluate('window.__samples'));

  /* ③.5 退场：.show 是立刻摘的（返回层读的就是它），
     视觉靠 fill:both 的 keyframes 撑着。这里确认「摘了 .show 元素仍然可见」——
     如果这一步 opacity 在第一帧就 0，说明退场被吞了，视觉上会"啪"一下消失。 */
  await evaluate("window.__sample('view-notes', function(){ closeView('notes'); }, 300)");
  await sleep(600);
  {
    const d = await evaluate('window.__samples') || [];
    const shown = d.filter(x => x.op > 0.05).length;
    console.log('\n── 退场 closeView(notes)');
    console.log('  仍可见的帧数 ' + shown + '/' + d.length + '（0 就是被吞了）');
    console.log('  ty：' + d.filter((_, i) => i % 3 === 0).slice(0, 6).map(x => x.ty).join(' → '));
    console.log('  opacity：' + d.filter((_, i) => i % 3 === 0).slice(0, 6).map(x => x.op).join(' → '));
    console.log('  .show 已摘：' + await evaluate("!document.getElementById('view-notes').classList.contains('show')"));
    report.push({ label: '退场', shown, total: d.length });
    if (shown < 2) { console.log('  ⚠️ 退场动画丢失'); process.exitCode = 1; }
  }

  /* ④ 反证：关掉动效后必须一帧到位（证明降级真的生效，不是"看着慢一点"） */
  await evaluate("document.documentElement.classList.add('no-motion')");
  await evaluate("window.__sample('page-me', function(){ go('me'); }, 300)");
  await sleep(700);
  analyze('【反证】no-motion 下的切页', await evaluate('window.__samples'));
  await evaluate("document.documentElement.classList.remove('no-motion')");

  /* ---- ⑤ 底栏磁吸拖动 ---- */
  await evaluate("try{ document.querySelectorAll('.view').forEach(function(v){v.classList.remove('show');}); }catch(e){}");
  await evaluate("go('home')");
  await sleep(500);
  const P = (type, x, y) => `(function(){
    var bar = document.querySelector('.tabbar');
    bar.dispatchEvent(new PointerEvent('${type}', {bubbles:true, cancelable:true,
      clientX:${x}, clientY:${y}, pointerId:11, pointerType:'touch', isPrimary:true}));
    return true;
  })()`;
  const geom = await evaluate("(function(){ var r=document.querySelector('.tabbar').getBoundingClientRect(); return {l:r.left,t:r.top,w:r.width,h:r.height}; })()");
  await evaluate(P('pointerdown', geom.l + 40, geom.t + 30));
  const pressOn = await evaluate("document.querySelector('.tabbar').classList.contains('press')");
  /* 不再等长按：按下即可拖，这里故意 0ms 直接移动，验证"没有延迟" */
  await evaluate(P('pointermove', geom.l + geom.w * 0.80, geom.t + 30));
  await sleep(80);
  const dragI = await evaluate("document.querySelector('.tabbar').style.getPropertyValue('--tab-i')");
  const barTx = await evaluate("document.querySelector('.tabbar').style.translate");
  const isDrag = await evaluate("document.querySelector('.tabbar').classList.contains('drag')");
  await evaluate(P('pointerup', geom.l + geom.w * 0.80, geom.t + 30));
  await sleep(200);
  const activeTab = await evaluate("(document.querySelector('.tabbar .tab.on')||{}).dataset ? document.querySelector('.tabbar .tab.on').dataset.tab : '?'");
  const tail = await evaluate("(typeof RUNTIME_LOG!=='undefined'?RUNTIME_LOG:[]).slice(-5).map(function(x){return x.tag+':'+x.msg;}).join(' | ')");
  console.log('  最近日志：' + tail);
  console.log('\n── 底栏拖动');
  console.log('  按下缩放反馈=' + pressOn + ' · 拖动态=' + isDrag);
  console.log('  --tab-i 中途=' + (dragI || '(空)') + ' · 整条让位=' + (barTx || '(空)'));
  console.log('  松手后选中=' + activeTab + '（期望 me，因为拖到了 80% 处）');
  const okBar = isDrag && parseFloat(dragI) > 1.2 && barTx && Math.abs(parseFloat(barTx)) > 0.5 && activeTab === 'me';
  if(!okBar) console.log('  ⚠️ 底栏拖动不符合预期');

  /* ---- ⑥ 弹层关闭：遮罩不能比面板先退 ---- */
  await evaluate("go('home')");
  await sleep(300);
  await evaluate("pickPrefNum('workMin')");
  await sleep(600);
  await evaluate("closeSheet()");
  const maskSeries = [];
  for (let i = 0; i < 8; i++) {
    await sleep(55);
    maskSeries.push(await evaluate("(+getComputedStyle(document.getElementById('mask')).opacity).toFixed(2)"));
  }
  console.log('\n── 弹层关闭（遮罩透明度序列 / 每 55ms）');
  console.log('  ' + maskSeries.join(' → '));
  /* 面板滑出 .38s：280ms 时遮罩还应该有可观的不透明度 */
  const okMask = parseFloat(maskSeries[4]) > 0.35;
  if(!okMask) console.log('  ⚠️ 遮罩退得太早（面板裸着）');

  /* ---- ⑦ AI 按钮收拢：正圆 + 居中 ---- */
  await evaluate("go('home')");
  await sleep(300);
  const btnGeo = await evaluate(`(function(){
    var el = document.createElement('div');
    el.className = 'btn primary'; el.textContent = '让 AI 规划';
    var act = document.createElement('div'); act.className = 'act';
    act.appendChild(el);
    var host = document.querySelector('#planWrap') || document.body;
    host.appendChild(act);
    var before = el.getBoundingClientRect();
    if(typeof spinBtn === 'function') spinBtn(el, true);
    /* FLIP 的动画会覆盖 transform，直接量 rect 得到的是**动画第一帧**（还是长条）。
       先 cancel 再量，才是真实布局尺寸。 */
    el.getAnimations().forEach(function(a){ a.cancel(); });
    var after = el.getBoundingClientRect();
    var ar = act.getBoundingClientRect();
    var out = {
      w: Math.round(after.width), h: Math.round(after.height),
      round: Math.abs(after.width - after.height) <= 1,
      centered: Math.abs((after.left + after.width/2) - (ar.left + ar.width/2)) <= 2,
      shrank: after.width < before.width - 40,
      anims: el.getAnimations().length
    };
    out.beforeW = Math.round(before.width);
    act.remove();
    return out;
  })()`);
  const spinGeo = await evaluate(`(function(){
    var host = document.createElement('div');
    host.className = 'empty'; host.style.cssText = 'padding:22px 18px;width:100%';
    host.innerHTML = '<div class="act"><div class="btn primary" id="_sb">让 AI 规划</div></div>';
    var p = document.getElementById('planWrap') || document.body;
    p.innerHTML = ''; p.appendChild(host);
    var el = document.getElementById('_sb');
    spinBtn(el, true);
    el.getAnimations({subtree:true}).forEach(function(a){ a.cancel(); });
    var r = el.getBoundingClientRect(), hr = host.getBoundingClientRect();
    var c = getComputedStyle(el, '::after');
    var out = {
      dx: Math.round((r.left + r.width/2) - (hr.left + hr.width/2)),
      dy: Math.round((r.top + r.height/2) - (hr.top + hr.height/2)),
      w: Math.round(r.width), h: Math.round(r.height),
      box: 'w' + c.width + ' h' + c.height + ' ml' + c.marginLeft + ' mt' + c.marginTop
        + ' left' + c.left + ' top' + c.top
    };
    host.remove();
    return out;
  })()`);
  console.log('  圆心相对卡片：dx=' + spinGeo.dx + 'px dy=' + spinGeo.dy + 'px · 尺寸 ' + spinGeo.w + '×' + spinGeo.h);
  console.log('  环 ::after ' + spinGeo.box);

  console.log('\n── AI 按钮收拢');
  console.log('  收拢前宽 ' + btnGeo.beforeW + 'px → 之后 ' + btnGeo.w + '×' + btnGeo.h
    + ' · 正圆=' + btnGeo.round + ' · 居中=' + btnGeo.centered + ' · 有动画=' + (btnGeo.anims > 0));
  const okBtn = btnGeo.round && btnGeo.centered && btnGeo.shrank;
  if(!okBtn) console.log('  ⚠️ 按钮形态不符合预期');

  /* ---- ⑧ 侧出：整块滑到屏外，且不能一边滑一边变透明 ---- */
  await evaluate("go('home')");
  await sleep(400);
  await evaluate("window.__sample('view-schedule', function(){ openView('schedule'); }, 500)");
  await sleep(750);
  await evaluate("window.__sample('view-schedule', function(){ closeView('schedule'); }, 380)");
  await sleep(650);
  const outS = await evaluate('window.__samples') || [];
  const pick = outS.filter((_, i) => i % 4 === 0).slice(0, 8);
  console.log('\n── 侧出 closeView(schedule) / 每 4 帧取一个');
  console.log('  tx：' + pick.map(x => x.tx).join(' → '));
  console.log('  op：' + pick.map(x => x.op).join(' → '));
  const txMax = Math.max.apply(null, outS.map(x => Math.abs(x.tx)));
  const opStay = outS.filter(x => x.t < 280 && x.op < 0.6).length === 0;
  const okOut = txMax > 300 && opStay;
  if(!okOut) console.log('  ⚠️ 侧出不符合预期（最大位移 ' + Math.round(txMax) + '，中途掉透明度=' + !opStay + '）');

  /* ---- ⑨ 从卡片返回：conceal 期间元素必须一直可见 ---- */
  await evaluate("go('home')");
  await sleep(400);
  await evaluate(`(function(){
    var el = document.querySelector('.g-tile'), r = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true,
      clientX:r.left+5, clientY:r.top+5, pointerType:'touch', pointerId:21}));
    openView('schedule');
  })()`);
  await sleep(750);
  await evaluate("window.__sample('view-schedule', function(){ closeView('schedule'); }, 420)");
  await sleep(700);
  const backS = await evaluate('window.__samples') || [];
  console.log('\n── 从卡片返回（conceal）/ 每 4 帧取一个');
  console.log('  opacity：' + backS.filter((_, i) => i % 4 === 0).slice(0, 8).map(x => x.op).join(' → '));
  console.log('  圆角：' + backS.filter((_, i) => i % 4 === 0).slice(0, 8).map(x => x.rad).join(' → '));
  const opAlive = backS.filter(x => x.t < 300 && x.op < 0.6).length === 0;
  const okBack = backS.length > 6 && opAlive;
  if(!okBack) console.log('  ⚠️ 返回动画期间元素是透明的（真机上就是"闪回"）');

  console.log('\n=== 判定 ===');
  const page = report[0];
  const okMoved = page && page.moved > 10;
  /* tail=0 表示末段已经停住，是最强的非线性（匀速才会保持峰值到最后一帧） */
  const okNonLinear = page && (page.tail === 0 || page.peak / page.tail > 3);
  /* 转场不再做淡入：透明度必须在第一帧就是 1（<=16ms）。
     如果这里变成 100ms+，说明有人又把 opacity 拖进了动画 —— 那会让
     页内每块 backdrop-filter 的模糊跟着"长出来"，也就是肉眼看到的"慢半拍"。 */
  /* 容 2~3 帧：第一次切页时元素刚从 display:none 转 block，
     computed opacity 在前一两帧会读到未布局的 0（不是真的淡入）。
     真正的淡入是 100ms 以上，与这个量级差一个数量级。 */
  const okFadeFirst = page && page.opDone !== null && page.opDone <= 45;
  const degrade = report[report.length - 1];
  const okDegrade = degrade && degrade.moved < 1;
  console.log('位移发生：' + okMoved + ' · 非线性：' + okNonLinear + '（峰值/尾部 >3）'
    + ' · 无淡入（第一帧即不透明）：' + okFadeFirst + ' · 降级一帧到位：' + okDegrade);
  console.log('遮罩时序：' + okMask + ' · 按钮收拢：' + okBtn + ' · 侧出：' + okOut + ' · 卡片返回：' + okBack);
  process.exitCode = (okMoved && okNonLinear && okFadeFirst && okDegrade && okBar && okMask && okBtn && okOut && okBack) ? 0 : 1;
} catch (e) {
  console.error('探测失败：' + e.message);
  process.exitCode = 2;
} finally {
  cleanup();
}
