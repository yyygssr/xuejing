/* tools/pro-ui/sync.mjs —— 把皮肤源文件同步进 index.html
   ------------------------------------------------------------------
   皮肤只有一份真相：tools/pro-ui/pro-skin.css。
   应用要的是内联 CSS（单文件 WebView，没有外链样式），所以中间隔了一次拷贝 ——
   而拷贝一定会漂移。这个脚本负责「不漂移」：
     node tools/pro-ui/sync.mjs          重新写入 index.html 里的那一段
     node tools/pro-ui/sync.mjs --check  只比对，不一致就退出码 1（给自测用）
   index.html 里那一段两头有标记，别手改，改源文件再同步。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const SRC = path.join(root, 'tools', 'pro-ui', 'pro-skin.css');
const APP = path.join(root, 'index.html');
const HEAD = '/* ==== UI Pro 皮肤 · 由 tools/pro-ui/sync.mjs 从 pro-skin.css 同步，勿手改此段 ==== */';
const TAIL = '/* ==== UI Pro 皮肤 结束 ==== */';

const skin = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n').trimEnd();
const block = HEAD + '\n' + skin + '\n' + TAIL;

const html = fs.readFileSync(APP, 'utf8');
const i = html.indexOf(HEAD);
const j = html.indexOf(TAIL);
if (i < 0 || j < 0) {
  /* 第一次接入：插到主样式块的 </style> 之前 */
  const at = html.lastIndexOf('</style>');
  if (at < 0) { console.error('找不到 </style>，不敢乱写'); process.exit(2); }
  const nl = html.includes('\r\n') ? '\r\n' : '\n';
  const src = html.slice(0, at) + block.split('\n').join(nl) + nl + nl + html.slice(at);
  fs.writeFileSync(APP, src);
  console.log('已首次插入 UI Pro 皮肤（' + skin.split('\n').length + ' 行）→ index.html');
  process.exit(0);
}

/* index.html 是 CRLF，源文件是 LF —— 比对前先归一，否则 --check 永远报漂移 */
const cur = html.slice(i, j + TAIL.length).replace(/\r\n/g, '\n');
if (cur === block) {
  console.log('✓ index.html 内的皮肤与源文件一致');
  process.exit(0);
}
if (process.argv.includes('--check')) {
  console.error('✗ 皮肤漂移：index.html 里的那一段和 tools/pro-ui/pro-skin.css 不一样');
  console.error('  跑一次 node tools/pro-ui/sync.mjs 再提交');
  process.exit(1);
}
/* 写回时保持 index.html 自己的换行风格，不然整文件 diff 会炸 */
const nl = html.includes('\r\n') ? '\r\n' : '\n';
fs.writeFileSync(APP, html.slice(0, i) + block.split('\n').join(nl) + html.slice(j + TAIL.length));
console.log('已同步 UI Pro 皮肤 → index.html');
