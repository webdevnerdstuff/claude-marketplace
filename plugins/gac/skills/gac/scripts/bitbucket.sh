#!/usr/bin/env bash
# bitbucket.sh: PR helper for Bitbucket Cloud (bitbucket.org). Bitbucket has no releases,
# so there is no release command; gacppmr runs as gacppm there.
#
# Run from inside the repo. Works out workspace/repo from the `origin` remote. Per-user state:
#   ~/.config/gac/hosts.json   { "bitbucket.org": { "type": "bitbucket", "email": "you@example.com" } }
#   macOS Keychain             service "gac-bitbucket:bitbucket.org", account $USER  (token)
#
# Tokens: an Atlassian API token with the Bitbucket scopes read:repository,
# read:pullrequest and write:pullrequest (sent with your Atlassian email), or a workspace /
# repository access token with pull request write access (no email; sent as a Bearer token).
#
# Commands:
#   setup                     prompts for your Atlassian email (blank for an access token)
#                             and the token (hidden), and saves them
#   default-branch            the repo's main branch
#   pr-create <base> <title> [body]   open a PR from the current branch; prints "<number> <url>"
#   pr-checks <number>        success | pending | failure | none  (none = no builds reported)
#   pr-approvals <number>     how many reviewers approved the PR
#   pr-merge <number>         merge commit + delete the branch; prints "merged"
set -euo pipefail

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/remote.sh"

API="https://api.bitbucket.org/2.0"
BB_HOST="bitbucket.org"   # one account for bitbucket.org, whichever host name the remote uses
SERVICE="gac-bitbucket:$BB_HOST"

api() { # api METHOD PATH [JSON]
  local tok email; tok=$(keychain_get "$SERVICE") || die "no Bitbucket token in the Keychain; run: bitbucket.sh setup"
  email=$(host_field email "$BB_HOST")
  local args=(-sS -X "$1" -H "Accept: application/json" -w '\n%{http_code}')
  if [[ -n "$email" ]]; then args+=(-u "$email:$tok"); else args+=(-H "Authorization: Bearer $tok"); fi
  [[ $# -ge 3 ]] && args+=(-H "Content-Type: application/json" -d "$3")
  local out code
  out=$(curl "${args[@]}" "$API$2") || die "request failed: $1 $2"
  code=${out##*$'\n'}; out=${out%$'\n'*}
  if [[ "$code" -ge 400 ]]; then die "$1 $2 -> HTTP $code: $(jq -r '.error.message // .' <<<"$out" 2>/dev/null || echo "$out")"; fi
  printf '%s' "$out"
}

cmd=${1:-}; shift || true
[[ -z "$cmd" || "$cmd" == -h || "$cmd" == --help ]] && usage

parse_remote
case "$HOST" in bitbucket.org|*.bitbucket.org) ;; *) die "origin isn't on bitbucket.org ($HOST)" ;; esac

case "$cmd" in
  setup)
    need_tty
    read -r -p "Atlassian account email (leave blank for a workspace/repository access token): " email
    host_set "$BB_HOST" "$(jq -n --arg e "$email" '{type: "bitbucket", email: $e}')"
    keychain_prompt "$SERVICE" "gac token (Bitbucket)" \
      "Bitbucket token (read:repository, read:pullrequest, write:pullrequest)"
    api GET "/repositories/$SLUG" >/dev/null && echo "Connected to $SLUG on Bitbucket." ;;

  default-branch)
    api GET "/repositories/$SLUG" | jq -r '.mainbranch.name' ;;

  pr-create)
    base=${1:?base}; title=${2:?title}; body=${3:-}
    head=$(git branch --show-current)
    api POST "/repositories/$SLUG/pullrequests" "$(jq -n --arg b "$base" --arg h "$head" --arg t "$title" --arg d "$body" \
      '{title:$t, description:$d, source:{branch:{name:$h}}, destination:{branch:{name:$b}}, close_source_branch:true}')" \
      | jq -r '"\(.id) \(.links.html.href)"' ;;

  pr-checks)
    n=${1:?number}
    api GET "/repositories/$SLUG/pullrequests/$n/statuses?pagelen=100" | jq -r '
      [.values[].state] as $s
      | if ($s | length) == 0 then "none"
        elif any($s[]; . == "FAILED" or . == "STOPPED") then "failure"
        elif any($s[]; . == "INPROGRESS") then "pending"
        else "success" end' ;;

  pr-approvals)
    n=${1:?number}
    api GET "/repositories/$SLUG/pullrequests/$n" | jq -r '[.participants[]? | select(.approved)] | length' ;;

  pr-merge)
    n=${1:?number}
    api POST "/repositories/$SLUG/pullrequests/$n/merge" '{"merge_strategy":"merge_commit","close_source_branch":true}' >/dev/null
    # A large merge can finish in the background; give it a moment before reporting.
    for _ in 1 2 3 4 5 6; do
      state=$(api GET "/repositories/$SLUG/pullrequests/$n" | jq -r '.state')
      [[ "$state" == MERGED ]] && { echo merged; exit 0; }
      sleep 5
    done
    echo "not merged (state: $state)" ;;

  *) usage ;;
esac
