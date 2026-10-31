#!/usr/bin/env python3
"""改了 css/ 或 js/ 之後執行：更新 index.html 裡的 ?v= 版本號，避免瀏覽器用舊快取。
用法：python3 tools/bump-version.py"""
import re, time, pathlib
p = pathlib.Path(__file__).resolve().parent.parent / 'index.html'
s = p.read_text(encoding='utf-8')
v = time.strftime('%Y%m%d%H%M')
s2, n = re.subn(r'(\.(?:css|js))\?v=\d+', r'\1?v=' + v, s)
p.write_text(s2, encoding='utf-8')
print(f'bumped {n} refs to v={v}')
