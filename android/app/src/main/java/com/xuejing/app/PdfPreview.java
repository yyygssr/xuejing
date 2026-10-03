package com.xuejing.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.os.ParcelFileDescriptor;
import android.util.Base64;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;

/**
 * PDF 逐页转图片。
 *
 * 为什么需要这一步：视觉模型的 OpenAI 兼容接口只收**图片**（image_url），
 * 不收 PDF 二进制。而本项目是零外部依赖的单文件 WebView，没有 pdf.js。
 * 所以用系统自带的 android.graphics.pdf.PdfRenderer（API 21+）在原生侧渲染，
 * 页面那边把 PNG 当普通图片发给模型 —— 整条链路不引入任何第三方库。
 *
 * 代价（页数越多越慢、内存峰值越高），所以调用方要限页。
 */
final class PdfPreview {

    /** 单页渲染的最短边与最长边（px）。太小看不清字，太大纯属浪费 token。 */
    private static final int MAX_EDGE = 1400;
    private static final int MIN_EDGE = 800;

    private PdfPreview() { }

    /** 渲染结果。pages 是 data:image/jpeg;base64,... 列表（第一页在 index 0）。 */
    public static final class Result {
        final String[] pages;
        final boolean more;   // 文档页数 > 实际渲染页数
        final String err;

        Result(String[] pages, boolean more, String err) {
            this.pages = pages == null ? new String[0] : pages;
            this.more = more;
            this.err = err;
        }
    }

    public static boolean supported() {
        return android.os.Build.VERSION.SDK_INT >= 21;
    }

    /**
     * @param b64     PDF 字节的 base64（不带 data: 前缀）
     * @param maxPages 最多渲染几页
     * @param cb      回调一定在主线程（要直接 evalJs 回页面）
     */
    public static void render(final Context ctx, final String b64, final int maxPages,
                       final Callback cb) {
        if (!supported()) {
            cb.onDone(new Result(null, false, "这台设备的系统版本太老，做不了 PDF 转图"));
            return;
        }
        final int cap = Math.max(1, Math.min(maxPages <= 0 ? 6 : maxPages, 12));
        new Thread(new Runnable() {
            @Override
            public void run() {
                Result r = doRender(ctx, b64, cap);
                cb.onDone(r);
            }
        }, "pdf-preview").start();
    }

    public interface Callback {
        void onDone(Result r);
    }

    private static Result doRender(Context ctx, String b64, int maxPages) {
        File tmp = null;
        ParcelFileDescriptor fd = null;
        PdfRenderer renderer = null;
        try {
            byte[] raw = Base64.decode(b64, Base64.DEFAULT);
            if (raw == null || raw.length == 0) {
                return new Result(null, false, "PDF 内容是空的");
            }
            // PdfRenderer 只吃文件描述符，base64 内存流不行 —— 先落临时文件
            tmp = File.createTempFile("xj_pdf", ".pdf", ctx.getCacheDir());
            FileOutputStream fo = new FileOutputStream(tmp);
            try {
                fo.write(raw);
                fo.flush();
            } finally {
                try { fo.close(); } catch (Throwable ignored) { }
            }

            fd = ParcelFileDescriptor.open(tmp, ParcelFileDescriptor.MODE_READ_ONLY);
            renderer = new PdfRenderer(fd);

            int total = renderer.getPageCount();
            if (total <= 0) return new Result(null, false, "这个 PDF 没有任何页面");

            int n = Math.min(total, maxPages);
            String[] out = new String[n];
            for (int i = 0; i < n; i++) {
                PdfRenderer.Page page = null;
                Bitmap bmp = null;
                ByteArrayOutputStream bos = null;
                try {
                    page = renderer.openPage(i);
                    int w = page.getWidth();
                    int h = page.getHeight();
                    if (w <= 0 || h <= 0) {
                        out[i] = "";
                        continue;
                    }
                    // 缩放到合理尺寸：太小看不清字，太大只是烧 token 和内存
                    float k = 1f;
                    int longest = Math.max(w, h);
                    if (longest > MAX_EDGE) k = (float) MAX_EDGE / (float) longest;
                    else if (longest < MIN_EDGE) k = (float) MIN_EDGE / (float) longest;

                    int bw = Math.max(1, Math.round(w * k));
                    int bh = Math.max(1, Math.round(h * k));
                    bmp = Bitmap.createBitmap(bw, bh, Bitmap.Config.ARGB_8888);
                    // PDF 页面默认透明，涂白底 —— 不然 JPEG 里是黑块
                    new Canvas(bmp).drawColor(Color.WHITE);
                    // render 只有两个重载，第四参是 int 或 RenderParams。
                    // RenderParams 的构造器是包私有的、拿不到实例，
                    // 所以走 int 那个：RENDER_MODE_FOR_DISPLAY 就是那个常量。
                    // rect 传满整页（页面已按 bw×bh 建好）。
                    page.render(bmp, new android.graphics.Rect(0, 0, bw, bh), null,
                            android.graphics.pdf.RenderParams.RENDER_MODE_FOR_DISPLAY);

                    bos = new ByteArrayOutputStream();
                    bmp.compress(Bitmap.CompressFormat.JPEG, 82, bos);
                    out[i] = "data:image/jpeg;base64,"
                            + Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP);
                } catch (Throwable t) {
                    out[i] = "";
                } finally {
                    if (page != null) {
                        try { page.close(); } catch (Throwable ignored) { }
                    }
                    if (bmp != null) {
                        try { bmp.recycle(); } catch (Throwable ignored) { }
                    }
                    if (bos != null) {
                        try { bos.close(); } catch (Throwable ignored) { }
                    }
                }
            }
            // 去掉渲染失败的空位
            int keep = 0;
            for (int i = 0; i < out.length; i++) {
                if (out[i] != null && out[i].length() > 0) out[keep++] = out[i];
            }
            String[] pages = new String[keep];
            System.arraycopy(out, 0, pages, 0, keep);
            if (pages.length == 0) {
                return new Result(null, false, "这个 PDF 没能渲染出页面（可能是加密文件）");
            }
            return new Result(pages, total > pages.length, null);
        } catch (OutOfMemoryError e) {
            return new Result(null, false, "PDF 太大，手机内存不够转图");
        } catch (Throwable t) {
            String m = t.getMessage();
            return new Result(null, false,
                    "读不了这个 PDF" + (m == null ? "" : ("（" + m + "）")));
        } finally {
            if (renderer != null) {
                try { renderer.close(); } catch (Throwable ignored) { }
            }
            if (fd != null) {
                try { fd.close(); } catch (Throwable ignored) { }
            }
            if (tmp != null) {
                // 临时文件含用户文档内容，删干净
                try { tmp.delete(); } catch (Throwable ignored) { }
            }
        }
    }

    /** 把结果拼成页面回调 window.onPdfPreview({...}) 的实参。 */
    static String toJsArgs(PdfPreview.Result r) {
        StringBuilder sb = new StringBuilder("{");
        sb.append("\"pages\":[");
        for (int i = 0; i < r.pages.length; i++) {
            if (i > 0) sb.append(',');
            sb.append(MainActivity.jsString(r.pages[i]));
        }
        sb.append("],\"more\":").append(r.more ? "true" : "false");
        sb.append(",\"err\":").append(r.more ? "null" : MainActivity.jsString(r.err));
        sb.append('}');
        return sb.toString();
    }
}
