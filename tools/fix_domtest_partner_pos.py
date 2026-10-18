"""把误放到页内模板之外的「搭档」断言搬回模板内部（return JSON.stringify(R) 之前）。

原因：ASSERTS 是 String.raw`...` 模板，模板在 `return JSON.stringify(R);` 处结束。
写在那之后的内容是 Node 侧代码，里面的 T(...) 根本不会执行 —— 自测会显示
「216 项」而不是「221 项」，且没有任何报错（最坏的一种静默失败）。
"""
import io, sys, re

P = 'tools/domtest.mjs'
t = io.open(P, 'r', encoding='utf-8', newline='').read()

START = "  /* ============================================================\n     搭档\n     ------------------------------------------------------------\n"
i = t.find(START)
if i < 0:
    print('[FAIL] 找不到搭档块的起点')
    sys.exit(1)

# 搭档块结束在「架构守卫：记忆读写全走 memItems」那段的 catch 之后
ENDMARK = "    results.push({ name: '架构守卫：记忆读写全走 memItems', ok: false, info: 'THREW: ' + (e && e.message) });\n  }\n"
j = t.find(ENDMARK, i)
if j < 0:
    print('[FAIL] 找不到搭档块的终点')
    sys.exit(1)
j += len(ENDMARK)

block = t[i:j]
# 从原位置摘掉
t2 = t[:i] + t[j:]
print('摘出搭档块 %d 字符' % len(block))

# 架构守卫那段（Node 侧，读文件）必须留在模板外；其余页内断言搬进模板
GUARD = "  /* 架构守卫：记忆的写路径不许绕过 memItems()。\n"
k = block.find(GUARD)
if k < 0:
    print('[FAIL] 搭档块里找不到架构守卫的分界')
    sys.exit(1)
in_page = block[:k]                 # T(...) / TA(...) → 搬进模板
node_side = block[k:]               # 架构守卫 + 结果输出 → 留在 Node 侧

# 插到模板内 return 之前
ANCHOR = "  return JSON.stringify(R);\n})()\n`;"
if t2.count(ANCHOR) != 1:
    print('[FAIL] 模板收尾锚点命中 %d 处' % t2.count(ANCHOR))
    sys.exit(1)
t2 = t2.replace(ANCHOR, in_page.rstrip() + "\n\n" + ANCHOR)

# 架构守卫 + 汇总输出 接在文件末尾原来那个「全部通过」之前
OUT = "  console.log('\\n' + (fail ? fail + ' 项失败' : '全部通过') + ' / 共 ' + results.length + ' 项');"
if t2.count(OUT) != 1:
    print('[FAIL] 汇总输出锚点命中 %d 处' % t2.count(OUT))
    sys.exit(1)
# node_side 里已经带了架构守卫 + 它自己的 results.push + 汇总输出（原来那段是连着写的）
# 先确认 node_side 末尾是不是已经含 OUT
if OUT in node_side:
    node_side = node_side.split(OUT)[0]
t2 = t2.replace(OUT, node_side.rstrip() + "\n\n" + OUT)

io.open(P, 'w', encoding='utf-8', newline='').write(t2)
print('已搬回模板内 %d 字符；Node 侧守卫 %d 字符' % (len(in_page), len(node_side)))
