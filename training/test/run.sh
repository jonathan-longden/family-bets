#!/bin/bash
# Every test in the dataset pipeline, one module at a time.
#
#   ./run.sh              everything
#   ./run.sh labels cli   just those
#
# Standard library only: no pytest, no virtualenv, no install. A dataset check
# that needs a setup step before it can be trusted is a check nobody runs.
set -u
cd "$(dirname "$0")"

ALL="labels sessions config validate dupes metrics build ingest cli"
SUITES=${*:-$ALL}

mkdir -p report
out=report/failures.txt
: > $out
total=0; bad=0
for f in $SUITES; do
  printf '%-12s' "$f"
  o=$(timeout 300 python3 -m unittest -v "test_$f" 2>&1)
  n=$(grep -c '\.\.\. ok$' <<<"$o")
  total=$((total + n))
  if grep -qE '^(OK|OK \(skipped=[0-9]+\))$' <<<"$o"; then
    echo "PASS $n"
  else
    bad=$((bad + 1))
    echo "PASS $n  <-- LOOK"
    { echo "===== $f"; echo "$o"; echo; } >> $out
  fi
done
echo
echo "$total tests, $bad module(s) with failures"
[ "$bad" -eq 0 ] || echo "detail in $(pwd)/$out"
exit $((bad > 0))
