#!/usr/bin/env python3
"""改了 css/ 或 js/ 之後執行：更新 index.html / beasts.html / beast.html 裡的 ?v= 版本號，避免瀏覽器用舊快取。
用法：python3 tools/bump-version.py"""
import re, time, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
v = time.strftime('%Y%m%d%H%M')
for name in ('index.html', 'beasts.html', 'beast.html'):
    p = root / name
    if not p.exists(): continue
    s = p.read_text(encoding='utf-8')
    s2, n = re.subn(r'(\.(?:css|js))\?v=\d+', r'\1?v=' + v, s)
    p.write_text(s2, encoding='utf-8')
    print(f'{name}: bumped {n} refs to v={v}')
