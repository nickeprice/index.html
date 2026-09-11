import json
import random
from http.server import BaseHTTPRequestHandler
from datetime import datetime, timedelta

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # 1. FETCH SIMULATION (Replace with actual USGS/NOAA/Open-Meteo requests)
        # Puyallup River (USGS 12101500) & NOAA (9446484) data
        current_cfs = 1850.0
        current_ntu = 22.0
        past_ntu = 45.0 # 24 hours ago
        current_temp_c = 11.2
        past_temp_c = 13.5 # 24 hours ago
        
        tide_high = 10.5 # ft
        tide_low = 1.2 # ft
        
        # 2. ALGORITHMIC UPGRADES
        # Temp Delta (Negative is dropping, triggers movement)
        temp_delta = current_temp_c - past_temp_c
        
        # NTU Trend (Clearing vs Blowing out)
        is_clearing = past_ntu > 30 and current_ntu < 30
        
        # Tidal Exchange Coefficient
        tidal_exchange = tide_high - tide_low
        tidal_push_multiplier = 1.0 + (tidal_exchange * 0.05)
        
        # FMI (Flow Migration Index) Calculation
        base_fmi = (current_cfs / 2000) * 100 
        fmi = base_fmi * tidal_push_multiplier
        if is_clearing:
            fmi += 15.0 # Migration spike in clearing water
        
        # 3. JSON PAYLOAD
        payload = {
            "timestamp": datetime.utcnow().isoformat(),
            "hydrology": {
                "cfs": current_cfs,
                "ntu": current_ntu,
                "ntu_trend": "clearing" if is_clearing else "stable",
                "temp_c": current_temp_c,
                "temp_delta": round(temp_delta, 2)
            },
            "kinematics": {
                "tidal_exchange_ft": round(tidal_exchange, 2),
                "fmi_score": round(fmi, 2)
            }
        }
        
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode('utf-8'))