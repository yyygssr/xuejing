package com.xuejing.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * 通知构建与渠道管理。
 *
 * 分两条渠道：
 *  - focus_timer  专注计时：低优先级、静音、常驻
 *  - class_remind 上课/下课提醒：高优先级，会响
 *
 * 关于「上岛」：
 *  真正的上岛是 AOSP 的 Live Updates —— Android 15+ 只要给一条「常驻 + 低扰通道」
 *  的通知塞上 extras 里的 android.requestPromotedOngoing，系统就会把它提升到
 *  状态栏胶囊 / 灵动岛。小米超级岛、OPPO 实况窗是厂商自己的非公开协议
 *  （需要白名单），在同一条通知上额外挂一份参数即可，拿不到白名单就被忽略。
 *
 *  实现全部收敛在 Island.java 里（构建 / 下发 / 下岛 / 厂商参数单点维护），
 *  这里只负责「什么时候该上岛、什么时候该发普通通知」。
 *  详见 技术框架.md「系统通知与上岛适配」。
 *
 * ── 挂哪个面上，就用哪套排版（v1.1.0 重做）────────────────────────
 *  专注计时：
 *    上岛时 —— 岛上的主显示位是**标题**，系统不会替你渲染 chronometer，
 *              所以把「状态 + 倒计时」写进标题（「专注中 24:35」），
 *              正文留空、不挂 chronometer（两个数字并排＝排版乱），
 *              由 FocusService 每秒覆盖更新这一条。
 *    不上岛 —— 标题放课程/任务名，倒计时交给系统 chronometer（不用唤醒 CPU，锁屏也在走）。
 *    两种模式各自只有一个倒计时，不会重复。
 */
public class Notify {

    public static final String CH_FOCUS = "focus_timer";
    public static final String CH_CLASS = "class_remind";

    public static final int ID_FOCUS = 1001;
    public static final int ID_CLASS = 1002;

    /** 页面「灵动岛上岛」开关；关掉后不注入厂商 focus/live extras */
    public static volatile boolean islandExtrasOn = true;

    public static void ensureChannels(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;

        NotificationChannel focus = new NotificationChannel(
                CH_FOCUS, "专注计时", NotificationManager.IMPORTANCE_LOW);
        focus.setDescription("专注期间在通知栏显示倒计时");
        focus.setShowBadge(false);
        focus.enableVibration(false);
        focus.setSound(null, null);
        nm.createNotificationChannel(focus);

        NotificationChannel cls = new NotificationChannel(
                CH_CLASS, "上课与下课提醒", NotificationManager.IMPORTANCE_HIGH);
        cls.setDescription("每节课开始前与结束时的提醒");
        cls.enableVibration(true);
        nm.createNotificationChannel(cls);

        /* 上岛专用低扰通道（专注计时的前台服务通知仍走 CH_FOCUS，不动） */
        Island.ensureChannel(c);
    }

    private static PendingIntent openApp(Context c, int reqCode) {
        Intent i = new Intent(c, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(c, reqCode, i, flags);
    }

    /**
     * 专注计时通知（同时是前台服务的通知）。
     *
     * @param remainSecs 剩余秒数；暂停时是冻结值
     * @param running    是否在走
     */
    public static Notification buildFocus(Context c, String label, int remainSecs, boolean running) {
        return buildFocus(c, label, remainSecs, running, 0);
    }

    /** @param totalSecs 本轮总秒数，用来画倒计时进度条；<=0 表示不画 */
    public static Notification buildFocus(Context c, String label, int remainSecs, boolean running,
                                          int totalSecs) {
        String task = (label == null || label.trim().isEmpty()) ? "自由专注" : label.trim();
        int remain = Math.max(0, remainSecs);
        /* 专注上岛也受「灵动岛 → 专注计时」那个开关管。
           以前只要总开关开着就上，用户没法单独关掉专注那一条。 */
        boolean island = islandExtrasOn && Island.cfgFocus;

        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CH_FOCUS)
                .setSmallIcon(Island.ICON_TIMER)
                .setContentIntent(openApp(c, 11))
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setColor(0xFF5A5AD6)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

        /* 走不走系统计时：运行中就把终点时刻交给系统（chronometer / MIUI timerInfo），
           秒由系统自己跳。v0.2.8 之前这里一律 setUsesChronometer(false)，
           逼得 FocusService 每秒重发一次通知；而 MIUI 侧 enableFloat 又是 true，
           于是「每秒刷新」直接翻译成「岛每秒弹开一次」。
           ——这两处必须一起改，只改一处仍会反复展开。 */
        long endAt = System.currentTimeMillis() + remain * 1000L;

        if (island) {
            /* 上岛：走和上课提醒**同一套两列排版**（复用 Island.pillViews），
               左 = 任务名，右 = MM:SS 倒计时。
               以前这里把「专注中 24:35」整句塞进标题，于是左边只剩一个图标 ——
               和上课提醒是同一个毛病，用户一起提的。 */
            Island.Pill p = Island.pillTimer(task,
                    (running ? "" : "已暂停 ") + hhmmss(remain),
                    running ? endAt : 0L, totalSecs * 1000L);
            /* running=true 时右列交给 Chronometer 自走秒 —— 系统计时，不用我们每秒发通知 */
            b.setCustomContentView(Island.pillViews(c, Island.ICON_TIMER, p, Island.ACCENT, running))
             .setContentTitle(p.name)
             .setContentText(p.right)
             .setShowWhen(running)
             .setWhen(endAt)
             .setUsesChronometer(running);
            if (running && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                b.setChronometerCountDown(true);
            }
        } else {
            /* 不上岛：倒计时交给系统 chronometer 自绘（不需要我们逐秒刷新） */
            b.setContentTitle(task)
             .setContentText(running ? "专注计时中 · 点开回到学径" : "已暂停")
             .setSubText(running ? "" : "")
             .setShowWhen(running)
             .setWhen(System.currentTimeMillis() + remain * 1000L)
             .setUsesChronometer(running);
            if (running && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                b.setChronometerCountDown(true);
            }
        }

        Notification n = b.build();
        if (island) {
            /* 上岛：常驻 + FLAG_NO_CLEAR + promoted 标志 + 厂商参数。
               前台服务通知保持 null TAG，才能与 startForeground 合成同一条。 */
            Island.promote(c, n, task, (running ? "" : "已暂停 ") + hhmmss(remain),
                    Island.ACCENT, Island.pillTimer(task,
                            (running ? "" : "已暂停 ") + hhmmss(remain),
                            running ? endAt : 0L, totalSecs * 1000L));
        }
        return n;
    }

    /** 上课 / 下课提醒（不上岛时用的普通高优通知） */
    public static Notification buildClass(Context c, boolean isStart, String name, String detail, int before) {
        String title = classTitle(isStart, name);
        String text = classText(isStart, name, detail, before);

        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CH_CLASS)
                .setSmallIcon(Island.ICON_CLASS)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setContentIntent(openApp(c, isStart ? 21 : 22))
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setColor(0xFF5A5AD6)
                .setCategory(isStart ? NotificationCompat.CATEGORY_REMINDER : NotificationCompat.CATEGORY_EVENT)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

        if (isStart) {
            /* 课前倒计时：系统 chronometer 往回数，用户一眼看到还有多久 */
            long endAt = System.currentTimeMillis() + Math.max(0, before) * 60_000L;
            b.setShowWhen(true).setWhen(endAt).setUsesChronometer(true);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                b.setChronometerCountDown(true);
            }
        }

        return b.build();
    }

    private static String classTitle(boolean isStart, String name) {
        String n = (name == null || name.trim().isEmpty()) ? "课程" : name.trim();
        return isStart ? ("马上上课 · " + n) : ("下课了 · " + n);
    }

    private static String classText(boolean isStart, String name, String detail, int before) {
        String d = (detail == null || detail.isEmpty()) ? "" : (detail + " · ");
        if (!isStart) return d + "点开结束本次专注并保存";
        if (before <= 0) return d + "已到上课时间，预约的专注会自动开始";
        return d + "约 " + before + " 分钟后开始，点开可立即开始或取消预约";
    }

    /**
     * 上课 / 下课提醒。
     *
     * 开着上岛时走 Island（低扰常驻 + promoted 标志 + 关闭按钮 + 到点自动下岛），
     * 关掉时退回原来的高优先级一次性通知。
     *
     * detail 形如「08:00-09:40 · 实验楼 B204」——岛上位置窄，这里把它拆成
     * 「时间是几点」+「在哪」，课程名与时刻上岛，地点放副文本。
     *
     * 上岛又分三种相位，都由 islandStart / islandStay / islandEnd 三个开关决定：
     *   · 课前（before>0）        → 「还有 N 分钟上课」，上课那一刻收摊
     *   · 正点（before==0）       → 开「上课期间常驻」就把**同一条岛**翻成
     *                               「还有 N 分钟下课」并延长到下课；没开就收摊
     *   · 下课（!isStart）        → 「已下课」；常驻那条能复用就复用，不新发
     */
    public static void showClass(Context c, boolean isStart, String name, String detail, int before) {
        ensureChannels(c);
        if (!canPost(c)) return;

        if (islandClassOnIsland(c, isStart, name, detail, before)) return;

        try {
            NotificationManagerCompat.from(c)
                    .notify(ID_CLASS, buildClass(c, isStart, name, detail, before));
        } catch (SecurityException ignored) { }
    }

    /**
     * 上课/下课提醒该不该上岛；上了岛返回 true（这条提醒已经发出去了）。
     *
     * 返回 false 的四种情况一律**退回普通高优先级通知**，绝不静默丢掉提醒：
     *   · 总闸关（islandExtrasOn=false）
     *   · 机型不支持 —— Android 15 以下 requestPromotedOngoing 被系统忽略，
     *     岛会退化成了「不响 + 划不掉」的常驻通知（CH_LIVE 是 IMPORTANCE_LOW、
     *     setOngoing）。拿来当上课提醒，等于用户把手机静音都听不到。
     *   · 对应的分项开关（islandStart / islandEnd）关着
     *   · 时间解析不出来，岛上的倒计时会是错的数
     * 以前这三种情况全是 `return`，通知分支永远走不到 ——
     * 关掉「上课提醒上岛」就再也收不到上课提醒，是个能要命的静默失效。
     */
    private static boolean islandClassOnIsland(Context c, boolean isStart, String name,
                                               String detail, int before) {
        if (!islandExtrasOn || !Island.supported()) return false;
        String course = shortName(name);
        String time = timeRange(detail);
        String place = placeOf(detail);
        String startHM = hm(time, true), endHM = hm(time, false);
        long now = System.currentTimeMillis();
        /* 时间解析不出来就别硬上岛：倒计时会变成一个错的数，
           那种错误比不上岛更难发现（用户以为课表现在是准的）。 */
        long startAt = todayAt(startHM), endAt = todayAt(endHM);
        boolean okTime = startAt > 0 && endAt > 0;

        if (isStart) {
            if (!Island.cfgStart) return false;
            if (before > 0) {
                if (!okTime) return false;
                Island.showClass(c, Island.ID_CLASS_START,
                        course + (Island.elTime ? (" " + startHM) : ""),
                        place, false, startAt, startAt, true);
                return true;
            }
            /* 正点上课 */
            if (Island.cfgStay && okTime) {
                Island.showClass(c, Island.ID_CLASS_START,
                        course + (Island.elTime ? (" " + startHM) : ""),
                        place, true, endAt, endAt, true);
                return true;
            }
            /* 不常驻：把课前那条收掉。但「上课了」这条本身还得让用户知道，
               所以退回普通通知（上岛之前本来就是这个行为）。 */
            Island.hide(c, Island.ID_CLASS_START);
            return false;
        }

        /* 下课提醒 */
        if (!Island.cfgEnd) { Island.hide(c, Island.ID_CLASS_START); return false; }
        long hideAt = now + Island.stayMillis();
        if (Island.cfgStay && Island.isShowing(c, Island.ID_CLASS_START)) {
            /* 常驻那条还在：翻成「已下课」，别新发一条（两条岛会叠在一起闪） */
            Island.showClass(c, Island.ID_CLASS_START, course, place, true, 0L, hideAt, false);
        } else {
            Island.hide(c, Island.ID_CLASS_START);
            Island.showClass(c, Island.ID_CLASS_END, course, place, true, 0L, hideAt, false);
        }
        return true;
    }

    /** 「08:00」→ 今天那个时刻的毫秒；解析失败返回 0，调用方据此退回普通通知 */
    private static long todayAt(String hmStr) {
        try {
            String[] p = hmStr.split(":");
            if (p.length < 2) return 0L;
            java.util.Calendar cal = java.util.Calendar.getInstance();
            cal.set(java.util.Calendar.HOUR_OF_DAY, Integer.parseInt(p[0].trim()));
            cal.set(java.util.Calendar.MINUTE, Integer.parseInt(p[1].trim()));
            cal.set(java.util.Calendar.SECOND, 0);
            cal.set(java.util.Calendar.MILLISECOND, 0);
            return cal.getTimeInMillis();
        } catch (Throwable t) { return 0L; }
    }

    public static void test(Context c) {
        ensureChannels(c);
        if (!canPost(c)) return;
        if (islandExtrasOn && Island.supported()) {
            /* 直接在岛上发一条：60 秒后自己下来，方便一眼确认上岛与倒计时有没有生效。
               走和上课提醒同一条路，预览到的排版就是真实排版。
               机型不支持时退回普通通知 —— 否则测试按钮点了等于没反应。 */
            long end = System.currentTimeMillis() + 60_000L;
            Island.showClass(c, Island.ID_TEST, "上岛测试", "排版与倒计时", false, end, end, true);
            return;
        }
        try {
            Notification n = buildClass(c, true, "示例课程", "08:00-09:40 · 实验楼 B204", 5);
            NotificationManagerCompat.from(c).notify(ID_CLASS + 1, n);
        } catch (SecurityException ignored) { }
    }

    public static boolean canPost(Context c) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return NotificationManagerCompat.from(c).areNotificationsEnabled()
                    && c.checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                       == android.content.pm.PackageManager.PERMISSION_GRANTED;
        }
        return NotificationManagerCompat.from(c).areNotificationsEnabled();
    }

    // ============================================================
    // detail 拆解 / 短字段
    // ============================================================

    /** 「08:00-09:40」 */
    private static String timeRange(String detail) {
        String[] p = splitDetail(detail);
        return p[0];
    }

    /** 「实验楼 B204」 */
    private static String placeOf(String detail) {
        String[] p = splitDetail(detail);
        return p[1];
    }

    private static String[] splitDetail(String detail) {
        String d = detail == null ? "" : detail.trim();
        String time = "", place = "";
        int i = d.indexOf(" · ");
        String head = i >= 0 ? d.substring(0, i).trim() : d;
        String tail = i >= 0 ? d.substring(i + 3).trim() : "";
        if (head.matches("\\d{1,2}:\\d{2}\\s*-\\s*\\d{1,2}:\\d{2}")) {
            time = head;
            place = tail;
        } else {
            place = d;
        }
        return new String[]{time, place};
    }

    /** time 的起 / 止时刻；解析不出来返回空串 */
    private static String hm(String time, boolean start) {
        if (time == null || time.isEmpty()) return "";
        String[] p = time.split("-");
        if (p.length != 2) return "";
        return (start ? p[0] : p[1]).trim();
    }

    /** 课程名按显示宽度截一下：岛上标题只有一行，太长了会变省略号乱码 */
    private static String shortName(String name) {
        String n = (name == null || name.trim().isEmpty()) ? "课程" : name.trim();
        return clip(n, 10);
    }

    // ============================================================
    // 厂商「上岛」适配
    // ============================================================

    /**
     * 厂商参数与 AOSP 上岛标志全部收敛在 {@link Island} 里，这里只留一个查询入口。
     *
     * 之所以不在这里拼 extras：早期版本把小米参数塞成 Bundle（miui.focus.param = Bundle），
     * 但系统实际读的是 **JSON 字符串 param_v2**，Bundle 那份没有任何实现会去解析，
     * 等于白塞。现在按验证过的结构统一走 Island.promote()。
     */

    public static String vendorName() {
        if (isMiui()) return "小米 HyperOS / MIUI · Liveup";
        if (isOplus()) return "OPPO / 一加 ColorOS · 实况窗";
        String m = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase();
        if (m.contains("vivo") || m.contains("iqoo")) return "vivo · 原子通知";
        if (m.contains("honor") || m.contains("huawei")) return "华为/荣耀 · 灵动通知";
        return "通用 Android · 焦点 extras";
    }

    private static boolean isMiui() {
        String m = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase();
        String b = Build.BRAND == null ? "" : Build.BRAND.toLowerCase();
        return m.contains("xiaomi") || m.contains("redmi") || b.contains("xiaomi") || b.contains("redmi") || b.contains("poco");
    }

    private static boolean isOplus() {
        String m = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase();
        String b = Build.BRAND == null ? "" : Build.BRAND.toLowerCase();
        return m.contains("oppo") || m.contains("oneplus") || m.contains("realme")
                || b.contains("oppo") || b.contains("oneplus") || b.contains("realme");
    }

    private static String clip(String s, int n) {
        if (s == null) return "";
        return s.length() <= n ? s : s.substring(0, n) + "…";
    }

    static String hhmmss(int secs) {
        secs = Math.max(0, secs);
        int h = secs / 3600, m = (secs % 3600) / 60, s = secs % 60;
        if (h > 0) return String.format("%d:%02d:%02d", h, m, s);
        return String.format("%02d:%02d", m, s);
    }
}
