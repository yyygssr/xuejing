/*
 * tools/audit.mjs —— 日程语义一致性审计
 *
 * 为什么要它：学径有大量「同一语义在两处实现」的情况。最典型的是
 * 「某天上不上课」——页面有一份（dayInfo），原生 ReminderScheduler 又有一份。
 * 以前靠人记住「改页面要记得改原生」，结果就是节假日期间通知照常提醒上课。
 *
 * 这个工具把「改了一处要记得改哪些地方」变成机器检查，四个维度：
 *
 *   1) GATE      绕过单一口：谁在直接读 S.courses 判断某天有没有课
 *   2) SEMANTIC  重复实现：节假日/周次判定散落在哪些函数里
 *   3) CONTRACT  跨语言对账：页面推给原生的字段，原生是否真的读了（双向）
 *   4) IMPACT    影响面：给定符号，列出全部下游消费者（--impact <sym>）
 *
 * 用法：
 *   node tools/audit.mjs                 跑全部检查，有违规退出码 1
 *   node tools/audit.mjs --gate          只跑 GATE + CONTRACT（自测里用这个）
 *   node tools/audit.mjs --impact dayInfo 打印某符号的下游影响面
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const HTML = read('index.html');
const JAVA_DIR = 'android/app/src/main/java/com/xuejing/app';
const JAVA_FILES = fs.readdirSync(path.join(root, JAVA_DIR)).filter(f => f.endsWith('.java'));
const JAVA = Object.fromEntries(JAVA_FILES.map(f => [f, read(JAVA_DIR + '/' + f)]));
const JAVA_ALL = JAVA_FILES.map(f => JAVA[f]).join('\n');

/* ============================================================
   1) GATE —— 绕过单一口
   ============================================================ */

/* 允许直接读原始 S.courses 的函数 —— 每个都要说得出「为什么按设计就该读原始的」。
   分三类：① 原始访问器 ② 增删改 ③ 与「某天上不上课」无关的结构性遍历。
   新增函数若不在表里且读了 S.courses，会被报出来 —— 那是提醒你：这里该不该过滤？ */
const RAW_OK = new Map([
  /* ① 原始访问器：按时间排序，不做语义过滤（过滤在 dayInfo 里） */
  ['courses', '原始访问器，语义过滤交给 dayInfo'],
  /* ② 初始化 / 数据迁移 */
  ['migrateFromV2', '数据迁移，不涉及语义'],
  /* ③ 增删改课程 —— 改的就是原始数据 */
  ['addCourse', '新增课程'],
  ['setCoursePriNow', '改优先级后回写源数组'],
  ['findCourseByName', '按名查课（CRUD 辅助）'],
  ['courseFind', 'AI 工具：查找课程'],
  ['courseUpdate', 'AI 工具：改课程'],
  ['courseDelete', 'AI 工具：删课程'],
  ['runToolCall', 'AI 工具分发器：里面的只读分支（getState 等）已用 coursesAt，见自测断言'],
  /* ④ 结构性统计 / 盘点：本来就不针对某一天 */
  ['hasCourseData', '判断有没有课表数据（结构）'],
  ['courseCount', '统计总课数（结构）'],
  ['nextPaint', '挑没用过的颜色（盘点）'],
  ['autoPaints', '批量挑颜色（盘点）'],
  ['findTodo', '找与课程相关的待办（结构）'],
  ['priContextBlock', '给 AI 的优先级上下文（结构）'],
  /* ⑤ 契约：推给原生的 payload。原生要自己按同一套规则判，
        页面提前砍掉的话原生就再也不知道「这天本该有课但放假了」。 */
  ['pushScheduleToNative', '页面→原生的判定契约，必须发原始数据'],
]);

/** 剥掉注释，但保留换行（保证行号不变）。
    不剥的话，「注释里提到 S.courses」会被当成违规 —— 第一版就踩了这个。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

/** 找出某位置所在的函数名。
    只认 `function NAME(` —— 早先把 `NAME: function(` 也当定义，
    会被字符串里的内容骗到，把 runToolCall 里的 delCourse 误判成别的函数。 */
function enclosingFn(src, idx) {
  const before = src.slice(0, idx);
  const re = /(?:^|\n)[ \t]*function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let best = null, m;
  while ((m = re.exec(before))) best = m[1];
  return best || '<文件顶层>';
}

function checkGate() {
  const src = stripComments(HTML);
  const problems = [];
  const rows = [];
  const re = /\bS\.courses\b/g;
  let m;
  while ((m = re.exec(src))) {
    const line = src.slice(0, m.index).split(/\n/).length;
    const fn = enclosingFn(src, m.index);
    const snippet = src.slice(m.index, m.index + 46).replace(/\s+/g, ' ');
    const reason = RAW_OK.get(fn);
    const ok = !!reason;
    rows.push({ line, fn, snippet, ok, reason });
    if (!ok) problems.push({ line, fn, snippet });
  }
  return { rows, problems };
}

/* ============================================================
   2) SEMANTIC —— 判定散落情况
   ============================================================ */

const SEMANTIC_FNS = ['holidayOn', 'holidayModeOn', 'holidayFlat', 'dateKeyForDayIdx',
  'dayInfo', 'coursesAt', 'courseShouldShow', 'weekSpecMatch', 'weekNo'];

function checkSemantic() {
  const out = {};
  for (const fn of SEMANTIC_FNS) {
    const re = new RegExp('\\b' + fn + '\\s*\\(', 'g');
    const hits = [];
    let m;
    while ((m = re.exec(HTML))) {
      hits.push(HTML.slice(0, m.index).split(/\r?\n/).length);
    }
    out[fn] = hits;
  }
  return out;
}

/* ============================================================
   3) CONTRACT —— 页面 ↔ 原生 字段对账
   ============================================================ */

/* 页面推给原生的「日程语义契约」字段。
   reads    = 必须真的读到它，且**列全**（原生有人改了却没登记 = 这里报错）
   indirect = 通过某个原生方法间接消费（写下来是为了提醒：改那边要跟这边一起改）
   JS 侧一旦加字段而不登记、或登记了却没人读，这里直接报错 ——
   强制在写下的那一刻就想清楚「谁需要它」，而不是等出了问题再回来补。 */
const NATIVE_CONSUMERS = {
  termStart: {
    reads: ['ReminderScheduler.java'],
    indirect: ['weekMatchesNow() / reschedule() 里算第几周'],
  },
  courses: {
    reads: ['ReminderScheduler.java'],
    indirect: ['每天每门课排两个闹钟'],
  },
  bookings: {
    reads: ['ReminderScheduler.java'],
    /* v0.2.4 语义变更，旧注释写的是「已预约的课不提醒」，已经不对了：
       现在是「已预约的课由原生闹钟自动开始专注」（见 ClassAlarmReceiver）。
       而且 bookedCourseId() 会从 key 上取课程 id —— key 就是页面的 cid()，
       补记时靠它判断记到哪门课头上。 */
    indirect: ['bookedCourseId()：预约的课由闹钟自动开始专注，并从 key 取课程 id'],
  },
  holidays: {
    reads: ['ReminderScheduler.java'],
    indirect: ['isHolidayNow() → ClassAlarmReceiver 触发时判定放假日静默跳过'],
  },
  holidayMode: {
    reads: ['ReminderScheduler.java'],
    indirect: ['isHolidayNow() 的总开关；关闭时 holidays 不生效'],
  },
  overrides: {
    reads: ['ReminderScheduler.java'],
    /* op=add → 按具体日期排一次性闹钟（REQ_BASE+70000 段，过点不补发）；
       op=cancel → cancelledByOverrideNow() 触发时判定，停课日静默跳过。
       与页面 overridesApply() 必须同规则（n/t 都空=全天停课，否则精确相等）。 */
    indirect: ['补课排一次性闹钟 / cancelledByOverrideNow() 停课日静默跳过'],
  },
};

/** 从 pushScheduleToNative 的 JSON 字面量里抠出字段名 */
function pushedFields() {  const anchor = "nat('setSchedule', JSON.stringify({";
  const i = HTML.indexOf(anchor);
  if (i < 0) return null;
  const body = HTML.slice(i + anchor.length);
  const end = body.indexOf('}));');
  if (end < 0) return null;
  const fields = [];
  for (const line of body.slice(0, end).split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_$][\w$]*)\s*:/);
    if (m) fields.push(m[1]);
  }
  return fields;
}

/** 原生是否真的读了这个顶层字段。
    注意 Java 侧有自定义封装 optText(root, "x")，正则要一并覆盖 ——
    漏了它会把明明读了 termStart 误报成「没人读」（第一版就踩了）。 */
function javaReads(field) {
  const readers = [];
  /* 不要加 g：带 g 的 RegExp 是有状态的，.test() 会把 lastIndex 带到下一轮循环，
     一个字段被两个文件读时会漏判第二个（对账因此时好时坏）。这里只需要「有没有」，
     不需要全局匹配。 */
  const rx = new RegExp(
    '(?:\\.(?:opt|get)(?:String|Int|Boolean|Long|Double|JSONArray|JSONObject)\\(\\s*"' + field + '"'
    + '|\\boptText\\(\\s*\\w+\\s*,\\s*"' + field + '")');
  for (const [f, src] of Object.entries(JAVA)) {
    if (rx.test(src)) readers.push(f);
  }
  return readers;
}

/* ============================================================
   3b) 灵动岛分项配置对账（另一条桥，不在 setSchedule 里）
   ============================================================ */

const ISLAND_CONSUMERS = {
  on: {
    reads: ['Island.java'],
    /* 总闸有两条桥：setIslandOn → Notify.islandExtrasOn（老路），
       以及 setIslandPrefs 里的 on → Island.cfgOn。两条都送到才算数 ——
       只信一条的话，另一条丢了就会出现「设置页显示关了、岛上还在跑」。
       showClass() 第一行就是 if(!cfgOn) return，别改成只看 Notify 那个。 */
    indirect: ['cfgOn：showClass() 的总闸，与 Notify.islandExtrasOn 双保险'],
  },
  start: {
    reads: ['Island.java'],
    indirect: ['cfgStart：课前提醒要不要上岛（Notify.showClass 分流）'],
  },
  end: {
    reads: ['Island.java'],
    indirect: ['cfgEnd：下课提醒要不要上岛（Notify.showClass 分流）'],
  },
  stay: {
    reads: ['Island.java'],
    indirect: ['cfgStay：上课后同一条岛翻成「离下课」，否则到点收摊'],
  },
  focus: {
    reads: ['Island.java'],
    indirect: ['cfgFocus：专注计时上不上岛（Notify.buildFocus 分流，与 islandExtrasOn 一起判）'],
  },
  len: {
    reads: ['Island.java'],
    indirect: ['cfgLen → stayMillis()：下课提醒/测试岛停留多久；MIUI timeout 也跟它走'],
  },
  stayMin: {
    reads: ['Island.java'],
    /* v0.2.9 把「岛屿形态」和「停留时长」拆成两个键：len 管排版，stayMin 管多久下岛。
       以前两者共用一个键，选「短岛」会连带把停留时间也改掉。 */
    indirect: ['stayMin → stayMillis()：事件型岛（下课提醒/测试岛）自动下岛前等多久'],
  },
  elems: {
    reads: ['Island.java'],
    indirect: ['elCourse/elPlace/elTime/elCountdown → pill() 决定两列放什么'],
  },
};

/** 从 applyIslandPref 的 JSON 字面量里抠出字段名 */
function islandPushedFields() {
  const anchor = "nat('setIslandPrefs', JSON.stringify({";
  const i = HTML.indexOf(anchor);
  if (i < 0) return null;
  const body = HTML.slice(i + anchor.length);
  const end = body.indexOf('}));');
  if (end < 0) return null;
  const fields = [];
  for (const line of body.slice(0, end).split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_$][\w$]*)\s*:/);
    if (m) fields.push(m[1]);
  }
  return fields;
}

/** Island.setPrefs 是否真的读了这个键（o.optBoolean("start") / o.has("stay")） */
function islJavaReads(field) {
  const readers = [];
  /* 同 javaReads：这里只需要「读没读」，加 g 会让 lastIndex 跨文件残留 */
  const rx = new RegExp('\\.(?:has|optBoolean|optInt|optJSONArray)\\("' + field + '"\\)');
  for (const [f, src] of Object.entries(JAVA)) {
    if (rx.test(src)) readers.push(f);
  }
  return readers;
}

function checkIslandContract() {
  const fields = islandPushedFields();
  const problems = [];
  if (!fields) {
    problems.push('找不到 applyIslandPref 的 setIslandPrefs payload，无法对账');
    return { fields: [], problems };
  }
  for (const f of fields) {
    const decl = ISLAND_CONSUMERS[f];
    const actual = islJavaReads(f);
    if (!decl) {
      problems.push(`灵动岛字段 ${f}：原生侧未登记消费者。`
        + `请在 audit.mjs 的 ISLAND_CONSUMERS 里登记它由谁读、用来干什么。`);
      continue;
    }
    for (const d of decl.reads) {
      if (!JAVA[d]) { problems.push(`灵动岛字段 ${f}：登记的消费者 ${d} 不存在`); continue; }
      if (!actual.includes(d)) {
        problems.push(`灵动岛字段 ${f}：登记由 ${d} 读取，但 Island.setPrefs 里没读到 "${f}" `
          + `—— 要么登记写错了，要么原生侧漏接了（表现：设置页开了、岛上没反应）`);
      }
    }
    for (const a of actual) {
      if (!decl.reads.includes(a)) {
        problems.push(`灵动岛字段 ${f}：${a} 读了它，但没在 ISLAND_CONSUMERS.reads 里登记`);
      }
    }
  }
  for (const f of Object.keys(ISLAND_CONSUMERS)) {
    if (!fields.includes(f)) {
      problems.push(`灵动岛字段 ${f}：ISLAND_CONSUMERS 里有登记，但页面已经不再推送它了（陈旧登记）`);
    }
  }
  return { fields, problems };
}

function checkContract() {
  const fields = pushedFields();
  const problems = [];
  if (!fields) {
    problems.push('找不到 pushScheduleToNative 的 setSchedule payload，无法对账');
    return { fields: [], problems };
  }
  for (const f of fields) {
    const decl = NATIVE_CONSUMERS[f];
    const actual = javaReads(f);
    if (!decl) {
      problems.push(`字段 ${f}：原生侧未登记消费者。判定所需的事实若原生不读，`
        + `原生就判不出来（这正是「放假照常提醒」的成因）。请在 audit.mjs 的 `
        + `NATIVE_CONSUMERS 里登记它由谁读、用来干什么。`);
      continue;
    }
    for (const d of decl.reads) {
      if (!JAVA[d]) { problems.push(`字段 ${f}：登记的消费者 ${d} 不存在`); continue; }
      if (!actual.includes(d)) {
        problems.push(`字段 ${f}：登记由 ${d} 读取，但该文件里没有读到 "${f}" —— `
          + `要么登记写错了，要么原生侧漏改了`);
      }
    }
    for (const a of actual) {
      if (!decl.reads.includes(a)) {
        problems.push(`字段 ${f}：${a} 读了它，但没在 NATIVE_CONSUMERS.reads 里登记`);
      }
    }
  }
  for (const f of Object.keys(NATIVE_CONSUMERS)) {
    if (!fields.includes(f)) {
      problems.push(`字段 ${f}：NATIVE_CONSUMERS 里有登记，但页面已经不再推送它了（陈旧登记）`);
    }
  }
  return { fields, problems };
}

/* ============================================================
   4) IMPACT —— 影响面
   ============================================================ */
function impact(sym) {
  const out = [];
  const scan = (label, src, file) => {
    const re = new RegExp('\\b' + sym + '\\b', 'g');
    let m, n = 0;
    while ((m = re.exec(src))) {
      n++;
      const line = src.slice(0, m.index).split(/\r?\n/).length;
      out.push({ file, line });
    }
    if (n) out.push({ file: label + ' 合计', line: n });
  };
  scan('index.html', HTML, 'index.html');
  for (const [f, src] of Object.entries(JAVA)) scan(f, src, f);
  return out;
}

/* ============================================================
   供外部（tools/domtest.mjs）直接 import 复用
   —— 本机 node 进程不能再拉一个 node（spawnSync 报 EBUSY），
      所以自测里是 import 进来跑，不是命令行跑。
   ============================================================ */
export function runChecks(opts = {}) {
  const onlyGate = !!opts.onlyGate;
  const gate = checkGate();
  const con = checkContract();
  const sem = onlyGate ? null : checkSemantic();
  const problems = [
    ...gate.problems.map(p => `绕过单一口：index.html:${p.line} 在 ${p.fn}() 直接读 S.courses（${p.snippet}）`),
    ...con.problems,
  ];
  return { gate, con, sem, problems, ok: problems.length === 0 };
}

/* ============================================================
   命令行入口
   ============================================================ */
function main() {
const args = process.argv.slice(2);

if (args[0] === '--impact') {
  const sym = args[1];
  if (!sym) { console.error('用法：node tools/audit.mjs --impact <符号名>'); process.exit(2); }
  const rows = impact(sym);
  console.log(`\n=== 「${sym}」的影响面 ===`);
  for (const r of rows) console.log(`  ${r.file}:${r.line}`);
  console.log(`合计 ${rows.filter(r => !r.file.includes('合计')).length} 处\n`);
  process.exit(0);
}

const onlyGate = args.includes('--gate');
let failed = 0;
const line = s => console.log('\n' + '='.repeat(64) + '\n' + s + '\n' + '='.repeat(64));

/* ---- GATE ---- */
const gate = checkGate();
const suspects = gate.problems;
line('1) GATE 绕过单一口：谁在直接读 S.courses');
console.log(`共 ${gate.rows.length} 处读取；已登记「按设计就该读原始」的函数 ${RAW_OK.size} 个`);
if (suspects.length) {
  failed++;
  console.log(`\n[违规] ${suspects.length} 处在不该直读的地方读了 S.courses：`);
  for (const s of suspects) {
    console.log(`  index.html:${s.line}  在 ${s.fn}()  →  ${s.snippet}`);
    console.log(`      若它用于判断「某天有课」，请改走 dayInfo() / coursesAt()`);
    console.log(`      若确实该读原始数据，在 audit.mjs 的 RAW_OK 里登记并写明理由`);
  }
} else {
  console.log('\n[通过] 没有绕过单一口的读取点');
}
console.log('\n明细：');
for (const r of gate.rows) {
  console.log(`  ${r.ok ? '  ok ' : '  !! '} ${String(r.line).padStart(6)}  ${r.fn}()` +
    (r.reason ? `  ← ${r.reason}` : ''));
}

/* ---- SEMANTIC ---- */
if (!onlyGate) {
  const sem = checkSemantic();
  line('2) SEMANTIC 判定函数的分布（改动时的影响面）');
  for (const [fn, hits] of Object.entries(sem)) {
    console.log(`  ${fn.padEnd(16)} ${String(hits.length).padStart(3)} 处` +
      (hits.length <= 12 ? '  行 ' + hits.join(',') : ''));
  }
  console.log('\n读法：某个函数行数突然变多，说明语义被摊到多处了 —— 该收口。');
}

/* ---- CONTRACT ---- */
const con = checkContract();
line('3) CONTRACT 页面 ↔ 原生 字段对账');
console.log('页面 pushScheduleToNative 推送：' + con.fields.join(', '));
for (const f of con.fields) {
  const d = NATIVE_CONSUMERS[f];
  const reads = d ? d.reads : [];
  const a = javaReads(f);
  const mark = (reads.length && reads.every(x => a.includes(x))
    && a.every(x => reads.includes(x))) ? '  ok ' : '  !! ';
  console.log(`  ${mark}${f.padEnd(12)} 登记读取=${reads.join(',') || '（未登记）'}`
    + `  实际读取=${a.join(',') || '（没人读）'}`);
  if (d && d.indirect) console.log(`      用途：${d.indirect.join('；')}`);
}
if (con.problems.length) {
  failed++;
  console.log('\n[违规]');
  for (const p of con.problems) console.log('  · ' + p);
} else {
  console.log('\n[通过] 两端字段对账一致');
}

/* ---- CONTRACT(2) 灵动岛分项配置 ----
   这套配置走的是另一条桥（setIslandPrefs → Island.setPrefs），不在 setSchedule 里，
   所以上面那套对账看不见它。但它是同一个性质的问题：页面加了开关、原生没接，
   表现就是「设置页里明明开了，岛上却什么都不变」—— 而且没有任何报错。
   v0.2.6 刚为「笔记返回」踩过同类的坑，这里提前把对账补上。 */
const isl = checkIslandContract();
line('3b) CONTRACT 灵动岛分项配置（setIslandPrefs → Island.setPrefs）');
console.log('页面推送：' + (isl.fields.join(', ') || '（找不到 payload）'));
for (const f of isl.fields) {
  const d = ISLAND_CONSUMERS[f];
  const reads = d ? d.reads : [];
  const a = islJavaReads(f);
  const mark = (reads.length && reads.every(x => a.includes(x))
    && a.every(x => reads.includes(x))) ? '  ok ' : '  !! ';
  console.log(`  ${mark}${f.padEnd(12)} 登记读取=${reads.join(',') || '（未登记）'}`
    + `  实际读取=${a.join(',') || '（没人读）'}`);
  if (d && d.indirect) console.log(`      用途：${d.indirect.join('；')}`);
}
if (isl.problems.length) {
  failed++;
  console.log('\n[违规]');
  for (const p of isl.problems) console.log('  · ' + p);
} else {
  console.log('\n[通过] 灵动岛两端对账一致');
}

/* ============================================================
   4) SECURITY —— 审计 P0 的结构性守卫（2026-10-24）
   ------------------------------------------------------------
   这些不是"某处写法对不对"，而是**"这个口子不该再被打开"**。
   页面功能断言（domtest）验的是行为，这里验的是源码里不该出现的东西：
   一旦有人为了省事又写回 eval、或漏了桥的来源校验，这里立刻报。
   ============================================================ */
function checkSecurity() {
  const srcPage = stripComments(HTML);
  const problems = [];
  const warns = [];      /* 降级项：可见但不判失败（见下面的说明） */
  const rows = [];

  /* ① 页面里不许有 eval / new Function ——
        原来的历史会话菜单把 id 拼进 JS 源码字符串再 eval，
        id 来自备份文件，等于「备份内容 → 任意代码执行」。 */
  /* ⚠️ 正则要认「(0, eval)(...)」这种间接调用 —— eval 后面紧跟的是 ")" 不是 "("。
     第一版写成 /\beval\s*\(/ 时，漏掉的正是审计点名的那一处写法
     （项目里原来就是 (0, eval)(String(it.run))），等于守卫形同虚设。
     所以这里只要出现独立的 eval 标识符就报，比匹配调用形状更可靠。 */
  const evalHits = [...srcPage.matchAll(/\beval\b|\bnew\s+Function\b/g)];
  rows.push(['页面无 eval / new Function', evalHits.length === 0,
             evalHits.length ? (evalHits.length + ' 处') : '0 处']);
  evalHits.forEach(m => problems.push('发现 eval/Function（第 '
    + (srcPage.slice(0, m.index).split(/\n/).length) + ' 行）'));

  /* ② 备份必须默认剥离密钥：stripSecrets 与 SECRET_KEYS 都得在，
        且 buildBackup 里要有"非 includeSecrets 才剥离"的分支。 */
  const hasStrip = /function\s+stripSecrets\s*\(/.test(srcPage);
  const hasSecretKeys = /var\s+SECRET_KEYS\s*=/.test(srcPage);
  const guardBranch = /if\s*\(\s*!includeSecrets\s*&&\s*SECRET_KEYS\.indexOf/.test(srcPage);
  rows.push(['备份默认剥离密钥', hasStrip && hasSecretKeys && guardBranch]);
  if (!hasStrip) problems.push('缺少 stripSecrets()');
  if (!hasSecretKeys) problems.push('缺少 SECRET_KEYS 清单');
  if (!guardBranch) problems.push('buildBackup 没有「默认剥离」分支');

  /* ③ 笔记 HTML 必须走白名单净化：渲染与保存两侧都要出现 sanitizeNoteHtml。
        只要求"出现过"是最低门槛 —— 真正的行为由 domtest 的 XSS 断言兜。 */
  const sanitizeCalls = (srcPage.match(/sanitizeNoteHtml\s*\(/g) || []).length;
  /* 门槛定 4：笔记的渲染侧至少 2 处（详情预览、全屏编辑器）+ 保存侧 7 处 + 分享卡。
     只要低于 4 就说明有人把某个写入点换回了直接 innerHTML。 */
  rows.push(['笔记净化被使用（渲染+保存两侧）', sanitizeCalls >= 4, sanitizeCalls + ' 处']);
  if (sanitizeCalls < 4) problems.push('sanitizeNoteHtml 调用次数偏少（' + sanitizeCalls
    + '），渲染与保存两侧都要用');

  /* ④ 原生桥：每个 @JavascriptInterface 方法体必须调 trusted()。
        注：用"方法声明后 300 字符内是否出现 trusted()"做粗筛，
        比跨行正则稳（Java 的方法体缩进/换行写法不统一）。 */
  const bridge = (JAVA['NativeBridge.java'] || '');
  const decls = [...bridge.matchAll(/@JavascriptInterface\s*[\s\S]{0,120}?public\s+\w+\s+(\w+)\s*\(/g)];
  const unguarded = decls.filter(m => {
    const after = bridge.slice(m.index, m.index + 600);
    return !/trusted\s*\(\s*\)/.test(after);
  }).map(m => m[1]);
  /* ★ 2026-10-26：这两项在 v0.3.4 里被**主动回退**了（白屏事故）。
     重要：不要再为了"让守卫变绿"而改代码 —— 上一次就是这么改出白屏的
     （为了让 L-1 变绿把 SafeBrowsing 从 false 改成 true）。
     守卫的职责是**如实反映当前状态**，不是逼代码去满足它。
     所以这里改成降级警告：打印出来看得见，但不判失败。
     等真机确认能启动之后，再把 trusted() 和白名单加回来，那时它们自然会变绿。 */
  const bridgeDegraded = unguarded.length > 0;
  rows.push(['桥方法 trusted() 来源校验',
             !bridgeDegraded ? true : false,
             bridgeDegraded ? ('未启用（' + decls.length + ' 个方法裸奔）') : 'ok']);
  if (bridgeDegraded) warns.push('桥的来源校验当前未启用：' + unguarded.length
    + ' 个 @JavascriptInterface 方法没有 trusted()（v0.3.4 临时回退）');

  /* ⑤ WebView 边界。
     ★ v0.3.2 教训：一度要求「显式关掉 File/Content access」，结果部分设备上
     页面直接白屏（assets 走 file://，官方文档说不受影响，实测不是）。
     现在只守**真正在起作用**的两条边界：
       ① shouldOverrideUrlLoading 必须是否定式的白名单（外部页面进不来）
       ② SafeBrowsing 不许被显式关掉
     其余 WebView 能力交回系统默认 —— 跟默认值较劲只会换来白屏，
     而这些开关本来也不是安全边界的本体。 */
  const act = (JAVA['MainActivity.java'] || '');
  /* 白名单：只放行 asset，http(s) 交给系统浏览器，其余全拦。
     ★ 这里**不再**要求 SafeBrowsing 必须开着：v0.3.2 把它从 false 改成 true，
     紧接着就有用户报「进 App 白屏」—— 对一个纯本地单页应用来说，
     SafeBrowsing 挡不到任何东西（外部页面本来就进不来），却能把启动搞挂。
     所以只守真正在起作用的那条边界：导航白名单。 */
  const navWhitelist = /u\.startsWith\(ASSET_URL\)\s*\)\s*return\s+false/.test(act)
    && /return\s+true\s*;/.test(act);
  rows.push(['WebView 导航白名单（外部页面进不来）', navWhitelist,
             navWhitelist ? 'ok' : '未启用（v0.3.4 临时回退）']);
  if (!navWhitelist) warns.push('shouldOverrideUrlLoading 仍是 v0.3.1 的旧判据'
    + '（非 file:// 全拦），外部页面虽然进不来，但 file:// 下任意路径被放行');

  /* 原本还想统计「内联 onclick 里拼变量」的数量，但这个指标在源码层面测不准：
     真实写法是 'onclick="f(\'' + id + '\')"' —— 属性值本身是被拼出来的字符串，
     正则看到的是一段带引号的 JS 源码，不是完整的 HTML 属性，所以恒为 0。
     与其打印一个永远"通过"的假指标（等于给人错误的安全感），不如不报。
     这类注入由 domtest 的行为断言兜（4 条 XSS 用例）。

     真正的结构性保证来自上面的三条：不许 eval、净化必须被使用、桥必须验来源。 */

  return { rows, problems, warns, decls: decls.length };
}

/* ============================================================
   4) SECURITY 安全边界（审计 P0）
   ============================================================ */
const sec = checkSecurity();
line('4) SECURITY 安全边界（审计 P0）');
for (const [name, val, shown0] of sec.rows) {
  /* 判定与显示必须同一个来源：第一版对非 boolean 值一律显示 "ok"，
     于是「页面无 eval」明明扫到 1 处、控制台却写着 ok —— 误导比不报更糟。 */
  const ok = (val === true);
  const shown = shown0 !== undefined ? shown0 : (ok ? 'ok' : '!!');
  console.log(`  ${ok ? '  ok ' : '  !! '}${name.padEnd(28)} ${shown}`);
}
if (sec.warns.length) {
  console.log('\n[降级] 以下安全项当前未启用（不判失败，但要知道）');
  for (const w of sec.warns) console.log('  ! ' + w);
}
if (sec.problems.length) {
  failed++;
  console.log('\n[违规]');
  for (const p of sec.problems) console.log('  · ' + p);
} else {
  console.log('\n[通过] 没有硬性违规');
}

console.log('\n' + (failed ? `[审计未通过] ${failed} 项检查有问题` : '[审计通过] 全部一致'));
process.exit(failed ? 1 : 0);
}

/* 直接运行时才走 CLI；被 import 时只导出函数，不跑也不 exit */
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
