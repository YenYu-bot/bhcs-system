#!/usr/bin/env python3
"""把 ChatGPT 產出的設定圖切成系統用的 512×512 透明 PNG。
用法：
  v1（白底、四階交疊）：python3 tools/split-beast-sheets.py <資料夾…>
  v2（透明底、等寬分格）：python3 tools/split-beast-sheets.py --v2 <資料夾…>
      檔名 01-<key>.png…12-<key>.png（四階）、s01-<key>.png…（受驚四階）、13-badges.png（3×4）、14-steward.png（3 欄）、15-items.png（4×2）
輸出：assets/beasts/{key}-{1..4}.png、steward-{1..3}.png、realm-{1..12}.png、item-{key}.png
作法：從四個角 floodFill 找出「連到邊緣的白底」去背（白毛靈獸內部的白不會被挖掉），
      橫排靈獸用連通元件拆（各階左右交疊、寬度不等）、格狀徽章／道具用投影空隙切。切不出預期段數會印警告並跳過。"""
import sys, pathlib, re
import numpy as np, cv2
from PIL import Image

OUT = pathlib.Path(__file__).resolve().parent.parent / 'assets' / 'beasts'
BEASTS = ['qinglong', 'zhuque', 'qilin', 'jiuwei', 'orochi', 'baku', 'angel', 'mermaid', 'unicorn', 'griffin', 'fenrir', 'bastet']   # v2 順序
BEASTS_V1 = ['qinglong', 'baihu', 'zhuque', 'xuanwu', 'qilin', 'jiuwei', 'kunpeng', 'baize', 'pixiu', 'xiezhi', 'suanni', 'kuiniu']
ITEMS = ['stone', 'dingxin', 'pojing', 'juling', 'xisui', 'rename', 'hat', 'real']
SIZE, FILL = 512, 0.88          # 網頁顯示最大約 260px，512 夠用又省流量
STAGE_FILL = [0.70, 0.78, 0.86, 0.94]   # 四階逐漸變大，保留「成長」感

def remove_bg(img, tol=5):
    """img: BGR。回傳 BGRA；背景 = 從邊緣 floodFill（固定範圍、容差小）連到的近白區。
    生成圖的底色約 252，白毛約 235–248，所以用「跟種子差 ≤ tol」的固定範圍才不會漏進白毛。"""
    h, w = img.shape[:2]
    mask = np.zeros((h + 2, w + 2), np.uint8)
    flags = 4 | cv2.FLOODFILL_MASK_ONLY | cv2.FLOODFILL_FIXED_RANGE | (255 << 8)
    work = img.copy()
    seeds = [(x, y) for x in range(0, w, max(1, w // 24)) for y in (0, h - 1)] + [(x, y) for y in range(0, h, max(1, h // 12)) for x in (0, w - 1)]
    for seed in seeds:
        if int(img[seed[1], seed[0]].min()) >= 240:
            cv2.floodFill(work, mask, seed, 0, (tol,) * 3, (tol,) * 3, flags)
    bg = mask[1:-1, 1:-1] > 0
    alpha = np.where(bg, 0, 255).astype(np.uint8)
    # 邊緣 2px 柔化：越接近底色越透明，去掉白邊
    band = cv2.dilate(bg.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    band &= ~bg
    whiteness = img.min(axis=2).astype(np.int32)
    soft = np.clip((250 - whiteness) * 255 // 30, 0, 255).astype(np.uint8)
    alpha[band] = np.minimum(alpha[band], soft[band])
    out = cv2.cvtColor(img, cv2.COLOR_BGR2BGRA); out[:, :, 3] = alpha
    return out

def segments(alpha, n, axis, min_gap=6, thresh=2):
    """沿 axis（1=直欄切左右、0=橫列切上下）找 n 段。回傳 [(start,end)]。"""
    prof = (alpha > 40).sum(axis=axis)
    empty = prof <= thresh
    runs, i = [], 0
    while i < len(empty):
        if empty[i]:
            j = i
            while j < len(empty) and empty[j]: j += 1
            if i > 0 and j < len(empty): runs.append((j - i, i, j))   # 內部空隙
            i = j
        else: i += 1
    runs = [r for r in runs if r[0] >= min_gap]
    if len(runs) < n - 1: return None
    # 從最寬的幾個空隙裡挑 n-1 個，條件：切出的每一段都要有足夠的前景（避免把零星葉片當成一段）
    from itertools import combinations
    total = prof.sum()
    cand = sorted(runs, reverse=True)[:10]
    best = None
    for combo in combinations(sorted(cand, key=lambda r: r[1]), n - 1):
        bounds, start = [], 0
        for _, a, b in combo: bounds.append((start, a)); start = b
        bounds.append((start, len(empty)))
        masses = [prof[a:b].sum() for a, b in bounds]
        if min(masses) < total * 0.02: continue
        score = sum(c[0] for c in combo)
        if best is None or score > best[0]: best = (score, bounds)
    return best[1] if best else None

def save_png(path, bgra):
    """256 色量化（FastOctree + 抖動）：檔案約 1/4～1/5，顯示尺寸下看不出差別。"""
    im = Image.fromarray(cv2.cvtColor(bgra, cv2.COLOR_BGRA2RGBA))
    im.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG).save(str(path), optimize=True)

def crop_square(bgra, fill=FILL):
    a = bgra[:, :, 3]
    ys, xs = np.where(a > 20)
    if not len(ys): return None
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    fig = bgra[y0:y1, x0:x1]
    fh, fw = fig.shape[:2]
    s = SIZE * fill / max(fh, fw)
    fig = cv2.resize(fig, (max(1, round(fw * s)), max(1, round(fh * s))), interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_CUBIC)
    canvas = np.zeros((SIZE, SIZE, 4), np.uint8)
    fh, fw = fig.shape[:2]; ox, oy = (SIZE - fw) // 2, (SIZE - fh) // 2
    canvas[oy:oy + fh, ox:ox + fw] = fig
    return canvas

def figures(bgra, n, dil=15):
    """用連通元件把橫排的 n 隻拆開（各階會左右交疊，不能用直欄空隙切）。回傳每隻的 BGRA（其他隻的像素清掉）。"""
    a = bgra[:, :, 3] > 40
    d = cv2.dilate(a.astype(np.uint8), np.ones((dil, dil), np.uint8))
    cnt, lab, stats, cent = cv2.connectedComponentsWithStats(d, 8)
    comps = [dict(l=i, area=stats[i, cv2.CC_STAT_AREA], x0=stats[i, cv2.CC_STAT_LEFT], x1=stats[i, cv2.CC_STAT_LEFT] + stats[i, cv2.CC_STAT_WIDTH], cx=cent[i][0]) for i in range(1, cnt)]
    comps.sort(key=lambda c: -c['area'])
    def overlap(c, s): return max(0, min(c['x1'], s['x1']) - max(c['x0'], s['x0'])) / max(1, min(c['x1'] - c['x0'], s['x1'] - s['x0']))
    seeds = []
    for c in comps:
        hit = max(seeds, key=lambda s: overlap(c, s), default=None)
        if hit and overlap(c, hit) > 0.5: hit['members'].append(c['l']); hit['x0'] = min(hit['x0'], c['x0']); hit['x1'] = max(hit['x1'], c['x1']); hit['area'] += c['area']
        elif len(seeds) < n: seeds.append(dict(x0=c['x0'], x1=c['x1'], area=c['area'], members=[c['l']]))
        else:
            near = min(seeds, key=lambda s: min(abs(c['cx'] - s['x0']), abs(c['cx'] - s['x1'])) if not (s['x0'] <= c['cx'] <= s['x1']) else 0)
            near['members'].append(c['l'])
    if len(seeds) != n: return None
    total = sum(s['area'] for s in seeds)
    if min(s['area'] for s in seeds) < total * 0.02: return None
    seeds.sort(key=lambda s: s['x0'])
    out = []
    for s in seeds:
        keep = np.isin(lab, s['members']) & a
        fig = bgra.copy(); fig[~keep, 3] = 0
        out.append(fig)
    return out

def split_row(path, names):
    img = cv2.imread(str(path)); bgra = remove_bg(img)
    figs = None
    for dil in (15, 9, 5, 3):          # 相鄰兩階浪花相碰時縮小膨脹量再試
        figs = figures(bgra, len(names), dil)
        if figs: break
    if not figs: print(f'  !! {path.name}: 拆不出 {len(names)} 隻，跳過'); return
    for i, (fig, name) in enumerate(zip(figs, names)):
        fill = STAGE_FILL[i] if len(names) == 4 else FILL
        sq = crop_square(fig, fill); save_png(OUT / f'{name}.png', sq); print(f'  {name}.png')

def split_grid(path, names, cols, rows):
    img = cv2.imread(str(path)); bgra = remove_bg(img)
    rs = segments(bgra[:, :, 3], rows, axis=1, min_gap=4)
    if not rs: print(f'  !! {path.name}: 切不出 {rows} 列，跳過'); return
    k = 0
    for (y0, y1) in rs:
        band = bgra[y0:y1]
        cs = segments(band[:, :, 3], cols, axis=0, min_gap=4)
        if not cs: print(f'  !! {path.name}: 第 {k // cols + 1} 列切不出 {cols} 欄，跳過'); k += cols; continue
        for (x0, x1) in cs:
            if k >= len(names): break
            sq = crop_square(band[:, x0:x1]); save_png(OUT / f'{names[k]}.png', sq); print(f'  {names[k]}.png'); k += 1

def main(dirs):
    OUT.mkdir(parents=True, exist_ok=True)
    files = sorted(p for d in dirs for p in pathlib.Path(d).rglob('*.png'))
    for p in files:
        m = re.match(r'(\d\d)-', p.name)
        if not m: continue
        idx = int(m.group(1)); print(p.name)
        if 1 <= idx <= 12: split_row(p, [f'{BEASTS_V1[idx - 1]}-{s}' for s in range(1, 5)])
        elif idx == 13: split_grid(p, [f'realm-{i}' for i in range(1, 13)], cols=3, rows=4)
        elif idx == 14: split_row(p, ['steward-1', 'steward-2', 'steward-3'])
        elif idx == 15: split_grid(p, [f'item-{k}' for k in ITEMS], cols=2, rows=4)

# ── v2：透明底、等寬分格（ChatGPT 直接出透明 PNG，不用去背；靠「每格置中、不超出欄位」切）──
def cells(bgra, cols, rows=1):
    h, w = bgra.shape[:2]; cw, ch = w / cols, h / rows
    return [bgra[int(r * ch):int((r + 1) * ch), int(c * cw):int((c + 1) * cw)] for r in range(rows) for c in range(cols)]

def v2_file(p):
    m = re.match(r'(s?)(\d\d)-([a-z]+)?', p.name)
    if not m: return
    scared, idx, key = m.group(1) == 's', int(m.group(2)), m.group(3)
    bgra = cv2.imread(str(p), cv2.IMREAD_UNCHANGED)
    if bgra is None or bgra.shape[2] != 4: print(f'  !! {p.name}: 不是透明 PNG，跳過'); return
    print(p.name)
    if 1 <= idx <= 12:
        key = key if key in BEASTS else BEASTS[idx - 1]
        for i, cell in enumerate(cells(bgra, 4)):
            sq = crop_square(cell, STAGE_FILL[i])
            if sq is None: print(f'  !! 第 {i + 1} 欄沒有內容'); continue
            name = f'{key}-{i + 1}{"-scared" if scared else ""}.png'; save_png(OUT / name, sq); print(f'  {name}')
    elif idx == 13:
        for i, cell in enumerate(cells(bgra, 3, 4)):
            sq = crop_square(cell); save_png(OUT / f'realm-{i + 1}.png', sq) if sq is not None else None; print(f'  realm-{i + 1}.png')
    elif idx == 14:
        for i, cell in enumerate(cells(bgra, 3)):
            sq = crop_square(cell); save_png(OUT / f'steward-{i + 1}.png', sq) if sq is not None else None; print(f'  steward-{i + 1}.png')
    elif idx == 15:
        for i, cell in enumerate(cells(bgra, 4, 2)):
            if i >= len(ITEMS): break
            sq = crop_square(cell); save_png(OUT / f'item-{ITEMS[i]}.png', sq) if sq is not None else None; print(f'  item-{ITEMS[i]}.png')

def main_v2(dirs):
    OUT.mkdir(parents=True, exist_ok=True)
    for d in dirs:
        for p in sorted(pathlib.Path(d).rglob('*.png')): v2_file(p)

if __name__ == '__main__':
    args = sys.argv[1:]
    if args and args[0] == '--v2': main_v2(args[1:] or ['.'])
    else: main(args or ['.'])
