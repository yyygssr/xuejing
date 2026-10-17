package com.xuejing.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.graphics.drawable.Icon;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.widget.RemoteViews;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 「上岛」核心。
 *
 * 所谓上岛，本质就是一条**常驻（ongoing）低扰通知**，再在 extras 里塞一个私有布尔标志，
 * 让 Android 15+ 系统把它「提升」为 Live Updates（状态栏胶囊 / 灵动岛 / 厂商实况窗）。
 *
 * 真正生效的四项（缺一不可，见 技术框架.md「系统通知与上岛适配」）：
 *   1. 挂在 IMPORTANCE_LOW 静默通道上（高优通道会破坏 Live Updates 语义）
 *   2. setOngoing(true)（builder）+ 构建后置 FLAG_NO_CLEAR
 *   3. extras["android.requestPromotedOngoing"] = true   ← 最关键的一行
 *   4. 带 TAG 的 notify / cancel
 *
 * 例外：专注计时的前台服务通知走 **null TAG + Notify.ID_FOCUS**，
 * 这样才能与 startForeground 合并成同一条，不会在锁屏出现两条「专注中」。
 *
 * Android 15 以下第 3 步被系统忽略，通知自动退化为普通常驻低扰通知 —— 不报错、不崩溃。
 * 全程只用标准 NotificationManager + AlarmManager + 前台服务，不需要 root / Shizuku / 悬浮窗。
 *
 * ── 排版约定（v0.2.7 重做）──────────────────────────────────────────
 * 岛上给的位置极小，**微缩岛改成了自定义两列**（RemoteViews，见 res/layout/island_pill.xml）：
 *   左 = 小图标 + 课程名（+ 地点，副文本）
 *   右 = 倒计时「还有 N 分钟上课 / 下课」
 * 系统默认的通知排版是「左边一个图标、文字全挤在右边」，用户明确要求改掉。
 * 标题/正文仍然照旧给一份：自定义内容视图不被采用时（老系统、没拿到白名单的 ROM）
 * 系统会退回渲染它 —— 降级可以变丑，不能变空。
 *
 * 文案单点在 pill()：通知标题、RemoteViews、MIUI JSON 四处共用，
 * 各写一份的后果是屏幕上出现两个不一样的倒计时。
 *
 * 「课前」与「上课中」是**同一条通知的两种相位**（同 ID、改文案 + 延长下岛时间），
 * 不是两条岛 —— 拆两条的话交接瞬间会闪一下。
 *
 * 倒计时文字由 60 秒刷新闹钟推进（IslandActionReceiver 的 A_REFRESH → refresh()），
 * 只排到倒计时终点为止，不是无界轮询；也不用系统 chronometer ——
 * 它显示的是 MM:SS，用户要的是「还有多少分钟」。
 */
public final class Island {

    /** 上岛专用通道：低扰、无角标、无振动、无提示音 */
    public static final String CH_LIVE = "xuejing_live";
    /** 上岛通知统一走带 TAG 的 notify/cancel（cancel 时 TAG 与 ID 都要一致） */
    public static final String TAG_LIVE = "xuejing_live";

    /** AOSP 私有常量 EXTRA_REQUEST_PROMOTED_ONGOING；用字符串避免依赖具体 SDK 版本 */
    private static final String EXTRA_PROMOTED = "android.requestPromotedOngoing";
    private static final String PERM_PROMOTED = "android.permission.POST_PROMOTED_NOTIFICATIONS";

    static final String A_CLOSE = "com.xuejing.app.ISLAND_CLOSE";
    static final String A_HIDE = "com.xuejing.app.ISLAND_HIDE";
    static final String A_REFRESH = "com.xuejing.app.ISLAND_REFRESH";
    static final String K_ID = "island_id";

    /** 上岛通知 ID。1001 留给前台服务（null TAG），其余走 TAG_LIVE */
    public static final int ID_FOCUS = 1001;
    public static final int ID_CLASS_START = 2001;
    public static final int ID_CLASS_END = 2002;
    public static final int ID_TEST = 2003;

    /** 分场景左侧图标：专注用计时器，上课用书本，一眼能区分是哪类动态 */
    public static final int ICON_TIMER = R.drawable.ic_stat_timer;
    public static final int ICON_CLASS = R.drawable.ic_stat_class;

    public static final String ACCENT = "#5A5AD6";
    public static final String ACCENT_CLASS = "#4F7BE8";

    /* ---------- 分项偏好（页面 setIslandPrefs 推过来）----------
       以前岛上只有一个总开关，放什么、什么时候放全都不可配；
       且微缩岛走的是系统默认通知排版 —— 左边一个小图标、文字全挤在右边，
       用户明确要求改成「左边课程 + 图标、右边倒计时」。 */
    public static volatile boolean cfgOn = true;      // 总开关（与 Notify.islandExtrasOn 双保险）
    public static volatile boolean cfgStart = true;   // 上课提醒上岛
    public static volatile boolean cfgEnd = true;     // 下课提醒上岛
    public static volatile boolean cfgStay = false;   // 上课期间常驻岛
    public static volatile boolean cfgFocus = true;   // 专注计时上岛
    /* cfgLen 的语义在 v0.2.9 改了：不再是「停留时长」，而是**岛上信息多少**。
       ⚠️ 之前用户说「增加岛长短的设置」指的是**短岛布局**（左边只有名称、
       右边只有倒计时，像系统自带计时器那样），我误解成了岛停留多久 ——
       停留时长那条另立 stayMin，两者不再共用一个键。 */
    public static volatile int cfgLen = 1;            // 岛屿形态 0短岛/1标准/2完整
    /** 短岛：左列只名称、右列只倒计时，地点/时间一概不上岛。 */
    public static volatile boolean shortMode = false;
    /** 停留时长（分钟），下课提醒与测试岛自动下岛前等多久。与 cfgLen 无关。 */
    public static volatile int stayMin = 10;
    public static volatile boolean elCourse = true;   // 岛上显示课程名
    public static volatile boolean elPlace = true;    // 岛上显示地点
    public static volatile boolean elTime = false;    // 岛上显示上下课时间
    public static volatile boolean elCountdown = true;// 岛上显示倒计时

    /**
     * 事件型岛（下课提醒、测试岛）自动下岛前停留多久。
     *
     * 只管这两个：课前/常驻那两条按**语义**走（上课那一刻翻相位或收摊、下课收摊），
     * 不归时长档管 —— 把「到点该翻相位」也交给时长档，就会出现课都上完了岛上还写着
     * 「还有 3 分钟上课」。
     *
     * ⚠️ 这里读的是 stayMin，**不是 cfgLen**。v0.2.9 之前两者是一个键，
     * 结果「选短岛」会连带把停留时间也变成 5 分钟 —— 一个排版开关管到了行为开关。
     */
    public static long stayMillis() {
        int m = stayMin <= 0 ? 10 : (stayMin > 60 ? 60 : stayMin);
        return m * 60_000L;
    }

    /** 页面推过来的灵动岛配置。缺字段保留现值，别把没给的键重置回默认。 */
    public static void setPrefs(String json) {
        if (json == null || json.trim().isEmpty()) return;
        try {
            JSONObject o = new JSONObject(json);
            /* on 也当真闸门用：setIslandOn 是另一条桥，两条都送到才算数。
               只信一条的话，另一条丢了就会出现「设置页显示关了、岛上还在跑」。 */
            if (o.has("on")) cfgOn = o.optBoolean("on", cfgOn);
            if (o.has("start")) cfgStart = o.optBoolean("start", cfgStart);
            if (o.has("end")) cfgEnd = o.optBoolean("end", cfgEnd);
            if (o.has("stay")) cfgStay = o.optBoolean("stay", cfgStay);
            if (o.has("focus")) cfgFocus = o.optBoolean("focus", cfgFocus);
            if (o.has("len")) {
                int v = o.optInt("len", cfgLen);
                cfgLen = Math.max(0, Math.min(2, v));
                shortMode = cfgLen == 0;
            }
            if (o.has("stayMin")) {
                int v = o.optInt("stayMin", stayMin);
                stayMin = Math.max(1, Math.min(60, v));
            }
            if (o.has("elems")) {
                JSONArray a = o.optJSONArray("elems");
                if (a != null) {
                    elCourse = hasElem(a, "course");
                    elPlace = hasElem(a, "place");
                    elTime = hasElem(a, "time");
                    elCountdown = hasElem(a, "countdown");
                }
            }
        } catch (Throwable ignored) { }
    }

    private static boolean hasElem(JSONArray a, String k) {
        for (int i = 0; i < a.length(); i++) if (k.equals(a.optString(i))) return true;
        return false;
    }

    /* ---------- 岛上两列的文案 ----------
       通知标题/正文、RemoteViews、MIUI JSON **四处共用 Pill**。
       各写一份的后果是屏幕上同时出现两个不一样的倒计时 —— 那种 bug 只能靠肉眼发现，
       而用户看到的第一反应是「这应用数字是假的」。 */
    static final class Pill {
        final String name;   // 左列主文本：课程名（短岛档下就是名称本身）
        final String sub;    // 左列副文本：地点（短岛档下 GONE）
        final String right;  // 右列：倒计时
        /** 倒计时终点（毫秒）。>0 时用系统 Chronometer 自走秒 —— 不用每秒重发通知。 */
        final long endAt;
        /** 本轮总时长（毫秒），只用来画进度条；<=0 表示不知道总量，不画。 */
        final long totalMs;
        Pill(String name, String sub, String right) { this(name, sub, right, 0L, 0L); }
        Pill(String name, String sub, String right, long endAt) { this(name, sub, right, endAt, 0L); }
        Pill(String name, String sub, String right, long endAt, long totalMs) {
            this.name = name; this.sub = sub; this.right = right;
            this.endAt = endAt; this.totalMs = totalMs;
        }

        /** 短岛：左列只留名称，地点这类副信息一律不上岛；名称过长截到 4 个字。 */
        String nameOnly() {
            String n = name == null ? "" : name;
            return (shortMode && n.length() > 4) ? clip(n, 4) : n;
        }

        String subOrEmpty() {
            return shortMode ? "" : sub;
        }

        /** 剩余百分比 0..100，给进度条。不知道总量时返回 -1（不画）。 */
        int progressPct() {
            if (totalMs <= 0 || endAt <= 0) return -1;
            long left = endAt - System.currentTimeMillis();
            if (left < 0) left = 0;
            if (left > totalMs) left = totalMs;
            return (int) (left * 100L / totalMs);
        }

        /**
         * 小岛/大岛数字区要的是**纯数字**（MM:SS 或 N），不是「还有 5 分钟上课」这种整句。
         *
         * ⚠️ 必须扫「第一段连续数字」而不是「前缀数字」：课程文案是「还有 5 分钟上课」，
         * 数字在**开头两个汉字之后**。早先从下标 0 开始扫，扫到「还」就停 ——
         * 结果小岛显示成「还有 5…」，比显示成纯图标更糟。
         */
        String digit() {
            String r = right == null ? "" : right;
            int s = -1, e = -1;
            for (int i = 0; i < r.length(); i++) {
                char ch = r.charAt(i);
                boolean num = Character.isDigit(ch) || ch == ':';
                if (num && s < 0) s = i;
                if (num) e = i + 1;
                else if (s >= 0) break;          /* 数字段结束，后面的单位词不要 */
            }
            if (s < 0) return r.length() > 4 ? clip(r, 4) : r;
            return r.substring(s, e);
        }

        /** 数字后面的单位词，放 sameWidthDigitInfo.content（没单位就空）。 */
        String rightLabel() {
            String r = right == null ? "" : right;
            String dg = digit();
            if (dg.length() >= r.length()) return "";
            String rest = r.substring(dg.length() + (r.indexOf(dg))).trim();
            /* 去掉数字前面的引导词（「还有」），只留单位 */
            rest = rest.replaceAll("^[\\u4e00-\\u9fa5]{0,2}(?=[\\u5206\\u79d2\\u949f])", "");
            return rest.isEmpty() ? "" : clip(rest, 6);
        }
    }

    /**
     * @param course     课程名（调用方已把「上下课时间」拼进来，见 elTime）
     * @param place      地点，空则不占左列副文本
     * @param duringClass true=上课中（倒计时指向下课），false=上课前（指向上课）
     * @param millisLeft 剩余毫秒；<=0 表示已到点
     */
    static Pill pill(String course, String place, boolean duringClass, long millisLeft) {
        return pill(course, place, duringClass, millisLeft, 0L);
    }

    /**
     * @param totalMs 本轮总时长（毫秒），用来画倒计时进度条；<=0 表示不画
     */
    static Pill pill(String course, String place, boolean duringClass, long millisLeft,
                     long totalMs) {
        String c = (course == null || course.trim().isEmpty()) ? "课程" : course.trim();
        String sub = (elPlace && place != null && !place.trim().isEmpty()) ? place.trim() : "";
        String right = "";
        if (elCountdown) {
            if (millisLeft <= 0) {
                right = duringClass ? "已下课" : "上课中";
            } else {
                /* 向上取整：剩 4 分 10 秒要显示「5 分钟」。
                   向下取整会显示「0 分钟」，用户会以为已经上课了。 */
                long mins = Math.max(1, (millisLeft + 59_999L) / 60_000L);
                right = "还有 " + mins + " 分钟" + (duringClass ? "下课" : "上课");
            }
        }
        /* endAt 交给系统 Chronometer 自走秒：我们不必每秒重发通知
           （此前 MIUI 侧的 timerInfo 字段官方没给全，真机上不跳，已退回原生方案）。 */
        return new Pill(c, sub, right,
                millisLeft > 0 ? System.currentTimeMillis() + millisLeft : 0L,
                totalMs > 0 ? totalMs : (millisLeft > 0 ? millisLeft : 0L));
    }

    /**
     * 专注岛：右列是调用方给好的倒计时文本（MM:SS），不是「还有 N 分钟」——
     * 番茄钟看的是秒，四舍五入到分钟就等于没有倒计时了。
     * 左侧不放副文本（专注没有「地点」可言），任务名就是全部。
     */
    static Pill pillTimer(String label, String right) { return pillTimer(label, right, 0L, 0L); }

    static Pill pillTimer(String label, String right, long endAt, long totalMs) {
        String c = (label == null || label.trim().isEmpty()) ? "自由专注" : label.trim();
        /* 短岛左列只留名称：太长的任务名（「自由专注」「高数作业第 3 章」）
           会把胶囊撑宽。截到 4 个字而不是硬改成「专注」——
           用户自己起的任务名是有信息的，替掉它等于替用户改语义。 */
        if (shortMode && c.length() > 4) c = clip(c, 4);
        return new Pill(c, "", right == null ? "" : right, endAt, totalMs);    }

    private Island() { }

    // ---------------------------------------------------------------
    // 通道与能力判定
    // ---------------------------------------------------------------

    public static void ensureChannel(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        try {
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            if (nm == null || nm.getNotificationChannel(CH_LIVE) != null) return;
            NotificationChannel ch = new NotificationChannel(
                    CH_LIVE, "实时动态", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("专注计时与上课提醒的系统焦点 / 实况展示");
            ch.setShowBadge(false);
            ch.enableVibration(false);
            ch.setSound(null, null);
            nm.createNotificationChannel(ch);
        } catch (Throwable ignored) { }
    }

    /** Android 15（API 35）以下 requestPromotedOngoing 被忽略 → 退化为常驻低扰通知 */
    public static boolean supported() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM;
    }

    /** 上岛运行时权限（API 35+）。用户可在系统设置里单独关掉「实时动态」。 */
    public static boolean granted(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) return false;
        try {
            return c.checkSelfPermission(PERM_PROMOTED) == PackageManager.PERMISSION_GRANTED;
        } catch (Throwable t) {
            return false;
        }
    }

    /** 给设置页用的一句话状态（JSON，页面解析失败也有兜底文案） */
    public static String state(Context c) {
        boolean sup = supported();
        boolean gr = granted(c);
        try {
            JSONObject o = new JSONObject();
            o.put("sdk", Build.VERSION.SDK_INT);
            o.put("supported", sup);
            o.put("granted", gr);
            o.put("vendor", Notify.vendorName());
            return o.toString();
        } catch (Throwable t) {
            return "{\"sdk\":" + Build.VERSION.SDK_INT + ",\"supported\":" + sup
                    + ",\"granted\":" + gr + "}";
        }
    }

    // ---------------------------------------------------------------
    // 构建 / 下发 / 下岛
    // ---------------------------------------------------------------

    private static PendingIntent openApp(Context c, int reqCode) {
        Intent i = new Intent(c, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(c, reqCode, i, flags);
    }

    /**
     * 上课场景上岛 / 更新岛：**同一条通知、同一个 ID**。
     *
     * 课前提醒与「上课中」不是两条岛，而是同一条内容的两种相位 ——
     * 到点只改文案（「还有 N 分钟上课」→「还有 N 分钟下课」）并延长下岛时间。
     * 拆成两条 ID 的话，交接瞬间会出现两条岛叠在一起，用户看到的就是闪一下。
     *
     * @param duringClass false=课前（倒计时指向上课），true=上课中（指向下课）
     * @param endAt       倒计时终点：课前是上课时刻，上课中是下课时刻
     * @param hideAt      自动下岛时刻（<=0 表示不自动下）
     * @param refresh     是否排 60 秒刷新（倒计时文字得跟着走，见 scheduleRefresh）
     */
    public static void showClass(Context c, int id, String course, String place,
                                 boolean duringClass, long endAt, long hideAt,
                                 boolean refresh) {
        showClass(c, id, course, place, duringClass, endAt, hideAt, refresh, 0L);
    }

    public static void showClass(Context c, int id, String course, String place,
                                 boolean duringClass, long endAt, long hideAt,
                                 boolean refresh, long totalMs) {
        try {
            if (!cfgOn) return;
            ensureChannel(c);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                    && !NotificationManagerCompat.from(c).areNotificationsEnabled()) return;
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            if (nm == null) return;

            long left = endAt - System.currentTimeMillis();
            Pill p = pill(course, place, duringClass, left, totalMs);
            Notification n = buildPill(c, ICON_CLASS, p, ACCENT_CLASS, true, left > 0);
            try {
                n.actions = new Notification.Action[]{ closeAction(c, id) };
            } catch (Throwable ignored) { }
            nm.notify(TAG_LIVE, id, n);

            saveSession(c, id, course, place, duringClass, endAt,
                    totalMs > 0 ? totalMs : Math.max(0, left));
            if (hideAt > 0) scheduleHide(c, id, hideAt);
            if (refresh) scheduleRefresh(c, id, endAt);
        } catch (Throwable ignored) { }
    }

    /** 用自定义 RemoteViews 排两列：左 = 图标 + 课程名（+地点），右 = 倒计时。 */
    /**
     * 两列排版的那块 RemoteViews。**专注岛也复用它** ——
     * 专注和上课提醒上的是同一个岛，排版必须是同一套，
     * 否则用户会在两种动态之间看到两种风格，等于没设计过。
     */
    static RemoteViews pillViews(Context c, int icon, Pill p, String accent) {
        return pillViews(c, icon, p, accent, false);
    }

    /**
     * @param running true=倒计时在走（Chronometer 接管右列数字，系统自己跳秒）
     */
    static RemoteViews pillViews(Context c, int icon, Pill p, String accent, boolean running) {
        RemoteViews rv = new RemoteViews(c.getPackageName(), R.layout.island_pill);
        rv.setImageViewResource(R.id.islandIcon, icon > 0 ? icon : ICON_TIMER);
        /* ic_stat_* 是纯白剪色（fillColor 都是 #FFFFFFFF），靠系统当蒙版染色。
           但自定义内容视图**不在**系统染色范围内，白色图标会直接看不见，
           所以这里自己染一遍。setColorFilter(int) 是 ImageView 的单参方法，
           RemoteViews.setInt 调得动；用 ACCENT 这种中间明度，浅底深底都读得清。 */
        rv.setInt(R.id.islandIcon, "setColorFilter", parseColor(accent));

        /* 名称：短岛与完整岛都是它，只是短岛下面没有副文本。
           marquee 要 setSelected 才会滚 —— RemoteViews 调得动 setSelected，
           不设的话 ellipsize=marquee 永远停在省略号状态（静态截断）。 */
        rv.setTextViewText(R.id.islandName, p.name);
        try { rv.setInt(R.id.islandName, "setSelected", 1); } catch (Throwable ignored) { }

        String sub = p.subOrEmpty();
        rv.setViewVisibility(R.id.islandSub, sub.isEmpty() ? View.GONE : View.VISIBLE);
        rv.setTextViewText(R.id.islandSub, sub);

        /* 进度条（用户要的「倒计时环」）。不知道总量时整体藏掉，
           留一个空槽在右列比画一条永远不动的条更难看。 */
        /* 进度条颜色走 XML 的 android:progressTint —— RemoteViews 没有
           setProgressTintList 这个方法，只能在布局里声明。 */
        int pct = p.progressPct();
        rv.setViewVisibility(R.id.islandProgress, pct < 0 ? View.GONE : View.VISIBLE);
        if (pct >= 0) {
            try { rv.setProgressBar(R.id.islandProgress, 100, pct, false); }
            catch (Throwable ignored) { }
        }

        /* 右列倒计时：
           正在走 → 交给 Chronometer，系统按终点自走秒（不再需要每秒重发通知）；
           暂停/已到点 → 退回静态文字。
           ⚠️ Chronometer.setChronometer 要的是 SystemClock.elapsedRealtime()，
           不是 System.currentTimeMillis()；传错会得到一个 1970 年的起点。 */
        boolean ticking = running && p.endAt > 0
                && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N;
        rv.setViewVisibility(R.id.islandCountdown, p.right.isEmpty() ? View.GONE : View.VISIBLE);
        if (ticking) {
            try {
                rv.setChronometer(R.id.islandCountdown,
                        SystemClock.elapsedRealtime() + Math.max(0, p.endAt - System.currentTimeMillis()),
                        null, true);
                /* 倒数方向：Chronometer.setCountDown(boolean) 是实例方法，
                   RemoteViews 没有对应包装，只能用 setInt 反射调它。
                   不设的话它是正着走（从 00:00 往上加），与倒计时相反。 */
                try { rv.setInt(R.id.islandCountdown, "setCountDown", 1); }
                catch (Throwable ignored) { }
            } catch (Throwable t) {
                rv.setTextViewText(R.id.islandCountdown, p.right);
            }
        } else {
            rv.setTextViewText(R.id.islandCountdown, p.right);
        }
        return rv;
    }

    private static Notification buildPill(Context c, int icon, Pill p, String accent,
                                          boolean ongoing) {
        return buildPill(c, icon, p, accent, ongoing, false);
    }

    private static Notification buildPill(Context c, int icon, Pill p, String accent,
                                          boolean ongoing, boolean running) {
        RemoteViews rv = pillViews(c, icon, p, accent, running);

        /* 标题/正文照旧给一份：自定义内容视图不被采用时（老系统、没白名单的 ROM），
           系统会退回渲染它 —— 那时排版是默认的「图标左、文字右」，
           但信息不能少。降级可以变丑，不能变空。 */
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CH_LIVE)
                .setSmallIcon(icon > 0 ? icon : ICON_TIMER)
                .setColor(parseColor(accent))
                .setContentTitle(p.name)
                .setContentText(p.right.isEmpty() ? p.sub : p.right)
                .setContentIntent(openApp(c, 31))
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setOngoing(ongoing)
                .setOnlyAlertOnce(true)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setCustomContentView(rv)
                .setShowWhen(false).setUsesChronometer(false);

        Notification n = b.build();
        promote(c, n, p.name, p.right.isEmpty() ? p.sub : p.right, accent, p);
        return n;
    }

    /** 下岛：TAG 与 ID 必须和下发时一致，否则 cancel 不掉 */
    public static void hide(Context c, int id) {
        try {
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            if (nm != null) nm.cancel(TAG_LIVE, id);
        } catch (Throwable ignored) { }
        cancelHide(c, id);
        cancelRefresh(c, id);
        clearSession(c, id);
    }

    /** 收回所有上岛通知（关掉「灵动岛上岛」开关时调用） */
    public static void hideAll(Context c) {
        hide(c, ID_CLASS_START);
        hide(c, ID_CLASS_END);
        hide(c, ID_TEST);
    }

    /**
     * 给任意一条已构建的通知补上岛标志。
     * 专注计时的前台服务通知走这条路 —— 它挂在自己的通道上，不进 CH_LIVE。
     */
    public static void promote(Context c, Notification n, String title, String text, String accent) {
        promote(c, n, title, text, accent, null);
    }

    public static void promote(Context c, Notification n, String title, String text, String accent, Pill pill) {
        try {
            n.flags |= Notification.FLAG_NO_CLEAR;
            if (n.extras == null) n.extras = new Bundle();
            Bundle ex = n.extras;
            // 最关键的一行：Android 15+ 由系统提升为 Live Updates；低版本静默忽略
            ex.putBoolean(EXTRA_PROMOTED, true);
            ex.putBoolean("android.ongoingActivity", true);

            /* picInfo.pic 里写的只是「key」，系统还要去 miui.focus.pics 这个 Bundle 里
               按 key 取图。v0.2.7 只写了 key 从没放图 —— 系统取不到就回退成应用默认图标，
               于是「图标 + 倒计时」看着像只剩图标。 */
            picsBundle(c, ex, pill == null ? ICON_TIMER : ICON_CLASS);

            String miui = miuiParamV2(title, text, accent, pill);
            if (!miui.isEmpty()) {
                try { ex.putString("miui.focus.param", miui); } catch (Throwable ignored) { }
            }
            vendorExtras(ex, title, text);
        } catch (Throwable ignored) { }
    }

    /** 系统按 key 从这里取图标。JSON 里的 pic 必须引用同一个 key，否则取不到。 */
    private static final String K_PIC = "miui.focus.pic_island";

    private static void picsBundle(Context c, Bundle ex, int icon) {
        try {
            Bundle pics = new Bundle();
            pics.putParcelable(K_PIC, Icon.createWithResource(c, icon > 0 ? icon : ICON_TIMER));
            ex.putBundle("miui.focus.pics", pics);
        } catch (Throwable ignored) { }
    }

    // ---------------------------------------------------------------
    // 厂商参数
    // ---------------------------------------------------------------

    /**
     * 小米超级岛：是 **JSON 字符串** param_v2，不是 Bundle。
     * （早先塞 Bundle 的写法没有对应实现，属于无效 extras；这里按验证过的结构拼。）
     * 非公开协议，白名单外的 App 会被系统忽略，不影响功能。
     *
/**
     * 小米超级岛：是 **JSON 字符串** param_v2，不是 Bundle。
     * （早先塞 Bundle 的写法没有对应实现，属于无效 extras；这里按验证过的结构拼。）
     * 非公开协议，白名单外的 App 会被系统忽略，不影响功能。
     *
     * ── v0.2.8 按官方《小米超级岛通知模板库》20260129 修正的三处协议错误 ──────
     * ① **小岛不认 imageTextInfoLeft**。官方写明 smallIslandArea 只有三种组件：
     *    picInfo / combinePicInfo / imageTextInfoRight(type=6)。
     *    imageTextInfoLeft 是**大岛 A 区**的组件名，塞进小岛会被系统直接忽略 ——
     *    这就是「微缩岛不显示倒计时、只剩一个图标」的根因。
     *    小岛改用官方的「图标文本组件」imageTextInfoRight type=6（小图 + 悬浮数字）。
     *
     * ② **enableFloat 的语义被用反了**。官方定义：
     *    islandFirstFloat = 通知**第一次**出现时是否展开；
     *    enableFloat      = 通知**更新**时是否自动展开（默认 false）。
     *    v0.2.7 两个都写了 true，于是每一秒刷新一次通知 = 每秒被强制展开一次，
     *    用户看到的是「岛反复弹开，没法正常用」。现在：首次展开（要看清内容），
     *    之后一律保持摘要态。
     *
     * ③ **timeout 单位是分钟，不是秒**。官方：timeout 单位 min（默认 720），
     *    岛自身的停留时长是 param_island.islandTimeout，单位秒（默认 3600）。
     *    以前把秒塞进 timeout，等于把「5 分钟」写成「300 分钟」——
     *    岛赖着不走正是这么来的。停留时长现在走 islandTimeout。
     *
     * 倒计时不再由我们逐秒重算：官方给了 timerInfo（通用计时对象），
     * 系统自己按终点时刻走秒。这样数字在动，但通知不需要每秒重发一次。
     */
    private static String miuiParamV2(String title, String text, String accent, Pill pill) {
        try {
            String t = clip(nullTo(title), 16);
            String x = clip(nullTo(text), 24);
            String color = (accent == null || accent.trim().isEmpty()) ? ACCENT : accent.trim();

            JSONObject picInfo = new JSONObject().put("type", 1).put("pic", K_PIC);

            /* 大岛 A 区（左）：图标 + 课程名 + 地点。imageTextInfoLeft 用在这里是对的，
               官方 A 区支持 type=1/5。 */
            JSONObject leftText = new JSONObject()
                    .put("frontTitle", "学径")
                    .put("title", t)
                    .put("content", x)
                    .put("showHighlightColor", true);
            JSONObject left = new JSONObject()
                    .put("type", 1)
                    .put("picInfo", picInfo)
                    .put("textInfo", leftText);

            /* 大岛 B 区（右）：等宽数字组件，走秒交给 timerInfo。 */
            JSONObject bigArea = new JSONObject().put("imageTextInfoLeft", left);
            if (pill != null) {
                JSONObject digit = sameWidthDigit(pill);
                /* 构造失败时宁可不给这个键：JSONObject.put(key, null) 等于删键，
                   塞进去反而会让大岛 B 区变成空的。 */
                if (digit != null) bigArea.put("sameWidthDigitInfo", digit);
            }

            /* 小岛（短岛）：官方只有三种组件 —— picInfo / combinePicInfo /
               imageTextInfoRight(type=6)。
               v0.2.7 塞的是 imageTextInfoLeft（大岛 A 区的名字）→ 系统忽略 → 纯图标。

               现在用 **combinePicInfo**：中心图标 + 外圈**环形进度**。
               官方明确它就是「图标组合组件：中心图标 + 外圈环形进度」，
               正好对应用户要的「右边放一个倒计时环」，而且环由系统按 progress 自绘，
               不需要我们逐秒刷通知。数字交给下面的 timerInfo / RemoteViews Chronometer。 */
            JSONObject smallArea;
            int pct = pill == null ? -1 : pill.progressPct();
            if (pct >= 0) {
                smallArea = new JSONObject().put("combinePicInfo", new JSONObject()
                        .put("picInfo", picInfo)
                        .put("progressInfo", new JSONObject()
                                .put("progress", pct)
                                .put("colorReach", color)
                                .put("colorUnReach", "#33" + color.substring(1))
                                .put("isCCW", false)));
            } else {
                smallArea = new JSONObject().put("picInfo", picInfo);
            }

            JSONObject paramIsland = new JSONObject()
                    .put("islandProperty", 1)
                    /* 停留时长走 islandTimeout（**秒**），别再往 timeout（分钟）里塞 */
                    .put("islandTimeout", (int) Math.max(60, stayMillis() / 1000L))
                    .put("dismissIsland", false)
                    .put("bigIslandArea", bigArea)
                    .put("smallIslandArea", smallArea);
            JSONObject baseInfo = new JSONObject()
                    .put("title", t)
                    .put("content", x)
                    .put("colorTitle", color)
                    .put("type", 2);
            JSONObject paramV2 = new JSONObject()
                    .put("business", "xuejing")
                    /* 首次出现展开，让用户看清岛上有什么；之后一律保持摘要态 */
                    .put("islandFirstFloat", true)
                    .put("enableFloat", false)
                    .put("updatable", true)
                    .put("islandOrder", true)
                    /* timeout 单位是**分钟**（官方默认 720），不是秒 */
                    .put("timeout", 720)
                    .put("filterWhenNoPermission", false)
                    .put("ticker", t)
                    .put("aodTitle", t)
                    .put("param_island", paramIsland)
                    .put("baseInfo", baseInfo);
            return new JSONObject().put("param_v2", paramV2).toString();
        } catch (Throwable t) {
            return "";
        }
    }

    /**
     * 大岛 B 区的等宽数字。
     *
     * ⚠️ timerInfo 真机上**不跳秒**（v0.2.9 实测）：官方模板库只说它叫
     * 「通用计时对象」、在 chatInfo/highlightInfo 里出现，**没给字段表**，
     * 按同名措辞猜的 isCountDown/endTime 显然不对。
     * 所以现在**不再依赖它**：倒计时由 RemoteViews 的 Chronometer 走秒
     * （AOSP 标准能力，见 pillViews），timerInfo 只是留着加分。
     * 真机上若两者都不走，还能退回「按分钟重发通知」——反正
     * enableFloat 已固定 false，重发不会把岛重新弹开。
     */
    private static JSONObject sameWidthDigit(Pill pill) {
        JSONObject o;
        try {
            o = new JSONObject()
                    .put("digit", pill.digit())
                    .put("content", pill.rightLabel());
            if (pill.endAt > 0) {
                o.put("timerInfo", new JSONObject()
                        .put("timerType", 1)
                        .put("isCountDown", true)
                        .put("endTime", pill.endAt)
                        .put("systemCurrentTime", System.currentTimeMillis()));
            }
        } catch (Throwable ignored) {
            return null;
        }
        return o;
    }

    /** OPPO 实况窗 / vivo 原子通知：尽力而为，未适配的 ROM 会忽略 */
    private static void vendorExtras(Bundle ex, String title, String text) {
        String t = clip(nullTo(title), 14);
        String x = clip(nullTo(text), 36);
        try {
            ex.putBoolean("oplus.live.alert", true);
            ex.putString("oplus.live.alert.title", t);
            ex.putString("oplus.live.alert.text", x);
            ex.putBoolean("oplus.live.update", true);
            ex.putInt("oplus.live.type", 1);
        } catch (Throwable ignored) { }
        try {
            ex.putString("vivo.notification.atom.title", t);
            ex.putString("vivo.notification.atom.content", x);
            ex.putBoolean("vivo.notification.atom.support", true);
        } catch (Throwable ignored) { }
    }

    // ---------------------------------------------------------------
    // 关闭按钮 / 自动下岛
    // ---------------------------------------------------------------

    private static Notification.Action closeAction(Context c, int id) {
        Intent i = new Intent(A_CLOSE).setPackage(c.getPackageName());
        i.putExtra(K_ID, id);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getBroadcast(c, id, i, flags);
        return new Notification.Action.Builder(R.drawable.ic_stat_timer, "关闭", pi).build();
    }

    private static void scheduleHide(Context c, int id, long at) {
        try {
            AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            PendingIntent pi = hidePi(c, id);
            if (pi == null) return;
            /* 用 setAndAllowWhileIdle，不要 am.set()：
               set() 既不精确也不豁免 Doze，而它几乎不会抛异常 —— 于是下面那个
               「catch 里补一条 setAndAllowWhileIdle」的兜底实际永远走不到。
               结果是省电模式到期后岛不自己收，倒数也不刷新（看着像卡住了）。 */
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        } catch (Throwable ignored) { }
    }

    private static void cancelHide(Context c, int id) {
        try {
            AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
            PendingIntent pi = hidePi(c, id);
            if (am != null && pi != null) { am.cancel(pi); pi.cancel(); }
        } catch (Throwable ignored) { }
    }

    private static PendingIntent hidePi(Context c, int id) {
        Intent i = new Intent(A_HIDE).setPackage(c.getPackageName());
        i.putExtra(K_ID, id);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(c, id, i, flags);
    }

    // ---------------------------------------------------------------
    // 倒计时刷新（60 秒一次，有界）
    // ---------------------------------------------------------------

    /** 岛上会话：刷新闹钟靠它重算「还有 N 分钟」。单独一份 SP，别和课表混。 */
    private static final String SP_ISLAND = "xuejing_island";
    private static final String K_SESSION = "session";
    private static final long REFRESH_MS = 60_000L;

    private static SharedPreferences spIsland(Context c) {
        return c.getSharedPreferences(SP_ISLAND, Context.MODE_PRIVATE);
    }

    private static void saveSession(Context c, int id, String course, String place,
                                    boolean duringClass, long endAt, long totalMs) {
        try {
            JSONObject o = new JSONObject();
            o.put("id", id);
            o.put("course", course == null ? "" : course);
            o.put("place", place == null ? "" : place);
            o.put("during", duringClass);
            o.put("endAt", endAt);
            o.put("totalMs", totalMs);
            spIsland(c).edit().putString(K_SESSION, o.toString()).apply();
        } catch (Throwable ignored) { }
    }

    private static void clearSession(Context c, int id) {
        try {
            SharedPreferences sp = spIsland(c);
            String s = sp.getString(K_SESSION, "");
            if (s == null || s.isEmpty()) return;
            if (new JSONObject(s).optInt("id", 0) == id) sp.edit().remove(K_SESSION).apply();
        } catch (Throwable ignored) { }
    }

    /** 这条岛此刻是否在岛上。靠会话记录判断，不必去查 activeNotifications。 */
    public static boolean isShowing(Context c, int id) {
        try {
            String s = spIsland(c).getString(K_SESSION, "");
            if (s == null || s.isEmpty()) return false;
            return new JSONObject(s).optInt("id", 0) == id;
        } catch (Throwable t) { return false; }
    }

    /**
     * 每 60 秒重算一次倒计时并覆盖同一条通知。
     *
     * **不是无界轮询**：只排到 endAt 为止。课前提醒默认 5 分钟（最多 5 次），
     * 「上课期间常驻」一节课 45~90 分钟（用户主动开的开关）。
     * 用 AlarmManager.set 一次排一次，不搞 setRepeating、也不起前台服务 ——
     * 一分钟一次的更新不值得占一个常驻服务。
     */
    /**
     * 每分钟重算一次并覆盖同一条通知 —— 这是**兜底**，不是主路径。
     *
     * 主路径是 RemoteViews 的 Chronometer 自己走秒（AOSP 标准）。
     * 之所以还留这一层：MIUI 摘要态（小岛）拿的是 JSON 里的静态 digit，
     * 不重发它就不会变；万一某些 ROM 连 Chronometer 也不认，
     * 至少每分钟会更新一次，不会一直卡在旧数字上。
     *
     * ⚠️ 关键前提：v0.2.8 起 enableFloat 固定 false。
     * **重发通知不再会把岛重新弹开** —— 所以「刷新」和「展开」已经解耦。
     * v0.2.7 时代这两件事是绑在一起的（enableFloat=true），那才是
     * 「每秒弹开一次」的成因；只改一个会留下另一个。
     *
     * 仍然**不是无界轮询**：只排到 endAt 为止。
     */
    private static void scheduleRefresh(Context c, int id, long endAt) {
        try {
            long next = System.currentTimeMillis() + REFRESH_MS;
            if (next >= endAt) return;                 /* 一分钟内就到点，不必再刷 */
            AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            PendingIntent pi = refreshPi(c, id);
            if (pi == null) return;
            /* 同 scheduleHide：am.set() 不精确、不豁免 Doze，而且几乎不抛异常，
               原来的 catch 兜底等于永远走不到 —— 锁屏后岛上的倒计时就不动了。 */
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pi);
        } catch (Throwable ignored) { }
    }

    private static void cancelRefresh(Context c, int id) {
        try {
            AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
            PendingIntent pi = refreshPi(c, id);
            if (am != null && pi != null) { am.cancel(pi); pi.cancel(); }
        } catch (Throwable ignored) { }
    }

    /** requestCode 用 9000+id，和 hidePi 的 id 错开（同一个 code 会互相覆盖） */
    private static PendingIntent refreshPi(Context c, int id) {
        Intent i = new Intent(A_REFRESH).setPackage(c.getPackageName());
        i.putExtra(K_ID, id);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(c, 9000 + id, i, flags);
    }

    /** 刷新闹钟到点：读会话 → 重算 → 覆盖通知 → 再排下一次（或到点收摊） */
    public static void refresh(Context c) {
        try {
            String s = spIsland(c).getString(K_SESSION, "");
            if (s == null || s.isEmpty()) return;
            JSONObject o = new JSONObject(s);
            int id = o.optInt("id", 0);
            long endAt = o.optLong("endAt", 0L);
            if (id <= 0 || endAt <= 0) return;
            long now = System.currentTimeMillis();
            if (now >= endAt) { hide(c, id); return; }   /* 到点了，交给下课提醒/下岛闹钟接手 */
            long left = endAt - now;
            Pill p = pill(o.optString("course"), o.optString("place"),
                    o.optBoolean("during"), left, o.optLong("totalMs", 0L));
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            if (nm != null) {
                nm.notify(TAG_LIVE, id, buildPill(c, ICON_CLASS, p, ACCENT_CLASS, true, true));
            }
            scheduleRefresh(c, id, endAt);
        } catch (Throwable ignored) { }
    }

    // ---------------------------------------------------------------

    private static int parseColor(String accent) {
        try { return Color.parseColor(accent); } catch (Throwable t) { return 0xFF5A5AD6; }
    }

    private static String nullTo(String s) { return s == null ? "" : s; }

    private static String clip(String s, int n) {
        if (s == null) return "";
        return s.length() <= n ? s : s.substring(0, n) + "…";
    }
}
