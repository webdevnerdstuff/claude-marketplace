#!/usr/bin/env bash
# release-version.sh: version numbers for a release of the repo in the current directory.
#
# Version files read and written: .claude-plugin/plugin.json, package.json, composer.json
# (whichever exist and have a "version"). The tag prefix ("v" or none) follows the repo's
# existing tags; with no tags yet it's "v".
#
# Commands:
#   (none)            print what a release could be, one key=value per line:
#                       current=<latest release, e.g. 1.2.0, or 0.0.0 when there are no tags>
#                       prefix=<v or empty>
#                       files=<file=version ...>   (empty when there are no version files)
#                       file_version=<the version in the files, or empty>
#                       patch=<x.y.z+1>  minor=<x.y+1.0>  major=<x+1.0.0>
#                     Fails when the version files disagree with each other.
#   check <version>   fail if that release's tag already exists (locally or on origin);
#                     otherwise print the tag, e.g. v1.3.0
#   set <version>     write the version into every version file, keeping each file's
#                     formatting; prints the files it changed
set -euo pipefail

die() { echo "release-version.sh: $*" >&2; exit 1; }

command -v jq >/dev/null || die "jq is required"
root=$(git rev-parse --show-toplevel 2>/dev/null) || die "not inside a git repo"
cd "$root"

FILES=(.claude-plugin/plugin.json package.json composer.json)

file_versions() {
  local f v
  for f in "${FILES[@]}"; do
    [[ -f "$f" ]] || continue
    v=$(jq -r '.version // empty' "$f")
    [[ -n "$v" ]] && echo "$f=$v"
  done
  return 0
}

latest_tag() {
  git fetch --tags --quiet origin 2>/dev/null || true
  git tag --list --sort=-v:refname | grep -E '^v?[0-9]+\.[0-9]+\.[0-9]+' | head -n 1 || true
}

prefix_for() { [[ -n "$1" && "$1" != v* ]] && echo "" || echo v; }

tag_exists() {
  git rev-parse -q --verify "refs/tags/$1" >/dev/null \
    || [[ -n "$(git ls-remote --tags origin "refs/tags/$1" 2>/dev/null)" ]]
}

valid() { [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$ ]] || die "not a version: $1"; }

cmd=${1:-info}

case "$cmd" in
  info)
    # Plain loops, no mapfile: macOS's built-in bash is 3.2.
    entries=; file_version=
    while IFS= read -r entry; do
      [[ -n "$entry" ]] || continue
      entries="${entries:+$entries }$entry"
      v=${entry#*=}
      [[ -z "$file_version" ]] && file_version=$v
      [[ "$v" == "$file_version" ]] || die "version files disagree: $(file_versions | tr '\n' ' ')"
    done < <(file_versions)
    tag=$(latest_tag)
    current=${tag#v}; current=${current:-0.0.0}
    core=${current%%[-+]*}
    IFS=. read -r maj min pat <<<"$core"
    echo "current=$current"
    echo "prefix=$(prefix_for "$tag")"
    echo "files=$entries"
    echo "file_version=$file_version"
    echo "patch=$maj.$min.$((pat + 1))"
    echo "minor=$maj.$((min + 1)).0"
    echo "major=$((maj + 1)).0.0" ;;

  check)
    version=${2:?usage: release-version.sh check <version>}; valid "$version"
    tag="$(prefix_for "$(latest_tag)")$version"
    tag_exists "$tag" && die "tag $tag already exists; pick another version"
    echo "$tag" ;;

  set)
    version=${2:?usage: release-version.sh set <version>}; valid "$version"
    for f in "${FILES[@]}"; do
      [[ -f "$f" ]] && [[ -n "$(jq -r '.version // empty' "$f")" ]] || continue
      # Replace only the first "version": "..." (the top-level one), leaving the formatting alone.
      perl -0pi -e 's/("version"\s*:\s*")[^"]*(")/${1}'"$version"'${2}/' "$f"
      [[ "$(jq -r '.version' "$f")" == "$version" ]] || die "couldn't set the version in $f"
      echo "$f"
    done ;;

  -h|--help|*) sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
