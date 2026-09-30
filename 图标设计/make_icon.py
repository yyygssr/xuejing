# -*- coding: utf-8 -*-
"""学径 app 图标生成器。

设计：靛青渐变圆角方块 + 一条向右上延伸的路径（"书山有径"）+ 起点圆点 + 终点箭头。
用 4 倍超采样绘制再降采样，边缘够干净。
"""
import math, os
from PIL import Image, ImageDraw, ImageFilter

SS = 4                      # 超采样倍数
S = 1024                    # 成品边长
W = S * SS

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'output')
os.makedirs(OUT_DIR, exist_ok=True)

# ---------- 品牌色 ----------
BRAND   = (0x5a, 0x5a, 0xd6)
BRAND2  = (0x8b, 0x7b, 0xf0)
BRAND3  = (0x4a, 0x46, 0xc9)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def rounded_mask(size, radius):
    m = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def bezier(p0, p1, p2, p3, n=240):
    pts = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        x = u*u*u*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t*t*t*p3[0]
        y = u*u*u*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t*t*t*p3[1]
        pts.append((x, y))
    return pts


def build():
    # ---------- 底色：对角渐变 ----------
    grad = Image.new('RGB', (W, W))
    gd = ImageDraw.Draw(grad)
    for y in range(W):
        for_x = y / (W - 1)
        gd.line([(0, y), (W, y)], fill=lerp(BRAND2, BRAND3, for_x))
    # 左上角加一层柔光，避免整块死平
    glow = Image.new('L', (W, W), 0)
    ImageDraw.Draw(glow).ellipse(
        [-W * 0.35, -W * 0.45, W * 0.85, W * 0.55], fill=110)
    glow = glow.filter(ImageFilter.GaussianBlur(W * 0.16))
    grad = Image.composite(Image.new('RGB', (W, W), lerp(BRAND2, (255, 255, 255), 0.22)), grad, glow)

    # ---------- 路径 ----------
    layer = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    def px(v):
        return v / 1024 * W

    start = (px(268), px(778))
    c1    = (px(296), px(486))
    c2    = (px(566), px(596))
    end   = (px(742), px(300))

    path = bezier(start, c1, c2, end, n=520)

    # 沿线盖章而不是 im.line：PIL 画折线时相邻线段各画一次四边形，
    # 抗锯齿边缘互相盖会留下一道道「接缝」竖纹（第一版就是这样花的）。
    # 每条采样点都盖一个圆片（n 够大，圆片重叠率很高），自然叠出平滑粗线。
    # 注意步长要按**采样点间距**算，不能按索引跳 —— 第一版就是跳太狠成了虚线。
    half = px(31)
    for p in path:
        d.ellipse([p[0] - half, p[1] - half, p[0] + half, p[1] + half],
                  fill=(255, 255, 255, 255))

    # 起点：实心圆点（比线粗，作为「出发点」）
    r0 = px(56)
    d.ellipse([start[0] - r0, start[1] - r0, start[0] + r0, start[1] + r0],
              fill=(255, 255, 255, 255))

    # 终点：雪佛龙（两条粗线组成「›」）
    # 试过实心三角：底边两个倒钩会在小尺寸下糊成一团，还和路径交汇出一条
    # 凹口，看着像缺了一块。雪佛龙只有两条同宽的线，缩到 48px 也依然清楚。
    ang = math.atan2(end[1] - c2[1], end[0] - c2[0])
    ARM, SPREAD = px(132), math.radians(38)
    chev = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    cd = ImageDraw.Draw(chev)
    for s in (-1, 1):
        a = ang + math.pi + s * SPREAD
        arm = (end[0] + ARM * math.cos(a), end[1] + ARM * math.sin(a))
        seg = bezier(end, (end[0] + (arm[0]-end[0])*0.4, end[1] + (arm[1]-end[1])*0.4),
                     (end[0] + (arm[0]-end[0])*0.7, end[1] + (arm[1]-end[1])*0.7),
                     arm, n=80)
        for p in seg:
            cd.ellipse([p[0] - half, p[1] - half, p[0] + half, p[1] + half],
                       fill=(255, 255, 255, 255))
    layer = Image.alpha_composite(layer, chev)

    # ---------- 合成 ----------
    # 先把「标识层」单独存一份（透明底）。
    # 自适应图标的前景需要纯标识，而从合成图里按亮度反抠会连渐变的柔光层
    # 一起抠进来（那层的紫色也够亮），所以干脆直接从绘制结果导出，最准。
    layer.crop(layer.getbbox()).save(os.path.join(OUT_DIR, 'mark-1024.png'))

    mask = rounded_mask(W, int(px(232)))
    out = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    out.paste(grad, (0, 0), mask)
    out = Image.alpha_composite(out, layer)
    icon = out.resize((S, S), Image.LANCZOS)
    icon.save(os.path.join(OUT_DIR, 'icon-1024.png'))

    # 圆角之外真的透明，方便做 adaptive icon 的前景
    # ---------- 各尺寸 ----------
    for size, name in [(512, 'icon-512.png'), (192, 'icon-192.png'),
                       (160, 'icon-160.png'), (144, 'icon-144.png'),
                       (96, 'icon-96.png'), (72, 'icon-72.png'), (48, 'icon-48.png')]:
        icon.resize((size, size), Image.LANCZOS).save(os.path.join(OUT_DIR, name))
    print('saved to', OUT_DIR)
    print('files:', sorted(os.listdir(OUT_DIR)))


if __name__ == '__main__':
    build()
