#!/usr/bin/env python3
"""
Automated WDFW Freshwater Fishing Rules Scraper.
Scrapes official Washington eRegulations freshwater rules:
https://www.eregulations.com/washington/fishing/freshwater
Outputs structured JSON to src/data/wdfw_rules.json
"""

import sys
import os
import re
import json
import argparse
import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.eregulations.com/washington/fishing/"

RULE_PAGES = [
    "puget-sound-coastal-rivers-special-rules-a-c",
    "puget-sound-coastal-rivers-special-rules-d-k",
    "puget-sound-coastal-rivers-special-rules-l-r",
    "puget-sound-coastal-rivers-special-rules-s-z",
    "columbia-basin-rivers-special-rules-columbia-river",
    "columbia-basin-rivers-special-rules-a-c",
    "columbia-basin-rivers-special-rules-d-k",
    "columbia-basin-rivers-special-rules-l-n",
    "columbia-basin-rivers-special-rules-o-s",
    "columbia-basin-rivers-special-rules-t-z",
]

DEFAULT_MAJOR_RIVERS = [
    "Puyallup River", "Carbon River", "Green River", "Duwamish River",
    "Nisqually River", "Snohomish River", "Skykomish River", "Snoqualmie River",
    "Skagit River", "Stillaguamish River", "Cedar River", "Cowlitz River",
    "Kalama River", "Lewis River", "Yakima River", "Columbia River",
    "Hoh River", "Bogachiel River", "Chehalis River", "Satsop River",
    "Wynoochee River", "Samish River", "Nooksack River", "Deschutes River"
]

DAYS_MAP = {
    'SUN': 'Sunday', 'SUNDAY': 'Sunday', 'SUNDAYS': 'Sunday',
    'MON': 'Monday', 'MONDAY': 'Monday', 'MONDAYS': 'Monday',
    'TUE': 'Tuesday', 'TUES': 'Tuesday', 'TUESDAY': 'Tuesday', 'TUESDAYS': 'Tuesday',
    'WED': 'Wednesday', 'WEDNESDAY': 'Wednesday', 'WEDNESDAYS': 'Wednesday',
    'THU': 'Thursday', 'THUR': 'Thursday', 'THURS': 'Thursday', 'THURSDAY': 'Thursday', 'THURSDAYS': 'Thursday',
    'FRI': 'Friday', 'FRIDAY': 'Friday', 'FRIDAYS': 'Friday',
    'SAT': 'Saturday', 'SATURDAY': 'Saturday', 'SATURDAYS': 'Saturday',
}

def clean_text(text):
    if not text:
        return ""
    return re.sub(r'\s+', ' ', text).strip()

def extract_weekly_closures(rule_text, date_text):
    closures = []
    match = re.search(r'CLOSED\s+([A-Za-z\s,\.and]+)', rule_text, re.IGNORECASE)
    if match:
        raw_days = match.group(1)
        found_days = []
        for word in re.findall(r'[A-Za-z]+', raw_days):
            w_up = word.upper().rstrip('S')
            for k, day in DAYS_MAP.items():
                if k == word.upper() or k == w_up:
                    if day not in found_days:
                        found_days.append(day)
        if found_days:
            closures.append({
                "days": found_days,
                "date_range": clean_text(date_text),
                "description": clean_text(rule_text)
            })
    return closures

def parse_rules_from_page(html_text, target_rivers=None):
    soup = BeautifulSoup(html_text, 'html.parser')
    cd = soup.find('div', class_='content-designer')
    if not cd:
        return {}
    tbl = cd.find('table')
    if not tbl:
        return {}

    rows = tbl.find_all('tr')
    results = {}
    current_river = None
    current_river_key = None
    current_zone = None
    last_species = None

    for row in rows:
        h_span = row.find(class_=lambda c: c and 'BoW-Name' in c)
        if h_span:
            raw_title = clean_text(h_span.get_text())
            if raw_title.upper() in ['SPECIES', 'DATE', 'ADDITIONAL RULES']:
                continue
            
            clean_name = raw_title.title().replace("'S", "'s")
            
            if target_rivers:
                matched = False
                c_clean = clean_name.lower()
                for t in target_rivers:
                    t_clean = t.lower().replace(" river", "").replace(" creek", "").strip()
                    if t.lower() in c_clean or (len(t_clean) >= 4 and t_clean in c_clean):
                        matched = True
                        break
                if not matched:
                    current_river = None
                    current_zone = None
                    continue

            current_river_key = clean_name
            current_river = {
                "Zones": []
            }
            results[current_river_key] = current_river
            current_zone = None
            last_species = None
            continue

        if not current_river:
            continue

        cols = row.find_all(['td', 'th'])
        if len(cols) == 1 and cols[0].get('colspan') == '3':
            zone_desc = clean_text(cols[0].get_text())
            if not zone_desc or ('CRC' in zone_desc and len(zone_desc) < 15):
                continue
            
            is_closed = 'CLOSED WATERS' in zone_desc.upper()
            current_zone = {
                "zone_name": zone_desc,
                "description": zone_desc,
                "is_closed_waters": is_closed,
                "weekly_closures": [],
                "seasons": [],
                "additional_rules": []
            }
            current_river["Zones"].append(current_zone)
            last_species = None
            continue

        if len(cols) >= 2:
            if len(cols) == 3:
                species = clean_text(cols[0].get_text())
                dates = clean_text(cols[1].get_text())
                rules = clean_text(cols[2].get_text())
                if species:
                    last_species = species
            else:
                species = last_species or "All species"
                dates = clean_text(cols[0].get_text())
                rules = clean_text(cols[1].get_text())

            if not current_zone:
                current_zone = {
                    "zone_name": "Mainstem / Entire River",
                    "description": "Mainstem / Entire River",
                    "is_closed_waters": False,
                    "weekly_closures": [],
                    "seasons": [],
                    "additional_rules": []
                }
                current_river["Zones"].append(current_zone)

            if 'CLOSED WATERS' in rules.upper() or 'CLOSED WATERS' in dates.upper():
                current_zone["is_closed_waters"] = True

            w_closures = extract_weekly_closures(rules, dates)
            if w_closures:
                current_zone["weekly_closures"].extend(w_closures)

            if species:
                current_zone["seasons"].append({
                    "species": species,
                    "date_range": dates,
                    "rules": rules
                })

            if rules and not w_closures and rules not in current_zone["additional_rules"]:
                current_zone["additional_rules"].append(rules)

    return results

def scrape_wdfw(target_rivers=None, output_path="src/data/wdfw_rules.json"):
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    
    all_rules = {}
    print("Starting WDFW freshwater rules scraper...")
    if target_rivers:
        print(f"Filtering for {len(target_rivers)} target waterbodies")
    else:
        print("Scraping all major Washington river systems...")

    for page_slug in RULE_PAGES:
        url = BASE_URL + page_slug
        print(f"Fetching: {page_slug} ...")
        try:
            resp = requests.get(url, headers=headers, timeout=20)
            resp.encoding = 'utf-8'
            if resp.status_code == 200:
                page_rules = parse_rules_from_page(resp.text, target_rivers)
                print(f"  -> Extracted {len(page_rules)} rivers")
                for r_name, r_data in page_rules.items():
                    if r_name == "Green (Duwamish) River":
                        all_rules["Green River"] = r_data
                        all_rules[r_name] = r_data
                    elif r_name == "Green River" and "Green River" in all_rules:
                        all_rules["Green River (Cowlitz Co.)"] = r_data
                    else:
                        all_rules[r_name] = r_data
            else:
                print(f"  -> HTTP {resp.status_code} for {page_slug}")
        except Exception as e:
            print(f"  -> Error fetching {page_slug}: {e}")

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(all_rules, f, indent=2)

    print(f"\nSuccessfully wrote {len(all_rules)} river rules to: {output_path}")
    return all_rules

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Scrape WDFW Freshwater Fishing Rules")
    parser.add_argument("--rivers", nargs="+", help="Specific river names to scrape (e.g. Puyallup Green Nisqually)")
    parser.add_argument("--all", action="store_true", help="Scrape all available waterbodies on eRegulations")
    parser.add_argument("--output", default="src/data/wdfw_rules.json", help="Output JSON path")
    args = parser.parse_args()

    targets = None
    if args.rivers:
        targets = args.rivers
    elif not args.all:
        targets = DEFAULT_MAJOR_RIVERS

    scrape_wdfw(targets, args.output)

