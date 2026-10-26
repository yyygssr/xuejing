// 版本号一处改全部：build.gradle（versionCode/versionName）+ index.html 的 APP_VER
// 与两处可见文案（关于页 entry 副标题、关于页 about-ver）。
// ⚠️ 代码里「v0.2.9 重定」这类历史注释不许跟着替换 —— 那是「语义在哪一版定的」，
//    跟着改等于把历史改掉。
import fs from 'fs';
let g = fs.readFileSync('android/app/build.gradle', 'utf8');
const vc = /versionCode\s+(\d+)/.exec(g);
if (!vc) { console.error('读不到 versionCode'); process.exit(8); }
/* ⚠️ 当前版本也必须从 gradle 读，不能写死（真踩过两次）：
   写死的话，发布时把 versionName 从 0.4.x 改回 0.3.x 之后，
   脚本里的 cur 就和实际值对不上 → 锚点找不到 → 半途退出、
   versionCode 已经 +1 但 versionName 没变。 */
const vm = /versionName\s+"([\d.]+)"/.exec(g);
if (!vm) { console.error('读不到 versionName'); process.exit(8); }
const cur = vm[1];
const curParts = cur.split('.').map(Number);
const next = curParts[0] + '.' + curParts[1] + '.' + (curParts[2] + 1);
/* versionCode 从 gradle 自己读再 +1：写死数字的话第二次跑会因为
   「锚点是上一版的值」而静默不生效（真踩过：versionName 升了、code 没升）。 */
const code = Number(vc[1]) + 1;
g = g.split('versionCode ' + vc[1]).join('versionCode ' + code);
g = g.split('versionName "' + cur + '"').join('versionName "' + next + '"');
fs.writeFileSync('android/app/build.gradle', g);

let h = fs.readFileSync('index.html', 'utf8');
const pairs = [
  ["var APP_VER = 'v" + cur + "'", "var APP_VER = 'v" + next + "'"],
  ['<b>关于学径</b><small>v' + cur, '<b>关于学径</b><small>v' + next],
  ['<div class="about-ver">v' + cur, '<div class="about-ver">v' + next],
];
for (const [a, b] of pairs) {
  if (!h.includes(a)) { console.error('锚点没找到：' + a); process.exit(8); }
  h = h.split(a).join(b);
}
fs.writeFileSync('index.html', h);
console.log('已升到 v' + next + '（versionCode ' + code + '）');
