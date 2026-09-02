#!/bin/bash
# Every assertion-bearing suite, one at a time.
#
# One at a time on purpose. Several suites drive a real camera, a real service
# worker and a real 2.4 MB TensorFlow.js download, and running them together
# made them fight over the machine rather than over the app — which produced
# failures that passed when re-run alone and taught nobody anything.
#
#   ./run.sh              every suite
#   ./run.sh survey geo   just those
#
# Detail from anything that failed lands in report/failures.txt.
set -u
cd "$(dirname "$0")"

PORT=${PORT:-8777}
ROOT=$(cd ../.. && pwd)

# The app is served from the repository root, because the suites ask for
# /defects/ and the service worker's scope has to match what the site has in
# the field.
if ! curl -s -o /dev/null "http://127.0.0.1:$PORT/defects/"; then
  python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$ROOT" >/dev/null 2>&1 &
  SERVER=$!
  trap 'kill $SERVER 2>/dev/null' EXIT
  for _ in $(seq 40); do
    curl -s -o /dev/null "http://127.0.0.1:$PORT/defects/" && break
    sleep 0.25
  done
fi

# deploy*.mjs are excluded: they check the live GitHub Pages site, which needs
# outbound network and says nothing about the working tree.
ALL="amend backend bench bounded classes closer decode diag diagnose decodefail
     evidence miss
     diagscreen dupes frame frametest garbage geo layout local map meta mig note
     offline orient precision priority rawtype realtf secrets selftest shadow
     shell split strip survey sw swall swupgrade test upright vendorcache w3wkey
     where"
SUITES=${*:-$ALL}

mkdir -p report
out=report/failures.txt
: > $out
total=0; bad=0
for f in $SUITES; do
  printf '%-14s' "$f"
  o=$(timeout 900 node "$f.mjs" 2>&1)
  p=$(grep -c '^PASS ' <<<"$o"); q=$(grep -c '^FAIL ' <<<"$o")
  total=$((total + p))
  if [ "$q" -gt 0 ] || ! grep -q 'all passed' <<<"$o"; then
    bad=$((bad + 1))
    echo "PASS $p  FAIL $q  <-- LOOK"
    { echo "===== $f"; echo "$o"; echo; } >> $out
  else
    echo "PASS $p"
  fi
done
echo
echo "$total assertions, $bad suite(s) with failures"
[ "$bad" -eq 0 ] || echo "detail in $(pwd)/$out"
exit $((bad > 0))
