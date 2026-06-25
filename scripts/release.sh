#!/usr/bin/env bash
set -euo pipefail

# Release script: bump version, date a hand-written CHANGELOG entry, create git tag.
# Usage: npm run release:patch|minor|major
#   or:  ./scripts/release.sh patch|minor|major

BUMP_TYPE="${1:-}"
if [[ ! "$BUMP_TYPE" =~ ^(patch|minor|major)$ ]]; then
  echo "Usage: $0 <patch|minor|major>"
  exit 1
fi

# Get current version
CURRENT=$(node -p "require('./package.json').version")
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

case "$BUMP_TYPE" in
  patch) PATCH=$((PATCH + 1)) ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
TAG="v${NEW_VERSION}"
DATE=$(date +%Y-%m-%d)

echo "Bumping $CURRENT -> $NEW_VERSION ($BUMP_TYPE)"

# Check for uncommitted changes
if [[ -n $(git status --porcelain) ]]; then
  echo "Error: Working directory is not clean. Commit or stash changes first."
  exit 1
fi

# Check tag doesn't already exist
if git tag -l "$TAG" | grep -q "$TAG"; then
  echo "Error: Tag $TAG already exists."
  exit 1
fi

# Require a deliberate changelog entry before mutating files. Release notes
# should be written for users, not generated from raw commit subjects.
if [[ ! -f CHANGELOG.md ]]; then
  echo "Error: CHANGELOG.md is missing. Draft release notes before cutting $TAG."
  exit 1
fi

UNRELEASED_HEADING="## [${NEW_VERSION}] - Unreleased"
DATED_HEADING_REGEX="^## \\[${NEW_VERSION}\\] - [0-9]{4}-[0-9]{2}-[0-9]{2}$"

if grep -Fxq "$UNRELEASED_HEADING" CHANGELOG.md; then
  CHANGELOG_MODE="date"
elif grep -Eq "$DATED_HEADING_REGEX" CHANGELOG.md; then
  CHANGELOG_MODE="keep"
else
  cat <<EOF
Error: CHANGELOG.md does not contain an entry for $TAG.

Add a hand-written entry before releasing, for example:

## [${NEW_VERSION}] - Unreleased

<1-2 sentence lead focused on user-visible impact.>

### Highlights
- **Bold lede** — short explanation.

**Full Changelog**: https://github.com/subsquid-labs/portal-mcp-server/compare/v${CURRENT}...v${NEW_VERSION}
EOF
  exit 1
fi

# Bump package.json and package-lock.json versions
node -e "
const fs = require('fs');

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = '${NEW_VERSION}';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');

if (fs.existsSync('package-lock.json')) {
  const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
  lock.version = '${NEW_VERSION}';
  if (lock.packages && lock.packages['']) {
    lock.packages[''].version = '${NEW_VERSION}';
  }
  fs.writeFileSync('package-lock.json', JSON.stringify(lock, null, 2) + '\n');
}

// Keep the MCP registry manifest in lockstep so 'mcp-publisher publish' never
// ships a stale/duplicate version after a release.
if (fs.existsSync('server.json')) {
  const server = JSON.parse(fs.readFileSync('server.json', 'utf8'));
  server.version = '${NEW_VERSION}';
  fs.writeFileSync('server.json', JSON.stringify(server, null, 2) + '\n');
}
"

if [[ "$CHANGELOG_MODE" == "date" ]]; then
  node -e "
const fs = require('fs');
const path = 'CHANGELOG.md';
const oldHeading = '## [${NEW_VERSION}] - Unreleased';
const newHeading = '## [${NEW_VERSION}] - ${DATE}';
const text = fs.readFileSync(path, 'utf8');
fs.writeFileSync(path, text.replace(oldHeading, newHeading));
"
fi

# Commit and tag
STAGE_FILES=(package.json package-lock.json CHANGELOG.md)
if [[ -f server.json ]]; then
  STAGE_FILES+=(server.json)
fi
git add "${STAGE_FILES[@]}"
git commit -m "chore: release v${NEW_VERSION}"
git tag -a "$TAG" -m "v${NEW_VERSION}"

echo ""
echo "Released $TAG"
echo "  - package.json/package-lock.json bumped to $NEW_VERSION"
if [[ -f server.json ]]; then
  echo "  - server.json registry manifest bumped to $NEW_VERSION"
fi
echo "  - CHANGELOG.md entry dated"
echo "  - Git tag $TAG created"
echo ""
echo "To publish:"
echo "  git push && git push --tags"
echo ""
echo "This will trigger the Docker build workflow automatically."
