#!/usr/bin/env python3
"""匯入 ChatGPT 產出的受驚態單張透明 PNG（{name}-stage-{n}-scared.png，1024×1024 RGBA）。
用法：python3 tools/import-scared.py <資料夾…>
輸出：assets/beasts/{key}-{n}-scared.png（512×512、裁到內容、四階逐漸變大、256 色量化，與一般圖同規格）"""
import sys, pathlib, re
import numpy as np, cv2
from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import importlib.util   # 檔名有連字號，用 spec 載入
spec = importlib.util.spec_from_file_location('split', HERE / 'split-beast-sheets.py'); split = importlib.util.module_from_spec(spec); spec.loader.exec_module(split)

ALIAS = {'nine-tailed-fox': 'jiuwei', 'ninetailedfox': 'jiuwei'}

def main(dirs):
    split.OUT.mkdir(parents=True, exist_ok=True)
    n = 0
    for d in dirs:
        for p in sorted(pathlib.Path(d).rglob('*-scared.png')):
            m = re.match(r'([a-z-]+?)-stage-(\d)-scared\.png$', p.name)
            if not m: print(f'  ?? 檔名不符，跳過：{p.name}'); continue
            key, st = ALIAS.get(m.group(1), m.group(1)), int(m.group(2))
            if key not in split.BEASTS: print(f'  ?? 未知靈獸 {key}，跳過：{p.name}'); continue
            bgra = cv2.imread(str(p), cv2.IMREAD_UNCHANGED)
            if bgra is None or bgra.shape[2] != 4: print(f'  ?? 不是 RGBA：{p.name}'); continue
            sq = split.crop_square(bgra, split.STAGE_FILL[st - 1])
            out = split.OUT / f'{key}-{st}-scared.png'
            split.save_png(out, sq); print(f'  {out.name}'); n += 1
    print(f'{n} 張')

if __name__ == '__main__':
    main(sys.argv[1:] or ['.'])
