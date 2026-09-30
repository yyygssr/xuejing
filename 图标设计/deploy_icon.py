# -*- coding: utf-8 -*-
"""把生成的图标部署进 Android 资源 + 内嵌一份到 index.html。

自适应图标（API 26+）的规则：
  · 画布 108dp，可见区域只有中间约 76dp，必须留安全区
  · foreground 只放「标识」本身，且要比平面图里更小（否则边缘会被裁掉）
  · background 铺满 108dp，被系统按形状裁切
所以这里把标识单独抠出来（透明底），按 108dp 画布的 39% 居中放置。
"""
import os, re, base64, io
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # 项目根
RES  = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
ICON = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'output')


def mark_only():
    """标识层由 _make_icon.py 直接导出（mark-1024.png，透明底）。

    这里**不再**从合成图里反抠 —— 试过按亮度阈值抠，结果渐变的柔光层
    （那一片浅紫的最小通道也有 152）被算成微弱白，bbox 直接撑满整张画布。
    从绘制结果导出是精确的，没有阈值要猜。
    """
    m = Image.open(os.path.join(ICON, 'mark-1024.png')).convert('RGBA')
    m = m.crop(m.getbbox())
    m.save(os.path.join(ICON, 'mark.png'))
    return m


def deploy():
    mark = Image.open(os.path.join(ICON, 'mark.png')).convert('RGBA')

    # ---------- 1) 自适应图标的前景：108dp 画布，标识占 39% ----------
    fg_sizes = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}
    for d, canvas in fg_sizes.items():
        box = int(canvas * 0.39)
        s = max(mark.width, mark.height)
        m = mark.resize((max(1, round(mark.width * box / s)), max(1, round(mark.height * box / s))),
                        Image.LANCZOS)
        cv = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
        cv.paste(m, ((canvas - m.width) // 2, (canvas - m.height) // 2), m)
        dpath = os.path.join(RES, 'drawable-' + d)
        os.makedirs(dpath, exist_ok=True)
        cv.save(os.path.join(dpath, 'ic_launcher_foreground.png'))

    # ---------- 2) 传统图标：各密度放整张图 ----------
    legacy = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
    src = Image.open(os.path.join(ICON, 'icon-1024.png')).convert('RGBA')
    for d, size in legacy.items():
        dpath = os.path.join(RES, 'mipmap-' + d)
        os.makedirs(dpath, exist_ok=True)
        src.resize((size, size), Image.LANCZOS).save(os.path.join(dpath, 'ic_launcher.png'))

    # ---------- 3) 背景矢量：换成与图标一致的渐变 ----------
    # 采样点取上下边的中点（四角是圆角外的透明区，采到的是 00000000）；
    # 生成脚本用的是**垂直**渐变（逐行 lerp），所以矢量也写成纵向。
    rgb = src.convert('RGB')
    top = '#FF%02X%02X%02X' % rgb.getpixel((src.width // 2, 14))
    bot = '#FF%02X%02X%02X' % rgb.getpixel((src.width // 2, src.height - 15))
    bg = '''<?xml version="1.0" encoding="utf-8"?>
<!-- 与 app 图标同一套配色（由 _deploy_icon.py 采样写入，换图标记得同步） -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:aapt="http://schemas.android.com/aapt"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path android:pathData="M0,0h108v108h-108z">
        <aapt:attr name="android:fillColor">
            <gradient
                android:startX="54"
                android:startY="0"
                android:endX="54"
                android:endY="108"
                android:type="linear">
                <item android:offset="0" android:color="%s" />
                <item android:offset="1" android:color="%s" />
            </gradient>
        </aapt:attr>
    </path>
</vector>
''' % (top, bot)
    open(os.path.join(RES, 'drawable', 'ic_launcher_background.xml'), 'w', encoding='utf-8').write(bg)

    # ---------- 4) 清掉旧的矢量前景 + 旧的单份 mipmap 兜底 ----------
    for stale in [os.path.join(RES, 'drawable', 'ic_launcher_foreground.xml'),
                  os.path.join(RES, 'mipmap', 'ic_launcher.xml')]:
        if os.path.exists(stale):
            os.remove(stale)

    # ---------- 5) 内嵌一份到 index.html（关于页用） ----------
    small = src.resize((192, 192), Image.LANCZOS).convert('RGB')
    buf = io.BytesIO()
    small.save(buf, format='PNG', optimize=True)
    url = 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode('ascii')

    idx = os.path.join(ROOT, 'index.html')
    html = open(idx, encoding='utf-8').read()
    html = re.sub(r"var APP_ICON_URL = '[^']*';",
                  "var APP_ICON_URL = '" + url + "';", html, count=1)
    open(idx, 'w', encoding='utf-8').write(html)

    print('bg gradient:', top, '->', bot)
    print('embedded icon bytes:', len(url))
    print('foreground layers:', sorted(os.listdir(os.path.join(RES, 'drawable-xxxhdpi'))))


if __name__ == '__main__':
    if not os.path.exists(os.path.join(ICON, 'mark.png')):
        mark_only()
    deploy()
