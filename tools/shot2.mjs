import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'tools', 'shots2');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(path.join(root, 'index.html')));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = path.join(os.tmpdir(), 'edge-s2-' + Date.now());
const dbgPort = 9800 + Math.floor(Math.random() * 100);
const child = spawn(EDGE, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
  '--disable-extensions','--mute-audio','--hide-scrollbars','--window-size=430,932','--force-device-scale-factor=1',
  '--remote-debugging-port=' + dbgPort, '--user-data-dir=' + profile, 'about:blank'],
  { stdio: 'ignore', detached: true });
child.unref();
const cleanup = () => { try{ ws&&ws.close(); }catch(e){}; try{ server.close(); }catch(e){};
  try{ spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'}); }catch(e){} };
process.on('exit', cleanup);

async function waitFor(fn, ms = 40000, step = 250) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch (e) {} await new Promise(r => setTimeout(r, step)); }
  throw new Error('timeout');
}
let ws, msgId = 0, sessionId = null;
const pending = new Map();
function send(method, params = {}, useSession = true) {
  const id = ++msgId; const msg = { id, method, params };
  if (useSession && sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text };
  return r.result.value;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let n = 0;
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const f = path.join(outDir, String(++n).padStart(2,'0') + '-' + name + '.png');
  fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
  console.log('  shot ' + path.basename(f) + '  ' + fs.statSync(f).size + ' bytes');
}

const log = [];
try {
  const ver = await waitFor(async () => { try { return await (await fetch('http://127.0.0.1:' + dbgPort + '/json/version')).json(); } catch (e) { return null; } });
  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (_) { return; }
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') log.push('EXC: ' + ((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text)); };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, false);
  const att = await send('Target.attachToTarget', { targetId, flatten: true }, false);
  sessionId = att.sessionId;
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:' + port + '/index.html' });
  await waitFor(async () => (await ev('document.readyState')) === 'complete');
  await sleep(1600);
  await ev("(function(){var o=document.getElementById('onboard');if(o)o.classList.remove('show');document.body.classList.remove('ob-open');try{S.onboarded=true;}catch(e){}return 1})()");
  await sleep(500);

  // 1) AI 配置
  await ev("openAiConfig()"); await sleep(900); await shot('ai-config');
  log.push('ai-config entry text = ' + await ev("(document.querySelector('#view-ai [onclick*=\"openAiHub\"]')||{}).textContent"));

  // 2) 提供商页
  await ev("openAiHub()"); await sleep(1000); await shot('providers');
  log.push('prov cards = ' + await ev("document.querySelectorAll('#provList > .card').length"));
  log.push('shown = ' + await ev("[].slice.call(document.querySelectorAll('.view.show')).map(function(e){return e.id}).join(',')"));

  // 3) 展开第一家
  await ev("toggleProvCard('deepseek')"); await sleep(700); await shot('provider-expanded');
  log.push('expanded inputs = ' + await ev("document.querySelectorAll('#provList input').length"));
  log.push('has fetch btn = ' + await ev("/拉取模型列表/.test(document.getElementById('provList').innerHTML)"));
  log.push('has enabled list = ' + await ev("/可用模型/.test(document.getElementById('provList').innerHTML)"));

  // 4) 增删模型
  await ev("providerModelsAdd('deepseek','__test_model__')"); await sleep(400);
  log.push('after add enabled has test = ' + await ev("providerModelsOf('deepseek').indexOf('__test_model__')>=0"));
  await ev("providerModelsDel('deepseek','__test_model__')"); await sleep(400);
  log.push('after del enabled has test = ' + await ev("providerModelsOf('deepseek').indexOf('__test_model__')>=0"));

  // 5) 新增提供商
  await ev("addCustomProvider()"); await sleep(600); await shot('provider-added');
  log.push('custom count = ' + await ev("customProviders().length"));
  log.push('open card = ' + await ev("window.__provOpen"));

  // 6) 各功能模型弹页
  await ev("closeView('aihub'); openAiConfig(); openSheet('modelroles')"); await sleep(800); await shot('modelroles-sheet');
  log.push('modelroles has modelList = ' + await ev("!!document.getElementById('modelList') && document.getElementById('modelList').children.length"));
  log.push('modelroles has fetchBox = ' + await ev("!!document.getElementById('fetchBox')"));

  // 7) 回复风格弹页
  await ev("closeSheet(); openSheet('replystyle')"); await sleep(800); await shot('replystyle-sheet');
  log.push('replystyle items = ' + await ev("(document.getElementById('replyStyleList')||{children:[]}).children.length"));

  console.log('\n=== LOG ===');
  console.log(log.join('\n'));
  console.log('\n=== ERRORS ===');
  console.log(log.filter(l => l.startsWith('EXC')).join('\n') || 'none');
  cleanup(); process.exit(0);
} catch (e) {
  console.log('ERR ' + (e && e.stack || e));
  console.log(log.join('\n'));
  cleanup(); process.exit(3);
}
