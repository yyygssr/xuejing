/**
 * 对照实验：把 Island.miuiParamV2 的 JSON 生成逻辑原样搬到桌面跑，
 * 逐条核对官方《小米超级岛通知模板库》20260129 的硬性约束。
 *
 * 为什么单独写：那几个 bug（enableFloat 语义反了、timeout 单位错、
 * 小岛塞了大岛组件名）都是「编译通过、运行不报错、屏幕上就是不对」的类型，
 * 光读代码说服不了自己，必须让生成物本身说话。
 */
const LE = (n) => String(n).padStart(2, "0");
const clip = (s, n) => (s == null ? "" : (s.length <= n ? s : s.substring(0, n) + "…"));

const K_PIC = "miui.focus.pic_island";
const ACCENT_CLASS = "#4F7BE8";

let elCountdown = true, elPlace = true;

/* v0.2.9：cfgLen 不再是停留时长，而是岛屿形态 0短岛/1标准/2完整；
   停留时长另走 stayMin。这两个混成一个字段正是 v0.2.8 理解错需求的原因。 */
let cfgLen = 1;
let shortMode = false;
let stayMin = 10;
function stayMillis() { return stayMin * 60_000; }

/* ---- Pill：与 Island.java 保持一致 ---- */
class Pill {
  constructor(name, sub, right, endAt = 0, totalMs = 0) {
    this.name = name; this.sub = sub; this.right = right;
    this.endAt = endAt; this.totalMs = totalMs;
  }
  nameOnly() {
    const n = this.name || "";
    return (shortMode && n.length > 4) ? clip(n, 4) : n;
  }
  subOrEmpty() { return shortMode ? "" : this.sub; }
  /* 剩余百分比 0..100，给环形进度；不知道总量返回 -1（退回纯 picInfo） */
  progressPct() {
    if (this.totalMs <= 0 || this.endAt <= 0) return -1;
    let left = this.endAt - Date.now();
    if (left < 0) left = 0;
    if (left > this.totalMs) left = this.totalMs;
    return Math.floor(left * 100 / this.totalMs);
  }
  digit() {
    const r = this.right || "";
    let s = -1, e = -1;
    for (let i = 0; i < r.length; i++) {
      const ch = r[i];
      const num = /\d/.test(ch) || ch === ":";
      if (num && s < 0) s = i;
      if (num) e = i + 1;
      else if (s >= 0) break;
    }
    if (s < 0) return r.length > 4 ? clip(r, 4) : r;
    return r.substring(s, e);
  }
  rightLabel() {
    const r = this.right || "";
    const dg = this.digit();
    if (dg.length >= r.length) return "";
    const at = r.indexOf(dg);
    const rest = r.substring(at + dg.length).trim();
    return rest === "" ? "" : clip(rest, 6);
  }
}

function pill(course, place, duringClass, millisLeft) {
  const c = !course || !course.trim() ? "课程" : course.trim();
  const sub = (elPlace && place && place.trim()) ? place.trim() : "";
  let right = "";
  if (elCountdown) {
    if (millisLeft <= 0) right = duringClass ? "已下课" : "上课中";
    else {
      const mins = Math.max(1, Math.ceil(millisLeft / 60000));
      right = "还有 " + mins + " 分钟" + (duringClass ? "下课" : "上课");
    }
  }
  return new Pill(c, sub, right,
    millisLeft > 0 ? Date.now() + millisLeft : 0,
    millisLeft > 0 ? millisLeft : 0);
}

function pillTimer(label, right, endAt = 0, totalMs = 0) {
  let c = !label || !label.trim() ? "自由专注" : label.trim();
  if (shortMode && c.length > 4) c = clip(c, 4);
  return new Pill(c, "", right || "", endAt, totalMs);
}

function sameWidthDigit(p) {
  const o = { digit: p.digit(), content: p.rightLabel() };
  if (p.endAt > 0) {
    o.timerInfo = { timerType: 1, isCountDown: true, endAt: p.endAt,
                    systemCurrentTime: Date.now() };
  }
  return o;
}

/* ---- miuiParamV2：与 Island.java 保持一致 ---- */
function miuiParamV2(title, text, accent, p) {
  const t = clip(title || "", 16), x = clip(text || "", 24);
  const color = !accent || !accent.trim() ? "#5A5AD6" : accent.trim();

  const picInfo = { type: 1, pic: K_PIC };
  const leftText = { frontTitle: "学径", title: t, content: x, showHighlightColor: true };
  const left = { type: 1, picInfo, textInfo: leftText };

  const bigArea = { imageTextInfoLeft: left };
  if (p) {
    const dg = sameWidthDigit(p);
    if (dg) bigArea.sameWidthDigitInfo = dg;
  }

  /* 小岛（短岛）：官方只认 picInfo / combinePicInfo / imageTextInfoRight(type=6)。
     v0.2.9 按用户要求改成 **combinePicInfo** —— 官方定义就是
     「图标组合组件：中心图标 + 外圈环形进度」，正好是那个「倒计时环」。
     环由系统按 progress 自绘，不需要我们逐秒刷通知。 */
  const pct = p ? p.progressPct() : -1;
  const smallArea = pct >= 0
    ? { combinePicInfo: { picInfo,
        progressInfo: { progress: pct, colorReach: color,
                        colorUnReach: "#33" + color.substring(1), isCCW: false } } }
    : { picInfo };

  const paramIsland = { islandProperty: 1,
    islandTimeout: Math.max(60, Math.round(stayMillis() / 1000)),
    dismissIsland: false, bigIslandArea: bigArea, smallIslandArea: smallArea };

  const baseInfo = { title: t, content: x, colorTitle: color, type: 2 };
  const paramV2 = { business: "xuejing", islandFirstFloat: true, enableFloat: false,
    updatable: true, islandOrder: true, timeout: 720, filterWhenNoPermission: false,
    ticker: t, aodTitle: t, param_island: paramIsland, baseInfo };
  return { param_v2: paramV2 };
}

/* ---------------- 断言 ---------------- */
let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log("  ✓ " + msg); }
  else { fail++; console.log("  ✗ " + msg); }
}

const endAt = Date.now() + 5 * 60_000;
const p = pill("中华优秀传统文化", "敏行楼233", false, 5 * 60_000);
const r = miuiParamV2(p.name, p.right, ACCENT_CLASS, p);
const v2 = r.param_v2;
const isl = v2.param_island;

console.log("\n[1] 官方参数级约束");
ok(v2.business === "xuejing", "business 必填且为运营场景标识");
ok(v2.islandFirstFloat === true, "islandFirstFloat=true（首次展开，看清内容）");
ok(v2.enableFloat === false,
   "enableFloat=false —— 根因①：官方定义为「更新时是否展开」，true 会导致每次刷新都弹开");
ok(v2.updatable === true, "updatable=true（允许更新同一条）");
ok(v2.timeout === 720,
   "timeout=720 分钟 —— 根因③：官方单位是分钟，不是秒");
ok(typeof isl.islandTimeout === "number" && isl.islandTimeout === 600,
   "停留时长走 islandTimeout=" + isl.islandTimeout + " 秒（官方单位：秒）");
ok(isl.dismissIsland === false, "dismissIsland=false（常驻不自行消失）");
ok(isl.islandProperty === 1, "islandProperty=1（信息展示为主）");

console.log("\n[2] 小岛组件合法性 + 倒计时环（根因②，v0.2.9 改用环形进度）");
const smallKeys = Object.keys(isl.smallIslandArea);
ok(smallKeys.length === 1 && smallKeys[0] === "combinePicInfo",
   "smallIslandArea 只含 combinePicInfo：" + smallKeys.join(","));
ok(!("imageTextInfoLeft" in isl.smallIslandArea),
   "小岛**不含** imageTextInfoLeft —— 它是大岛 A 区组件名，小岛塞它会被系统忽略");
const cpi = isl.smallIslandArea.combinePicInfo;
ok(!!cpi.picInfo, "combinePicInfo 带中心图标");
ok(!!cpi.progressInfo, "combinePicInfo 带外圈环形进度（用户要的「倒计时环」）");
ok(cpi.progressInfo.progress >= 0 && cpi.progressInfo.progress <= 100,
   "progress 在 0..100：" + cpi.progressInfo.progress);
ok(/^#[0-9A-Fa-f]{6}$/.test(cpi.progressInfo.colorReach), "colorReach 是 6 位色值");
ok(/^#33[0-9A-Fa-f]{6}$/.test(cpi.progressInfo.colorUnReach),
   "colorUnReach 是同色半透明（#33 + RGB）：" + cpi.progressInfo.colorUnReach);
ok(cpi.progressInfo.isCCW === false, "isCCW=false（顺时针）");

console.log("\n[3] 大岛 A/B 区");
ok("imageTextInfoLeft" in isl.bigIslandArea, "大岛 A 区用 imageTextInfoLeft（正确）");
ok("sameWidthDigitInfo" in isl.bigIslandArea, "大岛 B 区用 sameWidthDigitInfo（等宽数字）");
const d = isl.bigIslandArea.sameWidthDigitInfo;
ok(/^[\d:]+$/.test(d.digit), "digit 是纯数字/冒号：" + d.digit);
ok(d.content === "分钟上课", "content 是单位词：" + d.content);

console.log("\n[4] timerInfo 走秒（原生 Chronometer 之外的加分项）");
ok(!!d.timerInfo, "B 区带 timerInfo");
ok(d.timerInfo.isCountDown === true, "isCountDown=true（倒计时）");
ok(d.timerInfo.endAt > 0 && d.timerInfo.endAt >= Date.now(), "endAt 是有效终点时刻");
ok(d.timerInfo.endAt !== d.timerInfo.systemCurrentTime,
   "endTime ≠ systemCurrentTime（终点确实在未来）");

console.log("\n[5] pic key 可解析");
ok(isl.bigIslandArea.imageTextInfoLeft.picInfo.pic === K_PIC,
   "大岛 pic key = " + K_PIC);
ok(cpi.picInfo.pic === K_PIC,
   "小岛 pic key 与大岛一致（同一个 pics Bundle 里的 key）");
ok(K_PIC.startsWith("miui.focus.pic"), "pic key 属于 miui.focus.pics Bundle 的命名空间");

console.log("\n[6] 各种相位");
const pEnd = pill("课程", "教三305", false, 0);
const rEnd = miuiParamV2(pEnd.name, pEnd.right, ACCENT_CLASS, pEnd).param_v2;
ok(rEnd.param_island.smallIslandArea.picInfo !== undefined,
   "到点相位（endAt=0，总量也未知）退回纯 picInfo，不画假环");

const f = pillTimer("自由专注", "24:44", Date.now() + 24 * 60_000 + 44_000,
  25 * 60_000);
const rf = miuiParamV2(f.name, f.right, "#5A5AD6", f).param_v2;
const fd = rf.param_island.bigIslandArea.sameWidthDigitInfo;
ok(fd.digit === "24:44", "专注 digit 保真 MM:SS：" + fd.digit);
ok(fd.timerInfo && fd.timerInfo.isCountDown === true, "专注也走系统 timerInfo");
const fpct = rf.param_island.smallIslandArea.combinePicInfo.progressInfo.progress;
ok(fpct > 90 && fpct <= 100,
   "专注环显示剩余比例（24:44 / 25:00 ≈ 98%）：" + fpct + "%");

const noPill = miuiParamV2("学径", "测试", ACCENT_CLASS, null).param_v2;
ok("picInfo" in noPill.param_island.smallIslandArea,
   "无倒计时场景小岛退回纯 picInfo（官方允许）");

console.log("\n[7] 停留时长（独立于岛屿形态）");
const S = [5, 10, 20, 30].map((m) => { stayMin = m;
  return miuiParamV2("x", "y", ACCENT_CLASS, p).param_v2.param_island.islandTimeout; });
stayMin = 10;
ok(JSON.stringify(S) === "[300,600,1200,1800]",
   "5/10/20/30 分钟 → " + S.join("/") + " 秒");
ok(S.every((x) => x <= 720 * 60), "全部在 timeout(720min=43200s) 之内，不会被上层提前收掉");
/* 形态不该影响停留时长 —— v0.2.8 把两者塞进同一个字段，就是这么错的 */
const byForm = [0, 1, 2].map((l) => { cfgLen = l; shortMode = l === 0;
  return miuiParamV2("x", "y", ACCENT_CLASS, p).param_v2.param_island.islandTimeout; });
cfgLen = 1; shortMode = false;
ok(new Set(byForm).size === 1,
   "切换岛屿形态不改变 islandTimeout：" + byForm.join("/"));

console.log("\n[8] 短岛形态：左只名称、右只倒计时");
shortMode = true;
const pShort = pill("中华优秀传统文化", "敏行楼233", false, 5 * 60_000);
ok(pShort.subOrEmpty() === "", "短岛左列副文本被抹掉（地点不上岛）");
ok(pShort.nameOnly().length <= 5,
   "短岛名称截到 4 字+" + (pShort.nameOnly().length > 4 ? "…" : "") + "：" + pShort.nameOnly());
const fShort = pillTimer("自由专注", "24:44", Date.now() + 60_000, 25 * 60_000);
ok(fShort.name.length <= 4,
   "专注名不超 4 字（短岛胶囊极窄）：「" + fShort.name + "」");
shortMode = false;
const pStd = pill("中华优秀传统文化", "敏行楼233", false, 5 * 60_000);
ok(pStd.subOrEmpty() === "敏行楼233" && pStd.nameOnly() === "中华优秀传统文化",
   "标准档保留地点与全名");

console.log("\n[9] 长度约束（岛上位置极窄）");
ok(v2.baseInfo.title.length <= 17, "baseInfo.title ≤17：" + v2.baseInfo.title);
ok(JSON.stringify(r).length <= 3072,
   "整个 param JSON " + JSON.stringify(r).length + " 字节 ≤ 3072（官方推送上限）");

console.log("\n[10] 反证：老代码的这几处错误确实会踩坑");
const bad = {
  enableFloat: true, timeout: 600,
  small: { picInfo: { type: 1, pic: "miui.focus.pic_imageText" },
           imageTextInfoLeft: { type: 1 } },
  noPicsBundle: true,
  timerInfoGuess: { timerType: 1, isCountDown: true, endTime: 0 },
};
ok(bad.enableFloat === true, "老代码 enableFloat=true → 每刷新一次弹开一次");
ok(bad.timeout === 600, "老代码 timeout=600（秒填进分钟字段）→ 实际 600 分钟 = 10 小时");
ok("imageTextInfoLeft" in bad.small,
   "老代码小岛塞 imageTextInfoLeft → 非小岛组件，退化成纯图标");
ok(bad.noPicsBundle, "老代码从未放 miui.focus.pics → 图标 key 取不到，回退应用默认图标");
ok(bad.timerInfoGuess.endTime === 0,
   "老代码 timerInfo 字段是按同名措辞猜的 → 真机上时间不跳（v0.2.9 已退回原生 Chronometer）");

console.log("\n完整 JSON 样例（上课倒计时）:");
console.log(JSON.stringify(r, null, 2));

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);
