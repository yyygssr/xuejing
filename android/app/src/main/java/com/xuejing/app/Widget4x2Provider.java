package com.xuejing.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.widget.RemoteViews;

import org.json.JSONObject;

/** 4×2：左四宫格 + 右问 AI / 课程 */
public class Widget4x2Provider extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        bind(context, XueJingWidgetProvider.parse(XueJingWidgetProvider.load(context)));
    }

    static void bind(Context c, JSONObject o) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(c);
        if (mgr == null) return;
        int[] ids = mgr.getAppWidgetIds(new ComponentName(c, Widget4x2Provider.class));
        if (ids == null || ids.length == 0) return;
        RemoteViews rv = new RemoteViews(c.getPackageName(), R.layout.widget_4x2);
        rv.setTextViewText(R.id.tCourse, o.optInt("weekCourses", 0) + "节");
        rv.setTextViewText(R.id.tNote, o.optInt("noteCount", 0) + "条");
        rv.setTextViewText(R.id.tTodo, o.optInt("todoCount", 0) + "待办");
        rv.setTextViewText(R.id.tFocus, o.optInt("focusMin", 0) + "m");
        boolean live = o.optBoolean("liveClass", false);
        String name = o.optString("nextName", "今天没有了");
        String time = o.optString("nextTime", "");
        String loc = o.optString("nextLoc", "");
        rv.setTextViewText(R.id.tClassTitle, live ? "正在上课" : "下一节课");
        rv.setTextViewText(R.id.tClassName, name == null || name.isEmpty() ? "今天没有了" : name);
        rv.setTextViewText(R.id.tClassMeta, time + (loc == null || loc.isEmpty() ? "" : (" · " + loc)));
        rv.setOnClickPendingIntent(R.id.bCourse, XueJingWidgetProvider.openApp(c, "schedule", 221));
        rv.setOnClickPendingIntent(R.id.bNote, XueJingWidgetProvider.openApp(c, "notes", 222));
        rv.setOnClickPendingIntent(R.id.bTodo, XueJingWidgetProvider.openApp(c, "todos", 223));
        rv.setOnClickPendingIntent(R.id.bFocus, XueJingWidgetProvider.openApp(c, "home", 224));
        rv.setOnClickPendingIntent(R.id.bAskAi, XueJingWidgetProvider.openApp(c, "chat", 225));
        rv.setOnClickPendingIntent(R.id.bClass, XueJingWidgetProvider.openApp(c, "schedule", 226));
        mgr.updateAppWidget(ids, rv);
    }
}
