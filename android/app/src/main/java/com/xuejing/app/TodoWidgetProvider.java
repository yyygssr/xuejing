package com.xuejing.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.widget.RemoteViews;

import org.json.JSONObject;

/** 桌面：待办 */
public class TodoWidgetProvider extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        bind(context, XueJingWidgetProvider.parse(XueJingWidgetProvider.load(context)));
    }

    static void bind(Context c, JSONObject o) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(c);
        if (mgr == null) return;
        int[] ids = mgr.getAppWidgetIds(new ComponentName(c, TodoWidgetProvider.class));
        if (ids == null || ids.length == 0) return;
        int n = o.optInt("todoCount", 0);
        String head = o.optString("todoHead", "");
        RemoteViews rv = new RemoteViews(c.getPackageName(), R.layout.widget_todo);
        rv.setTextViewText(R.id.wTitle, "待办");
        rv.setTextViewText(R.id.wName, n + " 条未完成");
        rv.setTextViewText(R.id.wMeta, n == 0 ? "点此添加" : head);
        rv.setOnClickPendingIntent(R.id.wRoot, XueJingWidgetProvider.openApp(c, "todos", 102));
        mgr.updateAppWidget(ids, rv);
    }
}
