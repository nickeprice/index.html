/**
 * Scalable GPS-Aware Regulations Engine for Washington Rivers.
 * Evaluates WDFW fishing rules against GPS coordinates and date.
 */

// GPS Bounding Boxes for major Washington river zones
const ZONE_GPS_CONFIG = {
  "Puyallup River": [
    {
      zoneIndex: 0,
      zoneNamePattern: /11th.*Clark/i,
      bbox: { minLat: 47.198, maxLat: 47.265, minLon: -122.440, maxLon: -122.322 },
      isLowestMouth: true
    },
    {
      zoneIndex: 1,
      zoneNamePattern: /400'.*downstream.*upstream.*Clark/i,
      bbox: { minLat: 47.193, maxLat: 47.201, minLon: -122.330, maxLon: -122.316 }
    },
    {
      zoneIndex: 2,
      zoneNamePattern: /upstream.*Clark.*Carbon/i,
      bbox: { minLat: 47.100, maxLat: 47.198, minLon: -122.325, maxLon: -122.205 }
    },
    {
      zoneIndex: 3,
      zoneNamePattern: /Carbon.*upstream/i,
      bbox: { minLat: 46.850, maxLat: 47.105, minLon: -122.250, maxLon: -121.900 }
    }
  ],
  "Carbon River": [
    {
      zoneIndex: 0,
      zoneNamePattern: /mouth.*Voight/i,
      bbox: { minLat: 47.080, maxLat: 47.130, minLon: -122.235, maxLon: -122.175 },
      isLowestMouth: true
    },
    {
      zoneIndex: 1,
      zoneNamePattern: /Voight.*Hwy|162/i,
      bbox: { minLat: 46.950, maxLat: 47.085, minLon: -122.200, maxLon: -121.950 }
    }
  ],
  "Green River": [
    {
      zoneIndex: 0,
      zoneNamePattern: /Harbor.*Island|Tukwila|mouth/i,
      bbox: { minLat: 47.450, maxLat: 47.600, minLon: -122.380, maxLon: -122.220 },
      isLowestMouth: true
    },
    {
      zoneIndex: 1,
      zoneNamePattern: /Tukwila|Auburn|277th/i,
      bbox: { minLat: 47.280, maxLat: 47.460, minLon: -122.280, maxLon: -122.180 }
    },
    {
      zoneIndex: 2,
      zoneNamePattern: /Auburn|Flaming.*Geyser|Palmer/i,
      bbox: { minLat: 47.200, maxLat: 47.330, minLon: -122.180, maxLon: -121.750 }
    }
  ],
  "Nisqually River": [
    {
      zoneIndex: 0,
      zoneNamePattern: /mouth.*Clear/i,
      bbox: { minLat: 47.030, maxLat: 47.130, minLon: -122.750, maxLon: -122.650 },
      isLowestMouth: true
    },
    {
      zoneIndex: 1,
      zoneNamePattern: /Clear.*Kalama/i,
      bbox: { minLat: 46.990, maxLat: 47.040, minLon: -122.680, maxLon: -122.630 }
    },
    {
      zoneIndex: 2,
      zoneNamePattern: /Kalama.*Alder|McKenna/i,
      bbox: { minLat: 46.800, maxLat: 47.000, minLon: -122.650, maxLon: -122.200 }
    }
  ],
  "Snohomish River": [
    {
      zoneIndex: 0,
      zoneNamePattern: /mouth|Burlington|Hwy.*9/i,
      bbox: { minLat: 47.880, maxLat: 48.060, minLon: -122.260, maxLon: -122.120 },
      isLowestMouth: true
    },
    {
      zoneIndex: 1,
      zoneNamePattern: /Hwy.*9.*Skykomish/i,
      bbox: { minLat: 47.800, maxLat: 47.920, minLon: -122.150, maxLon: -121.980 }
    }
  ]
};

let _rulesCache = null;

function setRulesCache(rules) {
  _rulesCache = rules;
}

function getRulesCache() {
  if (!_rulesCache) {
    if (typeof window !== 'undefined' && window.__WDFW_RULES__) {
      _rulesCache = window.__WDFW_RULES__;
    } else if (typeof require !== 'undefined') {
      try {
        _rulesCache = require('../data/wdfw_rules.json');
      } catch (e) {}
    }
  }
  return _rulesCache;
}

async function loadRules(customPath) {
  if (_rulesCache) return _rulesCache;
  if (typeof window !== 'undefined') {
    const urls = customPath ? [customPath] : ['/src/data/wdfw_rules.json', 'src/data/wdfw_rules.json', './src/data/wdfw_rules.json'];
    for (let i = 0; i < urls.length; i++) {
      try {
        const res = await fetch(urls[i] + '?_t=' + Date.now());
        if (res.ok) {
          _rulesCache = await res.json();
          return _rulesCache;
        }
      } catch (e) {}
    }
  }
  return getRulesCache();
}

// Auto-fetch rules if loaded in browser
if (typeof window !== 'undefined') {
  try { loadRules(); } catch(e) {}
}

function parseGPS(gpsInput) {
  if (!gpsInput) return null;
  if (typeof gpsInput === 'object') {
    const lat = Number(gpsInput.lat ?? gpsInput.latitude);
    const lon = Number(gpsInput.lon ?? gpsInput.longitude ?? gpsInput.lng);
    if (!isNaN(lat) && !isNaN(lon)) return { lat, lon };
  }
  if (typeof gpsInput === 'string') {
    const parts = gpsInput.split(',');
    if (parts.length === 2) {
      const lat = parseFloat(parts[0]);
      const lon = parseFloat(parts[1]);
      if (!isNaN(lat) && !isNaN(lon)) return { lat, lon };
    }
  }
  if (Array.isArray(gpsInput) && gpsInput.length >= 2) {
    const lat = parseFloat(gpsInput[0]);
    const lon = parseFloat(gpsInput[1]);
    if (!isNaN(lat) && !isNaN(lon)) return { lat, lon };
  }
  return null;
}

function matchRiverRules(rules, riverName) {
  if (!rules || !riverName) return null;
  const cleanName = riverName.trim().toLowerCase();

  // 1. Exact match
  for (const key of Object.keys(rules)) {
    if (key.toLowerCase() === cleanName) {
      return { name: key, data: rules[key] };
    }
  }

  // 2. Contains / startsWith match
  const candidates = [];
  for (const key of Object.keys(rules)) {
    const kLower = key.toLowerCase();
    const coreName = kLower.replace(' river', '').replace(' creek', '');
    if (cleanName.includes(kLower) || cleanName.includes(coreName)) {
      candidates.push({ name: key, data: rules[key], priority: kLower === cleanName ? 10 : 5 });
    }
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => {
      const aIsMain = !a.name.includes('Fork') && !a.name.includes('Tributar');
      const bIsMain = !b.name.includes('Fork') && !b.name.includes('Tributar');
      if (aIsMain && !bIsMain) return -1;
      if (!aIsMain && bIsMain) return 1;
      return b.priority - a.priority;
    });
    return candidates[0];
  }

  return null;
}

function findZoneForGPS(riverName, zones, gpsCoords) {
  if (!zones || zones.length === 0) return null;
  const parsedGPS = parseGPS(gpsCoords);

  if (parsedGPS) {
    const cfgList = ZONE_GPS_CONFIG[riverName] || [];
    for (let i = 0; i < cfgList.length; i++) {
      const cfg = cfgList[i];
      const bb = cfg.bbox;
      if (
        parsedGPS.lat >= bb.minLat &&
        parsedGPS.lat <= bb.maxLat &&
        parsedGPS.lon >= bb.minLon &&
        parsedGPS.lon <= bb.maxLon
      ) {
        if (zones[cfg.zoneIndex]) {
          return { zone: zones[cfg.zoneIndex], index: cfg.zoneIndex, byGPS: true };
        }
        const patternMatch = zones.find(z => cfg.zoneNamePattern && cfg.zoneNamePattern.test(z.zone_name));
        if (patternMatch) {
          return { zone: patternMatch, index: zones.indexOf(patternMatch), byGPS: true };
        }
      }
    }
  }

  // Default to lowest / mouth zone if no GPS or GPS outside specific zones
  let lowestZone = zones[0];
  let lowestIdx = 0;
  for (let i = 0; i < zones.length; i++) {
    const zn = zones[i].zone_name.toLowerCase();
    if (zn.includes('mouth') || zn.includes('11th st') || zn.includes('harbor island') || zn.includes('burlington')) {
      lowestZone = zones[i];
      lowestIdx = i;
      break;
    }
  }
  return { zone: lowestZone, index: lowestIdx, byGPS: false };
}
const MONTH_NAMES = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function getMemorialDaySaturday(year) {
  // Memorial Day is the last Monday of May
  const may31 = new Date(year, 4, 31);
  const dayOfWeek = may31.getDay();
  const lastMondayDate = 31 - ((dayOfWeek + 6) % 7);
  // Saturday before Memorial Day is 2 days before the last Monday
  return new Date(year, 4, lastMondayDate - 2, 0, 0, 0);
}

function parseDateToken(token, targetYear) {
  const clean = token.trim().toLowerCase();
  if (clean.includes('memorial day')) {
    return getMemorialDaySaturday(targetYear);
  }
  const match = clean.match(/([a-z]+)\.?\s*(\d+)/i);
  if (match) {
    const mStr = match[1].toLowerCase();
    const month = MONTH_NAMES[mStr];
    const day = parseInt(match[2], 10);
    if (month !== undefined && !isNaN(day)) {
      return new Date(targetYear, month, day, 0, 0, 0);
    }
  }
  return null;
}

function isDateInRange(targetDate, dateRangeStr) {
  if (!dateRangeStr) return true;
  const str = dateRangeStr.trim().toLowerCase();
  if (str.includes('year-round')) return true;
  if (str.includes('closed')) return false;

  const parts = str.split(/[-–—]|(?:\s+to\s+)/);
  if (parts.length < 2) return true;

  const y = targetDate.getFullYear();
  let start = parseDateToken(parts[0], y);
  let end = parseDateToken(parts[1], y);

  if (!start || !end) return true;

  // If season crosses year boundary (e.g. May to Jan, or Oct to Feb)
  if (end < start) {
    const endNextYear = new Date(end);
    endNextYear.setFullYear(y + 1);
    if (targetDate >= start && targetDate <= endNextYear) return true;
    
    // Check if targetDate is in the tail part of the previous year's window
    const startPrevYear = new Date(start);
    startPrevYear.setFullYear(y - 1);
    if (targetDate >= startPrevYear && targetDate <= end) return true;
    return false;
  }

  // Normal window within same calendar year
  const tTime = new Date(y, targetDate.getMonth(), targetDate.getDate()).getTime();
  const sTime = new Date(y, start.getMonth(), start.getDate()).getTime();
  const eTime = new Date(y, end.getMonth(), end.getDate(), 23, 59, 59).getTime();

  return tTime >= sTime && tTime <= eTime;
}

function evaluateZoneRules(zone, targetDate) {
  if (!zone) return { isOpen: false, reason: "Zone not found" };

  // 1. Permanent closed waters
  if (zone.is_closed_waters) {
    return {
      isOpen: false,
      reason: "Closed Waters Sanctuary",
      ruleDetail: zone.additional_rules?.join(' ') || "CLOSED WATERS."
    };
  }

  const dayName = DAY_NAMES[targetDate.getDay()];

  // 2. Weekly closures (e.g. CLOSED Sundays, Mondays, and Tuesdays)
  if (zone.weekly_closures && zone.weekly_closures.length > 0) {
    for (let i = 0; i < zone.weekly_closures.length; i++) {
      const wc = zone.weekly_closures[i];
      const inDateRange = isDateInRange(targetDate, wc.date_range);
      if (inDateRange) {
        const matchesDay = wc.days.some(d => d.toLowerCase() === dayName.toLowerCase());
        if (matchesDay) {
          return {
            isOpen: false,
            reason: `Weekly Closure (${dayName}s)`,
            ruleDetail: wc.description || `CLOSED ${wc.days.join(', ')}`
          };
        }
      }
    }
  }

  // 3. Season dates
  if (zone.seasons && zone.seasons.length > 0) {
    const openSeasons = [];
    for (let i = 0; i < zone.seasons.length; i++) {
      const s = zone.seasons[i];
      if (s.rules && s.rules.toUpperCase().includes('CLOSED WATERS')) continue;
      if (isDateInRange(targetDate, s.date_range)) {
        openSeasons.push(s);
      }
    }

    if (openSeasons.length > 0) {
      const spList = [...new Set(openSeasons.map(s => s.species))].join(', ');
      return {
        isOpen: true,
        reason: `Open: ${spList}`,
        openSeasons: openSeasons
      };
    } else {
      return {
        isOpen: false,
        reason: "Season Closed for Target Species"
      };
    }
  }

  return { isOpen: true, reason: "Open" };
}

function checkRiverStatus(date, gpsCoords, activeRiverName, overrideRules) {
  const rules = overrideRules || getRulesCache();
  const targetDate = (date instanceof Date) ? date : new Date(date || Date.now());
  const riverLookup = activeRiverName || "Puyallup River";

  if (!rules) {
    return {
      isOpen: false,
      statusText: "RIVER CLOSED",
      statusPill: "● RIVER CLOSED",
      color: "#ef4444",
      reason: "Regulations data loading...",
      riverName: riverLookup,
      zone: null,
      byGPS: false,
      date: targetDate
    };
  }

  const riverMatch = matchRiverRules(rules, riverLookup);
  if (!riverMatch || !riverMatch.data || !riverMatch.data.Zones || riverMatch.data.Zones.length === 0) {
    return {
      isOpen: false,
      statusText: "RIVER CLOSED",
      statusPill: "● RIVER CLOSED",
      color: "#ef4444",
      reason: `No specific regulations found for ${riverLookup}`,
      riverName: riverLookup,
      zone: null,
      byGPS: false,
      date: targetDate
    };
  }

  const { zone, index, byGPS } = findZoneForGPS(riverMatch.name, riverMatch.data.Zones, gpsCoords);
  const evaluation = evaluateZoneRules(zone, targetDate);

  const isOpen = !!evaluation.isOpen;
  return {
    isOpen: isOpen,
    statusText: isOpen ? "RIVER OPEN" : "RIVER CLOSED",
    statusPill: isOpen ? "● RIVER OPEN" : "● RIVER CLOSED",
    color: isOpen ? "#10b981" : "#ef4444",
    badgeClass: isOpen ? "status-pill-open" : "status-pill-closed",
    riverName: riverMatch.name,
    zone: zone,
    zoneIndex: index,
    byGPS: byGPS,
    reason: evaluation.reason,
    ruleDetail: evaluation.ruleDetail || "",
    date: targetDate
  };
}

/**
 * Robust Solar Math: Official Sunrise/Sunset and WDFW Legal Hours.
 * Legal Hours: 1 hour before sunrise to 1 hour after sunset.
 */
function calculateSolarHours(date, lat = 47.1950, lon = -122.3020) {
  const d = (date instanceof Date) ? date : new Date(date || Date.now());
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;

  const startOfYear = new Date(d.getFullYear(), 0, 0);
  const diff = d - startOfYear;
  const oneDay = 1000 * 60 * 60 * 24;
  const dayOfYear = Math.floor(diff / oneDay);

  // Solar calculation approximations (NOAA / Meeus formula)
  const lngHour = lon / 15;
  const calcTime = (isSunrise) => {
    const t = dayOfYear + ((isSunrise ? 6 : 18) - lngHour) / 24;
    const M = (0.9856 * t) - 3.289;
    let L = M + (1.916 * Math.sin(M * rad)) + (0.020 * Math.sin(2 * M * rad)) + 282.634;
    L = ((L % 360) + 360) % 360;

    let RA = deg * Math.atan(0.91764 * Math.tan(L * rad));
    RA = ((RA % 360) + 360) % 360;

    const Lquadrant = Math.floor(L / 90) * 90;
    const RAquadrant = Math.floor(RA / 90) * 90;
    RA = (RA + (Lquadrant - RAquadrant)) / 15;

    const sinDec = 0.39782 * Math.sin(L * rad);
    const cosDec = Math.cos(Math.asin(sinDec));
    const cosH = (Math.cos(90.833 * rad) - (sinDec * Math.sin(lat * rad))) / (cosDec * Math.cos(lat * rad));

    if (cosH > 1) return null; // Polar night
    if (cosH < -1) return null; // Midnight sun

    const H = isSunrise ? (360 - deg * Math.acos(cosH)) / 15 : (deg * Math.acos(cosH)) / 15;
    const T = H + RA - (0.06571 * t) - 6.622;
    let UT = ((T - lngHour) % 24 + 24) % 24;

    // Timezone offset for America/Los_Angeles on given date
    const probe = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(UT), Math.round((UT % 1) * 60)));
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: 'numeric', hour12: false });
    const parts = formatter.formatToParts(probe);
    const localHour = parseInt(parts.find(p => p.type === 'hour').value, 10);
    const localMin = parseInt(parts.find(p => p.type === 'minute').value, 10);

    const res = new Date(d.getFullYear(), d.getMonth(), d.getDate(), localHour, localMin);
    return res;
  };

  const sunriseDt = calcTime(true);
  const sunsetDt = calcTime(false);

  const formatAmPm = (dt) => {
    if (!dt) return "--:--";
    let h = dt.getHours();
    const m = dt.getMinutes().toString().padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${m} ${ampm}`;
  };

  if (!sunriseDt || !sunsetDt) {
    return { sunrise: "--", sunset: "--", lines_in: "--", lines_out: "--", heroText: "Legal Hours: --" };
  }

  const linesInDt = new Date(sunriseDt.getTime() - 60 * 60 * 1000);
  const linesOutDt = new Date(sunsetDt.getTime() + 60 * 60 * 1000);

  const inStr = formatAmPm(linesInDt);
  const outStr = formatAmPm(linesOutDt);

  return {
    sunrise: formatAmPm(sunriseDt),
    sunset: formatAmPm(sunsetDt),
    lines_in: inStr,
    lines_out: outStr,
    heroText: `Legal Hours: ${inStr} – ${outStr}`
  };
}

// Universal Exports (Node.js & Browser)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    checkRiverStatus,
    calculateSolarHours,
    findZoneForGPS,
    evaluateZoneRules,
    loadRules,
    setRulesCache,
    ZONE_GPS_CONFIG
  };
}
if (typeof window !== 'undefined') {
  window.checkRiverStatus = checkRiverStatus;
  window.calculateSolarHours = calculateSolarHours;
  window.loadRegulationsRules = loadRules;
  window.RegulationsEngine = {
    checkRiverStatus,
    calculateSolarHours,
    findZoneForGPS,
    evaluateZoneRules,
    loadRules,
    setRulesCache,
    ZONE_GPS_CONFIG
  };
}

