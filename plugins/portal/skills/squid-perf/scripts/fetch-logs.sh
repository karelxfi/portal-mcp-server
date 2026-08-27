#!/usr/bin/env bash
# squid-perf / fetch-logs.sh
# Fetch full logs for a single Squid deployment via `sqd logs` + expect pagination.
#
# Args:
#   $1  ref        e.g., void/gmx-optimized-multichain-v2@oe4zvr
#   $2  since      ISO 8601, e.g., 2026-04-16T08:30:59Z
#   $3  out_path   where the fetched log goes (parent dir must exist)
#
# Contract:
#   - Writes to "${out_path}.partial" first, renames atomically on success.
#   - Writes fetch-start time to "${out_path}.capture-start" on success.
#   - Writes "${out_path}.done" sentinel only on full success.
#   - Retries 3× with 10s backoff on failure.
#   - Exits 0 on success, non-zero on permanent failure (with error on stderr).

set -euo pipefail

REF="${1:-}"
SINCE="${2:-}"
OUT_PATH="${3:-}"

if [ -z "$REF" ] || [ -z "$SINCE" ] || [ -z "$OUT_PATH" ]; then
  printf "usage: %s <ref> <since-ISO> <out-path>\n" "$0" >&2
  exit 2
fi

if ! command -v expect >/dev/null 2>&1; then
  printf "fetch-logs: 'expect' not in PATH\n" >&2
  exit 3
fi
if ! command -v sqd >/dev/null 2>&1; then
  printf "fetch-logs: 'sqd' not in PATH\n" >&2
  exit 3
fi

OUT_DIR="$(dirname "$OUT_PATH")"
mkdir -p "$OUT_DIR"

PARTIAL="${OUT_PATH}.partial"
SENTINEL="${OUT_PATH}.done"
CAPTURE_START="${OUT_PATH}.capture-start"
CAPTURE_START_PARTIAL="${CAPTURE_START}.partial"

# Remove stale sentinel (if a prior aborted run left it) — shouldn't happen but be safe.
rm -f "$SENTINEL" "$CAPTURE_START" "$CAPTURE_START_PARTIAL"

PAGE_SIZE="${SQD_PERF_PAGE_SIZE:-10000}"
MAX_ATTEMPTS="${SQD_PERF_MAX_ATTEMPTS:-3}"
BACKOFF_SEC="${SQD_PERF_BACKOFF:-10}"
EXPECT_TIMEOUT="${SQD_PERF_EXPECT_TIMEOUT:-600}"   # per-page wait, seconds

has_recognizable_log_line() {
  # `expect` allocates a PTY, so the CLI may colorize individual fields. Strip
  # ANSI SGR sequences line-by-line before checking the current log shape.
  awk '
    BEGIN { esc = sprintf("%c", 27) }
    {
      gsub(esc "\\[[0-9;]*m", "")
      if ($0 ~ /[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[^[:space:]]+Z[[:space:]]+(TRACE|DEBUG|INFO|NOTICE|WARN|WARNING|ERROR|CRITICAL|FATAL)[[:space:]]+/) found = 1
    }
    END { exit found ? 0 : 1 }
  ' "$1"
}

attempt=1
while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
  capture_started_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  printf "fetch-logs [%s] attempt %d/%d — since=%s\n" "$REF" "$attempt" "$MAX_ATTEMPTS" "$SINCE" >&2

  : > "$PARTIAL"

  # Expect wrapper:
  #  - Spawns sqd logs, paginates by sending "it\r" whenever CLI prompts.
  #  - Breaks on EOF (all pages fetched) or timeout (stuck).
  #  - log_user 1 so output streams to stdout -> captured to $PARTIAL.
  # shellcheck disable=SC2016 # Tcl expands these variables inside Expect.
  if env \
    SQD_PERF_EXPECT_REF="$REF" \
    SQD_PERF_EXPECT_SINCE="$SINCE" \
    SQD_PERF_EXPECT_PAGE_SIZE="$PAGE_SIZE" \
    SQD_PERF_EXPECT_TIMEOUT_VALUE="$EXPECT_TIMEOUT" \
    expect -c '
    set timeout $env(SQD_PERF_EXPECT_TIMEOUT_VALUE)
    log_user 1
    spawn -noecho sqd logs -r $env(SQD_PERF_EXPECT_REF) --pageSize $env(SQD_PERF_EXPECT_PAGE_SIZE) --since $env(SQD_PERF_EXPECT_SINCE)
    set stuck 0
    while 1 {
      expect {
        -re {type "it" to fetch more logs} { send "it\r"; set stuck 0 }
        -re {Error|error:|ERR_|ECONNREFUSED|ENOTFOUND} { set stuck 1; continue }
        eof { break }
        timeout {
          incr stuck
          if {$stuck >= 2} { break }
        }
      }
    }
    catch {close}
    set wait_rc [catch {wait} wait_result]
    if {$wait_rc != 0} { exit 1 }
    if {[lindex $wait_result 2] != 0} { exit 1 }
    set child_rc [lindex $wait_result 3]
    if {$child_rc != 0} { exit $child_rc }
    exit 0
  ' > "$PARTIAL" 2> "${PARTIAL}.err"; then
    rc=0
  else
    rc=$?
  fi

  # Success requires a clean child exit, at least one recognizable Cloud log
  # line, and no obvious auth/error-only response. Quiet deployments may emit
  # only a handful of valid lines.
  line_count=$(wc -l < "$PARTIAL" 2>/dev/null | tr -d ' ')
  line_count="${line_count:-0}"

  if [ "$rc" -eq 0 ] && has_recognizable_log_line "$PARTIAL" \
     && ! grep -qE '^(Error|error:|ERR_|Not authorized|Unauthenticated|please run.*auth)' "$PARTIAL"; then
    # Success path: publish the log and capture timestamp, then write the
    # sentinel last so cache readers never accept incomplete metadata.
    mv -f "$PARTIAL" "$OUT_PATH"
    printf '%s\n' "$capture_started_at" > "$CAPTURE_START_PARTIAL"
    mv -f "$CAPTURE_START_PARTIAL" "$CAPTURE_START"
    rm -f "${PARTIAL}.err"
    : > "$SENTINEL"
    printf "fetch-logs [%s] ok — %s lines → %s\n" "$REF" "$line_count" "$OUT_PATH" >&2
    exit 0
  fi

  # Failure — surface stderr snippet, keep partial for debug, back off
  err_snip="$(head -c 2000 "${PARTIAL}.err" 2>/dev/null || true)"
  if [ -n "$err_snip" ]; then
    printf "fetch-logs [%s] attempt %d failed (rc=%d, %s lines)\n---stderr---\n%s\n------------\n" \
      "$REF" "$attempt" "$rc" "$line_count" "$err_snip" >&2
  else
    printf "fetch-logs [%s] attempt %d failed (rc=%d, %s lines)\n" "$REF" "$attempt" "$rc" "$line_count" >&2
  fi

  if [ "$attempt" -lt "$MAX_ATTEMPTS" ]; then
    sleep "$BACKOFF_SEC"
  fi
  attempt=$((attempt + 1))
done

printf "fetch-logs [%s] GAVE UP after %d attempts\n" "$REF" "$MAX_ATTEMPTS" >&2
exit 1
