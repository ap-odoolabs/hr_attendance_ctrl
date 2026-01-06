/** @odoo-module **/

(function () {
    const ROOT_CLASS = "o_att_box_root";
    const BOX_CLASS = "o_att_box_left";

    function clampPopoverLeft(pop) {
        if (!pop) return;
        try {
            // Remove any transforms that offset visually
            pop.style.transform = "none";
            pop.style.right = "auto";
            // Compute desired left so the popover fits the viewport with 16px margin
            const margin = 16;
            const rect = pop.getBoundingClientRect();
            // Current left from style (fallback to rect.left if not numeric)
            const currentLeftPx = (pop.style.left || "").replace("px","");
            let currentLeft = parseFloat(currentLeftPx);
            if (!isFinite(currentLeft)) currentLeft = rect.left;
            const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
            const maxLeft = Math.max(margin, vw - rect.width - margin);
            const newLeft = Math.min(Math.max(currentLeft, margin), maxLeft);
            pop.style.left = newLeft + "px";
            // Keep top from Odoo, but don’t let it go off-screen
            const topPx = (pop.style.top || "").replace("px","");
            let top = parseFloat(topPx);
            if (!isFinite(top)) top = Math.max(margin, rect.top);
            const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
            const maxTop = Math.max(margin, vh - rect.height - margin);
            const newTop = Math.min(Math.max(top, margin), maxTop);
            pop.style.top = newTop + "px";
            // Prevent overflow width
            pop.style.maxWidth = `calc(100vw - ${margin * 2}px)`;
        } catch (e) {
            // swallow
        }
    }

    function markRoot(box) {
        const root = box.closest(".o_action") || box.closest(".o_content") || document.querySelector(".o_action");
        if (root && !root.classList.contains(ROOT_CLASS)) {
            root.classList.add(ROOT_CLASS);
        }
    }

    function apply() {
        try {
            const box = document.querySelector(".o_att_menu_container");
            if (!box) return;
            box.classList.add(BOX_CLASS);
            markRoot(box);
            // Find the popover that contains the box and clamp its position
            const pop = box.closest(".o_popover.popover");
            if (pop) clampPopoverLeft(pop);
        } catch (e) {}
    }

    function init() {
        apply();
        const mo = new MutationObserver(() => apply());
        mo.observe(document.documentElement, { childList: true, subtree: true });
        window.addEventListener("resize", () => apply());
        setInterval(apply, 1000);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
