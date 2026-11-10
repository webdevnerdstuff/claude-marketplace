#!/usr/bin/env bash
# detect-host.sh: which git host the repo in the current directory uses, from its `origin` remote.
#
# Prints one of:
#   github      github.com: use the gh CLI
#   bitbucket   bitbucket.org (Bitbucket Cloud): use bitbucket.sh
#   gitea       a Forgejo or Gitea server registered with gitea.sh setup: use gitea.sh
#   unknown     anything else, including a Forgejo/Gitea server that isn't registered yet
set -euo pipefail

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/remote.sh"

[[ "${1:-}" == -h || "${1:-}" == --help ]] && usage

parse_remote

case "$HOST" in
  github.com) echo github ;;
  bitbucket.org|*.bitbucket.org) echo bitbucket ;;
  *)
    case "$(host_field type)" in
      forgejo|gitea) echo gitea ;;
      *) echo unknown ;;
    esac ;;
esac
