/**
 * Geolocation cache patch (non-AMD, safe for Odoo 18 assets)
 *
 * Goal:
 * - Reduce delay on Check In/Out when Odoo waits for navigator.geolocation.getCurrentPosition()
 *   to return a fresh fix.
 *
 * How:
 * - Monkey-patch navigator.geolocation.getCurrentPosition.
 * - If we have a recent cached position, immediately call success callback with cached coords.
 * - Otherwise, fall back to the original browser implementation.
 *
 * Notes:
 * - Cache is in-memory only (window.__att_ctrl_geo_cache).
 * - Does NOT change business logic; only short-circuits geolocation latency when possible.
 */
(function () {
    'use strict';

    // Feature flag (can be toggled in browser console)
    if (window.__att_ctrl_geo_cache_enabled === undefined) {
        window.__att_ctrl_geo_cache_enabled = true;
    }

    function log() {
        if (!window.__att_ctrl_debug) return;
        try { console.log.apply(console, ['[ATT_CTRL][GEO_CACHE]'].concat([].slice.call(arguments))); } catch (e) {}
    }

    function nowMs() { return Date.now ? Date.now() : (new Date()).getTime(); }

    // Max age of cached coord (ms)
    var MAX_AGE_MS = 15 * 1000; // 15s (safer for moving users)

    // Max acceptable distance between cached coord and last live fix (meters)
    var MAX_DIST_M = 50; // 50m

    function toRad(x) { return x * Math.PI / 180; }
    function haversineMeters(lat1, lon1, lat2, lon2) {
    var R = 6371000; // meters
    var dLat = toRad(lat2 - lat1);
    var dLon = toRad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(a));
}


    function makePosition(lat, lon, accuracy, ts) {
        // Minimal Position-like object used by most callers
        return {
            coords: {
                latitude: lat,
                longitude: lon,
                accuracy: accuracy || null,
                altitude: null,
                altitudeAccuracy: null,
                heading: null,
                speed: null,
            },
            timestamp: ts || nowMs(),
        };
    }

    function getCache() {
        var c = window.__att_ctrl_geo_cache;
        if (!c || !c.coords) return null;

        var age = nowMs() - (c.ts || 0);
        if (age < 0) age = 999999999;
        if (age > MAX_AGE_MS) return null;

        // Distance guard: if we have a recent "live" fix, don't reuse cache if it is far away.
        // This prevents stale cached coords from being reused after the user moves.
        try {
            var last = window.__att_ctrl_last_live_coords;
            if (last && typeof last.lat === 'number' && typeof last.lon === 'number') {
                var lastAge = nowMs() - (last.ts || 0);
                if (lastAge < 5 * 60 * 1000) { // only compare if last live fix is within 5 minutes
                    var d = haversineMeters(
                        c.coords.latitude, c.coords.longitude,
                        last.lat, last.lon
                    );
                    if (d > MAX_DIST_M) return null;
                }
            }
        } catch (e) {}

        return c;
    }

    function setCacheFromPosition(pos) {
        try {
            if (!pos || !pos.coords) return;
            window.__att_ctrl_geo_cache = {
                ts: nowMs(),
                coords: {
                    latitude: pos.coords.latitude,
                    longitude: pos.coords.longitude,
                    accuracy: pos.coords.accuracy || null,
                    altitude: pos.coords.altitude || null,
                    altitudeAccuracy: pos.coords.altitudeAccuracy || null,
                    heading: pos.coords.heading || null,
                    speed: pos.coords.speed || null,
                },
            };
            window.__att_ctrl_last_live_coords = { lat: pos.coords.latitude, lon: pos.coords.longitude, ts: nowMs() };
        } catch (e) {}
    }

    // Expose helper to prime cache (can be called by your inject_office_label.js after geolocation)
    window.__att_ctrl_geo_cache_set = function (lat, lon, accuracy) {
        window.__att_ctrl_geo_cache = {
            ts: nowMs(),
            coords: { latitude: lat, longitude: lon, accuracy: accuracy || null, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
        };
        log('Cache primed manually', window.__att_ctrl_geo_cache);
    };

    // Patch geolocation (if available)
    var geo = (navigator && navigator.geolocation) ? navigator.geolocation : null;
    if (!geo || typeof geo.getCurrentPosition !== 'function') {
        log('navigator.geolocation not available; patch skipped');
        return;
    }

    var _origGetCurrentPosition = geo.getCurrentPosition.bind(geo);

    geo.getCurrentPosition = function (success, error, options) {
        try {
            if (window.__att_ctrl_geo_cache_enabled) {
                var c = getCache();
                if (c) {
                    log('Using cached position (age<=15s, dist<=50m)', c);
                    if (typeof success === 'function') {
                        // Call success asynchronously to preserve async contract
                        setTimeout(function () {
                            success(makePosition(c.coords.latitude, c.coords.longitude, c.coords.accuracy, nowMs()));
                        }, 0);
                        return;
                        // Refresh cache in background (non-blocking)
                        try {
                            setTimeout(function () {
                                _origGetCurrentPosition(function (pos) {
                                    setCacheFromPosition(pos);
                                }, function () {}, options);
                            }, 0);
                        } catch (e) {}
                    }
                }
            }
        } catch (e) {
            // ignore and fall back
        }

        // Fall back to browser geolocation, but update cache on success
        return _origGetCurrentPosition(function (pos) {
            setCacheFromPosition(pos);
            if (typeof success === 'function') success(pos);
        }, function (err) {
            if (typeof error === 'function') error(err);
        }, options);
    };

    log('Geolocation cache patch active (non-AMD)');
})();
