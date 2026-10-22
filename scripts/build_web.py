#!/usr/bin/env python3
"""Build the web (artifact) version of the app into web/: the same pages, fed by a recorded data snapshot.

  python3 scripts/build_web.py        # needs Node + Playwright for the capture step
The output folder holds index.html (a page fragment, as the artifact host expects) and every file it loads.
"""
import pathlib, shutil, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'cot-widget-android/app/src/main/assets'
OUT = ROOT / 'web'

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
    page += ('\n<div id="snapBadge" style="position:fixed;right:max(10px,env(safe-area-inset-right,0px));top:calc(56px + env(safe-area-inset-top,0px));z-index:40;'
             'font:600 11px Inter,system-ui,sans-serif;color:#94A3B8;background:rgba(15,23,42,.92);border:1px solid rgba(0,229,255,.25);border-radius:999px;padding:5px 10px;pointer-events:none"></div>\n'
             '<script>(function(){var s=window.__SNAP,b=document.getElementById("snapBadge");if(!s||!b)return;'
             'var d=new Date(s.at);b.textContent="Web snapshot · "+d.toLocaleString([], {day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})+" · live prices in the Android app";setTimeout(function(){b.style.transition="opacity .6s";b.style.opacity="0";},7000);})();</script>\n')
    (OUT / 'index.html').write_text(page)
    subprocess.run(['node', str(ROOT / 'scripts/web/capture.js'), str(ASSETS), str(OUT / 'snapdata.js')], check=True)
    print('web build in', OUT)

if __name__ == '__main__':
    main()
