#!/usr/bin/env bash
# Curl the running dev server's water report and print only the keys this phase
# cares about. Usage: ./scripts/smoke.sh [site]  (default 12101500)
# Requires a dev server already running (scripts/dev_server.py 8000 &).
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-8000}"
SITE="${1:-12101500}"
curl -s "http://127.0.0.1:${PORT}/api/water_report?site=${SITE}" \
  | python3 -c '
import json, sys
d = json.load(sys.stdin)
r = d[0]
keys = ["cfs","gage","flow_idx","transit_time","transit_state","push_status","is_netting","net_status","pressure","rain","lunar_icon","species_calendar","tide_points","water_temp_f","turbidity_fnu"]
print("site:", r.get("site_id"), r.get("site_name"))
print("is_netting:", r.get("is_netting"), "| net_status:", r.get("net_status"))
print("transit:", r.get("transit_time"), r.get("transit_state"))
print("days:", len(d), "| first:", d[0].get("title"), "| tide_points:", len(r.get("tide_points") or []))
'
