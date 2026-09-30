# -*- coding: utf-8 -*-
import zipfile, re, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
apk = r'E:\AIwork\学径\学径-v1.5.9.apk'
z = zipfile.ZipFile(apk)
data = z.read('assets/index.html').decode('utf-8')
print('len', len(data))
m = re.search(r"APP_VER = '([^']+)'", data)
print('APP_VER', m.group(1) if m else 'MISSING')
m = re.search(r'class="about-ver">([^<]+)<', data)
print('about-ver', m.group(1) if m else 'MISSING')
m = re.search(r'关于学径</b><small>([^<]+)<', data)
print('settings about', m.group(1) if m else 'MISSING')
print('has VIEW_BACK', 'VIEW_BACK' in data)
print('has aihub view', 'view-aihub' in data)
print('single-layer fix', '同一时刻只允许一层二级页' in data)
print('modelpick 340px', 'min-width:340px' in data)
print('mengjibake', any(s in data for s in ['锛', '鐨', '闇€姹']))
# also check the android manifest version
mf = [n for n in z.namelist() if n.endswith('AndroidManifest.xml') or n == 'AndroidManifest.xml']
print('manifest entries', mf[:3])
