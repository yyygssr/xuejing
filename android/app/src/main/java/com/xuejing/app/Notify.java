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
        String task = (label == null || label.trim().isEmpty()) ? "自由专注" : label.trim();
        int remain = Math.max(0, remainSecs);
        boolean island = islandExtrasOn;

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

        if (island) {
            /* 岛上：标题 = 状态 + 倒计时，正文留空，不挂 chronometer */
            b.setContentTitle((running ? "专注中 " : "已暂停 ") + hhmmss(remain))
             .setContentText("")
             .setSubText(task)
             .setShowWhen(false)
             .setUsesChronometer(false);
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
               前台服务通知保持 null TAG，才能与 startForeground 合成同一条。
               标题就是岛上显示的那行，所以这里的 title 与上面一致。 */
            Island.promote(n, (running ? "专注中 " : "已暂停 ") + hhmmss(remain), task, Island.ACCENT);
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
     * 「时间是几点」+「在哪」，标题只留课程名与时刻，地点放正文并截断。
     */
    public static void showClass(Context c, boolean isStart, String name, String detail, int before) {
        ensureChannels(c);
        if (!canPost(c)) return;

        if (islandExtrasOn) {
            String course = shortName(name);
            String time = timeRange(detail);
            String place = placeOf(detail);
            String startHM = hm(time, true), endHM = hm(time, false);
            String title, text;
            if (isStart) {
                title = course + (startHM.isEmpty() ? " · 上课" : (" · " + startHM));
                text = (place.isEmpty() ? "" : (place + " · ")) + "约 " + Math.max(1, before) + " 分钟后开始";
            } else {
                title = course + " · 已下课";
                text = (endHM.isEmpty() ? "" : (endHM + (place.isEmpty() ? "" : " · "))) + place;
            }
            /* 课前提醒：上课那一刻自动下岛；下课提醒：10 分钟后自动下岛。
               上岛通知是常驻的，不给出口就会一直占着岛。 */
            long hideAt = System.currentTimeMillis()
                    + (isStart ? Math.max(1, before) * 60_000L : 10 * 60_000L);
            Island.show(c, isStart ? Island.ID_CLASS_START : Island.ID_CLASS_END,
                    Island.ICON_CLASS, title, clip(text, 28), "学径",
                    isStart ? Island.ACCENT_CLASS : Island.ACCENT,
                    true, hideAt, 0L);
            return;
        }

        try {
            NotificationManagerCompat.from(c)
                    .notify(ID_CLASS, buildClass(c, isStart, name, detail, before));
        } catch (SecurityException ignored) { }
    }

    public static void test(Context c) {
        ensureChannels(c);
        if (!canPost(c)) return;
        if (islandExtrasOn) {
            /* 直接在岛上发一条：60 秒后自己下来，方便一眼确认上岛与倒计时有没有生效 */
            Island.show(c, Island.ID_TEST, Island.ICON_TIMER, "上岛测试 · 60 秒后退下",
                    "专注计时会像这样在岛上显示倒计时", "学径", Island.ACCENT,
                    true, System.currentTimeMillis() + 60_000L,
                    System.currentTimeMillis() + 60_000L);
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
