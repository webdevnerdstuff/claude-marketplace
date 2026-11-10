#!/usr/bin/env bash
# gitea.sh: PR and release helper for self-hosted Forgejo and Gitea servers.
# (Forgejo is a fork of Gitea; both answer the same /api/v1 calls used here.)
#
# Run from inside the repo. Works out host/owner/repo from the `origin` remote, so no
# server is hard-coded. Per-user state:
#   ~/.config/gac/hosts.json   { "<git host>": { "type": "forgejo", "url": "http://host:3000" } }
#   macOS Keychain             service "gac-forge:<git host>", account $USER  (API token)
#
# Commands:
#   setup <web-url>           register this repo's host (checks /api/v1/version), then
#                             prompts for a token (hidden) and saves it to the Keychain
#   default-branch            the repo's default branch
#   pr-create <base> <title> [body]   open a PR from the current branch; prints "<number> <url>"
#   pr-checks <number>        success | pending | failure | error | none  (none = no CI)
#   pr-approvals <number>     how many reviewers approved the PR
#   pr-merge <number>         merge commit + delete the branch; prints "merged"
#   release-create <tag> <target> <title> [body]
#                             tag <target> (a branch or SHA) and publish a release; prints its URL
set -euo pipefail

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/remote.sh"

# The Keychain service keeps its original "gac-forge:" name so saved tokens keep working.
KEYCHAIN_PREFIX="gac-forge"

token() {
  keychain_get "$KEYCHAIN_PREFIX:$HOST" \
    || die "no token for $HOST in the Keychain; run: gitea.sh setup <web-url>"
}

api() { # api METHOD PATH [JSON]
  local base; base=$(host_field url); [[ -n "$base" ]] || die "$HOST isn't set up; run: gitea.sh setup <web-url>"
  local args=(-sS -X "$1" -H "Authorization: token $(token)" -H "Accept: application/json" -w '\n%{http_code}')
  [[ $# -ge 3 ]] && args+=(-H "Content-Type: application/json" -d "$3")
  local out code
  out=$(curl "${args[@]}" "${base%/}/api/v1$2") || die "request failed: $1 $2"
  code=${out##*$'\n'}; out=${out%$'\n'*}
  if [[ "$code" -ge 400 ]]; then die "$1 $2 -> HTTP $code: $(jq -r '.message // .' <<<"$out" 2>/dev/null || echo "$out")"; fi
  printf '%s' "$out"
}

cmd=${1:-}; shift || true
[[ -z "$cmd" || "$cmd" == -h || "$cmd" == --help ]] && usage

parse_remote

case "$cmd" in
  setup)
    web=${1:?usage: gitea.sh setup <web-url>}; web=${web%/}
    ver=$(curl -sS "$web/api/v1/version" | jq -r '.version // empty') || true
    [[ -n "$ver" ]] || die "$web/api/v1/version didn't answer like Forgejo/Gitea"
    type=gitea; [[ "$ver" == *forgejo* || "$ver" =~ ^[0-9]+\.[0-9]+\.[0-9]+\+gitea ]] && type=forgejo
    host_set "$HOST" "$(jq -n --arg t "$type" --arg u "$web" '{type: $t, url: $u}')"
    echo "Registered $HOST -> $web ($type $ver)"
    if [[ -z "$(keychain_get "$KEYCHAIN_PREFIX:$HOST")" ]]; then
      keychain_prompt "$KEYCHAIN_PREFIX:$HOST" "gac token ($HOST)" \
        "API token for $HOST (Settings → Applications; write:repository + write:issue)"
    fi ;;

  default-branch)
    api GET "/repos/$SLUG" | jq -r '.default_branch' ;;

  pr-create)
    base=${1:?base}; title=${2:?title}; body=${3:-}
    head=$(git branch --show-current)
    api POST "/repos/$SLUG/pulls" "$(jq -n --arg b "$base" --arg h "$head" --arg t "$title" --arg d "$body" '{base:$b, head:$h, title:$t, body:$d}')" \
      | jq -r '"\(.number) \(.html_url)"' ;;

  pr-checks)
    n=${1:?number}
    sha=$(api GET "/repos/$SLUG/pulls/$n" | jq -r '.head.sha')
    api GET "/repos/$SLUG/commits/$sha/status" | jq -r 'if (.total_count // 0) == 0 then "none" else .state end' ;;

  pr-approvals)
    n=${1:?number}
    api GET "/repos/$SLUG/pulls/$n/reviews" | jq -r '[.[] | select(.state == "APPROVED" and (.dismissed | not))] | length' ;;

  pr-merge)
    n=${1:?number}
    api POST "/repos/$SLUG/pulls/$n/merge" '{"Do":"merge","delete_branch_after_merge":true}' >/dev/null
    api GET "/repos/$SLUG/pulls/$n" | jq -r 'if .merged then "merged" else "not merged" end' ;;

  release-create)
    tag=${1:?tag}; target=${2:?target}; title=${3:?title}; body=${4:-}
    api POST "/repos/$SLUG/releases" "$(jq -n --arg t "$tag" --arg c "$target" --arg n "$title" --arg b "$body" '{tag_name:$t, target_commitish:$c, name:$n, body:$b, draft:false, prerelease:false}')" \
      | jq -r '.html_url' ;;

  *) usage ;;
esac
