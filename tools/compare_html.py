# -*- coding: utf-8 -*-
import zipfile, hashlib, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
disk = r'E:\AIwork\学径\index.html'
assets = r'E:\AIwork\学径\android\app\src\main\assets\index.html'
apk = r'E:\AIwork\学径\学径-v1.5.9.apk'

a = open(disk, 'rb').read()
b = open(assets, 'rb').read()
c = zipfile.ZipFile(apk).read('assets/index.html')
for name, blob in [('disk', a), ('assets', b), ('apk', c)]:
    print(f'{name}: bytes={len(blob)} sha256={hashlib.sha256(blob).hexdigest()[:16]} crlf={blob.count(b"\r\n")} lf_only={blob.count(b"\n") - blob.count(b"\r\n")} tail={blob[-20:]!r}')
print('disk==assets', a == b)
print('assets==apk', b == c)
print('disk==apk', a == c)
