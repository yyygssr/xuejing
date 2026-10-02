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
  ['renderSummaryQuick', '本周各科投入汇总（结构）'],
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
    indirect: ['isBooked()：已预约的课不提醒'],
  },
  holidays: {
    reads: ['ReminderScheduler.java'],
    indirect: ['isHolidayNow() → ClassAlarmReceiver 触发时判定放假日静默跳过'],
  },
  holidayMode: {
    reads: ['ReminderScheduler.java'],
    indirect: ['isHolidayNow() 的总开关；关闭时 holidays 不生效'],
  },
};

/** 从 pushScheduleToNative 的 JSON 字面量里抠出字段名 */
function pushedFields() {
  const anchor = "nat('setSchedule', JSON.stringify({";
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
  const rx = new RegExp(
    '(?:\\.(?:opt|get)(?:String|Int|Boolean|Long|Double|JSONArray|JSONObject)\\(\\s*"' + field + '"'
    + '|\\boptText\\(\\s*\\w+\\s*,\\s*"' + field + '")', 'g');
  for (const [f, src] of Object.entries(JAVA)) {
    if (rx.test(src)) readers.push(f);
  }
  return readers;
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

console.log('\n' + (failed ? `[审计未通过] ${failed} 项检查有问题` : '[审计通过] 全部一致'));
process.exit(failed ? 1 : 0);
}

/* 直接运行时才走 CLI；被 import 时只导出函数，不跑也不 exit */
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
