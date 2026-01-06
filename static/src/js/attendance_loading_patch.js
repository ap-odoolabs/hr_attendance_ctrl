/**
 * Attendance Loading Overlay Patch
 * Shows a "Saving attendance..." overlay from the moment user clicks Check In/Out
 * and hides it when /hr_attendance/systray_check_in_out XHR completes.
 *
 * Purpose: make the long geolocation wait visible and prevent users from logging out too early.
 */
(function () {
    'use strict';

    var OVERLAY_ID = 'att_ctrl_loading_overlay';
    var STYLE_ID = 'att_ctrl_loading_overlay_style';
    var loading = false;
    var loadingTimer = null;
    var lastClickAt = 0;

    function _ts() {
        try { return new Date().toISOString(); } catch (e) { return ''; }
    }
    function _log() {
        if (window.__att_ctrl_debug) {
            try { console.log.apply(console, ['[ATT_CTRL][LOADING]', _ts()].concat([].slice.call(arguments))); } catch (e) {}
        }
    }

    // Heuristic: identify attendance Check In/Out button
    function _isAttendanceButton(el) {
        if (!el) return false;
        var btn = el.closest ? el.closest('button,a,.btn') : el;
        if (!btn) return false;

        // Scope to attendance areas (systray dropdown or attendance view)
        var inAttendanceArea = !!(btn.closest && (
            btn.closest('.o_hr_attendance') ||
            btn.closest('.o_attendance_kiosk') ||
            btn.closest('.o_mail_systray_dropdown') ||  // some versions
            btn.closest('.o_systray_dropdown') ||
            btn.closest('.o-dropdown') ||
            btn.closest('.o_popover') ||
            btn.closest('.dropdown-menu')
        ));

        // Text match
        var txt = (btn.textContent || '').trim().toLowerCase();
        var cls = (btn.className || '').toLowerCase();

        // Known buttons often have these classes/selectors
        var looksLikeAttendance = (
            cls.indexOf('o_hr_attendance_sign_in_out') !== -1 ||
            cls.indexOf('o_hr_attendance_sign_in') !== -1 ||
            cls.indexOf('o_hr_attendance_sign_out') !== -1
        );

        // Fallback text patterns (English/Indonesian)
        var textMatch = (
            txt === 'check in' || txt === 'check out' ||
            txt.indexOf('check in') !== -1 || txt.indexOf('check out') !== -1 ||
            txt === 'masuk' || txt === 'pulang' ||
            txt.indexOf('masuk') !== -1 || txt.indexOf('pulang') !== -1
        );

        // Require button-ish + in attendance area to avoid false positives
        var isButtonish = (btn.tagName === 'BUTTON' || cls.indexOf('btn') !== -1);
        return isButtonish && inAttendanceArea && (looksLikeAttendance || textMatch);
    }

    function _ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = `
#${OVERLAY_ID} {
  position: fixed;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  background: rgba(255,255,255,0.55);
  z-index: 2147483000;
}
#${OVERLAY_ID} .att-ctrl-box {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(0,0,0,0.70);
  color: #fff;
  font-size: 13px;
  box-shadow: 0 6px 18px rgba(0,0,0,0.18);
}
#${OVERLAY_ID} .att-ctrl-spinner {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.35);
  border-top-color: #fff;
  animation: attCtrlSpin 0.8s linear infinite;
}
@keyframes attCtrlSpin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }
.att-ctrl-btn-disabled {
  opacity: 0.65 !important;
  cursor: wait !important;
}
        `;
        document.head.appendChild(st);
    }

    function _ensureOverlay() {
        _ensureStyle();
        var ov = document.getElementById(OVERLAY_ID);
        if (ov) return ov;

        ov = document.createElement('div');
        ov.id = OVERLAY_ID;

        var box = document.createElement('div');
        box.className = 'att-ctrl-box';

        var sp = document.createElement('div');
        sp.className = 'att-ctrl-spinner';

        var tx = document.createElement('div');
        tx.className = 'att-ctrl-text';
        tx.textContent = 'Saving attendance...';

        box.appendChild(sp);
        box.appendChild(tx);
        ov.appendChild(box);
        document.body.appendChild(ov);
        return ov;
    }

    function _setButtonDisabled(btn, disabled) {
        try {
            if (!btn) return;
            if (disabled) {
                btn.classList.add('att-ctrl-btn-disabled');
                btn.setAttribute('disabled', 'disabled');
                btn.setAttribute('aria-disabled', 'true');
            } else {
                btn.classList.remove('att-ctrl-btn-disabled');
                btn.removeAttribute('disabled');
                btn.removeAttribute('aria-disabled');
            }
        } catch (e) {}
    }

    var lastClickedButton = null;

    function showLoading(reason) {
        if (loading) return;
        loading = true;
        var ov = _ensureOverlay();
        ov.style.display = 'flex';
        _log('Overlay ON', reason || '');

        // Safety auto-hide (e.g. user denied geolocation, request never sent)
        clearTimeout(loadingTimer);
        loadingTimer = setTimeout(function () {
            _log('Overlay auto-hide after timeout');
            hideLoading('timeout');
        }, 90000);
    }

    function hideLoading(reason) {
        if (!loading) return;
        loading = false;
        var ov = document.getElementById(OVERLAY_ID);
        if (ov) ov.style.display = 'none';
        clearTimeout(loadingTimer);
        loadingTimer = null;
        _setButtonDisabled(lastClickedButton, false);
        lastClickedButton = null;
        _log('Overlay OFF', reason || '');
    }

    // 1) Capture click early to show loading immediately
    document.addEventListener('click', function (ev) {
        var t = ev.target;
        if (!_isAttendanceButton(t)) return;

        // Prevent double-trigger overlay spam
        var now = Date.now();
        if (now - lastClickAt < 400) return;
        lastClickAt = now;

        var btn = t.closest ? t.closest('button,a,.btn') : t;
        lastClickedButton = btn;
        _setButtonDisabled(btn, true);
        showLoading('click');
    }, true); // capture=true

    // 2) Patch XHR to hide overlay after the check-in/out request finishes
    (function patchXHR() {
        var XHR = window.XMLHttpRequest;
        if (!XHR || XHR.__attCtrlPatched) return;

        var origOpen = XHR.prototype.open;
        var origSend = XHR.prototype.send;

        XHR.prototype.open = function (method, url) {
            try { this.__attCtrlUrl = url; } catch (e) {}
            return origOpen.apply(this, arguments);
        };

        XHR.prototype.send = function () {
            var url = '';
            try { url = this.__attCtrlUrl || ''; } catch (e) {}
            var isCheck = (typeof url === 'string' && url.indexOf('/hr_attendance/systray_check_in_out') !== -1);

            if (isCheck) {
                _log('Detected XHR systray_check_in_out -> will hide overlay on loadend');
                var xhr = this;
                var done = function (evt) {
                    xhr.removeEventListener('loadend', done);
                    // Hide regardless of success/failure (errors can be shown by Odoo)
                    hideLoading('xhr-loadend');
                };
                xhr.addEventListener('loadend', done);
            }
            return origSend.apply(this, arguments);
        };

        XHR.__attCtrlPatched = true;
        _log('XHR patched');
    })();

    // 3) Also hide overlay on page unload (avoid stuck overlay if navigation)
    window.addEventListener('beforeunload', function () {
        try { hideLoading('unload'); } catch (e) {}
    });
})();
