/**
 * src/data/riverRegulations.js
 * Scalable Multi-River Regulation Engine for Washington Rivers.
 * Defines regulation rules, zone checks, and status evaluation.
 */

// Helper: Parse GPS coordinates from multiple formats ({lat, lon}, string, or null)
function parseGPS(gpsInput) {
  if (!gpsInput) return null;
  if (typeof gpsInput === 'object') {
    const lat = Number(gpsInput.lat ?? gpsInput.latitude);
    const lon = Number(gpsInput.lon ?? gpsInput.lng ?? gpsInput.longitude);
    if (!isNaN(lat) && !isNaN(lon)) return { lat, lon };
  }
  if (typeof gpsInput === 'string') {
    const parts = gpsInput.split(',');
    if (parts.length === 2) {
      const lat = parseFloat(parts[0].trim());
      const lon = parseFloat(parts[1].trim());
      if (!isNaN(lat) && !isNaN(lon)) return { lat, lon };
    }
  }
  return null;
}

/**
 * Puyallup River zone rule evaluation:
 * - Zone 1 & Zone 3: Open Aug 19 – Oct 31. CLOSED Sun, Mon, Tue through Sep 30. Open daily in Oct.
 * - Zone 2: ALWAYS CLOSED WATERS.
 */
function evaluatePuyallupZone(date, zoneId = 1) {
  if (zoneId === 2) {
    return {
      isOpen: false,
      reason: "Clark's Creek mouth: ALWAYS CLOSED WATERS."
    };
  }

  const m = date.getMonth() + 1; // 1-12
  const day = date.getDate();
  const dow = date.getDay(); // 0 = Sun, 1 = Mon, 2 = Tue, ...

  // Season runs Aug 19 – Oct 31
  const inSeason = (m === 8 && day >= 19) || (m === 9) || (m === 10);
  if (!inSeason) {
    return {
      isOpen: false,
      reason: "Season closed (Open Aug 19 – Oct 31)"
    };
  }

  // Aug 19 – Sep 30: CLOSED Sun, Mon, Tue
  if (m === 8 || m === 9) {
    if (dow === 0 || dow === 1 || dow === 2) {
      const days = ["Sunday", "Monday", "Tuesday"];
      return {
        isOpen: false,
        reason: `CLOSED Sun, Mon, Tue through Sep 30 (${days[dow]})`
      };
    }
    return {
      isOpen: true,
      reason: "Open Wednesday – Saturday through Sep 30"
    };
  }

  // October 1 – October 31: Open daily in Oct
  if (m === 10) {
    return {
      isOpen: true,
      reason: "Open daily in October"
    };
  }

  return {
    isOpen: false,
    reason: "Season closed"
  };
}

/**
 * Green River active WDFW season framework:
 * - Zone 1 (Lower River): Open Aug 20 – Dec 31 (Salmon daily)
 * - Zone 2 (Upper River): Open Aug 20 – Dec 31
 * - Zone 3 (Crisp/Keta Creek mouth): ALWAYS CLOSED WATERS
 */
function evaluateGreenRiverZone(date, zoneId = 1) {
  if (zoneId === 3) {
    return {
      isOpen: false,
      reason: "Crisp/Keta Creek mouth: ALWAYS CLOSED WATERS."
    };
  }

  const m = date.getMonth() + 1;
  const day = date.getDate();

  const inSeason = (m === 8 && day >= 20) || (m >= 9 && m <= 12);
  if (inSeason) {
    return {
      isOpen: true,
      reason: "Open Aug 20 – Dec 31 (Salmon)"
    };
  }

  return {
    isOpen: false,
    reason: "Season closed (Open Aug 20 – Dec 31)"
  };
}

/**
 * Nisqually River active WDFW season framework:
 * - Zone 1 (Lower River: mouth to Clear Creek): Open July 1 – Nov 15.
 *   CLOSED Sun, Mon, Tue through Sep 30. CLOSED Sun, Mon Oct 1 – Nov 15.
 * - Zone 2 (Clear Creek to Kalama Creek): Open Oct 26 – Nov 15 (CLOSED Sun, Mon).
 */
function evaluateNisquallyZone(date, zoneId = 1) {
  const m = date.getMonth() + 1;
  const day = date.getDate();
  const dow = date.getDay();

  if (zoneId === 1) {
    const inSeason = (m === 7) || (m === 8) || (m === 9) || (m === 10) || (m === 11 && day <= 15);
    if (!inSeason) {
      return {
        isOpen: false,
        reason: "Season closed (Open Jul 1 – Nov 15)"
      };
    }

    if (m === 7 || (m === 8 && day === 1)) {
      return {
        isOpen: true,
        reason: "Open daily (Jul 1 – Aug 1)"
      };
    }

    if ((m === 8 && day >= 2) || m === 9) {
      if (dow === 0 || dow === 1 || dow === 2) {
        return {
          isOpen: false,
          reason: "CLOSED Sun, Mon, Tue through Sep 30"
        };
      }
      return {
        isOpen: true,
        reason: "Open Wednesday – Saturday through Sep 30"
      };
    }

    if (m === 10 || (m === 11 && day <= 15)) {
      if (dow === 0 || dow === 1) {
        return {
          isOpen: false,
          reason: "CLOSED Sun, Mon (Oct 1 – Nov 15)"
        };
      }
      return {
        isOpen: true,
        reason: "Open Tuesday – Saturday (Oct 1 – Nov 15)"
      };
    }
  }

  if (zoneId === 2) {
    const inSeason = (m === 10 && day >= 26) || (m === 11 && day <= 15);
    if (!inSeason) {
      return {
        isOpen: false,
        reason: "Season closed (Open Oct 26 – Nov 15)"
      };
    }
    if (dow === 0 || dow === 1) {
      return {
        isOpen: false,
        reason: "CLOSED Sun, Mon (Oct 26 – Nov 15)"
      };
    }
    return {
      isOpen: true,
      reason: "Open Tuesday – Saturday (Oct 26 – Nov 15)"
    };
  }

  return {
    isOpen: false,
    reason: "Season closed"
  };
}

/**
 * Multi-River Regulations Configuration mapping river IDs to zones and rules.
 */
const riverRegulations = {
  // Puyallup River (USGS 12101500)
  '12101500': {
    id: '12101500',
    name: 'Puyallup River',
    zones: [
      {
        id: 'puyallup-zone-1',
        zoneNumber: 1,
        name: "Zone 1 (Lower River: 11th St to 400ft downstream of Clark's Creek)",
        isMainLower: true,
        bounds: { minLat: 47.198, maxLat: 47.265, minLon: -122.440, maxLon: -122.322 },
        checkZone: (coords) => coords && coords.lat >= 47.198 && coords.lat <= 47.265 && coords.lon >= -122.440 && coords.lon <= -122.322,
        evaluate: (date) => evaluatePuyallupZone(date, 1)
      },
      {
        id: 'puyallup-zone-2',
        zoneNumber: 2,
        name: "Zone 2 (Clark's Creek mouth: 400ft downstream to 400ft upstream)",
        isMainLower: false,
        bounds: { minLat: 47.193, maxLat: 47.201, minLon: -122.330, maxLon: -122.316 },
        checkZone: (coords) => coords && coords.lat >= 47.193 && coords.lat <= 47.201 && coords.lon >= -122.330 && coords.lon <= -122.316,
        evaluate: (date) => evaluatePuyallupZone(date, 2)
      },
      {
        id: 'puyallup-zone-3',
        zoneNumber: 3,
        name: "Zone 3 (Upper River: 400ft upstream of Clark's Creek to Carbon River)",
        isMainLower: false,
        bounds: { minLat: 47.100, maxLat: 47.198, minLon: -122.325, maxLon: -122.205 },
        checkZone: (coords) => coords && coords.lat >= 47.100 && coords.lat < 47.198 && coords.lon >= -122.325 && coords.lon <= -122.205,
        evaluate: (date) => evaluatePuyallupZone(date, 3)
      }
    ]
  },

  // Puyallup River near Orting (USGS 12093500)
  '12093500': {
    id: '12093500',
    name: 'Puyallup River (Orting)',
    zones: [
      {
        id: 'puyallup-orting-zone-1',
        zoneNumber: 3,
        name: "Zone 3 (Upper River: 400ft upstream of Clark's Creek to Carbon River)",
        isMainLower: true,
        bounds: { minLat: 47.100, maxLat: 47.198, minLon: -122.325, maxLon: -122.205 },
        checkZone: (coords) => coords && coords.lat >= 47.100 && coords.lat < 47.198 && coords.lon >= -122.325 && coords.lon <= -122.205,
        evaluate: (date) => evaluatePuyallupZone(date, 3)
      }
    ]
  },

  // Green River at Auburn (USGS 12113000)
  '12113000': {
    id: '12113000',
    name: 'Green River',
    zones: [
      {
        id: 'green-zone-1',
        zoneNumber: 1,
        name: 'Zone 1 (Lower River: Harbor Island to Tukwila / S 212th St)',
        isMainLower: true,
        bounds: { minLat: 47.450, maxLat: 47.600, minLon: -122.380, maxLon: -122.220 },
        checkZone: (coords) => coords && coords.lat >= 47.450 && coords.lat <= 47.600 && coords.lon >= -122.380 && coords.lon <= -122.220,
        evaluate: (date) => evaluateGreenRiverZone(date, 1)
      },
      {
        id: 'green-zone-2',
        zoneNumber: 2,
        name: 'Zone 2 (Upper River: S 212th St to Auburn / Hwy 18)',
        isMainLower: false,
        bounds: { minLat: 47.280, maxLat: 47.450, minLon: -122.280, maxLon: -122.180 },
        checkZone: (coords) => coords && coords.lat >= 47.280 && coords.lat < 47.450 && coords.lon >= -122.280 && coords.lon <= -122.180,
        evaluate: (date) => evaluateGreenRiverZone(date, 2)
      },
      {
        id: 'green-zone-3',
        zoneNumber: 3,
        name: 'Zone 3 (Crisp / Keta Creek mouth: 150ft downstream to 150ft upstream)',
        isMainLower: false,
        bounds: { minLat: 47.275, maxLat: 47.285, minLon: -122.080, maxLon: -122.065 },
        checkZone: (coords) => coords && coords.lat >= 47.275 && coords.lat <= 47.285 && coords.lon >= -122.080 && coords.lon <= -122.065,
        evaluate: (date) => evaluateGreenRiverZone(date, 3)
      }
    ]
  },

  // Nisqually River at McKenna (USGS 12089500)
  '12089500': {
    id: '12089500',
    name: 'Nisqually River',
    zones: [
      {
        id: 'nisqually-zone-1',
        zoneNumber: 1,
        name: 'Zone 1 (Lower River: mouth to Clear Creek)',
        isMainLower: true,
        bounds: { minLat: 47.030, maxLat: 47.130, minLon: -122.750, maxLon: -122.650 },
        checkZone: (coords) => coords && coords.lat >= 47.030 && coords.lat <= 47.130 && coords.lon >= -122.750 && coords.lon <= -122.650,
        evaluate: (date) => evaluateNisquallyZone(date, 1)
      },
      {
        id: 'nisqually-zone-2',
        zoneNumber: 2,
        name: 'Zone 2 (Clear Creek to Kalama Creek)',
        isMainLower: false,
        bounds: { minLat: 46.990, maxLat: 47.040, minLon: -122.680, maxLon: -122.630 },
        checkZone: (coords) => coords && coords.lat >= 46.990 && coords.lat <= 47.040 && coords.lon >= -122.680 && coords.lon <= -122.630,
        evaluate: (date) => evaluateNisquallyZone(date, 2)
      }
    ]
  },

  // Carbon River near Fairfax (USGS 12094000)
  '12094000': {
    id: '12094000',
    name: 'Carbon River',
    zones: [
      {
        id: 'carbon-zone-1',
        zoneNumber: 1,
        name: 'Zone 1 (Lower River: mouth to Voight Creek)',
        isMainLower: true,
        bounds: { minLat: 47.080, maxLat: 47.130, minLon: -122.235, maxLon: -122.175 },
        checkZone: (coords) => coords && coords.lat >= 47.080 && coords.lat <= 47.130 && coords.lon >= -122.235 && coords.lon <= -122.175,
        evaluate: (date) => {
          const m = date.getMonth() + 1;
          if (m >= 9 && m <= 11) {
            return { isOpen: true, reason: 'Open Sep 1 – Nov 30 (Salmon/Game Fish)' };
          }
          return { isOpen: false, reason: 'Season closed (Open Sep 1 – Nov 30)' };
        }
      }
    ]
  }
};


/**
 * Evaluates open/closed fishing status for a river, date, and optional GPS coordinates.
 * @param {Date|string|number} date Target date to check
 * @param {string|number} riverId River station ID (e.g. '12101500') or river name
 * @param {object|string|null} gpsCoords Optional GPS { lat, lon } or "lat,lon"
 * @returns {{ isOpen: boolean, reason: string }}
 */
function checkRiverStatus(date, riverId = '12101500', gpsCoords = null) {
  // Support flexible argument order if gpsCoords was passed as 2nd param: checkRiverStatus(date, coords, riverId)
  if (typeof riverId === 'object' && riverId !== null && ('lat' in riverId || 'latitude' in riverId)) {
    const tempCoords = riverId;
    riverId = (typeof gpsCoords === 'string' || typeof gpsCoords === 'number') ? gpsCoords : '12101500';
    gpsCoords = tempCoords;
  }

  const targetDate = (date instanceof Date) ? date : new Date(date || Date.now());

  // Resolve river configuration by ID or string alias
  const idStr = String(riverId || '12101500').trim();
  let riverConfig = riverRegulations[idStr];

  if (!riverConfig) {
    const idLower = idStr.toLowerCase();
    if (idLower.includes('puyallup')) riverConfig = riverRegulations['12101500'];
    else if (idLower.includes('green')) riverConfig = riverRegulations['12113000'];
    else if (idLower.includes('nisqually')) riverConfig = riverRegulations['12089500'];
    else if (idLower.includes('carbon')) riverConfig = riverRegulations['12094000'];
    else riverConfig = riverRegulations['12101500']; // default fallback
  }

  const coords = parseGPS(gpsCoords);
  let selectedZone = null;

  if (coords && Array.isArray(riverConfig.zones)) {
    // If Clark's Creek or other closed pocket exists, prioritize check
    const closedPocket = riverConfig.zones.find(z => !z.isMainLower && z.zoneNumber === 2);
    if (closedPocket && typeof closedPocket.checkZone === 'function' && closedPocket.checkZone(coords)) {
      selectedZone = closedPocket;
    } else {
      for (const zone of riverConfig.zones) {
        if (typeof zone.checkZone === 'function' && zone.checkZone(coords)) {
          selectedZone = zone;
          break;
        }
      }
    }
  }

  // If no GPS is provided, evaluate against the main lower river zone
  if (!selectedZone) {
    selectedZone = riverConfig.zones.find(z => z.isMainLower) || riverConfig.zones[0];
  }

  const evalResult = selectedZone.evaluate(targetDate);
  const isOpen = !!evalResult.isOpen;
  const reason = evalResult.reason || (isOpen ? 'River Open' : 'River Closed');

  return {
    isOpen: isOpen,
    reason: reason,
    statusPill: isOpen ? '● RIVER OPEN' : '● RIVER CLOSED',
    zone: selectedZone.name,
    river: riverConfig.name,
    date: targetDate
  };
}


/**
 * Solar Math: Official Sunrise/Sunset and WDFW Legal Hours.
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

    if (cosH > 1 || cosH < -1) return null;

    const H = isSunrise ? (360 - deg * Math.acos(cosH)) / 15 : (deg * Math.acos(cosH)) / 15;
    const T = H + RA - (0.06571 * t) - 6.622;
    let UT = ((T - lngHour) % 24 + 24) % 24;

    const probe = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(UT), Math.round((UT % 1) * 60)));
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false
    });
    const parts = formatter.formatToParts(probe);
    const localHour = parseInt(parts.find(p => p.type === 'hour').value, 10);
    const localMin = parseInt(parts.find(p => p.type === 'minute').value, 10);

    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), localHour, localMin);
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
    heroText: `Legal Hours: ${inStr} \u2013 ${outStr}`
  };
}

// Universal module export (CommonJS, ES Module, Browser)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    riverRegulations,
    checkRiverStatus,
    calculateSolarHours,
    parseGPS,
    evaluatePuyallupZone,
    evaluateGreenRiverZone,
    evaluateNisquallyZone
  };
}
if (typeof window !== 'undefined') {
  window.riverRegulations = riverRegulations;
  window.checkRiverStatus = checkRiverStatus;
  window.calculateSolarHours = calculateSolarHours;
}

