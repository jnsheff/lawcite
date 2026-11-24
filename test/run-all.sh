#!/bin/sh
# Runs the lawcite tests and every module's own suite; fails unless each prints its success marker.
cd "$(dirname "$0")/.." || exit 1
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
fail=0
out=$("$JSC" test/bootstrap-jsc.js 2>&1); echo "$out" | tail -6
echo "$out" | grep -q '^bootstrap OK' || { echo "  ^^^ FAILED: bootstrap"; fail=1; }
echo "--- modules/hicite";      (cd modules/hicite && sh test/run-all.sh) 2>&1 | tail -16 | tee /tmp/lawcite-hicite.out | tail -3
grep -q '^TESTS FAILED' /tmp/lawcite-hicite.out && fail=1
echo "--- modules/translators"; (cd modules/translators && sh test/run-all.sh) 2>&1 | tail -3 | tee /tmp/lawcite-translators.out
grep -q 'ALL TESTS PASSED' /tmp/lawcite-translators.out || fail=1
[ $fail = 0 ] && echo "LAWCITE: ALL TESTS PASSED" || { echo "LAWCITE: TESTS FAILED"; exit 1; }
