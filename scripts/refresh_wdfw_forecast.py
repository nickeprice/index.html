#!/usr/bin/env python3
"""
refresh_wdfw_forecast.py — WDFW annual salmon forecast hybrid scraper.

Fetches the STABLE index page (https://wdfw.wa.gov/fishing/management/north-falcon/forecasts),
resolves the current-year "Chinook forecasts" + "coho forecast" PDF hrefs (the
URLs change every year; the index is the stable anchor), downloads the PDFs,
and attempts stdlib-only text extraction to surface the candidate Puyallup
number. Because these PDFs ship as vector-graphic tables (no text layer) and
this repo deliberately has NO third-party PDF library, the script DEGRADES
HONESTLY: it prints the resolved source URLs + a human hint and NEVER writes
an unverified number.

Usage:
    python3 scripts/refresh_wdfw_forecast.py            # resolve + print, no write
    python3 scripts/refresh_wdfw_forecast.py --confirm  # write only CONFIRMED numbers

Contract (AGENTS.md no-fabricate):
  - `--confirm` writes a number ONLY when the human has verified it and passes
    it via --chinook=NNNN / --coho=NNNN (or edits the JSON by hand). The scraper
    never invents a figure from PDF geometry.
  - Without explicit confirmed numbers the JSON keeps `forecast: null` / `--`.
"""

import argparse
import json
import os
import re
import ssl
import sys
import urllib.request
import zlib

# Matches api/water_report.py's fetch pattern: public USGS/NOAA/WDFW data over
# HTTPS with an unverified context (local python often lacks the CA bundle).
SSL_CONTEXT = ssl._create_unverified_context()

INDEX_URL = "https://wdfw.wa.gov/fishing/management/north-falcon/forecasts"
JSON_PATH = os.path.join(os.path.dirname(__file__), "..", "src", "data", "wdfw_forecasts.json")
USER_AGENT = "Mozilla/5.0 (Puyallup-River-Companion; contact via wdfw.wa.gov)"
FORECAST_YEAR = 2026


def http_get(url, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=20, context=SSL_CONTEXT) as res:
        return res.read()


def resolve_index_links(html):
    """Return { 'chinook': href, 'coho': href } for the CURRENT-year PDFs."""
    links = {}
    for m in re.finditer(r'<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>', html, re.S):
        href, text = m.group(1), m.group(2)
        flat = re.sub(r'<[^>]+>', '', text).replace('&amp;', '&').strip()
        if str(FORECAST_YEAR) not in flat:
            continue  # only current-year items
        if 'coho forecast' in flat.lower() and 'coho' not in links:
            links['coho'] = href
        elif 'chinook forecast' in flat.lower() and 'chinook' not in links:
            links['chinook'] = href
    return links


def pdf_text_stdlib(pdf_bytes):
    """Best-effort decompress of FlateDecode streams via stdlib zlib."""
    chunks = []
    for m in re.finditer(rb'stream\r?\n(.*?)\r?\nendstream', pdf_bytes, re.S):
        blob = m.group(1)
        for wbits in (-15, 15, 47):
            try:
                chunks.append(zlib.decompress(blob, wbits).decode('latin-1'))
                break
            except Exception:
                continue
    return '\n'.join(chunks)


def find_candidate(text, term):
    """Return the text near a term — the human verifies this, never auto-write."""
    hits = [ln for ln in text.splitlines() if term.lower() in ln.lower()]
    return hits[:5]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--confirm', action='store_true',
                    help='write forecasts into wdfw_forecasts.json (only with --chinook/--coho)')
    ap.add_argument('--chinook', type=int, help='HUMAN-CONFIRMED Puyallup Chinook forecast')
    ap.add_argument('--coho', type=int, help='HUMAN-CONFIRMED Puyallup Coho forecast')
    ap.add_argument('--yes', action='store_true',
                    help='double-confirm: acknowledge you are writing HUMAN-VERIFIED numbers')
    args = ap.parse_args()

    print(f'== WDFW {FORECAST_YEAR} forecast resolver ==')
    try:
        html = http_get(INDEX_URL).decode('utf-8', errors='replace')
    except Exception as e:
        print(f'!! Could not fetch index {INDEX_URL}: {e}')
        sys.exit(1)

    links = resolve_index_links(html)
    print('Resolved current-year links:')
    for kind in ('chinook', 'coho'):
        href = links.get(kind)
        if not href:
            print(f'  {kind}: NOT FOUND on index page')
            continue
        full = href if href.startswith('http') else 'https://wdfw.wa.gov' + href
        print(f'  {kind}: {full}')

    # Download + attempt extraction (never writes).
    for kind in ('chinook', 'coho'):
        href = links.get(kind)
        if not href:
            continue
        full = href if href.startswith('http') else 'https://wdfw.wa.gov' + href
        try:
            pdf = http_get(full, binary=True)
            print(f'\n-- {kind} PDF: {len(pdf)} bytes --')
        except Exception as e:
            print(f'!! {kind} download failed: {e}')
            continue
        text = pdf_text_stdlib(pdf)
        if text.strip():
            cand = find_candidate(text, 'Puyallup')
            if cand:
                print('  Candidate lines near "Puyallup" (HUMAN VERIFY):')
                for ln in cand[:5]:
                    print('   ', ln)
            else:
                print('  Text layer found but no "Puyallup" line — check the PDF by hand.')
        else:
            print('  NOTE: no extractable text layer (vector-graphic tables).')
            print('  Open the PDF manually (link above) and confirm the Puyallup')
            print('  number before writing anything. Nothing was written.')

    # Write path: ONLY with explicit human-confirmed numbers AND --yes.
    if args.confirm:
        if not args.yes:
            print('\n!! --confirm requires --yes (safety: write HUMAN-VERIFIED numbers only).')
            print('   Nothing written.')
            sys.exit(1)
        if args.chinook is None and args.coho is None:
            print('\n!! --confirm requires --chinook=NNNN and/or --coho=NNNN (the HUMAN-confirmed numbers).')
            print('   Nothing written.')
            sys.exit(1)
        with open(JSON_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
        confirmed = {'Puyallup Chinook': args.chinook, 'Puyallup Coho': args.coho}
        changed = False
        for stock in data['stocks']:
            name = stock['stock']
            if name in confirmed and confirmed[name] is not None:
                href = links.get('chinook' if 'Chinook' in name else 'coho')
                stock['forecast'] = confirmed[name]
                stock['source_url'] = ('https://wdfw.wa.gov' + href) if href and not href.startswith('http') else href
                stock['year'] = FORECAST_YEAR
                changed = True
        with open(JSON_PATH, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
            f.write('\n')
        print(f'\nWrote confirmed forecasts to {JSON_PATH}')
        if not changed:
            print('(no matching stock keys were updated)')
    else:
        print('\nNo --confirm: nothing written. "../src/data/wdfw_forecasts.json" stays null (UI "--").')


if __name__ == '__main__':
    main()

