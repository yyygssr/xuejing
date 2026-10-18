package com.xuejing.app;

import android.content.Context;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * 资料库（RAG）的正文落盘口。
 *
 * ── 为什么要单独落盘，不塞 localStorage ─────────────────────────────
 * 页面是 file:///android_asset/index.html 加载的（file: 源），
 * 实测该来源下 **IndexedDB 完全不可用** —— indexedDB.open() 的
 * onsuccess / onerror 一个都不触发，只有超时能收场（本机 Edge 与
 * MIUI WebView 一致）。所以「几 MB 的课件正文」只剩两条路：
 *   · localStorage：整库配额约 5MB，两三本课件就满，且满了是**静默写失败**
 *     （save() 只 toast 一句「本地存储写入失败」，数据其实已经丢了）；
 *   · App 私有目录：容量按可用空间走，写入失败能拿到真实的 IOException。
 * 选后者。localStorage 只留一份「目录索引」（id / 标题 / 段数 / 字数），
 * 几十条元数据也就几 KB。
 *
 * ── 文件命名 ────────────────────────────────────────────────────────
 * 每个文档一个文件：docs/<id>.txt，内容是**已切好的分段**，用
 * {@link #SEP} 连接。用固定分隔符而不是 JSON：正文里全是中文标点，
 * JSON 化的收益只有「能放多条字段」——而字段都在索引里，正文是纯文本，
 * 少一层转义就少一处能把用户文档改坏的地方。
 *
 * 分隔符选 0x1E（RS, Record Separator）：正文不可能含控制字符，
 * 而 \n\n 这类可打印组合在课件里到处都是。
 *
 * ── 线程 ────────────────────────────────────────────────────────────
 * 所有方法都**在调用线程同步执行**（Bridge 里已放到后台线程），
 * 不碰 UI。读写都是几 MB 以内的小文件，同步更简单也更可测。
 */
final class DocStore {

    /** 段与段之间的分隔符（ASCII RS）。页面侧必须用同一个码点切分。 */
    static final char SEP = '\u001e';

    private DocStore() { }

    private static File dir(Context c) {
        File d = new File(c.getFilesDir(), "docs");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    /** 只允许 [A-Za-z0-9_-] 的 id，防止 "../" 之类的越权路径 */
    private static boolean safeId(String id) {
        if (id == null || id.isEmpty() || id.length() > 64) return false;
        for (int i = 0; i < id.length(); i++) {
            char ch = id.charAt(i);
            boolean ok = (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')
                    || (ch >= '0' && ch <= '9') || ch == '_' || ch == '-';
            if (!ok) return false;
        }
        return true;
    }

    private static File fileOf(Context c, String id) {
        return new File(dir(c), id + ".txt");
    }

    /** 写入（覆盖）。返回 null = 成功，否则是给用户看的中文原因。 */
    static String save(Context c, String id, String body) {
        if (!safeId(id)) return "文档编号不合法";
        if (body == null) body = "";
        File f = fileOf(c, id);
        File tmp = new File(dir(c), id + ".tmp");
        try {
            FileOutputStream fo = new FileOutputStream(tmp);
            fo.write(body.getBytes(StandardCharsets.UTF_8));
            fo.flush();
            fo.close();
            /* 先写临时文件再改名：写到一半被系统杀掉时，不会留下半截正文
               覆盖掉原来那份好的（用户的课件不该因为我们写完就没了）。 */
            if (f.exists() && !f.delete()) return "旧文件删不掉，可能被占用";
            if (!tmp.renameTo(f)) return "文件改名失败";
            return null;
        } catch (Throwable t) {
            try { if (tmp.exists()) tmp.delete(); } catch (Throwable ignored) { }
            return "写入失败：" + t.getClass().getSimpleName();
        }
    }

    /** 单个文档的读取上限。一份课件正文不该有 32MB，超出说明文件被写坏了。 */
    private static final long MAX_READ = 32L * 1024 * 1024;

    /** 读取。返回 null = 文件不存在。 */
    static String load(Context c, String id) {
        if (!safeId(id)) return null;
        File f = fileOf(c, id);
        if (!f.exists()) return null;
        try {
            long len = Math.min(f.length(), MAX_READ);
            FileInputStream in = new FileInputStream(f);
            byte[] buf = new byte[(int) len];
            int off = 0;
            while (off < buf.length) {
                int n = in.read(buf, off, buf.length - off);
                if (n <= 0) break;
                off += n;
            }
            in.close();
            return new String(buf, 0, off, StandardCharsets.UTF_8);
        } catch (Throwable t) {
            return null;
        }
    }

    /** 删除。返回 true = 已经不在了（幂等）。 */
    static boolean delete(Context c, String id) {
        if (!safeId(id)) return false;
        File f = fileOf(c, id);
        try { return !f.exists() || f.delete(); } catch (Throwable t) { return false; }
    }

    /** 清空整库。返回清掉的个数。 */
    static int clear(Context c) {
        File d = dir(c);
        File[] fs = d.listFiles();
        if (fs == null) return 0;
        int n = 0;
        for (File f : fs) {
            try { if (f.delete()) n++; } catch (Throwable ignored) { }
        }
        return n;
    }

    /** 已用字节数：管理页上要显示「资料库占用 2.3MB」，让用户知道分量。 */
    static long usedBytes(Context c) {
        File[] fs = dir(c).listFiles();
        if (fs == null) return 0;
        long n = 0;
        for (File f : fs) n += f.length();
        return n;
    }

    /** 一次性读回全部文档，用于换设备前打包（导出备份时走这里）。 */
    static String dumpAll(Context c) {
        StringBuilder sb = new StringBuilder();
        File[] fs = dir(c).listFiles();
        if (fs == null) return "";
        for (File f : fs) {
            String nm = f.getName();
            if (!nm.endsWith(".txt")) continue;
            String id = nm.substring(0, nm.length() - 4);
            if (!safeId(id)) continue;
            String body = load(c, id);
            if (body == null) continue;
            if (sb.length() > 0) sb.append('\u0001');
            /* 每份正文按「id <TAB> base64(UTF-8)」记一条：正文里的换行、
               TAB、控制字符（包括分段用的 RS）全部被 base64 吃掉，
               打包格式再不会有转义歧义。条与条之间用 0x01 隔开（正文里不会有）。 */
            sb.append(id).append('\t')
              .append(android.util.Base64.encodeToString(
                      body.getBytes(StandardCharsets.UTF_8), android.util.Base64.NO_WRAP));
        }
        return sb.toString();
    }
}
