#!/usr/bin/env bash
# release-version.sh: work out the release tag for the repo in the current directory.
#
# Reads "version" from every version file that has one:
#   .claude-plugin/plugin.json, package.json, composer.json
# and prints the tag to release, e.g. "v1.2.0". The "v" prefix follows the repo's existing
# tags (no tags yet = "v").
#
# Fails (exit 1, reason on stderr) when:
#   - no version file has a version
#   - the files disagree
#   - that tag already exists locally or on origin (the version wasn't bumped)
set -euo pipefail

die() { echo "release-version.sh: $*" >&2; exit 1; }

command -v jq >/dev/null || die "jq is required"
root=$(git rev-parse --show-toplevel 2>/dev/null) || die "not inside a git repo"
cd "$root"

versions=()
for f in .claude-plugin/plugin.json package.json composer.json; do
  [[ -f "$f" ]] || continue
  v=$(jq -r '.version // empty' "$f")
  [[ -n "$v" ]] && versions+=("$f=$v")
done

[[ ${#versions[@]} -gt 0 ]] || die "no version found in .claude-plugin/plugin.json, package.json or composer.json"

version=${versions[0]#*=}
for entry in "${versions[@]}"; do
  [[ "${entry#*=}" == "$version" ]] || die "version files disagree: ${versions[*]}"
done

git fetch --tags --quiet origin 2>/dev/null || true
latest=$(git tag --sort=-v:refname | head -n 1)
prefix=v
[[ -n "$latest" && "$latest" != v* ]] && prefix=

tag="$prefix$version"
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null \
  || [[ -n "$(git ls-remote --tags origin "refs/tags/$tag" 2>/dev/null)" ]]; then
  die "tag $tag already exists; bump the version first (found: ${versions[*]})"
fi

echo "$tag"
