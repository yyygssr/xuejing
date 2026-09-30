package com.xuejing.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.widget.RemoteViews;

import org.json.JSONObject;

/** 2×2：主页四宫格快捷跳转 */
public class Widget2x2Provider extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        bind(context, XueJingWidgetProvider.parse(XueJingWidgetProvider.load(context)));
    }

    static void bind(Context c, JSONObject o) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(c);
        if (mgr == null) return;
        int[] ids = mgr.getAppWidgetIds(new ComponentName(c, Widget2x2Provider.class));
        if (ids == null || ids.length == 0) return;
        RemoteViews rv = new RemoteViews(c.getPackageName(), R.layout.widget_2x2);
        int weekCourses = o.optInt("weekCourses", 0);
        rv.setTextViewText(R.id.tCourse, weekCourses > 0 ? (weekCourses + "节") : "导入");
        rv.setTextViewText(R.id.tNote, o.optInt("noteCount", 0) + "条");
        rv.setTextViewText(R.id.tTodo, o.optInt("todoCount", 0) + "待办");
        rv.setTextViewText(R.id.tFocus, o.optBoolean("focusRunning", false)
                ? (o.optString("focusText", "") + "")
                : (o.optInt("focusMin", 0) + "m"));
        rv.setOnClickPendingIntent(R.id.bCourse, XueJingWidgetProvider.openApp(c, "schedule", 211));
        rv.setOnClickPendingIntent(R.id.bNote, XueJingWidgetProvider.openApp(c, "notes", 212));
        rv.setOnClickPendingIntent(R.id.bTodo, XueJingWidgetProvider.openApp(c, "todos", 213));
        rv.setOnClickPendingIntent(R.id.bFocus, XueJingWidgetProvider.openApp(c, "home", 214));
        mgr.updateAppWidget(ids, rv);
    }
}
