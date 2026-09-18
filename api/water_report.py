import json
import math
import urllib.request
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import ssl

SSL_CONTEXT = ssl._create_unverified_context()

USGS_SITE = "12101500"   
NOAA_STATION = "9446484" 
LAT, LON = 47.1950, -122.3020 

STOCK_BASELINES = {
    "Chinook": {"peak_window": (8, 1, 9, 30), "peak_date": "09-10", "avg_run": 34000, "present": True},
    "Coho":    {"peak_window": (8, 25, 11, 15), "peak_date": "10-05", "avg_run": 48000, "present": True},
    "Pink":    {"peak_window": (8, 1, 9, 15), "peak_date": "08-20", "avg_run": 150000, "present": False}
}
NETTING_DAYS = [6, 0, 1] 
FORECAST_DAYS = 4 

def mm_to_in(mm): return mm / 25.4
def hpa_to_inhg(hpa): return hpa * 0.02953

def fetch_usgs_telemetry(site_id=USGS_SITE):
    # Puyallup River defaults strictly to USGS 12101500 (Puyallup River at Puyallup)
    if not site_id or site_id == "12096500":
        site_id = USGS_SITE

    url = f"https://waterservices.usgs.gov/nwis/iv/?format=json&sites={site_id}&parameterCd=00060,00065&siteStatus=all"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    default_name = "Puyallup River at Puyallup, WA" if site_id == USGS_SITE else f"USGS Station {site_id}"
    data_dict = {"site_name": default_name, "cfs": None, "gage": None, "is_active": False, "updated_time": "Updated: Telemetry Offline", "api_offline": True}
    try:
        with urllib.request.urlopen(req, timeout=8, context=SSL_CONTEXT) as response:
            try:
                raw = response.read().decode('utf-8')
            except Exception as e:
                raw = getattr(e, 'partial', b'').decode('utf-8', errors='ignore')
            data = json.loads(raw)
            time_series = data.get('value', {}).get('timeSeries', [])
            if not time_series:
                return data_dict
            
            site_raw = time_series[0]['sourceInfo']['siteName']
            if site_raw.isupper():
                parts = site_raw.title().rsplit(', ', 1)
                if len(parts) == 2 and len(parts[1]) == 2:
                    formatted_name = f"{parts[0]}, {parts[1].upper()}"
                else:
                    formatted_name = site_raw.title()
                data_dict["site_name"] = formatted_name.replace(" At ", " at ").replace(" Near ", " near ")
            else:
                data_dict["site_name"] = site_raw
            
            # Live response parsed — clear the offline fallback so the frontend
            # can tell "USGS unreachable" apart from "station seasonal".
            data_dict["api_offline"] = False

            has_fresh_discharge_or_gage = False
            latest_time = None
            latest_dt_str = ""
            latest_cfs_time = None
            latest_gage_time = None

            for ts in time_series:
                param_code = ts['variable']['variableCode'][0]['value']
                try:
                    records = ts['values'][0]['value']
                    if not records:
                        continue
                    
                    # Ensure the latest timeValue selected is the most recent record from the timeseries
                    records_sorted = sorted(records, key=lambda x: datetime.fromisoformat(x['dateTime']), reverse=True)
                    latest_record = records_sorted[0]
                    
                    val_str = latest_record['value']
                    dt_str = latest_record['dateTime']
                    
                    # Numerical Value Check (disregard missing/error values like -999999)
                    val = float(val_str)
                    if val < -900000:
                        continue
                    
                    # 24-Hour Freshness Check
                    reading_dt = datetime.fromisoformat(dt_str)
                    from datetime import timezone
                    now_aware = datetime.now(timezone.utc)
                    age_seconds = (now_aware - reading_dt).total_seconds()
                    
                    if age_seconds <= 24 * 3600:
                        if param_code in ["00060", "00065"]:
                            has_fresh_discharge_or_gage = True
                        if latest_time is None or reading_dt > latest_time:
                            latest_time = reading_dt
                            latest_dt_str = dt_str
                            
                        # Parameter 00060 = Discharge (CFS), Parameter 00065 = Gage Height (ft)
                        if param_code == "00060":
                            if latest_cfs_time is None or reading_dt >= latest_cfs_time:
                                latest_cfs_time = reading_dt
                                data_dict["cfs"] = val
                        elif param_code == "00065":
                            if latest_gage_time is None or reading_dt >= latest_gage_time:
                                latest_gage_time = reading_dt
                                data_dict["gage"] = val
                except:
                    continue

            if has_fresh_discharge_or_gage and latest_time:
                data_dict["is_active"] = True
                day_prefix = "Today at "
                if latest_time.date() != datetime.now().date():
                    day_prefix = latest_time.strftime("%A at ")
                tz_name = "PDT" if "-07:00" in latest_dt_str else "PST" if "-08:00" in latest_dt_str else "Local"
                time_str = latest_time.strftime("%-I:%M %p")
                data_dict["updated_time"] = f"Updated: {day_prefix}{time_str} {tz_name}"
    except:
        pass

    return data_dict

def fetch_noaa_tides_bulletproof(start_date, days):
    fetch_start = start_date - timedelta(days=2)
    date_str = fetch_start.strftime('%Y%m%d')
    total_hours = (days + 2) * 24
    url = f"https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?begin_date={date_str}&range={total_hours}&station={NOAA_STATION}&product=predictions&datum=MLLW&time_zone=lst_ldt&units=english&format=json"
    curve, extremes = [], []
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5, context=SSL_CONTEXT) as res:
            for item in json.loads(res.read().decode('utf-8')).get('predictions', []):
                curve.append({"dt": datetime.strptime(item['t'], "%Y-%m-%d %H:%M"), "height": float(item['v'])})
    except: pass

    if len(curve) > 60:
        for i in range(30, len(curve) - 30):
            pt = curve[i]
            window = [c['height'] for c in curve[i-25:i+26]]
            if pt['height'] == max(window):
                if not extremes or (pt['dt'] - extremes[-1]['dt']).total_seconds() > 3600*3:
                    extremes.append({'type': 'H', 'dt': pt['dt'], 'height': pt['height']})
            elif pt['height'] == min(window):
                if not extremes or (pt['dt'] - extremes[-1]['dt']).total_seconds() > 3600*3:
                    extremes.append({'type': 'L', 'dt': pt['dt'], 'height': pt['height']})
    return curve, extremes

def fetch_meteorological_data(lat=LAT, lon=LON):
    meteo_url = (f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
                 f"&daily=sunrise,sunset,moonrise,moonset,cloudcover_mean,precipitation_sum"
                 f"&hourly=surface_pressure&timezone=America%2FLos_Angeles")
    req = urllib.request.Request(meteo_url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=5, context=SSL_CONTEXT) as res:
            return json.loads(res.read().decode('utf-8'))
    except: return None

def calculate_escapement_curve(target_date):
    active_stocks, base_score = [], 10.0
    for species, meta in STOCK_BASELINES.items():
        if not meta.get("present", True): continue
        sm, sd, em, ed = meta["peak_window"]
        s_dt, e_dt = datetime(target_date.year, sm, sd), datetime(target_date.year, em, ed)
        if s_dt <= target_date <= e_dt:
            pm, pd = map(int, meta["peak_date"].split("-"))
            peak_dt = datetime(target_date.year, pm, pd)
            days_from_peak = abs((target_date - peak_dt).days)
            curve_mult = math.exp(-0.5 * (days_from_peak / 14.0) ** 2) 
            daily_fish = int(meta["avg_run"] * curve_mult * 0.04)
            active_stocks.append(f"<b>{species}</b> (~{daily_fish:,} entering)")
            score = 8.0 + (17.0 * curve_mult)
            if score > base_score: base_score = score
    return " &bull; ".join(active_stocks) if active_stocks else "Resident / Pre-Run", base_score


def build_species_calendar(target_date):
    """Per-species run calendar for the current day.

    For each modeled stock returns:
      - window_start / window_end (peak window)
      - peak_date
      - days_until_peak (negative if past, 0 at peak)
      - position: 'pre' / 'peak' / 'post' / 'off'
      - status_text for the UI
    """
    out = []
    for species, meta in STOCK_BASELINES.items():
        sm, sd, em, ed = meta["peak_window"]
        pm, pd = map(int, meta["peak_date"].split("-"))
        start = datetime(target_date.year, sm, sd)
        end = datetime(target_date.year, em, ed)
        peak = datetime(target_date.year, pm, pd)
        in_window = start <= target_date <= end
        days_until_peak = (peak - target_date).days
        if in_window:
            if days_until_peak == 0:
                position, status_text = "peak", "AT PEAK"
            elif days_until_peak < 0:
                position = "post"
                status_text = "PAST PEAK" if days_until_peak < -14 else "TAPERING"
            else:
                position = "pre"
                status_text = "BUILDING" if days_until_peak > 14 else "APPROACHING"
        else:
            position = "off"
            status_text = "NO PEAK PERIOD"
            if target_date < start:
                status_text = "SEASON AHEAD"
            elif target_date > end:
                status_text = "SEASON OVER"
        out.append({
            "species": species,
            "window_start": start.strftime("%b %d"),
            "window_end": end.strftime("%b %d"),
            "peak_date": f"{pm:02d}-{pd:02d}",
            "days_until_peak": days_until_peak,
            "position": position,
            "status_text": status_text
        })
    return out

def calculate_transit_time_and_flow(cfs, is_netting_day):
    dist_miles = 6.0 
    if cfs is None:
        flow_idx = 50
        base_speed = 0.50
    elif cfs < 800: flow_idx = max(1, int((cfs / 800) * 15)); base_speed = 0.10
    elif cfs <= 1700: progress = (cfs - 800) / 900; flow_idx = int(15 + (progress * 80)); base_speed = 0.10 + (progress * 0.90) 
    elif cfs <= 2400: progress = (cfs - 1700) / 700; flow_idx = int(95 + (progress * 5)); base_speed = 1.00 + (progress * 0.20) 
    elif cfs <= 3200: progress = (cfs - 2400) / 800; flow_idx = int(100 - (progress * 40)); base_speed = 1.20 - (progress * 0.55) 
    else: flow_idx = max(1, int(60 - ((cfs - 3200) / 1000) * 50)); base_speed = max(0.10, 0.65 - ((cfs - 3200)/1000) * 0.45)
        
    actual_speed = base_speed
    if is_netting_day:
        actual_speed = 0.01 
        state = "RIVER CORKED (Nets In)"
        flow_idx = int(flow_idx * 0.1) 
    elif flow_idx >= 80: state = "High Velocity Push"
    elif flow_idx >= 50: state = "Steady Migration"
    elif cfs is not None and cfs < 1300: state = "Bay Staging / Slow Push"
    else: state = "Bank Hugging / Resistance"
    
    hrs = dist_miles / max(actual_speed, 0.01) 
    time_str = "BLOCKED" if is_netting_day else "48+ hrs" if hrs > 48 else f"{int(hrs)} to {int(hrs)+2} hrs"
    return time_str, state, flow_idx, hrs

def simulate_fish_transit(spawn_time, tide_curve, cfs):
    if not tide_curve or not spawn_time: return None
    dist, curr_dt, step_hrs = 0.0, spawn_time, 0.25
    base = 0.5 if (cfs is not None and 1100 <= cfs <= 2800) else 0.2
    while dist < 6.0:
        closest = min(tide_curve, key=lambda x: abs((x['dt'] - curr_dt).total_seconds()))
        future = min(tide_curve, key=lambda x: abs((x['dt'] - (curr_dt + timedelta(hours=1))).total_seconds()))
        if future['height'] > closest['height']: speed = base * 1.8  
        elif future['height'] < closest['height']: speed = base * 0.3  
        else: speed = base
        if closest['height'] < 4.0: speed = base * 0.1 
        dist += speed * step_hrs
        curr_dt += timedelta(hours=step_hrs)
        if (curr_dt - spawn_time).total_seconds() > 96 * 3600: return None
    return curr_dt
    return curr_dt

def calculate_macro_environment(flow_idx, press_curr_inHg, press_prev_inHg, rain_in, lunar_phase, is_netting):
    env_score, conditions = 0.0, []
    net_mult = 0.15 if is_netting else 1.00
    flow_mult = (flow_idx / 100.0) * net_mult
    delta_inHg = press_curr_inHg - press_prev_inHg
    if delta_inHg <= -0.04:
        env_score += min(12, abs(delta_inHg * 100) * 1.2); conditions.append(f"Pressure Drop ({delta_inHg:+.2f} inHg)")
    elif delta_inHg >= 0.04:
        env_score -= min(15, (delta_inHg * 100) * 1.5); conditions.append(f"Pressure Rise (Lockjaw)")
    if rain_in > 0.05:
        env_score += min(8, math.log1p(rain_in * 25.4) * 2.5); conditions.append(f"Rain Freshet")
    if 0.45 <= lunar_phase <= 0.55:
        env_score -= 8; conditions.append("Full Moon Penalty")
    elif lunar_phase < 0.1 or lunar_phase > 0.9:
        env_score += 6; conditions.append("Spring Tide Pulses")
    return env_score, flow_mult, " + ".join(conditions) if conditions else "Stable"

def build_dynamic_timeline(lines_in, lines_out, sunrise_dt, sunset_dt, cloud_pct, arrivals, base_score, env_score, flow_mult, day_mult):
    current_time = lines_in
    timeline = []
    # Cloud pays once: env_score already carries the all-day Overcast bonus, so the
    # twilight UV/shade bonus is halved to avoid a +16 double count on cloudy dawns.
    uv_bonus = (cloud_pct / 100.0) * 4.0 
    # Symmetric twilight windows (both scale gently with cloud; dawn keeps a small
    # edge for the morning-bite bias in this basin).
    twilight_min = int(45 + cloud_pct * 0.2)
    dawn_end = sunrise_dt + timedelta(minutes=twilight_min)
    dusk_start = sunset_dt - timedelta(minutes=twilight_min)
    # Twilight feels pressure at sqrt strength: light still dominates, but a
    # brutal high-pressure day knocks ~10 pts off dawn/dusk instead of 0.
    day_mult_root = math.sqrt(day_mult) if day_mult and day_mult > 0 else 1.0
    
    while current_time <= lines_out:
        minute_score = 25.0 + base_score + env_score
        triggers = []
        in_twilight = False
        if lines_in <= current_time <= dawn_end:
            minute_score += 19.5 + uv_bonus; triggers.append(f"Dawn Light / UV Shield")
            in_twilight = True
        elif dusk_start <= current_time <= lines_out:
            minute_score += 18.5 + uv_bonus; triggers.append("Dusk / Bank Shadow")
            in_twilight = True
        else:
            triggers.append("Mid-Day Stable")
            
        for arr in arrivals:
            if arr["dt"] - timedelta(minutes=75) <= current_time <= arr["dt"] + timedelta(minutes=75):
                swing_pts = min(20.0, max(0.0, (arr["swing"] - 5.0) * 2.5)) + uv_bonus
                minute_score += swing_pts; triggers.append(f"Tide Arrival ({arr['swing']:.1f}ft Push)")
                
        final_score = minute_score * flow_mult
        if in_twilight:
            final_score *= day_mult_root
        else:
            final_score *= day_mult
            if day_mult < 1.0 and triggers and "Mid-Day" in triggers[0]: triggers[0] = "High Pressure Traffic"
                
        timeline.append({"time": current_time, "score": int(max(5, min(100, final_score))), "trigger": " + ".join(triggers)})
        current_time += timedelta(minutes=1)
        
    windows = []
    if not timeline: return windows
    start_time, curr_score, curr_trig = timeline[0]["time"], timeline[0]["score"], timeline[0]["trigger"]
    
    for i in range(1, len(timeline)):
        if timeline[i]["trigger"] != curr_trig or abs(timeline[i]["score"] - curr_score) > 3:
            windows.append({"start": start_time.isoformat(), "end": timeline[i-1]["time"].isoformat(), "score": curr_score, "triggers": curr_trig, "start_str": start_time.strftime('%-I:%M %p'), "end_str": timeline[i-1]["time"].strftime('%-I:%M %p')})
            start_time, curr_score, curr_trig = timeline[i]["time"], timeline[i]["score"], timeline[i]["trigger"]
            
    windows.append({"start": start_time.isoformat(), "end": timeline[-1]["time"].isoformat(), "score": curr_score, "triggers": curr_trig, "start_str": start_time.strftime('%-I:%M %p'), "end_str": timeline[-1]["time"].strftime('%-I:%M %p')})
    return windows

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        now = datetime.now()
        qs = parse_qs(urlparse(self.path).query)
        site = qs.get('site', [USGS_SITE])[0]
        if not site or site == "12096500":
            site = USGS_SITE
        try:
            req_lat = float(qs.get('lat', [str(LAT)])[0])
            req_lon = float(qs.get('lon', [str(LON)])[0])
        except:
            req_lat, req_lon = LAT, LON

        forecast_dates = [now + timedelta(days=d) for d in range(FORECAST_DAYS)]
        usgs_data = fetch_usgs_telemetry(site) 
        met_data = fetch_meteorological_data(req_lat, req_lon)
        all_tides_curve, all_tides_extremes = fetch_noaa_tides_bulletproof(now, FORECAST_DAYS)

        arrivals = []
        if all_tides_curve and all_tides_extremes:
            for ext in all_tides_extremes:
                if ext["type"] == "H" and ext["height"] >= 8.0:
                    prev_low = ext["height"]
                    for t in reversed(all_tides_extremes):
                        if t["dt"] < ext["dt"] and t["type"] == "L":
                            prev_low = t["height"]; break
                    swing = ext["height"] - prev_low
                    arr_dt = simulate_fish_transit(ext["dt"], all_tides_curve, usgs_data["cfs"])
                    if arr_dt: arrivals.append({"dt": arr_dt, "swing": swing})

        reports = []
        prev_upper = None
        for i, dt in enumerate(forecast_dates):
            day_extremes = [t for t in all_tides_extremes if t["dt"].date() == dt.date()]
            known_new = datetime(2000, 1, 6)
            days_since = (dt - known_new).days + (dt - known_new).seconds / 86400.0
            lunar_val = (days_since % 29.530588853) / 29.530588853
            
            if lunar_val < 0.05 or lunar_val > 0.95: lunar_icon = "🌑 New Moon"
            elif lunar_val < 0.20: lunar_icon = "🌒 Waxing Crescent"
            elif lunar_val < 0.30: lunar_icon = "🌓 First Quarter"
            elif lunar_val < 0.45: lunar_icon = "🌔 Waxing Gibbous"
            elif lunar_val < 0.55: lunar_icon = "🌕 Full Moon"
            elif lunar_val < 0.70: lunar_icon = "🌖 Waning Gibbous"
            elif lunar_val < 0.80: lunar_icon = "🌗 Last Quarter"
            else: lunar_icon = "🌘 Waning Crescent"
            
            sunrise_dt, sunset_dt = dt.replace(hour=6, minute=35), dt.replace(hour=19, minute=30)
            moonrise_str, moonset_str = None, None
            cloud_pct, rain_mm, press_curr_hpa, press_prev_hpa = 50, 0.0, 1013.25, 1013.25
            
            if met_data and 'daily' in met_data and 'hourly' in met_data:
                try:
                    sunrise_dt = datetime.fromisoformat(met_data['daily']['sunrise'][i])
                    sunset_dt = datetime.fromisoformat(met_data['daily']['sunset'][i])
                    moonrise_str = met_data['daily']['moonrise'][i] if 'moonrise' in met_data['daily'] else None
                    moonset_str = met_data['daily']['moonset'][i] if 'moonset' in met_data['daily'] else None
                    cloud_pct = met_data['daily']['cloudcover_mean'][i]
                    rain_mm = met_data['daily']['precipitation_sum'][i]
                    time_arr = met_data['hourly']['time']
                    
                    # OVERHAUL: Dynamic 6-Hour Rolling Pressure Window
                    target_now = dt.strftime('%Y-%m-%dT%H:00')
                    target_minus6 = (dt - timedelta(hours=6)).strftime('%Y-%m-%dT%H:00')
                    
                    if target_now in time_arr: press_curr_hpa = met_data['hourly']['surface_pressure'][time_arr.index(target_now)]
                    if target_minus6 in time_arr: press_prev_hpa = met_data['hourly']['surface_pressure'][time_arr.index(target_minus6)]
                except: pass

            rain_in = mm_to_in(rain_mm)
            press_curr_inHg, press_prev_inHg = hpa_to_inhg(press_curr_hpa), hpa_to_inhg(press_prev_hpa)

            is_netting_day = dt.weekday() in NETTING_DAYS
            net_status = "NETS IN (Severe Migration Block)" if is_netting_day else "River Open (Nets Out)"
            angler_desc, angler_mult = ("High (Weekend)", 0.80) if dt.weekday() in [5, 6] else ("Low/Moderate (Weekday)", 1.0)
            
            transit_time, transit_state, flow_index, transit_hrs = calculate_transit_time_and_flow(usgs_data["cfs"], is_netting_day)
            active_str, stock_base = calculate_escapement_curve(dt)
            env_score, flow_mult, push_status = calculate_macro_environment(flow_index, press_curr_inHg, press_prev_inHg, rain_in, lunar_val, is_netting_day)
            
            civil_in, civil_out = sunrise_dt - timedelta(minutes=35), sunset_dt + timedelta(minutes=35)
            lines_in, lines_out = sunrise_dt - timedelta(hours=1), sunset_dt + timedelta(hours=1)
            
            upper_dt, lower_dt = None, None
            if moonrise_str and moonset_str:
                try:
                    mr = datetime.fromisoformat(moonrise_str)
                    ms = datetime.fromisoformat(moonset_str)
                    if ms < mr: ms += timedelta(days=1)
                    upper_dt = mr + (ms - mr)/2
                except: pass
            elif prev_upper:
                upper_dt = prev_upper + timedelta(minutes=50)
                
            if upper_dt:
                prev_upper = upper_dt
                lower_dt = upper_dt + timedelta(hours=12, minutes=25)
                if lower_dt.date() > dt.date():
                    lower_dt = upper_dt - timedelta(hours=12, minutes=25)
                    
            moon_upper_str = upper_dt.strftime('%-I:%M %p') if upper_dt else "--"
            moon_lower_str = lower_dt.strftime('%-I:%M %p') if lower_dt else "--"
            
            tide_strs = [f"{'High' if ext['type'] == 'H' else 'Low'}: {ext['dt'].strftime('%-I:%M %p')} ({ext['height']:.1f} ft)" for ext in day_extremes]
            tide_chart_str = " | ".join(tide_strs) if tide_strs else "Tide Data Syncing..."
            tide_curve = [{"t": ext["dt"].strftime("%H:%M"), "h": round(ext["height"], 2), "type": ext["type"]} for ext in day_extremes]

            species_calendar = build_species_calendar(dt)

            timeline_windows = build_dynamic_timeline(lines_in, lines_out, sunrise_dt, sunset_dt, cloud_pct, arrivals, stock_base, env_score, flow_mult, angler_mult)
            peak_potential = max([w["score"] for w in timeline_windows]) if timeline_windows else 0

            reports.append({
                "id": f"day-{i}",
                "title": dt.strftime('%A, %b %d'), "tag": "TODAY" if i == 0 else "TOMORROW" if i == 1 else dt.strftime('%A').upper(),
                "peak": peak_potential, "cfs": int(round(usgs_data["cfs"])) if usgs_data["cfs"] is not None else None, "gage": round(usgs_data["gage"], 2) if usgs_data["gage"] is not None else None,
                "flow_idx": flow_index,
                "pressure": round(press_curr_inHg, 2), "press_delta": round(press_curr_inHg - press_prev_inHg, 2), "rain": round(rain_in, 2),
                "lunar_icon": lunar_icon, "cloud_pct": cloud_pct,
                "sunrise": sunrise_dt.strftime('%-I:%M %p'), "sunset": sunset_dt.strftime('%-I:%M %p'),
                "civil_in": civil_in.strftime('%-I:%M %p'), "civil_out": civil_out.strftime('%-I:%M %p'),
                "moon_upper": moon_upper_str, "moon_lower": moon_lower_str,
                "lines_in": lines_in.strftime('%-I:%M %p'), "lines_out": lines_out.strftime('%-I:%M %p'),
                "active_fish": active_str, "net_status": net_status, "angler_desc": angler_desc,
                "push_status": push_status, "tide_chart": tide_chart_str, "tide_curve": tide_curve,
                "species_calendar": species_calendar, "windows": timeline_windows, "is_netting": is_netting_day,
                "is_active": usgs_data["is_active"], "updated_time": usgs_data["updated_time"], "api_offline": bool(usgs_data.get("api_offline", False)),
                "site_name": usgs_data["site_name"], "site_id": site
            })

        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(reports).encode('utf-8'))
