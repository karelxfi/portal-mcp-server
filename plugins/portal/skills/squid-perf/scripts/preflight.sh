#!/usr/bin/env bash
# squid-perf / preflight.sh
# Verify all required tools are installed and the user is authenticated to Squid Cloud.
# Exits non-zero with a human-readable error on any missing piece.

set -euo pipefail

FAIL=0
report_ok()   { printf "  \033[32m✓\033[0m %s\n"   "$1"; }
report_miss() { printf "  \033[31m✗\033[0m %s\n"   "$1"; FAIL=1; }
report_warn() { printf "  \033[33m!\033[0m %s\n"   "$1"; }

printf "squid-perf preflight\n\n"

# --- sqd CLI ---
if command -v sqd >/dev/null 2>&1; then
  SQD_VERSION="$(sqd --version 2>/dev/null | head -n1 || echo unknown)"
  report_ok "sqd  (${SQD_VERSION})"
else
  report_miss "sqd CLI not found"
  printf "      install: npm i -g @subsquid/cli\n"
  printf "      docs:    https://docs.sqd.dev/en/sdk/squid-sdk/squid-cli/\n"
fi

# --- expect ---
if command -v expect >/dev/null 2>&1; then
  report_ok "expect"
else
  report_miss "expect not found"
  printf "      macOS: brew install expect\n"
  printf "      Ubuntu/Debian: sudo apt-get install -y expect\n"
  printf "      Fedora/RHEL:   sudo dnf install -y expect\n"
fi

# --- node ---
if command -v node >/dev/null 2>&1; then
  NODE_VERSION="$(node --version 2>/dev/null || echo unknown)"
  NODE_MAJOR="$(printf '%s' "$NODE_VERSION" | sed -E 's/^v?([0-9]+).*/\1/')"
  if [ -n "$NODE_MAJOR" ] && [ "$NODE_MAJOR" -ge 18 ] 2>/dev/null; then
    report_ok "node (${NODE_VERSION})"
  else
    report_warn "node (${NODE_VERSION}) — v18+ recommended; may still work"
  fi
else
  report_miss "node not found"
  printf "      install: https://nodejs.org or via nvm / fnm / volta\n"
fi

# --- sqd auth ---
# Probe auth cheaply. "sqd ls --no-interactive" is a harmless authenticated call; we redirect
# stdout away because we only care about exit status / stderr presence.
# Some sqd versions print "Not authorized" / "login required" / "Unauthenticated" on stderr.
if command -v sqd >/dev/null 2>&1; then
  if AUTH_OUT="$(sqd ls --no-interactive 2>&1 >/dev/null)"; then
    AUTH_RC=0
  else
    AUTH_RC=$?
  fi
  LOWER="$(printf '%s' "$AUTH_OUT" | tr '[:upper:]' '[:lower:]')"
  if printf '%s' "$LOWER" | grep -Eq 'not auth|unauth|login|please run.*auth|api key'; then
    report_miss "sqd auth: not authenticated"
    printf "      run:   sqd auth -k <YOUR_API_KEY>\n"
    printf "      docs:  https://docs.sqd.dev/en/sdk/squid-sdk/squid-cli/auth/\n"
  elif [ $AUTH_RC -ne 0 ]; then
    report_miss "sqd auth: probe returned exit $AUTH_RC (could not verify authentication)"
  else
    report_ok "sqd auth: OK"
  fi
fi

printf "\n"

if [ "$FAIL" -ne 0 ]; then
  printf "\033[31mpreflight failed\033[0m — install the missing tool(s) above and re-run.\n" >&2
  exit 1
fi

printf "\033[32mpreflight ok\033[0m\n"
exit 0
