#!/usr/bin/env bash
set -euo pipefail

# Publish @blocksuser/figma-mcp to npm — the same script BlocksOrg/mcp-linear
# ships as scripts/publish.sh, on pnpm. Run it from a clean checkout of the
# commit you want to ship, logged in to npm as a member of the @blocksuser org
# (`npm login`, or NODE_AUTH_TOKEN / an ~/.npmrc authToken).
# Usage: ./scripts/publish.sh <patch|minor|major> [--rc] [--dry-run]

PACKAGE="@blocksuser/figma-mcp"

usage() {
  cat <<USAGE
Publish $PACKAGE to npm.

Usage: $0 <patch|minor|major> [--rc] [--dry-run]
       $0 --help

Arguments:
  patch|minor|major  Which part of the version to bump (required)

Options:
  --rc        Publish a release candidate (x.y.z-rc.N) under the "rc" dist-tag
              instead of "latest". If the current version is already an rc,
              only the rc number is bumped (1.2.3-rc.0 -> 1.2.3-rc.1).
  --dry-run   Bump and build, but pass --dry-run to pnpm publish (nothing is
              uploaded; package.json / server.json are still bumped locally).
  -h, --help  Show this help

Examples:
  $0 patch        1.2.3      -> 1.2.4       (latest)
  $0 minor --rc   1.2.3      -> 1.3.0-rc.0  (rc)
  $0 minor --rc   1.3.0-rc.0 -> 1.3.0-rc.1  (rc)
  $0 minor        1.3.0-rc.1 -> 1.3.0       (latest)

After a real publish, commit the bump and tag it:
  git add package.json server.json && git commit -m "chore: release v<version>" && git tag v<version> && git push --follow-tags
USAGE
}

BUMP=""
RC=false
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    -h|--help)
      usage
      exit 0
      ;;
    --rc)
      RC=true
      ;;
    --dry-run)
      DRY_RUN=true
      ;;
    patch|minor|major)
      if [[ -n "$BUMP" ]]; then
        echo "Error: bump type given more than once ('$BUMP' and '$arg')" >&2
        exit 1
      fi
      BUMP="$arg"
      ;;
    *)
      echo "Error: unknown argument '$arg'" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$BUMP" ]]; then
  echo "Error: bump type is required (patch, minor or major)" >&2
  usage >&2
  exit 1
fi

cd "$(dirname "$0")/.."

# This repo is a pnpm project (pnpm-lock.yaml, `packageManager` pin, pnpm.overrides,
# `prepack: pnpm build`), unlike mcp-linear's npm one. Use the pnpm on PATH, else the
# pinned version through npx so a machine with only Node + npm can still publish.
PNPM_VERSION=$(node -p "(require('./package.json').packageManager || 'pnpm@10').split('@')[1]")
if command -v pnpm >/dev/null 2>&1; then
  PNPM=(pnpm)
else
  echo "pnpm not found on PATH; using npx pnpm@$PNPM_VERSION"
  PNPM=(npx -y "pnpm@$PNPM_VERSION")
fi
if [[ ! -d node_modules ]]; then
  echo "Installing dependencies..."
  "${PNPM[@]}" install --frozen-lockfile
fi

CURRENT=$(node -p "require('./package.json').version")
TAG="latest"

if $RC; then
  TAG="rc"
  if [[ "$CURRENT" == *-rc.* ]]; then
    echo "Bumping rc number ($CURRENT is already an rc; '$BUMP' not applied)..."
    npm version prerelease --preid rc --no-git-tag-version
  else
    echo "Bumping version (pre$BUMP, rc)..."
    npm version "pre$BUMP" --preid rc --no-git-tag-version
  fi
else
  echo "Bumping version ($BUMP)..."
  npm version "$BUMP" --no-git-tag-version
fi

VERSION=$(node -p "require('./package.json').version")

# server.json (the MCP registry manifest) carries the version twice; keep it in step.
jq --arg v "$VERSION" '.version = $v | .packages[0].version = $v' server.json > server.json.tmp && mv server.json.tmp server.json

echo "Publishing $PACKAGE@$VERSION (tag: $TAG)..."

"${PNPM[@]}" build

# --no-git-checks: the bump is intentionally uncommitted at this point (commit + tag after).
PUBLISH_ARGS=(--access public --tag "$TAG" --no-git-checks)
if $DRY_RUN; then
  PUBLISH_ARGS+=(--dry-run)
fi
"${PNPM[@]}" publish "${PUBLISH_ARGS[@]}"

if $DRY_RUN; then
  echo "Dry run complete for $PACKAGE@$VERSION (tag: $TAG) — nothing uploaded. package.json / server.json were bumped locally; git checkout them to undo."
else
  echo "Published $PACKAGE@$VERSION (tag: $TAG)"
fi
