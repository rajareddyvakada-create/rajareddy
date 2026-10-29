#!/usr/bin/env python3
"""Build the web (artifact) version of the app into web/: the same pages, fed by a recorded data snapshot.

  python3 scripts/build_web.py        # needs Node + Playwright for the capture step
The output folder holds index.html (a page fragment, as the artifact host expects) and every file it loads.
"""
import pathlib, shutil, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'cot-widget-android/app/src/main/assets'
OUT = ROOT / 'web'

# "What's built" panel shown on top of the web version: every feature the app has, newest first.
WORK = [
    ('v2.3', 'Audit fixes: correct COT trader names and missing-data handling, COT age warnings, demo-data badge, touch-based stops with conservative same-candle rule, trading costs, real contract sizes, agent confluence score (not a win probability), stale-price guard, demo trades kept out of the journal, encrypted API key, 25 + 4 automated tests'),
    ('v2.2', 'Fixes: app no longer closes if TradingView or XM crashes; AI agent recovers after a failed request; no 10-minute hole on live gold; Back works on XM; TradingView and XM pause in the background; agent opens Journal and Me'),
    ('v2.1', 'Live chart from your XM account (MT5 web terminal) beside TradingView; TradingView opens as the default chart'),
    ('v2.0', 'Live spot gold and silver on the app chart, no 10-minute delay (Swissquote ticks every 2 s)'),
    ('v1.9', '1D / 1W / 1M BOS and CHoCH levels listed and drawn on the chart; blank-chart fix'),
    ('v1.8', 'Your TradingView chart inside the Charts tab with symbol change, signed in with your own account'),
    ('v1.7', 'Midnight Cyberpunk theme with GSAP motion, neon gauges and cyber grid'),
    ('v1.7', 'Journal tab: every trade with mini chart, stats, equity curve, emotions, and AI explanations of losses'),
    ('v1.7', 'Google sign-in inside the app (no browser) with a create-account option; Me tab'),
    ('v1.6', 'AI agent toggle: reads chart, news and COT, places and closes trades, live guides; take-profit R setting (1.5R default)'),
    ('v1.6', 'Replay toggle, compact chart layout, landscape mode, and a Lines toggle that keeps BUY/SELL signals'),
    ('v1.5', 'News Intelligence tab: live headlines, impact scoring, calendar reminders and a gold verdict'),
    ('base', 'COT sentiment for gold and markets, scanner, alerts, brokers, bar replay with ATR trailing stop'),
]

WORK_PANEL = (
    '\n<style>html[data-web] .shell{height:calc(100% - 44px);margin-top:44px}</style>'
    '<details id="workPanel" style="display:block;position:fixed;left:50%;transform:translateX(-50%);top:calc(5px + env(safe-area-inset-top,0px));z-index:60;'
    'width:min(560px,calc(100vw - 32px));font:500 13px Inter,system-ui,sans-serif;color:#F8FAFC;background:rgba(15,23,42,.96);'
    'border:1px solid rgba(0,229,255,.35);border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.5)">'
    '<summary style="cursor:pointer;list-style:none;padding:8px 14px;font:700 13px Rajdhani,Inter,sans-serif;letter-spacing:.04em;color:#00E5FF">'
    '\u2713 Complete work so far \u00b7 v2.3 (tap to open)</summary>'
    '<ol style="margin:0;padding:4px 16px 12px 34px;max-height:60vh;overflow:auto;line-height:1.45">'
    + ''.join(f'<li style="margin:5px 0"><b style="color:#FFB300;font-family:JetBrains Mono,monospace;font-size:11px">{v}</b> {t}</li>' for v, t in WORK)
    + '<li style="margin:5px 0;list-style:none;color:#94A3B8">Android APK: github.com/rajareddyvakada-create/rajareddy/releases (v2.3)</li>'
    '</ol></details>\n')

def main():
    subprocess.run([sys.executable, str(ROOT / 'scripts/build_android_asset.py')], check=True)
    if OUT.exists(): shutil.rmtree(OUT)
    (OUT / 'charts').mkdir(parents=True)
    (OUT / 'vendor').mkdir()
    shutil.copy(ROOT / 'scripts/web/snap-shim.js', OUT / 'snap-shim.js')
    shutil.copy(ASSETS / 'vendor/gsap.min.js', OUT / 'vendor/gsap.min.js')
    for f in (ASSETS / 'charts').iterdir():
        t = f.read_text() if f.suffix == '.html' else None
        if t is not None:
            t = t.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<script src="../snap-shim.js"></script>', 1)
            (OUT / 'charts' / f.name).write_text(t)
        else:
            shutil.copy(f, OUT / 'charts' / f.name)
    page = (ROOT / 'cot-sentiment-widget.html').read_text()
    head = ('<script>document.documentElement.setAttribute("data-app","android");document.documentElement.setAttribute("data-web","1");</script>\n'
            '<script src="snapdata.js"></script>\n<script src="snap-shim.js"></script>\n')
    page = head + page
    # a small badge so nobody mistakes the snapshot for live prices
    page = page.replace('</body>', '') if '</body>' in page else page
    page += ('\n<div id="snapBadge" style="position:fixed;right:max(10px,env(safe-area-inset-right,0px));top:calc(100px + env(safe-area-inset-top,0px));z-index:40;'
             'font:600 11px Inter,system-ui,sans-serif;color:#94A3B8;background:rgba(15,23,42,.92);border:1px solid rgba(0,229,255,.25);border-radius:999px;padding:5px 10px;pointer-events:none"></div>\n'
             '<script>(function(){var s=window.__SNAP,b=document.getElementById("snapBadge");if(!s||!b)return;'
             'var d=new Date(s.at);b.textContent="Web snapshot · "+d.toLocaleString([], {day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})+" · live prices in the Android app";setTimeout(function(){b.style.transition="opacity .6s";b.style.opacity="0";},7000);})();</script>\n')
    page = WORK_PANEL + page
    (OUT / 'index.html').write_text(page)
    subprocess.run(['node', str(ROOT / 'scripts/web/capture.js'), str(ASSETS), str(OUT / 'snapdata.js')], check=True)
    print('web build in', OUT)

if __name__ == '__main__':
    main()
