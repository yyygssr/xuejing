package com.xuejing.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.widget.RemoteViews;

import org.json.JSONObject;

/** 桌面：下一节课 */
public class NextClassWidgetProvider extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        bind(context, XueJingWidgetProvider.parse(XueJingWidgetProvider.load(context)));
    }

    static void bind(Context c, JSONObject o) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(c);
        if (mgr == null) return;
        int[] ids = mgr.getAppWidgetIds(new ComponentName(c, NextClassWidgetProvider.class));
        if (ids == null || ids.length == 0) return;
        String name = o.optString("nextName", "—");
        String time = o.optString("nextTime", "");
        String loc = o.optString("nextLoc", "");
        RemoteViews rv = new RemoteViews(c.getPackageName(), R.layout.widget_next_class);
        rv.setTextViewText(R.id.wTitle, "下一节课");
        rv.setTextViewText(R.id.wName, name == null || name.isEmpty() ? "今天没有了" : name);
        String meta = time + (loc == null || loc.isEmpty() ? "" : (" · " + loc));
        rv.setTextViewText(R.id.wMeta, meta.trim());
        rv.setOnClickPendingIntent(R.id.wRoot, XueJingWidgetProvider.openApp(c, "schedule", 101));
        mgr.updateAppWidget(ids, rv);
    }
}
