#!/bin/zsh
set -eu
cd -- "${0:A:h}"

# Finder does not always inherit the same Node path as an interactive terminal.
for passage_node in "$(command -v node || true)" "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"; do
  if [[ -n "$passage_node" && -x "$passage_node" ]] && "$passage_node" -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 13) ? 0 : 1)' 2>/dev/null; then
    if "$passage_node" --env-file-if-exists=.env server.mjs --open-firefox; then
      exit 0
    else
      passage_exit=$?
      if [[ -t 0 ]]; then read '?Press Return to close this message.'; fi
      exit "$passage_exit"
    fi
  fi
done

print 'Passage needs Node.js 22.13 or later. Install it, then double-click this launcher again.'
read '?Press Return to close.'
