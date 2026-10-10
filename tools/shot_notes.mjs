/* 笔记页重构的可视化验证：列表（空/双列卡片/文件夹/深色）、文字编辑器、
   手写编辑器与笔刷设置面板。产出 tools/shots_notes/*.png */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHOTDIR = path.join(root, 'tools', 'shots_notes');
fs.rmSync(SHOTDIR, { recursive: true, force: true });
fs.mkdirSync(SHOTDIR, { recursive: true });

const WIDTH = Number(process.env.VIEWPORT_W || 412);
const HEIGHT = Number(process.env.VIEWPORT_H || 915);

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(path.join(root, 'index.html')));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const URL_ = 'http://127.0.0.1:' + port + '/index.html';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = path.join(os.tmpdir(), 'edge-app-' + Date.now());
const dbgPort = 9900 + Math.floor(Math.random() * 200);
const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--mute-audio', '--hide-scrollbars',
  '--window-size=' + WIDTH + ',' + HEIGHT,
  '--force-device-scale-factor=1',
  '--remote-debugging-port=' + dbgPort, '--user-data-dir=' + profile, 'about:blank'
], { stdio: 'ignore', detached: true });
child.unref();

const cleanup = () => {
  try { ws && ws.close(); } catch (e) {}
  try { server.close(); } catch (e) {}
  try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {}
};
process.on('exit', cleanup);

async function waitFor(fn, ms = 40000, step = 250) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch (e) {} await new Promise(r => setTimeout(r, step)); }
  throw new Error('timeout');
}
let ws, msgId = 0, sessionId = null;
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
  if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text };
  return r.result.value;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let n = 0;
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const f = path.join(SHOTDIR, String(++n).padStart(2, '0') + '-' + name + '.png');
  fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
  console.log('  shot ' + path.basename(f));
}

const log = [];
try {
  const ver = await waitFor(async () => { try { const r = await fetch('http://127.0.0.1:' + dbgPort + '/json/version'); return await r.json(); } catch (e) { return null; } });
  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
  const events = [];
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; events.push('EXC: ' + ((d.exception && d.exception.description) || d.text)); }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') events.push('LOG: ' + m.params.entry.text);
  };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, false);
  const att = await send('Target.attachToTarget', { targetId, flatten: true }, false);
  sessionId = att.sessionId;
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL_ });
  await waitFor(async () => (await evaluate('document.readyState')) === 'complete');
  await sleep(1500);
  await evaluate("(function(){var o=document.getElementById('onboard');if(o)o.classList.remove('show');document.body.classList.remove('ob-open');try{S.onboarded=true;}catch(e){}return 1})()");
  await sleep(400);

  // 灌几篇示例笔记 + 一个文件夹
  await evaluate(`(function(){
    S.notes = [
      {id:'x1', title:'高等数学 · 第五章', body:'定积分的性质：线性性、区间可加性、保序性。\\n做题先画区间，再判断被积函数正负。', at:Date.now()-3600e3, folder:'课堂笔记', mode:'text'},
      {id:'x2', title:'英语单词', body:'Helmholtz 亥姆霍兹；entropy 熵。昨天背的 30 个词还剩 8 个没记住。', at:Date.now()-86400e3, folder:'', mode:'text'},
      {id:'x3', title:'错题整理', body:'第 12 题错在没讨论判别式。', at:Date.now()-2*86400e3, folder:'错题本', mode:'text'},
      {id:'x4', title:'手写推导', body:'', at:Date.now()-3*86400e3, folder:'课堂笔记', mode:'ink', inkPng:''}
    ];
    S.noteFolders = ['课堂笔记','错题本'];
    save(); return 1;
  })()`);
  await sleep(300);

  // ① 列表：双列卡片（浅色）
  await evaluate("openNotes()");
  await sleep(500);
  await shot('list-light');

  // ② 搜索过滤
  await evaluate("noteSearchRun('高数')");
  await sleep(300);
  await shot('list-search');
  log.push('搜索高数 命中=' + await evaluate("noteFiltered().length"));

  // ③ 文件夹过滤
  await evaluate("noteSearchRun(''); notePickFolder('课堂笔记')");
  await sleep(300);
  await shot('list-folder');
  log.push('课堂笔记 可见=' + await evaluate("noteFiltered().length"));

  // ④ 新建弹层
  await evaluate("notePickFolder(''); openSheet('notenew')");
  await sleep(350);
  await shot('new-sheet');
  await evaluate("closeSheet()");

  // ⑤ 文字编辑器（浅色）
  await evaluate("noteOpen('x1')");
  await sleep(300);
  await evaluate("noteFullEnter()");
  await sleep(400);
  await shot('text-editor-light');
  log.push('字数行=' + await evaluate("document.getElementById('noteMeta').textContent"));

  // AI 结果弹层（不真调 AI，直接灌结果看版式）
  await evaluate("noteAiResult = '· 定积分保序性：a≤b 且 f≤g 则 ∫f≤∫g\\n· 区间可加用于分段函数\\n· 换元后上下限要同步换'; openSheet('noteairesult')");
  await sleep(350);
  await shot('ai-result');
  await evaluate("closeSheet(); noteFullClose()");

  // ⑥ 手写编辑器 + 笔刷设置面板（深色模式看观感）
  await evaluate("setTheme('dark'); applyLook(); noteOpen('x4')");
  await sleep(300);
  await evaluate("inkEnterFull()");
  await sleep(600);
  await shot('ink-editor-dark');
  await evaluate("inkSheetOpen()");
  await sleep(400);
  await shot('ink-sheet-dark');
  log.push('不遮挡=' + await evaluate("(function(){var s=document.getElementById('inkStage').getBoundingClientRect(),b=document.getElementById('inkBar').getBoundingClientRect();return b.top>=s.bottom-1})()"));
  await evaluate("inkSheetClose(); inkExitFull()");
  await sleep(300);

  // ⑦ 深色列表（双列）
  await evaluate("noteMode='list'; noteCurId=null; renderNotes()");
  await sleep(400);
  await shot('list-dark');

  // ⑧ 单列布局（浅色对照）
  await evaluate("setTheme('light'); applyLook(); S.noteCols=1; noteMode='list'; noteCurId=null; renderNotes()");
  await sleep(400);
  await shot('list-single-light');
  log.push('单列 grid=' + await evaluate("getComputedStyle(document.querySelector('.note-grid')).gridTemplateColumns"));
  log.push('单列按钮 title=' + await evaluate("document.getElementById('noteColsBtn').title"));

  // ⑨ 切回双列
  await evaluate("noteToggleCols()");
  await sleep(350);
  await shot('list-double-light');
  log.push('切回双列 grid=' + await evaluate("getComputedStyle(document.querySelector('.note-grid')).gridTemplateColumns"));

  // ⑩ 手写工具栏图标对照表（19px 实机尺寸 + 44px 放大看结构）
  await evaluate(`(function(){
    var keys=['pencil','marker','brush','eraserStroke','eraserArea','fit','undo','redo','sliders'];
    var names={pencil:'铅笔',marker:'马克笔',brush:'毛笔',eraserStroke:'橡皮·笔画',eraserArea:'橡皮·区域',fit:'适应纸张',undo:'撤销',redo:'重做',sliders:'更多设置'};
    var d=document.createElement('div'); d.id='__iconsheet';
    d.style.cssText='position:fixed;inset:0;z-index:99999;background:var(--bg);padding:18px;overflow:auto';
    d.innerHTML='<div style="font:700 14px/1.6 system-ui;margin-bottom:10px;color:var(--text)">19px（真机按钮里的实际尺寸）</div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:24px">'
      + keys.map(function(k){return '<div style="display:flex;flex-direction:column;align-items:center;gap:6px;width:58px;color:var(--text)">'
        + '<div style="width:44px;height:44px;border:1px solid var(--line);border-radius:14px;display:flex;align-items:center;justify-content:center">'+icSvg(k,19)+'</div>'
        + '<span style="font-size:9px;color:var(--sub)">'+names[k]+'</span></div>';}).join('')
      + '</div>'
      + '<div style="font:700 14px/1.6 system-ui;margin-bottom:12px;color:var(--text)">44px（放大看结构）</div>'
      + '<div style="display:flex;gap:16px;flex-wrap:wrap">'
      + keys.map(function(k){return '<div style="display:flex;flex-direction:column;align-items:center;gap:6px;color:var(--text)">'+icSvg(k,44)+'<span style="font-size:9px;color:var(--sub)">'+k+'</span></div>';}).join('')
      + '</div>';
    document.body.appendChild(d); return keys.length;
  })()`);
  await sleep(300);
  await shot('icon-sheet');
  await evaluate("document.getElementById('__iconsheet').remove()");

  // ⑪ 文字编辑器：选中一段后字号/颜色只作用在那一段
  await evaluate("noteOpen('x1'); noteFullEnter()");
  await sleep(400);
  log.push('选区样式：' + await evaluate(`(function(){
    var bd=document.getElementById('noteBody');
    var tn=bd.firstChild;
    var r=document.createRange(); r.setStart(tn,0); r.setEnd(tn,5);
    var s=window.getSelection(); s.removeAllRanges(); s.addRange(r);
    noteSyncSel();
    var chip=document.getElementById('ntbSize').textContent;
    noteStepFs(1); noteStepFs(1);
    var spans=bd.querySelectorAll('span[style*="font-size"]');
    var big=spans.length? spans[0].style.fontSize : 'none';
    var base=getComputedStyle(bd).fontSize;
    return '选中前chip='+chip+' · 套了'+spans.length+'个span · 段内字号='+big+' · 全文基准='+base;
  })()`));
  await sleep(250);
  await shot('text-editor-size-selection');
  await evaluate("noteFullClose(); noteMode='list'; noteCurId=null; renderNotes()");
  await sleep(250);

  console.log('\n=== LOG ===');
  console.log(log.join('\n'));
  console.log('\n=== PAGE ERRORS ===');
  console.log(events.length ? events.slice(0, 15).join('\n') : 'none');
  cleanup();
  process.exit(0);
} catch (e) {
  console.log('HARNESS ERROR: ' + (e && e.stack || e));
  console.log(log.join('\n'));
  cleanup();
  process.exit(3);
}
