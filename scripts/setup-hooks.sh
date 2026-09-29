#!/usr/bin/env sh
# One-time per clone: enable the versioned git hooks in .githooks/.
#
# Refuses to run unless this project is the ROOT of its own git repository, so it can never change the hook
# settings of an enclosing repository by accident. Run it after cloning:  npm run hooks
set -e

here=$(cd "$(dirname "$0")/.." && pwd -P)
top=$(git -C "$here" rev-parse --show-toplevel 2>/dev/null || true)

if [ -z "$top" ] || [ "$(cd "$top" && pwd -P)" != "$here" ]; then
  echo "Refusing: $here is not the root of its own git repository (git root: ${top:-none})." >&2
  echo "Clone or copy the project into its own repository first, then run this again." >&2
  exit 1
fi

chmod +x "$here/.githooks/pre-commit" "$here/.githooks/pre-push"
git -C "$here" config core.hooksPath .githooks
echo "git hooks enabled (core.hooksPath=.githooks)"
