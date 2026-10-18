# -*- coding: utf-8 -*-
"""键盘 padding 时序的对照实验（旧实现 vs 新实现）。

不需要真机：把 MainActivity 里那段逻辑按同样规则复刻成纯函数，
然后按「MIUI 上真实发生的时序」回放，看每一步算出来的 padding。

关键时序（adjustResize 机型）：
  帧1  键盘弹起，窗口先被缩小（h 变小），但 IME inset 这一帧还没报上来（ime=0）
  帧2  IME inset 报上来了（ime=键盘高度）
  帧3  键盘收起，窗口恢复，ime 归 0

旧实现在帧1 里把「缩小后的高度」记成基准 → 帧2 的 shrink 恒 0 → 全额补键盘高
→ 键盘收起后那段 padding 没人清 → 页面底部多出一截（弹层被顶上去）。
"""
import sys

VP = 2400        # 初始窗口高度（px）
IME = 900        # 键盘高度（px）


class Impl:
    """复刻 MainActivity 的两个数值方法。old=True 用修复前的逻辑。

    旧实现的两处差异（都是 bug 的来源）：
      · 布局监听判据是 imeBottomPx（可能过期），新实现是 kbOpen；
      · 键盘收起的分支直接 return，不收回 padding（新实现要收回）。
    """

    def __init__(self, old):
        self.old = old
        self.ime = 0
        self.rest = 0
        self.pad = 0
        self.kb_open = False

    def keyboard_pad(self):
        if self.ime <= 0:
            return 0
        h = self.h
        if h <= 0 or self.rest <= 0:
            return 0
        if not self.old and self.rest < h:
            self.rest = h          # 新实现：基准自愈
        shrink = max(0, self.rest - h)
        return max(0, self.ime - shrink)

    def on_insets(self, ime, h):
        """WindowInsets 回调"""
        self.ime = ime
        self.h = h
        self.kb_open = ime > 0
        if not self.old:
            self.pad = self.keyboard_pad() if self.kb_open else 0
        else:
            self.pad = self.keyboard_pad()
        return self.pad

    def on_layout(self, h):
        """OnGlobalLayoutListener"""
        self.h = h
        if self.old:
            if self.ime <= 0:
                if h > 0:
                    self.rest = h
                return self.pad        # ← 旧实现：直接 return，padding 留着
            self.pad = self.keyboard_pad()
            return self.pad
        else:
            if not self.kb_open:
                self.pad = 0           # ← 新实现：收回
                if h > 0 and (self.rest <= 0 or h >= self.rest):
                    self.rest = h
                return self.pad
            self.pad = self.keyboard_pad()
            return self.pad
        want = self.keyboard_pad()
        self.pad = want
        return want


def run(old):
    impl = Impl(old)
    impl.h = VP
    log = []

    # 初始：无键盘，布局回调测到基准
    impl.on_insets(0, VP)
    impl.on_layout(VP)
    log.append(('初始', VP, 0, impl.pad))

    # 帧1：窗口被 adjustResize 缩小，但 IME inset 还没报上来
    h1 = VP - IME
    impl.on_insets(0, h1)
    impl.on_layout(h1)
    log.append(('帧1 缩小/ime未报', h1, 0, impl.pad))

    # 帧2：IME inset 报上来
    impl.on_insets(IME, h1)
    log.append(('帧2 ime报上来', h1, IME, impl.pad))

    # 帧3a：键盘收起 —— **布局回调先跑**，此刻 ime 还是键盘的高度（过期值），
    #       而窗口已经恢复。这是真机上真实的回调顺序（窗口 resize 早于 insets 派发）。
    impl.on_layout(VP)
    log.append(('帧3a 布局(ime过期)', VP, impl.ime, impl.pad))

    # 帧3b：insets 回调后到，ime 归 0
    impl.on_insets(0, VP)
    log.append(('帧3b ime归0', VP, 0, impl.pad))

    # 帧3c：再来一次布局（用户操作后常见的额外回调）
    impl.on_layout(VP)
    log.append(('帧3c 再布局', VP, 0, impl.pad))
    return log, impl


print('窗口基准 %dpx，键盘 %dpx\n' % (VP, IME))
ok = True
for old in (True, False):
    tag = '旧实现' if old else '新实现'
    log, impl = run(old)
    print('── %s ──' % tag)
    print('   %-18s %8s %8s %10s' % ('阶段', '窗口高', 'ime', 'padding'))
    for name, h, ime, pad in log:
        print('   %-18s %8d %8d %10d' % (name, h, ime, pad))
    final = log[-1][3]
    verdict = 'PASS' if final == 0 else 'FAIL（底部多出 %d px）' % final
    print('   最终 padding = %d → %s\n' % (final, verdict))
    if old:
        if final == 0:
            print('   ! 旧实现竟然没有残留，说明这个时序没有复现 —— 需要重新核对真机时序')
            ok = False
    else:
        if final != 0:
            ok = False

print('对照实验结论：', 'PASS（旧实现确实残留、新实现已修）' if ok else 'FAIL')
sys.exit(0 if ok else 1)
