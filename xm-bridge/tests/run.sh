#!/usr/bin/env bash
# Runs every bridge test against the stand-in MT5 bridge (no Windows or MT5 needed).
#   ./run.sh            all suites
#   PORT=8800 ./run.sh  on another port, if 8711 is busy
set -u
cd "$(dirname "$0")"
PORT="${PORT:-8711}"
export PORT
PORT=$PORT node mock.js > /tmp/xm-mock-$PORT.log 2>&1 &
MOCK=$!
trap 'kill $MOCK 2>/dev/null' EXIT
for i in $(seq 1 20); do
  curl -sf -o /dev/null "http://localhost:$PORT/?key=test-key-123" && break
  sleep 0.5
done

fails=0
for t in fe.js sym.js hist.js ind.js pine.js reload.js settings.js sval.js conv3.js oxhtf.js slow.js upd.js clock.test.js; do
  printf '%-14s ' "$t"
  out=$(timeout 300 node "$t" 2>&1)
  p=$(printf '%s\n' "$out" | grep -cE '^PASS')
  f=$(printf '%s\n' "$out" | grep -cE '^FAIL|^CRASH')
  echo "pass=$p fail=$f"
  [ "$f" != "0" ] && { printf '%s\n' "$out" | grep -E '^FAIL|^CRASH' | sed 's/^/     /'; fails=$((fails+f)); }
done

# tz.js checks the clock maths directly and needs a device clock that is not UTC
printf '%-14s ' "tz.js"
out=$(TZ=Asia/Kolkata node tz.js 2>&1)
echo "pass=$(printf '%s\n' "$out" | grep -cE '^PASS') fail=$(printf '%s\n' "$out" | grep -cE '^FAIL')"
printf '%s\n' "$out" | grep -E '^FAIL' | sed 's/^/     /'
fails=$((fails + $(printf '%s\n' "$out" | grep -cE '^FAIL')))

printf '%-14s ' "test_updater.py"
out=$(python3 -I test_updater.py 2>&1)
echo "pass=$(printf '%s\n' "$out" | grep -cE '^PASS') fail=$(printf '%s\n' "$out" | grep -cE '^FAIL')"
fails=$((fails + $(printf '%s\n' "$out" | grep -cE '^FAIL')))

echo
[ "$fails" = "0" ] && echo "all green" || echo "$fails failing checks"
exit $([ "$fails" = "0" ] && echo 0 || echo 1)
