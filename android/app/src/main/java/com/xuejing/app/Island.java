package com.xuejing.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

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
 * ── 排版约定（v1.1.0 重做）──────────────────────────────────────────
 * 岛上给的位置极小，**主显示位是标题**（参考实现里番茄钟把「状态 + 倒计时」直接合进标题，
 * 因为胶囊/锁屏 Live Updates 只稳定渲染标题这一行）。所以：
 *   · 标题自带信息量、不放长句：专注 →「专注中 24:35」；上课 →「数据结构 · 08:00」
 *   · 正文只做补充且必须短：地点、剩余时间之类，超长一律截断
 *   · 不在同一条通知上同时用「标题里的数字」和系统 chronometer（两个数字并排就是「排版不正常」）
 *   · 不用 BigTextStyle：锁屏展开会把同一段话再渲染一遍
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
     * 构建一条上岛通知。图标 / 配色 / 上岛标志在这里单点维护。
     *
     * @param icon           左侧小图标（ICON_TIMER / ICON_CLASS）
     * @param ongoing        true 时是常驻岛
     * @param countdownEndAt >0 时用系统 chronometer 倒数到这个时刻（给不用标题倒计时的场景）；
     *                        传 0 表示不挂 chronometer（标题里已经写了数字，再来一个就是两个）
     */
    public static Notification build(Context c, int icon, String title, String text, String sub,
                                     String accent, boolean ongoing, long countdownEndAt) {
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CH_LIVE)
                .setSmallIcon(icon > 0 ? icon : ICON_TIMER)
                .setColor(parseColor(accent))
                .setContentTitle(title)
                .setContentText(text)
                .setContentIntent(openApp(c, 31))
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setOngoing(ongoing)
                .setOnlyAlertOnce(true)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        /* 不用 BigTextStyle：锁屏 Live Updates 展开时会把同一段话重复渲染一遍 */
        if (sub != null && !sub.trim().isEmpty()) b.setSubText(sub);
        if (countdownEndAt > 0) {
            b.setShowWhen(true).setWhen(countdownEndAt).setUsesChronometer(true);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) b.setChronometerCountDown(true);
        } else {
            b.setShowWhen(false).setUsesChronometer(false);
        }

        Notification n = b.build();
        promote(n, title, text, accent);
        return n;
    }

    /**
     * 下发上岛通知。
     *
     * @param closeable  是否挂「关闭」按钮（常驻岛必须给出口，否则用户划不掉就只能等自动下岛）
     * @param hideAtMillis 自动下岛时间戳（>0 时排一个闹钟兜底，防止岛一直占着）
     */
    public static void show(Context c, int id, int icon, String title, String text, String sub,
                            String accent, boolean closeable, long hideAtMillis, long countdownEndAt) {
        try {
            ensureChannel(c);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                    && !NotificationManagerCompat.from(c).areNotificationsEnabled()) return;

            NotificationManager nm = c.getSystemService(NotificationManager.class);
            if (nm == null) return;

            Notification n = build(c, icon, title, text, sub, accent, true, countdownEndAt);
            if (closeable) {
                try {
                    n.actions = new Notification.Action[]{ closeAction(c, id) };
                } catch (Throwable ignored) { }
            }
            nm.notify(TAG_LIVE, id, n);
            if (hideAtMillis > 0) scheduleHide(c, id, hideAtMillis);
        } catch (Throwable ignored) { }
    }

    /** 更新岛上的内容（同 TAG + 同 ID 覆盖即可） */
    public static void update(Context c, int id, int icon, String title, String text,
                              String accent, long countdownEndAt) {
        show(c, id, icon, title, text, null, accent, false, 0L, countdownEndAt);
    }

    /** 下岛：TAG 与 ID 必须和下发时一致，否则 cancel 不掉 */
    public static void hide(Context c, int id) {
        try {
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            if (nm != null) nm.cancel(TAG_LIVE, id);
        } catch (Throwable ignored) { }
        cancelHide(c, id);
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
    public static void promote(Notification n, String title, String text, String accent) {
        try {
            n.flags |= Notification.FLAG_NO_CLEAR;
            if (n.extras == null) n.extras = new Bundle();
            Bundle ex = n.extras;
            // 最关键的一行：Android 15+ 由系统提升为 Live Updates；低版本静默忽略
            ex.putBoolean(EXTRA_PROMOTED, true);
            ex.putBoolean("android.ongoingActivity", true);

            String miui = miuiParamV2(title, text, accent);
            if (!miui.isEmpty()) {
                try { ex.putString("miui.focus.param", miui); } catch (Throwable ignored) { }
            }
            vendorExtras(ex, title, text);
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
     * 岛上位置窄，title / content 一律按短字段给（调用方已截断），
     * 这里再兜一层上限，避免长句把大岛挤成两行乱码。
     */
    private static String miuiParamV2(String title, String text, String accent) {
        try {
            String t = clip(nullTo(title), 16);
            String x = clip(nullTo(text), 24);
            String color = (accent == null || accent.trim().isEmpty()) ? ACCENT : accent.trim();

            JSONObject picInfo = new JSONObject().put("type", 1).put("pic", "miui.focus.pic_imageText");
            JSONObject textInfo = new JSONObject()
                    .put("frontTitle", "学径")
                    .put("title", t)
                    .put("content", x)
                    .put("useHighLight", false);
            JSONObject bigArea = new JSONObject()
                    .put("imageTextInfoLeft", new JSONObject()
                            .put("type", 1)
                            .put("picInfo", picInfo)
                            .put("textInfo", textInfo));
            JSONObject smallArea = new JSONObject().put("picInfo", picInfo);
            JSONObject paramIsland = new JSONObject()
                    .put("islandProperty", 1)
                    .put("bigIslandArea", bigArea)
                    .put("smallIslandArea", smallArea);
            JSONObject baseInfo = new JSONObject()
                    .put("title", t)
                    .put("content", x)
                    .put("colorTitle", color)
                    .put("type", 2);
            JSONObject paramV2 = new JSONObject()
                    .put("business", "xuejing")
                    .put("enableFloat", true)
                    .put("updatable", true)
                    .put("islandFirstFloat", true)
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
            try { am.set(AlarmManager.RTC_WAKEUP, at, pi); }
            catch (Throwable t) { am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi); }
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

    private static int parseColor(String accent) {
        try { return Color.parseColor(accent); } catch (Throwable t) { return 0xFF5A5AD6; }
    }

    private static String nullTo(String s) { return s == null ? "" : s; }

    private static String clip(String s, int n) {
        if (s == null) return "";
        return s.length() <= n ? s : s.substring(0, n) + "…";
    }
}
