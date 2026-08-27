#!/bin/bash

set -euo pipefail

TESTS_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$TESTS_DIR/.." && pwd)"
TEST_TMP_DIR="$(mktemp -d)"
FAKE_BIN_DIR="$TEST_TMP_DIR/bin"

cleanup() {
  case "$TEST_TMP_DIR" in
    /tmp/*|/var/folders/*) rm -rf -- "$TEST_TMP_DIR" ;;
    *) printf 'refusing to clean unexpected test path: %s\n' "$TEST_TMP_DIR" >&2 ;;
  esac
}
trap cleanup EXIT INT TERM

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

command -v expect >/dev/null 2>&1 || fail "expect is required"
command -v node >/dev/null 2>&1 || fail "node is required"

printf 'test: cache keys remain distinct for colliding readable refs\n' >&2
CACHE_KEY_ONE="$(node "$SKILL_DIR/scripts/cache-key.mjs" 'a-b/c@d' '2026-01-01T00:00:00Z')"
CACHE_KEY_TWO="$(node "$SKILL_DIR/scripts/cache-key.mjs" 'a/b-c@d' '2026-01-01T00:00:00Z')"
[ "$CACHE_KEY_ONE" != "$CACHE_KEY_TWO" ] || fail "cache key helper collapsed distinct refs"

mkdir -p "$FAKE_BIN_DIR"
cp "$TESTS_DIR/fixtures/fake-sqd" "$FAKE_BIN_DIR/sqd"
chmod +x "$FAKE_BIN_DIR/sqd"

printf 'test: preflight rejects an unsuccessful auth probe\n' >&2
if PREFLIGHT_OUTPUT="$(env PATH="$FAKE_BIN_DIR:$PATH" bash "$SKILL_DIR/scripts/preflight.sh" 2>&1)"; then
  fail "preflight accepted a failed auth probe"
fi
printf '%s' "$PREFLIGHT_OUTPUT" | grep -q 'could not verify authentication' || fail "preflight did not explain the auth probe failure"
if printf '%s' "$PREFLIGHT_OUTPUT" | grep -q 'sqd auth: OK'; then
  fail "preflight incorrectly reported successful authentication"
fi

printf 'test: fetch rejects a child process failure even with plausible output\n' >&2
if env PATH="$FAKE_BIN_DIR:$PATH" SQD_PERF_MAX_ATTEMPTS=1 SQD_PERF_BACKOFF=0 SQD_PERF_EXPECT_TIMEOUT=1 \
  bash "$SKILL_DIR/scripts/fetch-logs.sh" org/name@hash 2026-01-01T00:00:00Z "$TEST_TMP_DIR/failed.log"; then
  fail "fetch accepted a failed sqd process"
fi
if [ -e "$TEST_TMP_DIR/failed.log.done" ]; then
  fail "fetch wrote a completion sentinel for a failed sqd process"
fi

printf 'test: parser rejects unrecognized input\n' >&2
if node "$SKILL_DIR/scripts/parse.mjs" \
  --input "$TESTS_DIR/fixtures/garbage.log" \
  --output "$TEST_TMP_DIR/garbage.json" \
  --label garbage; then
  fail "parser accepted input without SQD log lines"
fi

printf 'test: fetch accepts a successful child process\n' >&2
env PATH="$FAKE_BIN_DIR:$PATH" SQD_PERF_FAKE_LOGS_EXIT=0 SQD_PERF_MAX_ATTEMPTS=1 SQD_PERF_BACKOFF=0 SQD_PERF_EXPECT_TIMEOUT=1 \
  bash "$SKILL_DIR/scripts/fetch-logs.sh" org/name@hash 2026-01-01T00:00:00Z "$TEST_TMP_DIR/success.log"
[ -e "$TEST_TMP_DIR/success.log.done" ] || fail "fetch did not write a completion sentinel"

printf 'test: fetch and parser accept ANSI-colored CLI output\n' >&2
env PATH="$FAKE_BIN_DIR:$PATH" SQD_PERF_FAKE_LOGS_EXIT=0 SQD_PERF_FAKE_ANSI=1 SQD_PERF_MAX_ATTEMPTS=1 SQD_PERF_BACKOFF=0 SQD_PERF_EXPECT_TIMEOUT=1 \
  bash "$SKILL_DIR/scripts/fetch-logs.sh" org/name@hash 2026-01-01T00:00:00Z "$TEST_TMP_DIR/ansi.log"
[ -e "$TEST_TMP_DIR/ansi.log.done" ] || fail "fetch rejected ANSI-colored logs"
node "$SKILL_DIR/scripts/parse.mjs" \
  --input "$TEST_TMP_DIR/ansi.log" \
  --output "$TEST_TMP_DIR/ansi.json" \
  --label ansi
node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1])); if (p.meta.parsedLines !== 6) process.exit(1)' "$TEST_TMP_DIR/ansi.json" \
  || fail "parser did not preserve all ANSI-colored log lines"

printf 'test: parser accepts current CLI levels and preserves restart origin\n' >&2
node "$SKILL_DIR/scripts/parse.mjs" \
  --input "$TESTS_DIR/fixtures/current-levels.log" \
  --output "$TEST_TMP_DIR/current-levels.json" \
  --label levels
node "$SKILL_DIR/scripts/parse.mjs" \
  --input "$TESTS_DIR/fixtures/restart.log" \
  --output "$TEST_TMP_DIR/restart.json" \
  --label restart
node "$TESTS_DIR/assert-parser.mjs" "$TEST_TMP_DIR/current-levels.json" "$TEST_TMP_DIR/restart.json"

printf 'test: parser counts errors beyond the retained sample cap\n' >&2
ERROR_LOG="$TEST_TMP_DIR/error-cap.log"
for i in $(seq 1 1001); do
  printf 'api 2026-01-01T00:00:00Z WARN sqd:test warning-%s\n' "$i"
done > "$ERROR_LOG"
printf 'api 2026-01-01T00:00:00Z ERROR sqd:test final-error\n' >> "$ERROR_LOG"
node "$SKILL_DIR/scripts/parse.mjs" \
  --input "$ERROR_LOG" \
  --output "$TEST_TMP_DIR/error-cap.json" \
  --label error-cap
node -e '
  const parsed = JSON.parse(require("fs").readFileSync(process.argv[1]));
  const service = parsed.services.api;
  if (service.errorCount !== 1002 || service.errors.length !== 1000) process.exit(1);
  if (service.levelCounts.warning !== 1001 || service.levelCounts.error !== 1) process.exit(1);
' "$TEST_TMP_DIR/error-cap.json" || fail "parser confused total errors with retained samples"

printf 'test: parser and renderer produce a comparison report\n' >&2
REPORT_DIR="$TEST_TMP_DIR/report-run"
mkdir -p "$REPORT_DIR/parsed"
cp "$TESTS_DIR/fixtures/compare-syncs.json" "$REPORT_DIR/compare-syncs.json"
NOISY_BASELINE="$TEST_TMP_DIR/noisy-baseline.log"
cp "$TESTS_DIR/fixtures/baseline.log" "$NOISY_BASELINE"
for i in $(seq 1 1001); do
  printf 'api 2026-01-01T00:10:00Z WARN sqd:test report-warning-%s\n' "$i"
done >> "$NOISY_BASELINE"
printf 'api 2026-01-01T00:10:00Z ERROR sqd:test report-error\n' >> "$NOISY_BASELINE"
node "$SKILL_DIR/scripts/parse.mjs" \
  --input "$NOISY_BASELINE" \
  --output "$REPORT_DIR/parsed/baseline.json" \
  --label baseline
node "$SKILL_DIR/scripts/parse.mjs" \
  --input "$TESTS_DIR/fixtures/optimized.log" \
  --output "$REPORT_DIR/parsed/optimized.json" \
  --label optimized
cat > "$REPORT_DIR/failures.json" <<'JSON'
[
  {
    "label": "experimental",
    "ref": "org/experimental@ghi",
    "stage": "fetch",
    "message": "fetch failed after retries"
  },
  {
    "label": "candidate",
    "ref": "org/candidate@jkl",
    "stage": "parse",
    "message": "log did not contain recognizable progress data"
  }
]
JSON
node "$SKILL_DIR/scripts/report.mjs" --run-dir "$REPORT_DIR"
grep -q 'optimized.*2.50× faster.*baseline' "$REPORT_DIR/report.md" || fail "Markdown comparison verdict is missing"
grep -q 'experimental.*fetch failed' "$REPORT_DIR/report.md" || fail "Markdown fetch failure is missing"
grep -q 'candidate.*parse failed' "$REPORT_DIR/report.md" || fail "Markdown parse failure is missing"
node "$TESTS_DIR/assert-report.mjs" "$REPORT_DIR/report.html"

printf '{"status":"ok","tests":9}\n'
