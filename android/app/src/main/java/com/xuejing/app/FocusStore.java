package com.xuejing.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;

/**
 * 专注会话的唯一持久化口。
 *
 * ── 为什么要有这个文件（v0.2.4 重构）──────────────────────────────────
 * 旧实现里 FocusService 的全部状态是 static 字段，而且一行都不落盘：
 *   · 进程被回收 → 正在跑的专注连同 sEndAt 一起蒸发；
 *   · 计时走完 → 只把通知改写成「专注完成」，从不告诉页面。
 * 于是用户看到的是「通知栏的专注正常归零了，可学径里今日专注还是 0m」。
 *
 * 重构后**计时权威移到原生**，本类就是那个权威的落点：
 *   · 会话（running / paused）写进 SharedPreferences，进程死了也在；
 *   · 走完或手动结束时产出一条「待记账」记录进 pending 队列，
 *     页面下次打开时消费它，调 addFocusMin() 把统计补上。
 *
 * 「还没被页面消费」是常态而不是异常 —— 用户可能跑完专注就再不打开 App，
 * 也可能隔三天才打开。所以 pending 是**队列**而不是单个槽位，且按 id 幂等。
 *
 * ── 有效专注秒数的口径 ──────────────────────────────────────────────
 * 暂停的时间不算专注，所以拆成两个数记：
 *   accumSecs —— 已结算的秒数（每次 pause 把当前这一段算进来）
 *   resumeAt  —— 当前这一段 running 的起点
 * 有效秒数 = accumSecs + (running ? now - resumeAt : 0)
 *
 * 但服务要是真被杀，resumeAt 到「下次打开 App」的整段都会被算进去，那是虚的。
 * 所以 ticker 每秒顺手更新 lastAliveAt，结算时取 min(now, lastAliveAt + 宽限)，
 * 宽限给 10 秒（ticker 1 秒一跳，留足误差）。
 *
 * ── 与页面的契约 ────────────────────────────────────────────────────
 * 页面侧只允许通过两个桥接方法碰到这里：
 *   focusState() 拉快照（当前会话 + 待记账队列）
 *   focusAck()   消费完待记账后回执
 * 改字段必须两边一起改，tools/audit.mjs 会做对账。
 */
public class FocusStore {

    private static final String SP = "xuejing_focus";
    private static final String K_CUR = "current";
    private static final String K_PENDING = "pending";

    public static final String ST_RUNNING = "running";
    public static final String ST_PAUSED = "paused";

    /** 结束原因：走完 / 手动结束 / 丢弃不记账 */
    public static final String R_NATURAL = "natural";
    public static final String R_MANUAL = "manual";
    public static final String R_DISCARD = "discard";

    /** ticker 每秒一跳，服务被杀后结算最多认这么多毫秒的误差 */
    private static final long ALIVE_GRACE_MS = 10_000L;

    /** 心跳写盘节流：见 alive() */
    private static final long ALIVE_THROTTLE_MS = 5_000L;

    /** 队列上限：只留最近这些条，避免长期不打开 App 把 SharedPreferences 撑大 */
    private static final int PENDING_MAX = 50;

    private static SharedPreferences sp(Context c) {
        return c.getSharedPreferences(SP, Context.MODE_PRIVATE);
    }

    /* ================= 当前会话 ================= */

    static JSONObject current(Context c) {
        if (c == null) return null;
        String s = sp(c).getString(K_CUR, "");
        if (s == null || s.isEmpty()) return null;
        try {
            JSONObject o = new JSONObject(s);
            return o.optString("state", "").isEmpty() ? null : o;
        } catch (Throwable t) {
            return null;
        }
    }

    static void saveCurrent(Context c, JSONObject o) {
        if (c == null) return;
        sp(c).edit().putString(K_CUR, o == null ? "" : o.toString()).apply();
    }

    static void clearCurrent(Context c) {
        if (c == null) return;
        sp(c).edit().putString(K_CUR, "").apply();
    }

    /**
     * 开一轮新的专注会话。
     *
     * @param dir down=倒计时（到点自动结束）/ up=正计时（手动结束才算）
     */
    static JSONObject open(Context c, String label, String courseId, String mode,
                           String dir, int totalSecs) {
        long now = System.currentTimeMillis();
        JSONObject o = new JSONObject();
        boolean up = "up".equals(dir);
        try {
            /* id 用开始时刻：天然递增，够唯一，也方便页面做幂等 */
            o.put("id", now);
            o.put("label", (label == null || label.trim().isEmpty()) ? "自由专注" : label.trim());
            o.put("courseId", courseId == null ? "" : courseId);
            o.put("mode", (mode == null || mode.isEmpty()) ? "work" : mode);
            o.put("dir", up ? "up" : "down");
            o.put("totalSecs", Math.max(1, totalSecs));
            o.put("startAt", now);
            /* 正计时没有终点，endAt 记 0 */
            o.put("endAt", up ? 0L : now + Math.max(1, totalSecs) * 1000L);
            o.put("accumSecs", 0);
            o.put("resumeAt", now);
            o.put("lastAliveAt", now);
            o.put("state", ST_RUNNING);
        } catch (Throwable ignored) { }
        saveCurrent(c, o);
        return o;
    }

    /** 暂停：把当前这一段结算进 accumSecs，并记住暂停时刻（恢复时要把 endAt 往后推） */
    static void pause(Context c) {
        JSONObject o = current(c);
        if (o == null) return;
        long now = System.currentTimeMillis();
        int gained = 0;
        if (ST_RUNNING.equals(o.optString("state"))) {
            long ra = o.optLong("resumeAt", now);
            long cap = o.optLong("lastAliveAt", now) + ALIVE_GRACE_MS;
            gained = (int) Math.max(0, (Math.min(now, cap) - ra) / 1000L);
        }
        try {
            o.put("accumSecs", o.optInt("accumSecs", 0) + gained);
            o.put("state", ST_PAUSED);
            o.put("pausedAt", now);
            o.put("resumeAt", 0L);
        } catch (Throwable ignored) { }
        saveCurrent(c, o);
    }

    /** 恢复：倒计时的 endAt 要往后推「暂停了多久」，否则暂停会白白吃掉倒计时 */
    static void resume(Context c) {
        JSONObject o = current(c);
        if (o == null) return;
        long now = System.currentTimeMillis();
        long pausedAt = o.optLong("pausedAt", 0L);
        long endAt = o.optLong("endAt", 0L);
        try {
            if (endAt > 0 && pausedAt > 0) o.put("endAt", endAt + (now - pausedAt));
            o.put("state", ST_RUNNING);
            o.put("resumeAt", now);
            o.put("lastAliveAt", now);
            o.put("pausedAt", 0L);
        } catch (Throwable ignored) { }
        saveCurrent(c, o);
    }

    /** 延长当前这一轮（秒）：倒计时的结束时刻跟着往后推，正计时只改计划总时长 */
    static void extend(Context c, int secs) {
        JSONObject o = current(c);
        if (o == null || secs <= 0) return;
        try {
            o.put("totalSecs", o.optInt("totalSecs", 0) + secs);
            if (!"up".equals(o.optString("dir"))) {
                long endAt = o.optLong("endAt", 0L);
                if (endAt > 0) o.put("endAt", endAt + secs * 1000L);
            }
        } catch (Throwable ignored) { }
        saveCurrent(c, o);
    }

    /**
     * ticker 每秒调一次：留下「服务还活着」的证据，服务被杀后结算才不会虚增。
     * 写入按 5 秒节流 —— 每秒一次磁盘 I/O 太浪费，而 5 秒的精度对补算够用
     * （宽限有 10 秒，覆盖得住）。
     */
    static void alive(Context c) {
        JSONObject o = current(c);
        if (o == null) return;
        if (!ST_RUNNING.equals(o.optString("state"))) return;
        long now = System.currentTimeMillis();
        if (now - o.optLong("lastAliveAt", 0L) < ALIVE_THROTTLE_MS) return;
        try {
            o.put("lastAliveAt", now);
        } catch (Throwable ignored) { }
        saveCurrent(c, o);
    }

    /**
     * 结束会话并（除丢弃外）产出一条待记账记录。
     *
     * @param reason natural 走完 / manual 手动结束 / discard 丢弃不记账
     */
    static void finish(Context c, String reason) {
        JSONObject o = current(c);
        if (o == null) return;
        String why = (reason == null || reason.isEmpty()) ? R_NATURAL : reason;
        try {
            o.put("secs", effectiveSecs(o));
            o.put("endedAt", System.currentTimeMillis());
            o.put("endReason", why);
            o.put("state", "ended");
        } catch (Throwable ignored) { }
        if (!R_DISCARD.equals(why)) enqueue(c, o);
        clearCurrent(c);
    }

    /** 有效专注秒数：已结算的 + 当前这一段（截至「最后活着」的时刻） */
    static int effectiveSecs(JSONObject o) {
        if (o == null) return 0;
        int acc = o.optInt("accumSecs", 0);
        if (!ST_RUNNING.equals(o.optString("state"))) return acc;
        long now = System.currentTimeMillis();
        long ra = o.optLong("resumeAt", now);
        long cap = o.optLong("lastAliveAt", now) + ALIVE_GRACE_MS;
        return acc + (int) Math.max(0, (Math.min(now, cap) - ra) / 1000L);
    }

    /** 倒计时剩余秒数；正计时恒为 0 */
    static int remainSecs(JSONObject o) {
        if (o == null) return 0;
        if ("up".equals(o.optString("dir"))) return 0;
        long endAt = o.optLong("endAt", 0L);
        if (endAt <= 0) return 0;
        return (int) Math.max(0, (endAt - System.currentTimeMillis() + 999) / 1000L);
    }

    /* ================= 待记账队列 ================= */

    static JSONArray pending(Context c) {
        if (c == null) return new JSONArray();
        String s = sp(c).getString(K_PENDING, "");
        if (s == null || s.isEmpty()) return new JSONArray();
        try {
            return new JSONArray(s);
        } catch (Throwable t) {
            return new JSONArray();
        }
    }

    private static void enqueue(Context c, JSONObject session) {
        if (c == null || session == null) return;
        JSONArray arr = pending(c);
        try {
            JSONObject rec = new JSONObject();
            rec.put("id", String.valueOf(session.optLong("id", System.currentTimeMillis())));
            rec.put("label", session.optString("label", "自由专注"));
            rec.put("courseId", session.optString("courseId", ""));
            rec.put("mode", session.optString("mode", "work"));
            rec.put("dir", session.optString("dir", "down"));
            rec.put("totalSecs", session.optInt("totalSecs", 0));
            rec.put("secs", session.optInt("secs", 0));
            rec.put("startAt", session.optLong("startAt", 0L));
            rec.put("endedAt", session.optLong("endedAt", System.currentTimeMillis()));
            rec.put("reason", session.optString("endReason", R_NATURAL));
            arr.put(rec);
        } catch (Throwable ignored) { }
        if (arr.length() > PENDING_MAX) {
            JSONArray keep = new JSONArray();
            for (int i = arr.length() - PENDING_MAX; i < arr.length(); i++) {
                try {
                    keep.put(arr.get(i));
                } catch (Throwable ignored) { }
            }
            arr = keep;
        }
        sp(c).edit().putString(K_PENDING, arr.toString()).apply();
    }

    /** 页面消费完一批记录后回执；按 id 幂等，重复 ack 不会出错 */
    static void ack(Context c, String idsJson) {
        if (c == null) return;
        Set<String> ids = new HashSet<>();
        try {
            JSONArray a = new JSONArray(idsJson == null ? "[]" : idsJson);
            for (int i = 0; i < a.length(); i++) {
                String v = String.valueOf(a.get(i));
                if (!v.isEmpty()) ids.add(v);
            }
        } catch (Throwable t) {
            return;
        }
        if (ids.isEmpty()) return;
        JSONArray src = pending(c);
        JSONArray keep = new JSONArray();
        for (int i = 0; i < src.length(); i++) {
            try {
                JSONObject o = src.getJSONObject(i);
                if (!ids.contains(String.valueOf(o.opt("id")))) keep.put(o);
            } catch (Throwable ignored) { }
        }
        sp(c).edit().putString(K_PENDING, keep.toString()).apply();
    }

    /* ================= 给页面的快照 ================= */

    /**
     * 页面启动 / 回到前台时拉一次：当前会话 + 待记账队列。
     * 这是原生 → 页面**唯一**的批量通道；秒级的倒计时不走这里（太费电），
     * 页面拿到 endAt 后自己按时间戳推算。
     */
    static String stateJson(Context c) {
        JSONObject out = new JSONObject();
        try {
            JSONObject cur = current(c);
            if (cur != null) {
                out.put("hasSession", true);
                out.put("id", String.valueOf(cur.optLong("id", 0L)));
                out.put("running", ST_RUNNING.equals(cur.optString("state")));
                out.put("paused", ST_PAUSED.equals(cur.optString("state")));
                out.put("label", cur.optString("label", "自由专注"));
                out.put("courseId", cur.optString("courseId", ""));
                out.put("mode", cur.optString("mode", "work"));
                out.put("dir", cur.optString("dir", "down"));
                out.put("totalSecs", cur.optInt("totalSecs", 0));
                out.put("startAt", cur.optLong("startAt", 0L));
                out.put("endAt", cur.optLong("endAt", 0L));
                out.put("secs", effectiveSecs(cur));
                out.put("remainSecs", remainSecs(cur));
            } else {
                out.put("hasSession", false);
                out.put("running", false);
                out.put("paused", false);
            }
            out.put("pending", pending(c));
            out.put("now", System.currentTimeMillis());
        } catch (Throwable ignored) { }
        return out.toString();
    }
}
