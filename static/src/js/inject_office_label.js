/**
 * NON-AMD injector for "Office" + "GPS Coordinates" in Odoo Attendance.
 * - No odoo.define / require
 * - Finds Check in/Check out buttons in both attendance forms AND the systray dropdown
 * - Injects label *right above the button* within the nearest relevant container
 * - Uses Geolocation + JSON-RPC fetch to /attendance_ctrl/get_name
 * - Debug logs via window.__att_debug
 */
(function () {
    'use strict';

    // Debug helpers (enable by setting window.__att_ctrl_debug = true)
    function _ts() {
        try {
            var d = new Date();
            return d.toISOString().replace('T',' ').replace('Z','') + '.' + String(d.getMilliseconds()).padStart(3,'0');
        } catch (e) { return String(Date.now()); }
    }

    var lastLat, lastLon, lastRenderedKey, busy = false;
    var LABEL_CLASS = 'o_hr_attendance_office_label';

    function d(msg) { try { (window.__att_debug = window.__att_debug || []).push(msg); } catch (e) {} }
    function textOf(el) { return (el && el.textContent || '').trim().toLowerCase(); }
    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    function isVisible(el) { return !!(el && (el.offsetParent || el.getClientRects().length)); }

    function looksLikeAttendanceContainer(el) {
        if (!el) return false;
        var c = (el.className || '').toLowerCase();
        var id = (el.id || '').toLowerCase();
        return /attendance|hr_attendance|o_att|kiosk/.test(c + ' ' + id);
    }

    // Known selectors for attendance buttons (various views)
    var ANCHOR_SELECTORS = [
        '.o_hr_attendance_sign_in_out',
        '.o_hr_attendance_sign_in',
        '.o_hr_attendance_sign_out',
        '[name="attendance_manual"]',
        '[name="action_my_attendance"]',
        '.o_attendance_kiosk .btn-primary',
        '.o_attendance_kiosk .btn',
        '.o_hr_attendance .btn-primary',
        '.o_hr_attendance .btn',
        '.o_att_menu_container .btn',
        '.o_attendance .btn-primary',
        '.o_attendance .btn',
        // Systray/dropdown contexts:
        '.o-dropdown-menu .btn-success',
        '.o-dropdown-menu .btn-primary',
        '.dropdown-menu .btn-success',
        '.dropdown-menu .btn-primary',
        '.o_menu_systray .btn-success',
        '.o_menu_systray .btn-primary'
    ];

    // Match by text (EN + ID), incl. "Masuk in" variants
    var TEXT_PATTERNS = [
        /check\s*[-_/ ]*\s*in/i, /check\s*[-_/ ]*\s*out/i,
        /sign\s*in/i, /sign\s*out/i,
        /clock\s*in/i, /clock\s*out/i,
        /\bmasuk\b/i, /\bkeluar\b/i, /masuk\s*in/i
    ];

    function findTarget() {
        // 1) Try known selectors
        for (var i = 0; i < ANCHOR_SELECTORS.length; i++) {
            var list = document.querySelectorAll(ANCHOR_SELECTORS[i]);
            for (var j = 0; j < list.length; j++) {
                var el = list[j];
                if (!isVisible(el)) continue;
                var section = el.closest('.o_att_menu_container, .o_hr_attendance, .o_attendance_kiosk, .o_attendance, .modal, .o_popover, .o-dropdown-menu, .dropdown-menu, .o_menu_systray, header, .o_navbar');
                if (!section) section = el.parentElement || document.body;
                // Require that either section or any ancestor looks like attendance or dropdown/systray
                var guard = section.closest('.o_att_menu_container, .o_hr_attendance, .o_attendance_kiosk, .o_attendance, .o-dropdown-menu, .dropdown-menu, .o_menu_systray, header, .o_navbar');
                if (!guard) continue;
                return { anchor: el, section: section };
            }
        }
        // 2) Try by text content
        var nodes = document.querySelectorAll('button, a, [role="button"]');
        for (var k = 0; k < nodes.length; k++) {
            var e = nodes[k];
            if (!isVisible(e)) continue;
            var t = textOf(e);
            if (!t) continue;
            for (var p = 0; p < TEXT_PATTERNS.length; p++) {
                if (TEXT_PATTERNS[p].test(t)) {
                    var sec = e.closest('.o_att_menu_container, .o_hr_attendance, .o_attendance_kiosk, .o_attendance, .modal, .o_popover, .o-dropdown-menu, .dropdown-menu, .o_menu_systray, header, .o_navbar');
                    if (!sec) sec = e.parentElement || document.body;
                    return { anchor: e, section: sec };
                }
            }
        }
        d('no target found');
        return null;
    }

    function renderAt(section, anchor, officeText, latitude, longitude) {
        if (!section || !anchor) return;
        var root = section;
        var box = root.querySelector('.' + LABEL_CLASS);
        if (!box) {
            box = document.createElement('div');
            // Never block clicks on the real Check In/Out button (critical for systray UX)
            box.style.pointerEvents = 'none';
            box.style.userSelect = 'none';
            box.className = LABEL_CLASS;
            box.className += ' card rounded-3 border shadow-sm mt-3';
            box.style.marginBottom = '0.5rem';
            box.style.fontSize = '0.9rem';
            box.style.maxWidth = '100%';
            box.style.overflow = 'hidden';
            // Insert right AFTER the anchor button
            if (anchor.parentNode) anchor.parentNode.insertBefore(box, anchor.nextSibling);
            else root.insertBefore(box, root.firstChild);
        }

        // Render framed layout with Office inline and GPS on the right
        var _office = (officeText && String(officeText).trim()) || '-';
        _office = escapeHtml(_office);
        var _lat = (typeof latitude !== 'undefined' && latitude !== null) ? latitude : '-';
        _lat = escapeHtml(_lat);
        var _lon = (typeof longitude !== 'undefined' && longitude !== null) ? longitude : '-';
        _lon = escapeHtml(_lon);

        box.innerHTML = ''
            + '<div style="background-color:#F0F8FF;" class="card-body py-2 px-3">'
            + '  <div class="d-flex flex-column gap-2">'
            + '    <div class="d-flex align-items-center gap-2">'
            + '      <small class="text-muted mb-0">GEO-access: </small>'
            + '      <div class="mb-0"><strong>' + _office + '</strong></div>'
            + '    </div>'
            + '    <div class="d-flex align-items-center gap-2 text-muted">'
            + '      <small class="mb-0">Geolocation: </small>'
            + '      <div class="mb-0">' + _lat + ' , ' + _lon + '</div>'
            + '    </div>'
            + '  </div>'
            + '</div>';
        
        return;
    }

    function getOfficeName(lat, lon) {
        var payload = { jsonrpc: '2.0', method: 'call', params: { latitude: lat, longitude: lon }, id: Date.now() };
        /* debug only  */
        return fetch('/attendance_ctrl/get_name', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(payload),
        }).then(function (r) { /* debug only  */ return r.json(); })
          .then(function (data) { return (data && data.result) ? data.result : data; })
          .catch(function () { return null; });
    }

    function ensureInjected() {
        if (busy) return;
        var tgt = findTarget();
        if (!tgt) return;
        busy = true;
        /* debug only  */

        var renderWith = function (officeText, lat, lon) {
            lastLat = lat; lastLon = lon;
            renderAt(tgt.section, tgt.anchor, officeText, lat, lon);
            /* debug only  */
            busy = false;
        };

        if (navigator.geolocation) {
            /* debug only  */
            navigator.geolocation.getCurrentPosition(function (pos) {
                var lat = pos.coords.latitude;
                var lon = pos.coords.longitude;
                getOfficeName(lat, lon).then(function (res) {
                    if (res) {
                        var officeText = (res && res.location !== undefined) ? res.location : '-';
                        var rlat = (res && res.latitude !== undefined) ? res.latitude : lat;
                        var rlon = (res && res.longitude !== undefined) ? res.longitude : lon;
                        renderWith(officeText, rlat, rlon);
                    } else {
                        renderWith('-', lat, lon);
                    }
                }).catch(function () {
                    renderWith('-', lat, lon);
                });
            }, function () {
                renderWith('-', lastLat, lastLon);
            });
        } else {
            renderWith('-', lastLat, lastLon);
        }
    }

    // Debug: capture clicks on check-in/out buttons (helps correlate with Network timings)
    document.addEventListener('click', function (ev) {
        try {
            var el = ev.target;
            if (!el) return;
            // climb up to a button/anchor if needed
            var btn = el.closest ? el.closest('button, a, [role="button"]') : null;
            if (!btn) return;
            var t = (btn.textContent || '').trim();
            var cls = (btn.className || '');
            var href = btn.getAttribute ? btn.getAttribute('href') : '';
            // match likely attendance buttons by text OR known classes
            var tl = t.toLowerCase();
            var matchText = (/check\s*[-_/ ]*\s*in/i.test(t) || /check\s*[-_/ ]*\s*out/i.test(t) || /sign\s*in/i.test(t) || /sign\s*out/i.test(t) || /\bmasuk\b/i.test(t) || /\bkeluar\b/i.test(t) || /masuk\s*in/i.test(t));
            var matchCls = (/(o_hr_attendance_sign_in_out|o_hr_attendance_sign_in|o_hr_attendance_sign_out)/i.test(cls));
            if (matchText || matchCls) {
                /* debug only  */
            }
        } catch (e) {}
    }, true);

    // Observe DOM and navigation
    var observer = new MutationObserver(function () { try { requestAnimationFrame(ensureInjected); } catch (e) {} });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('click', function () { setTimeout(ensureInjected, 50); setTimeout(ensureInjected, 300); });
    window.addEventListener('hashchange', function () { setTimeout(ensureInjected, 50); });
    document.addEventListener('DOMContentLoaded', function () { setTimeout(ensureInjected, 50); });
    window.addEventListener('load', function () { setTimeout(ensureInjected, 50); });

    // Legacy global export: try to inject near the detected button only
    window.injectLabel = function (container, text, latitude, longitude) {
        var tgt = findTarget();
        if (!tgt) { d('legacy injectLabel called but no target'); return; }
        renderAt(tgt.section, tgt.anchor, text, latitude, longitude);
    };
})();
