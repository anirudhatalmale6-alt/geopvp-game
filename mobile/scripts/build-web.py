#!/usr/bin/env python3
"""
Build the website version of the app (coinprowl.com/play) into ../server/public/play.

  cd mobile && python3 scripts/build-web.py

expo export (web, baseUrl /play from app.json) -> add the home-screen bits (manifest, icons, iOS meta tags)
-> replace server/public/play. The server serves that folder at /play (server/src/index.ts).
"""
import json, os, re, shutil, subprocess, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
MOBILE = os.path.dirname(HERE)
OUT = os.path.join(MOBILE, 'dist-web')
DEST = os.path.join(MOBILE, '..', 'server', 'public', 'play')
BASE = '/play'
BG = '#0a0e1a'

shutil.rmtree(OUT, ignore_errors=True)
subprocess.run(['npx', 'expo', 'export', '--platform', 'web', '--output-dir', OUT], cwd=MOBILE, check=True)

# icons: the app icon (black tile, COINPROWL wordmark), plus a maskable one with room for Android's circle crop
src = Image.open(os.path.join(MOBILE, 'assets', 'icon.png')).convert('RGB')
for size in (180, 192, 512):
    src.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, f'icon-{size}.png'))
mask = Image.new('RGB', (512, 512), (0, 0, 0))
inner = src.resize((410, 410), Image.LANCZOS)
mask.paste(inner, ((512 - 410) // 2, (512 - 410) // 2))
mask.save(os.path.join(OUT, 'icon-maskable-512.png'))

manifest = {
    'name': 'CoinProwl', 'short_name': 'CoinProwl', 'description': 'GPS PvP battle game. Play. Prowl. Earn.',
    'id': BASE + '/', 'start_url': BASE + '/', 'scope': BASE + '/', 'display': 'standalone', 'orientation': 'portrait',
    'background_color': BG, 'theme_color': BG,
    'icons': [
        {'src': f'{BASE}/icon-192.png', 'sizes': '192x192', 'type': 'image/png'},
        {'src': f'{BASE}/icon-512.png', 'sizes': '512x512', 'type': 'image/png'},
        {'src': f'{BASE}/icon-maskable-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'maskable'},
    ],
}
with open(os.path.join(OUT, 'manifest.webmanifest'), 'w') as f:
    json.dump(manifest, f, indent=2)

p = os.path.join(OUT, 'index.html')
html = open(p).read()
html = html.replace('content="width=device-width, initial-scale=1, shrink-to-fit=no"',
                    'content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover"')
head = f'''
    <link rel="manifest" href="{BASE}/manifest.webmanifest" />
    <link rel="apple-touch-icon" href="{BASE}/icon-180.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="CoinProwl" />
    <meta name="description" content="CoinProwl - GPS PvP battle game. Log in and play in your browser." />
    <style>
      html, body {{ background: {BG}; }}
      /* iPhone home-screen app: keep the game clear of the notch and the home bar */
      #root {{ box-sizing: border-box; padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom); }}
    </style>
'''
html = html.replace('</head>', head + '</head>', 1)
assert 'manifest.webmanifest' in html
open(p, 'w').write(html)

shutil.rmtree(DEST, ignore_errors=True)
shutil.copytree(OUT, DEST)
js = [f for f in os.listdir(os.path.join(DEST, '_expo', 'static', 'js', 'web'))]
print('built ->', os.path.relpath(DEST, MOBILE), '| bundle', js)
