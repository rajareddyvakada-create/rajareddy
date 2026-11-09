"""Tests for the self-update, against a local server standing in for GitHub."""
import http.server, pathlib, shutil, sys, tempfile, threading, functools
sys.path.insert(0, '/home/user/rajareddy/xm-bridge/backend')
import updater

REAL = pathlib.Path('/home/user/rajareddy/xm-bridge/frontend/index.html').read_bytes()
tmp = pathlib.Path(tempfile.mkdtemp())
served = tmp / 'served'; served.mkdir()

def serve(body: bytes, name='index.html'):
    (served / name).write_bytes(body)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(served)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{srv.server_address[1]}/index.html'

fails = 0
def ok(name, cond, detail=''):
    global fails
    if not cond: fails += 1
    print(('PASS ' if cond else 'FAIL ') + name + (' — ' + str(detail) if detail else ''))

page = tmp / 'index.html'
page.write_bytes(REAL)

# 1. same file both sides
serve(REAL)
st = updater.status(page, URL)
ok('Identical pages are not an update', st['newer'] is False, st)

# 2. a newer page
newer = REAL.replace(b'<title>XM Trading</title>', b'<title>XM Trading</title><!-- v2 -->')
serve(newer)
st = updater.status(page, URL)
ok('A changed page is seen as newer', st['newer'] is True and st['latest'] != st['current'], st)

res = updater.apply(page, URL)
ok('Applying it rewrites the page', res['changed'] is True and page.read_bytes() == newer, res)
ok('And keeps the old one as a backup', (tmp / 'index.html.bak').read_bytes() == REAL)
ok('Applying twice does nothing the second time', updater.apply(page, URL)['changed'] is False)

# 3. junk is refused
serve(b'<html>hello</html>')
try:
    updater.apply(page, URL); ok('Junk is refused', False, 'it was accepted')
except updater.UpdateError as e:
    ok('Junk is refused with a reason', 'not this app' in str(e), str(e)[:70])
ok('And the page on disk is untouched', page.read_bytes() == newer)

# 4. something enormous is refused
serve(newer + b'x' * (updater.MAX_BYTES + 10))
try:
    updater.apply(page, URL); ok('An oversized download is refused', False, 'it was accepted')
except updater.UpdateError as e:
    ok('An oversized download is refused', 'larger' in str(e), str(e)[:60])

# 5. a page that is half the app is still refused
serve(b'<title>XM Trading</title><div id="chart"></div>')
try:
    updater.apply(page, URL); ok('A page missing parts is refused', False, 'accepted')
except updater.UpdateError as e:
    ok('A page missing parts is refused', '/api/candles' in str(e), str(e)[:70])

# 6. server down
srv.shutdown()
try:
    updater.status(page, URL); ok('An unreachable server is reported', False, 'no error')
except updater.UpdateError as e:
    ok('An unreachable server is reported', "Couldn't reach" in str(e), str(e)[:60])

shutil.rmtree(tmp, ignore_errors=True)
print(('all good' if not fails else str(fails) + ' failed'))
sys.exit(1 if fails else 0)
