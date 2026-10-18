# -*- coding: utf-8 -*-
"""读 PNG（8bit RGB/RGBA、非隔行）并按坐标采样亮度。零依赖，只用 zlib。
用法：
  python tools/png_lum.py <png> <x1,y1> <x2,y2> ...      # 打印每点 RGB 与亮度
  python tools/png_lum.py <png> --row <y> <x0> <x1>       # 打印一行上的亮度分布
"""
import sys, zlib, struct


def load_png(path):
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', '不是 PNG'
    pos = 8
    w = h = bit = ctype = None
    idat = b''
    while pos < len(data):
        ln, typ = struct.unpack('>I4s', data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + ln]
        pos += 12 + ln
        if typ == b'IHDR':
            w, h, bit, ctype, comp, filt, inter = struct.unpack('>IIBBBBB', body)
            assert bit == 8 and inter == 0, '只支持 8bit 非隔行'
            assert ctype in (2, 6), '只支持 RGB/RGBA'
        elif typ == b'IDAT':
            idat += body
        elif typ == b'IEND':
            break
    bpp = 3 if ctype == 2 else 4
    raw = zlib.decompress(idat)
    stride = w * bpp
    out = bytearray(w * h * bpp)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        f = raw[p]; p += 1
        line = bytearray(raw[p:p + stride]); p += stride
        if f == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 0xFF
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif f == 3:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif f == 4:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                pp = a + b - c
                pa, pb, pc = abs(pp - a), abs(pp - b), abs(pp - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return w, h, bpp, out


def px(w, bpp, buf, x, y):
    off = (y * w + x) * bpp
    return buf[off], buf[off + 1], buf[off + 2]


def lum(rgb):
    r, g, b = rgb
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


if __name__ == '__main__':
    path = sys.argv[1]
    w, h, bpp, buf = load_png(path)
    print('size %dx%d bpp=%d' % (w, h, bpp))
    if sys.argv[2] == '--row':
        y = int(sys.argv[3]); x0 = int(sys.argv[4]); x1 = int(sys.argv[5])
        vals = [(x, lum(px(w, bpp, buf, x, y))) for x in range(x0, x1)]
        print('row y=%d  x:%d..%d' % (y, x0, x1))
        print('  ' + ' '.join('%d:%.0f' % (x, v) for x, v in vals))
    elif sys.argv[2] == '--cols':
        step = int(sys.argv[3]) if len(sys.argv) > 3 else 20
        y0 = int(sys.argv[4]) if len(sys.argv) > 4 else 0
        y1 = int(sys.argv[5]) if len(sys.argv) > 5 else h
        print('列平均亮度（x 步长 %d · y %d..%d）' % (step, y0, y1))
        acc = []
        for x0 in range(0, w, step):
            tot = 0.0; n = 0
            for x in range(x0, min(w, x0 + step)):
                for y in range(y0, y1):
                    tot += lum(px(w, bpp, buf, x, y)); n += 1
            acc.append((x0, tot / max(1, n)))
        print('  ' + ' '.join('%d:%.1f' % (x, v) for x, v in acc))
        left = sum(v for x, v in acc if x < w * 0.25) / max(1, len([1 for x, _ in acc if x < w * 0.25]))
        right = sum(v for x, v in acc if x > w * 0.75) / max(1, len([1 for x, _ in acc if x > w * 0.75]))
        print('  左 25%% 均值 %.1f · 右 25%% 均值 %.1f · 差 %+.1f' % (left, right, left - right))
    elif sys.argv[2] == '--hf':
        # 高频能量：逐行求平均亮度，再看这些行均值的标准差。
        # 横条纹底（8px 周期）没被糊掉 → 行均值在蓝/橙之间来回跳 → std 很大；
        # 被 backdrop-filter 糊掉 → 行均值拉平 → std ≈ 0。
        rows = []
        for y in range(h):
            tot = 0.0
            for x in range(w):
                tot += lum(px(w, bpp, buf, x, y))
            rows.append(tot / max(1, w))
        mean = sum(rows) / max(1, len(rows))
        var = sum((v - mean) ** 2 for v in rows) / max(1, len(rows))
        print('%s  size=%dx%d  行均值std=%.2f  行均值范围=%.1f..%.1f  全图均值=%.1f'
              % (path.split('\\')[-1].split('/')[-1], w, h, var ** 0.5,
                 min(rows), max(rows), mean))
    elif sys.argv[2] == '--col':
        x = int(sys.argv[3]); y0 = int(sys.argv[4]); y1 = int(sys.argv[5])
        vals = [(y, lum(px(w, bpp, buf, x, y))) for y in range(y0, y1)]
        print('col x=%d  y:%d..%d' % (x, y0, y1))
        print('  ' + ' '.join('%d:%.0f' % (y, v) for y, v in vals))
    else:
        for a in sys.argv[2:]:
            x, y = [int(v) for v in a.split(',')]
            rgb = px(w, bpp, buf, x, y)
            print('  (%d,%d) rgb=%s lum=%.1f' % (x, y, rgb, lum(rgb)))
