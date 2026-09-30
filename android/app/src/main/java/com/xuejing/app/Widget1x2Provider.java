package com.xuejing.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.widget.RemoteViews;

import org.json.JSONObject;

/** 1×2：下一节课 + 待办数 */
public class Widget1x2Provider extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        bind(context, XueJingWidgetProvider.parse(XueJingWidgetProvider.load(context)));
    }

    static void bind(Context c, JSONObject o) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(c);
        if (mgr == null) return;
        int[] ids = mgr.getAppWidgetIds(new ComponentName(c, Widget1x2Provider.class));
        if (ids == null || ids.length == 0) return;
        String name = o.optString("nextName", "今天没有了");
        String time = o.optString("nextTime", "");
        String loc = o.optString("nextLoc", "");
        int todo = o.optInt("todoCount", 0);
        RemoteViews rv = new RemoteViews(c.getPackageName(), R.layout.widget_1x2);
        rv.setTextViewText(R.id.wTitle, o.optBoolean("focusRunning", false) ? "专注中" : "下一节课");
        rv.setTextViewText(R.id.wName, name == null || name.isEmpty() ? "今天没有了" : name);
        String meta = time + (loc == null || loc.isEmpty() ? "" : (" · " + loc));
        rv.setTextViewText(R.id.wMeta, meta.trim());
        rv.setTextViewText(R.id.wTodo, todo + "待办");
        rv.setOnClickPendingIntent(R.id.wRoot,
                XueJingWidgetProvider.openApp(c, "schedule", 201));
        mgr.updateAppWidget(ids, rv);
    }
}
