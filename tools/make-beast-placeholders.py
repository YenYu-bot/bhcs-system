#!/usr/bin/env python3
"""產生 assets/beasts/ 的 SVG 佔位圖（ChatGPT 的 PNG 到位後會自動取代，不用刪）。
用法：python3 tools/make-beast-placeholders.py"""
import pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent / 'assets' / 'beasts'
ROOT.mkdir(parents=True, exist_ok=True)
BEASTS = [('qinglong','青龍','#4ecb8d','🐉'),('zhuque','朱雀','#ff6b6b','🐦‍🔥'),('qilin','麒麟','#f6c343','🦌'),('jiuwei','九尾狐','#b58cf5','🦊'),
          ('orochi','八岐大蛇','#7c5cff','🐍'),('baku','夢貘','#6c7bd9','🐘'),('angel','小天使','#ffe6a3','👼'),('mermaid','人魚','#4fd1e0','🧜'),
          ('unicorn','獨角獸','#ff9ecf','🦄'),('griffin','獅鷲','#ff9f43','🦅'),('fenrir','芬里爾','#9ed8ff','🐺'),('bastet','巴斯特貓','#3b3f6b','🐈‍⬛')]
STAGE = {1:'幼靈',2:'靈獸',3:'聖獸',4:'神獸'}
def svg(color, emoji, label, sub, size_scale):
    r = 160 + 60 * size_scale
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs><radialGradient id="g" cx="50%" cy="45%" r="55%"><stop offset="0" stop-color="{color}" stop-opacity=".55"/><stop offset="1" stop-color="{color}" stop-opacity="0"/></radialGradient></defs>
<circle cx="256" cy="250" r="{r}" fill="url(#g)"/>
<circle cx="256" cy="250" r="{r-30}" fill="none" stroke="{color}" stroke-opacity=".6" stroke-width="{4+size_scale*3}" stroke-dasharray="{'none' if size_scale>2 else '12 10'}"/>
<text x="256" y="{275}" font-size="{150+size_scale*30}" text-anchor="middle" font-family="Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,sans-serif">{emoji}</text>
<text x="256" y="430" font-size="44" font-weight="900" text-anchor="middle" fill="#fff" font-family="Noto Sans TC,sans-serif">{label}</text>
<text x="256" y="474" font-size="26" text-anchor="middle" fill="{color}" font-family="Noto Sans TC,sans-serif">{sub}</text>
</svg>'''
n = 0
for key, name, color, emoji in BEASTS:
    for st in range(1, 5):
        (ROOT / f'{key}-{st}.svg').write_text(svg(color, emoji, name, f'{STAGE[st]} · 佔位圖', st), encoding='utf-8'); n += 1
        (ROOT / f'{key}-{st}-scared.svg').write_text(svg('#94a3b8', '😨', name, f'{STAGE[st]} · 受驚佔位圖', st), encoding='utf-8'); n += 1
for i, (sub, emoji) in enumerate([('平時','🧒'),('警告','⚠️'),('懲罰','😠')], 1):
    (ROOT / f'steward-{i}.svg').write_text(svg('#56ccb2', emoji, '護山管家', sub + ' · 佔位圖', 2), encoding='utf-8'); n += 1
for lv, nm in enumerate(['煉氣','築基','結丹','元嬰','化神','煉虛','合體','大乘','渡劫','真仙','金仙','大羅金仙'], 1):
    tier = '#b87333' if lv <= 3 else '#c0c0c0' if lv <= 6 else '#f1c40f' if lv <= 9 else '#fff8dc'
    (ROOT / f'realm-{lv}.svg').write_text(svg(tier, '🔘', nm, f'第 {lv} 境 · 佔位圖', (lv-1)//3+1), encoding='utf-8'); n += 1
for key, nm, emoji in [('stone','靈石','💎'),('dingxin','定心符','🧧'),('pojing','破境丹','🔴'),('juling','聚靈丹','🟢'),('xisui','洗髓丹','⚪'),('rename','改名卡','🪧'),('hat','仙帽','🎩'),('real','現實獎勵','🎁')]:
    (ROOT / f'item-{key}.svg').write_text(svg('#7dd3fc', emoji, nm, '道具 · 佔位圖', 1), encoding='utf-8'); n += 1
print(f'wrote {n} placeholder svgs to {ROOT}')
