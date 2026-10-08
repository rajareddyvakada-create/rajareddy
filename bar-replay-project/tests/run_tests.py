#!/usr/bin/env python3
"""End-to-end tests for the Chrome extension and the website, with every network call faked.

Faked: Binance REST + WebSocket, Twelve Data, Google sign-in (chrome.identity / Google Identity Services).
Real servers are never contacted, so this runs offline.

Setup:  pip install playwright pillow && python -m playwright install chromium
Run:    python3 build.py && python3 tests/run_tests.py
Optional: CHROME_PATH=/path/to/chrome to use a specific Chrome build.
"""
import asyncio, os, shutil, tempfile, threading, functools, http.server
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, 'dist')
CH = os.environ.get('CHROME_PATH') or None
MOCK_EXT = open(os.path.join(ROOT, 'tests', 'mock.js')).read()
MOCK_WEB = open(os.path.join(ROOT, 'tests', 'mockweb.js')).read()
TMP = tempfile.mkdtemp(prefix='br-test-')
failures = []

def check(cond, label):
    print(('PASS ' if cond else 'FAIL ') + label)
    if not cond: failures.append(label)

def copy_with_client(src, name, client):
    dst = os.path.join(TMP, name); shutil.copytree(src, dst)
    p = os.path.join(dst, 'config.js'); s = open(p).read()
    open(p, 'w').write(s.replace("googleClientId: ''", f"googleClientId: '{client}'"))
    return dst

def serve(folder, port):
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    h = functools.partial(Quiet, directory=folder)
    srv = http.server.ThreadingHTTPServer(('localhost', port), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

async def ext_page(p, extdir, label):
    ctx = await p.chromium.launch_persistent_context(os.path.join(TMP, 'prof_' + label), executable_path=CH, headless=False,
        args=['--headless=new', '--no-sandbox', f'--disable-extensions-except={extdir}', f'--load-extension={extdir}'],
        viewport={'width': 390, 'height': 800})
    await ctx.add_init_script(MOCK_EXT)
    sw = ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker', timeout=15000)
    eid = sw.url.split('/')[2]
    pg = await ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    await pg.goto(f'chrome-extension://{eid}/replay.html'); await pg.wait_for_timeout(800)
    return ctx, pg, eid, errs

async def test_extension(p):
    ctx, pg, eid, errs = await ext_page(p, os.path.join(DIST, 'bar-replay-extension'), 'A')
    check(eid == 'odiolklmlggafpajcjkhjncimmgbccad', 'extension ID is the fixed one')
    check(await pg.is_visible('#setup'), 'ext: setup steps shown when no client ID')
    await pg.click('#skipAuth'); await pg.wait_for_timeout(1500)
    check('Binance' in await pg.inner_text('#src'), 'ext: Binance data loads by default')
    check(await pg.inner_text('#liveBadge') == 'Live', 'ext: live badge shows Live')
    await pg.click('#buy'); await pg.wait_for_timeout(300)
    # the fake feed moves fast, so the stop-loss/target may already have closed the trade
    check(await pg.is_visible('#posBox') or 'Trades (1)' in await pg.inner_text('#statsBtn'), 'ext: practice trade opens')
    if await pg.is_visible('#closePos'): await pg.click('#closePos')
    await pg.click('#back'); await pg.wait_for_timeout(300)
    check('go live' in await pg.inner_text('#liveBadge'), 'ext: stepping back switches to replay')
    await pg.click('#dataBtn'); await pg.fill('#dSym', 'BADSYM'); await pg.click('#loadData'); await pg.wait_for_timeout(400)
    check('Invalid symbol' in await pg.inner_text('#dataErr'), 'ext: bad Binance symbol shows an error')
    await pg.check('input[value=twelve]'); await pg.fill('#dSym', 'XAU/USD'); await pg.fill('#dKey', 'goodkey'); await pg.click('#loadData'); await pg.wait_for_timeout(800)
    check('Twelve Data' in await pg.inner_text('#src'), 'ext: Twelve Data loads with a key')
    check(not errs, 'ext: no page errors ' + str(errs)); await ctx.close()

    extB = copy_with_client(os.path.join(DIST, 'bar-replay-extension'), 'extB', 'test-client.apps.googleusercontent.com')
    ctx, pg, eid, errs = await ext_page(p, extB, 'B')
    await pg.click('#googleBtn'); await pg.wait_for_timeout(1500)
    check(await pg.is_hidden('#gate'), 'ext: Google sign-in completes (mocked)')
    await pg.click('#sell'); await pg.wait_for_timeout(200)
    if await pg.is_visible('#closePos'): await pg.click('#closePos')
    keys = await pg.evaluate('Object.keys(localStorage)')
    check(any(k.startswith('u:1234:') for k in keys), 'ext: data stored per Google account')
    await pg.click('#acctBtn'); await pg.click('#signOut'); await pg.wait_for_timeout(1000)
    check(await pg.is_visible('#gate'), 'ext: sign out returns to sign-in screen')
    check(not errs, 'ext signed-in: no page errors ' + str(errs)); await ctx.close()

async def test_website(p):
    webB = copy_with_client(os.path.join(DIST, 'bar-replay-website'), 'webB', 'web-client.apps.googleusercontent.com')
    s1 = serve(os.path.join(DIST, 'bar-replay-website'), 8091); s2 = serve(webB, 8092)
    b = await p.chromium.launch(executable_path=CH, args=['--no-sandbox'])
    try:
        ctx = await b.new_context(viewport={'width': 390, 'height': 760}, is_mobile=True, has_touch=True)
        await ctx.add_init_script(MOCK_WEB)
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:8091/'); await pg.wait_for_timeout(700)
        check(await pg.inner_text('#originUri') == 'http://localhost:8091', 'web: setup shows the site origin')
        await pg.click('#skipAuth'); await pg.wait_for_timeout(1500)
        check(await pg.inner_text('#liveBadge') == 'Live', 'web: live data without sign-in')
        await pg.tap('#buy'); await pg.wait_for_timeout(300)
        check(await pg.is_visible('#posBox') or 'Trades (1)' in await pg.inner_text('#statsBtn'), 'web: practice trade opens')
        check(not errs, 'web: no page errors ' + str(errs)); await ctx.close()

        ctx = await b.new_context(viewport={'width': 390, 'height': 760}, is_mobile=True, has_touch=True)
        await ctx.add_init_script(MOCK_WEB)
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:8092/'); await pg.wait_for_timeout(700)
        await pg.click('#fakeGis'); await pg.wait_for_timeout(1500)
        check(await pg.is_hidden('#gate'), 'web: Google sign-in completes (mocked)')
        await pg.reload(); await pg.wait_for_timeout(1200)
        check(await pg.is_hidden('#gate'), 'web: sign-in remembered after reload')
        check(not errs, 'web signed-in: no page errors ' + str(errs)); await ctx.close()
    finally:
        await b.close(); s1.shutdown(); s2.shutdown()

async def main():
    async with async_playwright() as p:
        await test_extension(p)
        await test_website(p)
    shutil.rmtree(TMP, ignore_errors=True)
    print(f'\n{len(failures)} failure(s)' if failures else '\nAll tests passed')
    raise SystemExit(1 if failures else 0)

asyncio.run(main())
