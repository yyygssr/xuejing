"""修正架构守卫的位置：必须在「let fail = 0; for (const t of results)」之前。

上一版搬移把它放在了打印循环之后 —— 它照样执行、照样 push 进 results，
但**永远不会被打印**，表现是「自测通过但看不到这条」。这类位置错误
比逻辑错误更隐蔽：没有任何报错，只是少了一行输出。
"""
import io, sys

P = 'tools/domtest.mjs'
t = io.open(P, 'r', encoding='utf-8', newline='').read()

START = "  /* 架构守卫：记忆的写路径不许绕过 memItems()。\n"
i = t.find(START)
if i < 0:
    print('[FAIL] 找不到守卫起点')
    sys.exit(1)
ENDMARK = "    results.push({ name: '架构守卫：记忆读写全走 memItems', ok: false, info: 'THREW: ' + (e && e.message) });\n  }\n"
j = t.find(ENDMARK, i)
if j < 0:
    print('[FAIL] 找不到守卫终点')
    sys.exit(1)
j += len(ENDMARK)
block = t[i:j]
t2 = t[:i] + t[j:]
print('摘出守卫 %d 字符' % len(block))

ANCHOR = "  let fail = 0;\n"
if t2.count(ANCHOR) != 1:
    print('[FAIL] 打印循环锚点命中 %d 处' % t2.count(ANCHOR))
    sys.exit(1)
t2 = t2.replace(ANCHOR, block.rstrip() + "\n\n" + ANCHOR)

io.open(P, 'w', encoding='utf-8', newline='').write(t2)
print('已移到打印循环之前')
