#!/usr/bin/env bash
# Installs atl on this machine: dependencies, global binary, Claude Code skill.
#
# The skill is a **symlink** to the repo, not a copy: `git pull` is enough
# to update it, and it cannot drift from the CLI it documents.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
skills_dir="${HOME}/.claude/skills"
link="${skills_dir}/atl"

echo "→ dependencies"
npm install --silent

echo "→ global binary (npm link)"
npm link >/dev/null

echo "→ Claude Code skill"
mkdir -p "${skills_dir}"

if [ -L "${link}" ]; then
  current="$(readlink "${link}")"
  if [ "${current}" != "${repo}/skill" ]; then
    echo "   replacing an existing symlink that pointed at ${current}"
    rm "${link}"
  fi
elif [ -e "${link}" ]; then
  # A real directory there is not ours: leave it alone.
  echo "   ✗ ${link} exists and is not a symlink — move it by hand" >&2
  exit 1
fi

ln -sfn "${repo}/skill" "${link}"

echo
echo "✓ installed"
echo "  atl        → $(command -v atl || echo 'not found in PATH')"
echo "  skill      → ${link} -> ${repo}/skill"
echo
if [ ! -f "${XDG_CONFIG_HOME:-${HOME}/.config}/atl/config.json" ]; then
  echo "Left to do: run 'atl auth' (the Anytype application must be running)."
else
  echo "Config already in place: $(atl auth --status --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.space+' · '+(j.authenticated?'authenticated':'key needs a look'))})")"
fi
