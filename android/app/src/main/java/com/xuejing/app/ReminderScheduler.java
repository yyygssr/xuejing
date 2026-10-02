package com.xuejing.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;
import java.util.HashSet;
import java.util.Set;

/**
 * 上课 / 下课提醒的闹钟调度。
 *
 * 课表来自页面（JSON），这里为每门课的「下一次上课」安排两个精确闹钟：
 * 开始前 remindBefore 分钟提醒一次，下课时再提醒一次。
 * 每次触发后由接收器重新排下一周的那一次，所以只维护「最近一轮」的闹钟，
 * 不会堆出成百上千个待触发项。
 *
 * 精确闹钟在 Android 12+ 需要用户在系统里授予「闹钟和提醒」权限。
 * 没授予时自动降级为非精确闹钟（可能晚几分钟），功能不中断。
 */
public class ReminderScheduler {

    private static final String SP = "xuejing_reminders";
    private static final String K_CODES = "codes";
    private static final String K_SCHEDULE = "schedule";
    private static final String K_PREFS = "prefs";

    private static final int REQ_BASE = 1000;

    public static void reschedule(Context c, String scheduleJson, String prefsJson) {
        if (c == null) return;
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;

        // 先把上一轮排的闹钟全部撤掉，避免课表改了以后旧闹钟还在响
        cancelAll(c, am);

        SharedPreferences sp = c.getSharedPreferences(SP, Context.MODE_PRIVATE);
        sp.edit()
          .putString(K_SCHEDULE, scheduleJson == null ? "" : scheduleJson)
          .putString(K_PREFS, prefsJson == null ? "" : prefsJson)
          .apply();

        if (!classRemindOn(prefsJson)) return;

        int before = remindBefore(prefsJson);
        boolean endRemind = endRemindOn(prefsJson);

        // 页面新格式：{termStart, courses:{0:[…]}}；旧格式直接是 {0:[…]}
        String termStart = "";
        JSONObject coursesRoot;
        try {
            JSONObject root = new JSONObject(scheduleJson == null ? "{}" : scheduleJson);
            if (root.optJSONObject("courses") != null) {
                termStart = optText(root, "termStart");
                coursesRoot = root.getJSONObject("courses");
            } else {
                coursesRoot = root;
            }
        } catch (Throwable t) {
            coursesRoot = new JSONObject();
        }

        Set<String> codes = new HashSet<>();
        try {
            for (int day = 0; day < 7; day++) {
                JSONArray list = coursesRoot.optJSONArray(String.valueOf(day));
                if (list == null) continue;
                for (int i = 0; i < list.length(); i++) {
                    JSONObject o = list.optJSONObject(i);
                    if (o == null) continue;
                    /* 周次（每周 / 单周 / 双周 / 5-8 周）**不在排程时过滤**。
                       早期写法是「本周不匹配就 continue」—— 后果是双周课在单周那天
                       一个闹钟都不排，而下一次排程要等到用户重开 App，
                       于是「双周的课根本不提醒」。现在一律排下一个该星期的触发点，
                       到点再判断周次是否匹配，不匹配就静默跳过（见 ClassAlarmReceiver）。 */
                    String w = optText(o, "w");
                    if (w.isEmpty()) w = "all";
                    String t = optText(o, "t");
                    String name = optText(o, "n");
                    if (name.isEmpty()) name = "课程";
                    String loc = optText(o, "loc");
                    String[] se = t.split("-");
                    if (se.length != 2) continue;
                    int sh = hourOf(se[0]), sm = minOf(se[0]);
                    int eh = hourOf(se[1]), em = minOf(se[1]);
                    if (sh < 0 || eh < 0) continue;

                    long startAt = nextOccurrence(day, sh, sm);
                    long endAt = nextOccurrence(day, eh, em);
                    String detail = t + (loc.isEmpty() ? "" : (" · " + loc));
                    long now = System.currentTimeMillis();

                    int codeStart = REQ_BASE + day * 100 + i * 2;
                    /* 课前提醒：start - before。若已进入提醒窗口但尚未上课，
                       立刻补发一条（以前要求 remindAt > now，导致「还剩 3 分钟」永远不提醒）。 */
                    if (before > 0 && startAt > now) {
                        long remindAt = startAt - before * 60_000L;
                        if (remindAt <= now) remindAt = now + 2000L;
                        set(c, am, codeStart, remindAt, true, name, detail, before, w);
                        codes.add(String.valueOf(codeStart));
                    }
                    /* 正点再排一条「上课」：预约专注在原生侧自动开始也要靠它 */
                    int codeBegin = REQ_BASE + day * 100 + 80 + i;
                    if (startAt > now) {
                        set(c, am, codeBegin, startAt, true, name, detail, 0, w);
                        codes.add(String.valueOf(codeBegin));
                    }
                    if (endRemind && endAt > now) {
                        int codeEnd = REQ_BASE + day * 100 + i * 2 + 1;
                        set(c, am, codeEnd, endAt, false, name, detail, before, w);
                        codes.add(String.valueOf(codeEnd));
                    }
                }
            }
        } catch (Throwable ignored) { }

        sp.edit().putStringSet(K_CODES, codes).apply();
    }

    /**
     * w 支持四种写法（与页面 coursesAt 的过滤规则必须一致）：
     *   all      每周
     *   odd/even 单周 / 双周
     *   5-8      第 5~8 周（也容错 5~8、5 到 8 之外的空格）
     * termStart 为空时按第 1 周（奇）处理。
     */
    static boolean weekMatches(String w, int week) {
        if (w == null || w.isEmpty() || "all".equals(w)) return true;
        String v = w.trim().toLowerCase();
        boolean odd = (week % 2) == 1;
        if ("odd".equals(v)) return odd;
        if ("even".equals(v)) return !odd;
        java.util.regex.Matcher m = RANGE.matcher(v);
        if (m.matches()) {
            try {
                int a = Integer.parseInt(m.group(1)), b = Integer.parseInt(m.group(2));
                if (a > b) { int t = a; a = b; b = t; }
                return week >= a && week <= b;
            } catch (Throwable ignored) { return true; }
        }
        return true;
    }

    private static final java.util.regex.Pattern RANGE =
            java.util.regex.Pattern.compile("^(\\d{1,2})\\s*[-~到]\\s*(\\d{1,2})$");

    /** 供接收器用：按当前时间判断这条课该不该响（termStart 从已存的课表里取） */
    static boolean weekMatchesNow(Context c, String w) {
        try {
            SharedPreferences sp = c.getSharedPreferences(SP, Context.MODE_PRIVATE);
            JSONObject root = new JSONObject(sp.getString(K_SCHEDULE, "{}"));
            String termStart = root.optJSONObject("courses") != null ? optText(root, "termStart") : "";
            return weekMatches(w, weekNo(termStart));
        } catch (Throwable t) {
            return true;
        }
    }

    static int weekNo(String termStart) {
        if (termStart == null || termStart.trim().isEmpty()) return 1;
        try {
            String[] p = termStart.trim().split("-");
            if (p.length != 3) return 1;
            Calendar cal = Calendar.getInstance();
            cal.set(Integer.parseInt(p[0]), Integer.parseInt(p[1]) - 1, Integer.parseInt(p[2]), 0, 0, 0);
            cal.set(Calendar.MILLISECOND, 0);
            long start = cal.getTimeInMillis();
            long days = (System.currentTimeMillis() - start) / 86400000L;
            int w = (int) Math.floor(days / 7.0) + 1;
            return w < 1 ? 1 : w;
        } catch (Throwable t) {
            return 1;
        }
    }

    /** 用存储的课表重排（开机、应用更新、闹钟触发后调用） */
    public static void rescheduleFromStore(Context c) {
        SharedPreferences sp = c.getSharedPreferences(SP, Context.MODE_PRIVATE);
        reschedule(c, sp.getString(K_SCHEDULE, ""), sp.getString(K_PREFS, ""));
    }

    /** 精确闹钟授权状态，给设置页用（JSON，解析失败页面也有兜底文案） */
    public static boolean canExact(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;   // 12 以下不需要授权
        try {
            AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
            return am != null && am.canScheduleExactAlarms();
        } catch (Throwable t) {
            return false;
        }
    }

    private static void cancelAll(Context c, AlarmManager am) {
        SharedPreferences sp = c.getSharedPreferences(SP, Context.MODE_PRIVATE);
        Set<String> codes = sp.getStringSet(K_CODES, null);
        if (codes == null) return;
        for (String s : codes) {
            try {
                int code = Integer.parseInt(s);
                PendingIntent pi = buildPi(c, code, true, "", "", 0, "all", false);
                if (pi != null) {
                    am.cancel(pi);
                    pi.cancel();
                }
            } catch (Throwable ignored) { }
        }
        sp.edit().putStringSet(K_CODES, new HashSet<String>()).apply();
    }

    private static void set(Context c, AlarmManager am, int code, long triggerAt,
                            boolean isStart, String name, String detail, int before, String w) {
        if (triggerAt <= System.currentTimeMillis()) return;
        PendingIntent pi = buildPi(c, code, isStart, name, detail, before, w, true);
        if (pi == null) return;
        try {
            boolean exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms();
            if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
        } catch (SecurityException e) {
            try { am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi); } catch (Throwable ignored) { }
        } catch (Throwable ignored) { }
    }

    private static PendingIntent buildPi(Context c, int code, boolean isStart,
                                         String name, String detail, int before, String w,
                                         boolean mutable) {
        Intent i = new Intent(c, ClassAlarmReceiver.class);
        i.putExtra("isStart", isStart)
         .putExtra("name", name)
         .putExtra("detail", detail)
         .putExtra("before", before)
         /* 周次要带到触发点：本周期不匹配就别响，但闹钟照排（这样下一周自然会响） */
         .putExtra("w", w == null ? "all" : w);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        try {
            return PendingIntent.getBroadcast(c, code, i, flags);
        } catch (Throwable t) {
            return null;
        }
    }

    /** 下一次「每周第 day 天的 hh:mm」，已过则顺延一周。
     *  页面 day：0=周一 … 6=周日。
     *  不要用 Calendar.set(DAY_OF_WEEK)：它依赖 Locale 的一周起点，
     *  在部分 ROM 上会落到「本周已经过去的那天」，再叠时区偏移就更容易排错。 */
    private static long nextOccurrence(int jsDay, int h, int m) {
        Calendar cal = Calendar.getInstance();
        // Calendar.SUNDAY=1 … SATURDAY=7 → 换算成 0=周一 … 6=周日
        int todayJs = (cal.get(Calendar.DAY_OF_WEEK) + 5) % 7;
        int diff = (jsDay - todayJs + 7) % 7;
        cal.set(Calendar.HOUR_OF_DAY, h);
        cal.set(Calendar.MINUTE, m);
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);
        if (diff == 0 && cal.getTimeInMillis() <= System.currentTimeMillis()) {
            diff = 7;
        }
        if (diff != 0) cal.add(Calendar.DAY_OF_YEAR, diff);
        return cal.getTimeInMillis();
    }

    /** 课表 JSON 里是否预约了这门课（cid 含课名与时间段） */
    static boolean isBooked(Context c, String name, String time) {
        if (c == null || name == null || name.isEmpty()) return false;
        try {
            SharedPreferences sp = c.getSharedPreferences(SP, Context.MODE_PRIVATE);
            String json = sp.getString(K_SCHEDULE, "");
            if (json == null || json.isEmpty()) return false;
            JSONObject root = new JSONObject(json);
            JSONObject bookings = root.optJSONObject("bookings");
            if (bookings == null) return false;
            java.util.Iterator<String> it = bookings.keys();
            while (it.hasNext()) {
                String k = it.next();
                if (k == null) continue;
                if (k.contains(name) && (time == null || time.isEmpty() || k.contains(time))) {
                    return true;
                }
            }
        } catch (Throwable ignored) { }
        return false;
    }

    /**
     * 今天是不是放假（放假当天不提醒上课）。
     *
     * 数据来自页面 pushScheduleToNative() 推来的 holidays 扁平表 + holidayMode 开关，
     * 规则必须与页面 dayInfo() 完全一致 —— 契约见页面 pushScheduleToNative() 的注释。
     *
     * 和单双周一样在**触发时**判断而不是排程时判断：排程时过滤会让放假那周一个闹钟都不排，
     * 而下一次重排要等用户重开 App，于是「放假前最后一节课之后再也不提醒」。
     * 现在每周照排，不该响的那天静默跳过（接收器仍会重排下一周）。
     *
     * 以前这里完全没有节假日概念 —— 页面修了「放假当天主页不显示课」，
     * 通知却照响，因为这条语义在页面和原生写了两遍且没人通知对方。
     */
    static boolean isHolidayNow(Context c) {
        try {
            SharedPreferences sp = c.getSharedPreferences(SP, Context.MODE_PRIVATE);
            JSONObject root = new JSONObject(sp.getString(K_SCHEDULE, "{}"));
            if (!root.optBoolean("holidayMode", false)) return false;
            JSONObject hol = root.optJSONObject("holidays");
            if (hol == null) return false;
            Calendar cal = Calendar.getInstance();
            String key = cal.get(Calendar.YEAR) + "-" + pad2(cal.get(Calendar.MONTH) + 1)
                    + "-" + pad2(cal.get(Calendar.DAY_OF_MONTH));
            return hol.optString(key, "").length() > 0;
        } catch (Throwable t) {
            return false;
        }
    }

    private static String pad2(int n) { return (n < 10 ? "0" : "") + n; }

    /** 从 "08:00-09:40" 算出秒数 */
    static int durationSecs(String timeRange) {
        try {
            String[] p = String.valueOf(timeRange).split("-");
            if (p.length != 2) return 50 * 60;
            int sh = hourOf(p[0]), sm = minOf(p[0]);
            int eh = hourOf(p[1]), em = minOf(p[1]);
            if (sh < 0 || eh < 0) return 50 * 60;
            int mins = (eh * 60 + em) - (sh * 60 + sm);
            if (mins <= 0 || mins > 240) mins = 50;
            return mins * 60;
        } catch (Throwable t) {
            return 50 * 60;
        }
    }

    private static int hourOf(String hm) {
        try { return Integer.parseInt(hm.trim().split(":")[0]); } catch (Exception e) { return -1; }
    }

    private static int minOf(String hm) {
        try { return Integer.parseInt(hm.trim().split(":")[1]); } catch (Exception e) { return -1; }
    }

    /**
     * 只取真正的字符串字段。org.json 的 optString 会把 JSON 里的 null
     * 读成字面量 "null"（JSONObject.NULL.toString() 就是 "null"），
     * 拿它当课程名/教室就会出现「null」这种闹钟文案。这里一律当空串。
     */
    private static String optText(JSONObject o, String key) {
        if (o == null) return "";
        Object v = o.opt(key);
        return (v instanceof String) ? (String) v : "";
    }

    private static int remindBefore(String prefsJson) {
        try { return new JSONObject(prefsJson).optInt("remindBefore", 5); } catch (Throwable e) { return 5; }
    }

    private static boolean classRemindOn(String prefsJson) {
        try { return new JSONObject(prefsJson).optBoolean("classRemind", true); } catch (Throwable e) { return true; }
    }

    private static boolean endRemindOn(String prefsJson) {
        try { return new JSONObject(prefsJson).optBoolean("endRemind", true); } catch (Throwable e) { return true; }
    }

}
