#!/usr/bin/env bash
# One-shot verification wrapper. Usage:
#   ./scripts/check.sh        # full gate: syntax + sanity pass (network)
#   ./scripts/check.sh --quick  # syntax + static only (~1s, no server/network)
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== syntax =="
find src -name '*.js' -print0 | xargs -0 -n1 node --check
node --check sw.js
node --check sanity_pass.js
python3 -m py_compile api/water_report.py scripts/dev_server.py scripts/scrape_wdfw.py scripts/refresh_wdfw_forecast.py
echo "syntax OK"

if [[ "${1:-}" == "--quick" ]]; then
  echo "quick mode: skipping sanity pass (network)"
  exit 0
fi

echo "== sanity pass =="
node sanity_pass.js --quiet
