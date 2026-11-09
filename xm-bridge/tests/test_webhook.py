"""Tests for TradingView alert parsing and the guards that decide whether to trade one.

No MetaTrader needed: webhook.py deliberately holds no MT5 import, so everything that decides
whether real money moves can be checked on any machine.
"""
import pathlib, sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'backend'))
import webhook
from webhook import Alert, Guard, WebhookRefused, parse_alert

SECRET = 'a-long-enough-secret-value'

fails = 0


def ok(name, cond, detail=''):
    global fails
    if not cond:
        fails += 1
    print(('PASS ' if cond else 'FAIL ') + name + (' — ' + str(detail) if detail else ''))


def refused(name, fn, *, status=None, contains=None):
    """A check that passes only when the call is refused, for the stated reason."""
    try:
        fn()
    except WebhookRefused as exc:
        detail = f'{exc.status} {exc.reason}'
        if status is not None and exc.status != status:
            ok(name, False, f'refused but with {detail}, expected status {status}')
            return
        if contains is not None and contains.lower() not in exc.reason.lower():
            ok(name, False, f'refused but reason was {detail!r}, expected to mention {contains!r}')
            return
        ok(name, True, detail)
    except Exception as exc:                       # noqa: BLE001 - a wrong exception is a failure
        ok(name, False, f'raised {type(exc).__name__}: {exc}')
    else:
        ok(name, False, 'was accepted')


def fresh(**kw) -> Guard:
    base = dict(enabled=True, secret=SECRET, max_lot=0.10, default_lot=0.01)
    base.update(kw)
    return Guard(**base)


print('--- parsing: JSON')
a = parse_alert('{"secret":"s","action":"buy","symbol":"XAUUSD","lot":0.05,"sl":3990,"tp":4010}')
ok('JSON alert is read', a.action == 'buy' and a.symbol == 'XAUUSD' and a.lot == 0.05
   and a.sl == 3990 and a.tp == 4010, a.without_secret())
ok('Secret is kept off the logged shape', 'secret' not in a.without_secret())

a = parse_alert('{"passphrase":"s","side":"long","ticker":"OANDA:XAUUSD","qty":"0.02"}')
ok('Aliases are accepted', a.action == 'buy' and a.symbol == 'XAUUSD' and a.lot == 0.02,
   a.without_secret())

a = parse_alert('{"secret":"s","action":"sell","symbol":"EURUSD.P"}')
ok('A perpetual suffix is dropped', a.symbol == 'EURUSD', a.symbol)

print('--- parsing: the plain comma form')
a = parse_alert('my-secret,buy,XAUUSD,0.03')
ok('Positional form is read', a.secret == 'my-secret' and a.action == 'buy'
   and a.symbol == 'XAUUSD' and a.lot == 0.03, a.without_secret())

a = parse_alert('my-secret,sell,US30Cash,0.02,sl=44000,tp=43000,comment=ox alpha')
ok('Trailing key=value pairs are read', a.sl == 44000 and a.tp == 43000
   and a.comment == 'ox alpha', a.without_secret())

a = parse_alert('my-secret,close,XAGUSD')
ok('Close needs no lot', a.action == 'close' and a.lot is None, a.without_secret())

a = parse_alert('  my-secret , BUY , xauusd , 0.01  ')
ok('Spacing and case do not matter', a.action == 'buy' and a.lot == 0.01, a.without_secret())

a = parse_alert('my-secret,closeall')
ok('closeall needs no symbol', a.action == 'closeall' and a.symbol == '', a.without_secret())

print('--- parsing: bad bodies are refused, not guessed at')
refused('Empty body', lambda: parse_alert(''), contains='empty')
refused('Broken JSON', lambda: parse_alert('{"secret":"s","action":'), contains='will not parse')
refused('JSON that is not an object', lambda: parse_alert('[1,2,3]'), contains='must be an object')
refused('No action', lambda: parse_alert('{"secret":"s","symbol":"XAUUSD"}'), contains='no action')
refused('Unknown action', lambda: parse_alert('s,hodl,XAUUSD'), contains='unknown action')
refused('Buy with no symbol', lambda: parse_alert('{"secret":"s","action":"buy"}'),
        contains='needs a symbol')
refused('Symbol with odd characters',
        lambda: parse_alert('{"secret":"s","action":"buy","symbol":"XAU/USD;drop"}'),
        contains='characters no MT5 symbol uses')
refused('An absurdly long body', lambda: parse_alert('s,buy,XAUUSD,' + 'x' * 5000),
        contains='larger than any alert')
refused('Bytes that are not UTF-8', lambda: parse_alert(b'\xff\xfe\x00bad'), contains='UTF-8')

a = parse_alert('{"secret":"s","action":"buy","symbol":"XAUUSD","lot":"not a number"}')
ok('An unreadable lot becomes none, not zero', a.lot is None, a.lot)

print('--- the guard: it is off until it is turned on')
refused('Off by default', lambda: Guard().check(parse_alert(f'{SECRET},buy,XAUUSD'), is_demo=True),
        status=503, contains='WEBHOOK_ENABLED')
refused('On, but with no secret set',
        lambda: fresh(secret='').check(parse_alert(f'{SECRET},buy,XAUUSD'), is_demo=True),
        status=503, contains='WEBHOOK_SECRET')
refused('On, with a secret too short to be worth having',
        lambda: fresh(secret='short').check(parse_alert('short,buy,XAUUSD'), is_demo=True),
        status=503, contains='shorter than 16')

refused('A secret that reuses API_KEY',
        lambda: fresh(api_key=SECRET).check(parse_alert(f'{SECRET},buy,XAUUSD'), is_demo=True),
        status=503, contains='same as API_KEY')
ok('A different secret alongside an API_KEY is fine',
   fresh(api_key='some-other-key').check(parse_alert(f'{SECRET},buy,XAUUSD'),
                                         is_demo=True).action == 'buy')

print('--- the guard: the secret')
refused('A wrong secret', lambda: fresh().check(parse_alert('wrong-secret,buy,XAUUSD'), is_demo=True),
        status=401)
refused('A missing secret',
        lambda: fresh().check(parse_alert('{"action":"buy","symbol":"XAUUSD"}'), is_demo=True),
        status=401)
try:
    fresh().check(parse_alert('wrong-secret,buy,XAUUSD'), is_demo=True)
except WebhookRefused as exc:
    ok('A prober is told nothing useful', exc.quiet == 'refused', exc.quiet)

got = fresh().check(parse_alert(f'{SECRET},buy,XAUUSD,0.02'), is_demo=True)
ok('The right secret is accepted', got.action == 'buy' and got.lot == 0.02, got.without_secret())

print('--- the guard: a live account')
refused('A live account is refused by default',
        lambda: fresh().check(parse_alert(f'{SECRET},buy,XAUUSD'), is_demo=False),
        status=403, contains='WEBHOOK_ALLOW_LIVE')
got = fresh(allow_live=True).check(parse_alert(f'{SECRET},buy,XAUUSD'), is_demo=False)
ok('A live account works once allowed on purpose', got.action == 'buy')

print('--- the guard: lot size')
got = fresh().check(parse_alert(f'{SECRET},buy,XAUUSD'), is_demo=True)
ok('No lot in the alert uses the default', got.lot == 0.01, got.lot)
refused('A lot above the cap',
        lambda: fresh().check(parse_alert(f'{SECRET},buy,XAUUSD,5.0'), is_demo=True),
        contains='above the webhook cap')
refused('A negative lot',
        lambda: fresh().check(parse_alert(f'{SECRET},buy,XAUUSD,-1'), is_demo=True),
        contains='above zero')
got = fresh().check(parse_alert(f'{SECRET},close,XAUUSD,9.9'), is_demo=True)
ok('A close ignores any lot it was sent', got.lot is None, got.lot)

print('--- the guard: symbol allowlist')
g = fresh(symbols=('XAUUSD', 'EURUSD'))
ok('An allowed symbol passes',
   g.check(parse_alert(f'{SECRET},buy,xauusd'), is_demo=True).symbol == 'xauusd')
refused('A symbol outside the list',
        lambda: fresh(symbols=('XAUUSD',)).check(parse_alert(f'{SECRET},buy,US30Cash'), is_demo=True),
        status=403, contains='WEBHOOK_SYMBOLS')

print('--- the guard: a retry must not double the position')
g = fresh()
g.check(parse_alert(f'{SECRET},buy,XAUUSD,0.01'), is_demo=True, now=1000.0)
refused('The same alert sent again',
        lambda: g.check(parse_alert(f'{SECRET},buy,XAUUSD,0.01'), is_demo=True, now=1001.0),
        status=409, contains='already handled')
later = g.check(parse_alert(f'{SECRET},buy,XAUUSD,0.01'), is_demo=True, now=1000.0 + 61)
ok('The same alert much later is a new one', later.action == 'buy')

g = fresh()
g.check(parse_alert(f'{SECRET},buy,XAUUSD,0.01'), is_demo=True, now=2000.0)
second = g.check(parse_alert(f'{SECRET},buy,XAUUSD,0.02'), is_demo=True, now=2001.0)
ok('A different lot is a different alert', second.lot == 0.02, second.lot)

g = fresh()
g.check(parse_alert('{"secret":"%s","action":"buy","symbol":"XAUUSD","id":"one"}' % SECRET),
        is_demo=True, now=3000.0)
refused('An id repeated is a duplicate even if the rest differs',
        lambda: g.check(parse_alert(
            '{"secret":"%s","action":"buy","symbol":"EURUSD","id":"one"}' % SECRET),
            is_demo=True, now=3001.0),
        status=409)

# A refused alert must not be remembered, or correcting it and sending again would look like a
# retry and be refused a second time for the wrong reason.
g = fresh()
try:
    g.check(parse_alert(f'{SECRET},buy,XAUUSD,99'), is_demo=True, now=4000.0)
except WebhookRefused:
    pass
corrected = g.check(parse_alert(f'{SECRET},buy,XAUUSD,0.01'), is_demo=True, now=4001.0)
ok('A corrected alert gets through after a refusal', corrected.lot == 0.01, corrected.lot)
refused('A refusal does not use up the rate limit either',
        lambda: fresh(per_minute=1, max_lot=0.02).check(
            parse_alert(f'{SECRET},buy,XAUUSD,99'), is_demo=True, now=4100.0),
        contains='above the webhook cap')

print('--- the guard: rate limit')
g = fresh(per_minute=3)
for i in range(3):
    g.check(parse_alert(f'{SECRET},buy,XAUUSD,0.0{i + 1}'), is_demo=True, now=5000.0 + i)
refused('Beyond the per-minute limit',
        lambda: g.check(parse_alert(f'{SECRET},buy,EURUSD,0.01'), is_demo=True, now=5003.0),
        status=429, contains='in a minute')
ok('The limit clears after a minute',
   g.check(parse_alert(f'{SECRET},buy,EURUSD,0.01'), is_demo=True, now=5000.0 + 61).action == 'buy')

print('--- reading the configuration from .env')
env = {
    'WEBHOOK_ENABLED': 'true', 'WEBHOOK_SECRET': SECRET, 'WEBHOOK_MAX_LOT': '0.5',
    'WEBHOOK_DEFAULT_LOT': '0.02', 'WEBHOOK_SYMBOLS': 'xauusd, eurusd ',
    'WEBHOOK_ALLOW_LIVE': 'no', 'WEBHOOK_PER_MINUTE': '12',
}
env['API_KEY'] = 'the-rest-api-key'
g = webhook.guard_from_env(lambda k, d='': env.get(k, d))
ok('.env is read as written', g.enabled and g.secret == SECRET and g.max_lot == 0.5
   and g.default_lot == 0.02 and g.symbols == ('XAUUSD', 'EURUSD')
   and g.allow_live is False and g.per_minute == 12, g)
ok('An empty .env gives a guard that refuses everything',
   webhook.guard_from_env(lambda k, d='': d).why_unusable() is not None)
g_bad = webhook.guard_from_env(lambda k, d='': {'WEBHOOK_ENABLED': 'true',
                                                'WEBHOOK_SECRET': SECRET,
                                                'WEBHOOK_MAX_LOT': 'banana'}.get(k, d))
ok('A nonsense cap falls back to the safe default', g_bad.max_lot == 0.10, g_bad.max_lot)

print()
print('all good' if not fails else f'{fails} failing checks')
sys.exit(1 if fails else 0)
