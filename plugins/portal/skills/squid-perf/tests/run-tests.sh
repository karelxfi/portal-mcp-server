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
[ -e "$TEST_TMP_DIR/success.log.capture-start" ] || fail "fetch did not preserve its start time"

printf 'test: fetch accepts a one-line capture and parser uses fetch-start liveness\n' >&2
env PATH="$FAKE_BIN_DIR:$PATH" SQD_PERF_FAKE_LOGS_EXIT=0 SQD_PERF_FAKE_SHORT=1 SQD_PERF_MAX_ATTEMPTS=1 SQD_PERF_BACKOFF=0 SQD_PERF_EXPECT_TIMEOUT=1 \
  bash "$SKILL_DIR/scripts/fetch-logs.sh" org/quiet@hash 2026-01-01T00:00:00Z "$TEST_TMP_DIR/short.log"
[ -e "$TEST_TMP_DIR/short.log.done" ] || fail "fetch rejected a valid one-line capture"
[ -e "$TEST_TMP_DIR/short.log.capture-start" ] || fail "short capture omitted fetch-start metadata"
printf '2026-01-01T00:00:30Z\n' > "$TEST_TMP_DIR/short.log.capture-start"
node "$SKILL_DIR/scripts/parse.mjs" \
  --input "$TEST_TMP_DIR/short.log" \
  --output "$TEST_TMP_DIR/short.json" \
  --label short
node -e '
  const parsed = JSON.parse(require("fs").readFileSync(process.argv[1]));
  if (!parsed.meta.live) process.exit(1);
  if (parsed.meta.captureTimeSource !== "fetch-start") process.exit(1);
  if (parsed.meta.captureStartedAt !== "2026-01-01T00:00:30.000Z") process.exit(1);
' "$TEST_TMP_DIR/short.json" || fail "parser measured liveness at parse time instead of fetch start"

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
printf 'test: parser counts small backward jumps and keeps the chronological final block\n' >&2
node "$SKILL_DIR/scripts/parse.mjs" \
  --input "$TESTS_DIR/fixtures/small-restart.log" \
  --output "$TEST_TMP_DIR/small-restart.json" \
  --label small-restart
printf 'test: parser preserves restart position when timestamps match\n' >&2
node "$SKILL_DIR/scripts/parse.mjs" \
  --input "$TESTS_DIR/fixtures/same-timestamp-restart.log" \
  --output "$TEST_TMP_DIR/same-timestamp-restart.json" \
  --label same-timestamp-restart
node "$SKILL_DIR/scripts/parse.mjs" \
  --input "$TESTS_DIR/fixtures/reverse-same-timestamp-restart.log" \
  --output "$TEST_TMP_DIR/reverse-same-timestamp-restart.json" \
  --label reverse-same-timestamp-restart
cat > "$TEST_TMP_DIR/same-timestamp-only.log" <<'LOG'
api 2026-01-01T00:00:10.000Z INFO sqd:processor 100 / 1000, rate: 10 blocks/sec
api 2026-01-01T00:00:10.000Z INFO sqd:processor 200 / 1000, rate: 10 blocks/sec
api 2026-01-01T00:00:10.000Z INFO sqd:processor 300 / 1000, rate: 10 blocks/sec
LOG
node "$SKILL_DIR/scripts/parse.mjs" \
  --input "$TEST_TMP_DIR/same-timestamp-only.log" \
  --output "$TEST_TMP_DIR/same-timestamp-only.json" \
  --label same-timestamp-only
node -e '
  const service = JSON.parse(require("fs").readFileSync(process.argv[1])).services.api;
  if (service.progressRows.map(row => row[1]).join(",") !== "100,200,300") process.exit(1);
  if (service.restarts.length !== 0) process.exit(1);
' "$TEST_TMP_DIR/same-timestamp-only.json" || fail "parser reversed an unknown-direction same-timestamp capture"
node "$TESTS_DIR/assert-parser.mjs" \
  "$TEST_TMP_DIR/current-levels.json" \
  "$TEST_TMP_DIR/restart.json" \
  "$TEST_TMP_DIR/small-restart.json" \
  "$TEST_TMP_DIR/same-timestamp-restart.json" \
  "$TEST_TMP_DIR/reverse-same-timestamp-restart.json"

printf 'test: report keeps a nonnegative final-segment range after restart\n' >&2
RESTART_REPORT_DIR="$TEST_TMP_DIR/restart-report-run"
mkdir -p "$RESTART_REPORT_DIR/parsed"
cat > "$RESTART_REPORT_DIR/compare-syncs.json" <<'JSON'
{
  "createdAt": "2026-01-01T00:00:00Z",
  "downtimeThresholdSec": 120,
  "breakpointsOverride": null,
  "indexers": [
    { "ref": "org/restart@abc", "since": "2026-01-01T00:00:00Z", "label": "reverse-same-timestamp-restart" }
  ]
}
JSON
cp "$TEST_TMP_DIR/reverse-same-timestamp-restart.json" "$RESTART_REPORT_DIR/parsed/reverse-same-timestamp-restart.json"
printf '[]\n' > "$RESTART_REPORT_DIR/failures.json"
node "$SKILL_DIR/scripts/report.mjs" --run-dir "$RESTART_REPORT_DIR"
grep -Fq '100% (500 blocks)' "$RESTART_REPORT_DIR/report.md" || fail "restart report omitted the final 500-block segment"
grep -Fq 'Sync timings use the final uninterrupted segment.' "$RESTART_REPORT_DIR/report.md" || fail "restart report omitted the segment warning"
if grep -Fq 'p95 10ms' "$RESTART_REPORT_DIR/report.md"; then
  fail "restart report included a same-timestamp pre-restart multicall"
fi

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

printf 'test: report excludes idle-tail rates and honors raw-range overrides\n' >&2
EDGE_REPORT_DIR="$TEST_TMP_DIR/edge-report-run"
mkdir -p "$EDGE_REPORT_DIR/parsed"
cat > "$EDGE_REPORT_DIR/compare-syncs.json" <<'JSON'
{
  "createdAt": "2026-01-01T00:00:00Z",
  "downtimeThresholdSec": 120,
  "breakpointsOverride": null,
  "indexers": [
    { "ref": "org/edge-a@abc", "since": "2026-01-01T00:00:00Z", "label": "edge-a" },
    { "ref": "org/edge-b@def", "since": "2026-01-01T00:00:00Z", "label": "edge-b" }
  ]
}
JSON
cat > "$TEST_TMP_DIR/edge-a.log" <<'LOG'
api 2026-01-01T00:00:00.000Z INFO sqd:processor 100 / 1000, rate: 10 blocks/sec, mapping: 10 blocks/sec, 10 items/sec, eta: 90s
api 2026-01-01T00:00:10.000Z INFO sqd:processor 500 / 1000, rate: 10 blocks/sec, mapping: 10 blocks/sec, 10 items/sec, eta: 50s
api 2026-01-01T00:00:10.000Z INFO sqd:multicall processed sync 500 at block 500: 1 chunks, 1 groups, 1 total calls, 10ms
api 2026-01-01T00:00:20.000Z INFO sqd:processor 995 / 1000, rate: 10 blocks/sec, mapping: 10 blocks/sec, 10 items/sec, eta: 0s
api 2026-01-01T00:00:20.000Z INFO sqd:multicall processed idle 995 at block 995: 1 chunks, 1 groups, 1 total calls, 9999ms
api 2026-01-01T00:00:20.000Z INFO sqd:processor 995 / 1000, rate: 1000 blocks/sec, mapping: 1000 blocks/sec, 1000 items/sec, eta: 0s
api 2026-01-01T00:00:20.000Z INFO sqd:processor 1000 / 1000, rate: 1000 blocks/sec, mapping: 1000 blocks/sec, 1000 items/sec, eta: 0s
api 2026-01-01T00:05:00.000Z INFO sqd:processor 1000 / 1000, rate: 1000 blocks/sec, mapping: 1000 blocks/sec, 1000 items/sec, eta: 0s
api 2026-01-01T00:10:00.000Z INFO sqd:processor 1000 / 1000, rate: 1000 blocks/sec, mapping: 1000 blocks/sec, 1000 items/sec, eta: 0s
LOG
cat > "$TEST_TMP_DIR/edge-b.log" <<'LOG'
api 2026-01-01T00:00:00.000Z INFO sqd:processor 100 / 1000, rate: 10 blocks/sec, mapping: 10 blocks/sec, 10 items/sec, eta: 90s
api 2026-01-01T00:00:10.000Z INFO sqd:processor 500 / 1000, rate: 10 blocks/sec, mapping: 10 blocks/sec, 10 items/sec, eta: 50s
api 2026-01-01T00:00:10.000Z INFO sqd:multicall processed sync 500 at block 500: 1 chunks, 1 groups, 1 total calls, 10ms
api 2026-01-01T00:00:20.000Z INFO sqd:processor 995 / 1000, rate: 10 blocks/sec, mapping: 10 blocks/sec, 10 items/sec, eta: 0s
api 2026-01-01T00:00:20.000Z INFO sqd:multicall processed idle 995 at block 995: 1 chunks, 1 groups, 1 total calls, 9999ms
api 2026-01-01T00:00:20.000Z INFO sqd:processor 995 / 1000, rate: 1 blocks/sec, mapping: 1 blocks/sec, 1 items/sec, eta: 0s
api 2026-01-01T00:00:20.000Z INFO sqd:processor 1000 / 1000, rate: 1 blocks/sec, mapping: 1 blocks/sec, 1 items/sec, eta: 0s
api 2026-01-01T00:05:00.000Z INFO sqd:processor 1000 / 1000, rate: 1 blocks/sec, mapping: 1 blocks/sec, 1 items/sec, eta: 0s
api 2026-01-01T00:10:00.000Z INFO sqd:processor 1000 / 1000, rate: 1 blocks/sec, mapping: 1 blocks/sec, 1 items/sec, eta: 0s
LOG
node "$SKILL_DIR/scripts/parse.mjs" --input "$TEST_TMP_DIR/edge-a.log" --output "$EDGE_REPORT_DIR/parsed/edge-a.json" --label edge-a
node "$SKILL_DIR/scripts/parse.mjs" --input "$TEST_TMP_DIR/edge-b.log" --output "$EDGE_REPORT_DIR/parsed/edge-b.json" --label edge-b
printf '[]\n' > "$EDGE_REPORT_DIR/failures.json"
node "$SKILL_DIR/scripts/report.mjs" --run-dir "$EDGE_REPORT_DIR"
if grep -q 'Likely the dominant bottleneck' "$EDGE_REPORT_DIR/report.md"; then
  fail "rate finding included post-catchup idle-tail samples"
fi
if grep -Fq '257.5 blk/s' "$EDGE_REPORT_DIR/report.md" || grep -Fq '7.8 blk/s' "$EDGE_REPORT_DIR/report.md"; then
  fail "interval rate table included post-catchup idle-tail samples"
fi
grep -Fq 'p95 10ms' "$EDGE_REPORT_DIR/report.md" || fail "sync multicall sample is missing"
if grep -Fq '9999ms' "$EDGE_REPORT_DIR/report.md"; then
  fail "interval multicall statistics included a same-timestamp idle-tail sample"
fi
node -e '
  const lines = require("fs").readFileSync(process.argv[1], "utf8").split("\n");
  const templateLine = lines.findIndex(line => line.includes("type=\"__bundler/template\"") && line.trim().startsWith("<script"));
  const inner = JSON.parse(lines[templateLine + 1]);
  const openTag = "<script id=\"__REPORT_DATA__\" type=\"application/json\">";
  const openAt = inner.indexOf(openTag, inner.indexOf("-->") + 3);
  const closeAt = inner.indexOf("</script>", openAt + openTag.length);
  const data = JSON.parse(inner.slice(openAt + openTag.length, closeAt));
  const service = data.services.find(item => item.name === "api");
  for (const label of ["edge-a", "edge-b"]) {
    const progress = service?.progress?.[label];
    if (!progress || progress.at(-1)?.block !== 995 || progress.at(-1)?.t !== 20) process.exit(1);
    if (service.tier2?.[label]?.multicallMeanMs !== 10) process.exit(1);
    if (service.tier2?.[label]?.multicallP95Ms !== 10) process.exit(1);
  }
' "$EDGE_REPORT_DIR/report.html" || fail "HTML summary included post-catchup idle-tail samples"
node -e '
  const fs = require("fs");
  for (const file of process.argv.slice(1)) {
    const parsed = JSON.parse(fs.readFileSync(file));
    parsed.meta.parserVersion = 6;
    for (const service of Object.values(parsed.services)) {
      service.progressSchema = service.progressSchema.slice(0, 7);
      service.progressRows = service.progressRows.map(row => row.slice(0, 7));
      for (const sample of service.multicall) delete sample.sequence;
      for (const restart of service.restarts) delete restart.sequence;
    }
    fs.writeFileSync(file, JSON.stringify(parsed));
  }
' "$EDGE_REPORT_DIR/parsed/edge-a.json" "$EDGE_REPORT_DIR/parsed/edge-b.json"
node "$SKILL_DIR/scripts/report.mjs" --run-dir "$EDGE_REPORT_DIR"
node -e '
  const lines = require("fs").readFileSync(process.argv[1], "utf8").split("\n");
  const templateLine = lines.findIndex(line => line.includes("type=\"__bundler/template\"") && line.trim().startsWith("<script"));
  const inner = JSON.parse(lines[templateLine + 1]);
  const openTag = "<script id=\"__REPORT_DATA__\" type=\"application/json\">";
  const openAt = inner.indexOf(openTag, inner.indexOf("-->") + 3);
  const closeAt = inner.indexOf("</script>", openAt + openTag.length);
  const data = JSON.parse(inner.slice(openAt + openTag.length, closeAt));
  const service = data.services.find(item => item.name === "api");
  for (const label of ["edge-a", "edge-b"]) {
    if (service.tier2?.[label]?.multicallMeanMs !== 10) process.exit(1);
    if (service.tier2?.[label]?.multicallP95Ms !== 10) process.exit(1);
  }
' "$EDGE_REPORT_DIR/report.html" || fail "legacy parsed report included an ambiguous catchup-boundary multicall"
if grep -Fq '9999ms' "$EDGE_REPORT_DIR/report.md"; then
  fail "legacy parsed interval included an ambiguous catchup-boundary multicall"
fi
node "$SKILL_DIR/scripts/report.mjs" --run-dir "$EDGE_REPORT_DIR" --breakpoints 900
node -e '
  const lines = require("fs").readFileSync(process.argv[1], "utf8").split("\n");
  const templateLine = lines.findIndex(line => line.includes("type=\"__bundler/template\"") && line.trim().startsWith("<script"));
  const inner = JSON.parse(lines[templateLine + 1]);
  const openTag = "<script id=\"__REPORT_DATA__\" type=\"application/json\">";
  const openAt = inner.indexOf(openTag, inner.indexOf("-->") + 3);
  const closeAt = inner.indexOf("</script>", openAt + openTag.length);
  const data = JSON.parse(inner.slice(openAt + openTag.length, closeAt));
  const service = data.services.find(item => item.name === "api");
  if (!service || service.breakpoints.length !== 1) process.exit(1);
  if (service.breakpoints[0].block !== 1000) process.exit(1);
  if (!service.breakpoints[0].perIndexer["edge-a"].reached || !service.breakpoints[0].perIndexer["edge-b"].reached) process.exit(1);
  if (service.progress["edge-a"].at(-1)?.block !== 1000 || service.progress["edge-b"].at(-1)?.block !== 1000) process.exit(1);
' "$EDGE_REPORT_DIR/report.html" || fail "override breakpoint was truncated to the catch-up range"

printf 'test: report warns when ending coverage ranges diverge\n' >&2
RANGE_REPORT_DIR="$TEST_TMP_DIR/range-report-run"
mkdir -p "$RANGE_REPORT_DIR/parsed"
cat > "$RANGE_REPORT_DIR/compare-syncs.json" <<'JSON'
{
  "createdAt": "2026-01-01T00:00:00Z",
  "downtimeThresholdSec": 120,
  "breakpointsOverride": null,
  "indexers": [
    { "ref": "org/range-a@abc", "since": "2026-01-01T00:00:00Z", "label": "range-a" },
    { "ref": "org/range-b@def", "since": "2026-01-01T00:00:00Z", "label": "range-b" }
  ]
}
JSON
cat > "$TEST_TMP_DIR/range-a.log" <<'LOG'
api 2026-01-01T00:00:00.000Z INFO sqd:processor 100 / 1000, rate: 10 blocks/sec
api 2026-01-01T00:00:20.000Z INFO sqd:processor 995 / 1000, rate: 10 blocks/sec
LOG
cat > "$TEST_TMP_DIR/range-b.log" <<'LOG'
api 2026-01-01T00:00:00.000Z INFO sqd:processor 100 / 2000, rate: 10 blocks/sec
api 2026-01-01T00:00:20.000Z INFO sqd:processor 1995 / 2000, rate: 10 blocks/sec
LOG
node "$SKILL_DIR/scripts/parse.mjs" --input "$TEST_TMP_DIR/range-a.log" --output "$RANGE_REPORT_DIR/parsed/range-a.json" --label range-a
node "$SKILL_DIR/scripts/parse.mjs" --input "$TEST_TMP_DIR/range-b.log" --output "$RANGE_REPORT_DIR/parsed/range-b.json" --label range-b
printf '[]\n' > "$RANGE_REPORT_DIR/failures.json"
node "$SKILL_DIR/scripts/report.mjs" --run-dir "$RANGE_REPORT_DIR"
grep -Fq "starting or ending coverage differs by > 5%" "$RANGE_REPORT_DIR/report.md" || fail "ending-range divergence warning is missing"

printf '{"status":"ok","tests":15}\n'
