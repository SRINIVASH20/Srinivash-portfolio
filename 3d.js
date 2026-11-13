/* Fly-through controller for 3d.html. Plain JavaScript, no libraries.

   Scrolling moves a camera forward along the Z axis. The page has a tall
   invisible #track so the browser's own scrolling (wheel, keys, touch, scrollbar)
   drives the flight. Each panel fades in as the camera approaches and out as it
   passes. When the window is small, motion is reduced, or CSS 3D is missing,
   nothing here runs and the flat stacked layout is shown instead. */
(function () {
    'use strict';

    var root = document.documentElement;
    var world = document.getElementById('world');
    var track = document.getElementById('track');
    var bg = document.getElementById('bg');
    var rail = document.getElementById('rail');
    var hint = document.getElementById('hint');
    var panels = Array.prototype.slice.call(document.querySelectorAll('.panel'));
    var navLinks = Array.prototype.slice.call(document.querySelectorAll('[data-go]'));

    var N = panels.length;
    var D = 900;                                   // distance between panels, in px
    var PX = [0, -7, 7, -7, 7, -6, 6, 0];          // sideways offset per panel, in vw
    var STEP_VH = 0.9;                             // scroll distance per panel, as a share of window height

    var supports3d = !!(window.CSS && CSS.supports && CSS.supports('transform-style', 'preserve-3d'));
    var query = window.matchMedia('(min-width: 900px) and (min-height: 540px) and (prefers-reduced-motion: no-preference)');

    var on = false;
    var raf = 0;
    var cur = 0;            // current camera position, in panel units (eased)
    var vel = 0;            // change of `cur` per frame, drives the star streaks
    var mx = 0, my = 0, rx = 0, ry = 0;
    var activeIndex = -1;
    var camZNow = 0, camXNow = 0;
    var perfFrames = 0, perfStart = 0, perfDone = false;

    function clamp(v, a, b) { return Math.min(Math.max(v, a), b); }
    function smooth(t) { return t * t * (3 - 2 * t); }

    // Linear scroll position -> eased panel position, so the camera lingers at each panel.
    function eased(f) {
        var k = Math.floor(f);
        if (k >= N - 1) { return N - 1; }
        var t = f - k;
        return k + (0.7 * smooth(t) + 0.3 * t);
    }

    function stepPx() { return Math.round(window.innerHeight * STEP_VH); }

    function scrollFraction() {
        var y = window.pageYOffset || root.scrollTop || 0;
        return clamp(y / stepPx(), 0, N - 1);
    }

    function goTo(k, smoothScroll) {
        window.scrollTo({ top: k * stepPx(), behavior: smoothScroll ? 'smooth' : 'auto' });
    }

    /* ---------- Rail (side dots) ---------- */
    var railButtons = [];

    function buildRail() {
        if (railButtons.length) { return; }
        panels.forEach(function (panel, k) {
            var b = document.createElement('button');
            b.type = 'button';
            var label = panel.getAttribute('data-label') || ('Section ' + (k + 1));
            b.setAttribute('aria-label', 'Go to ' + label);
            var tip = document.createElement('span');
            tip.className = 'tip';
            tip.textContent = label;
            tip.setAttribute('aria-hidden', 'true');
            b.appendChild(tip);
            b.addEventListener('click', function () { goTo(k, true); });
            rail.appendChild(b);
            railButtons.push(b);
        });
    }

    function setActive(k) {
        if (k === activeIndex) { return; }
        activeIndex = k;
        railButtons.forEach(function (b, i) {
            b.setAttribute('aria-current', i === k ? 'true' : 'false');
        });
        navLinks.forEach(function (a) {
            var from = parseInt(a.getAttribute('data-go'), 10);
            var to = a.hasAttribute('data-end') ? parseInt(a.getAttribute('data-end'), 10) : from;
            if (k >= from && k <= to && !(from === 0 && k !== 0)) {
                a.setAttribute('aria-current', 'location');
            } else {
                a.removeAttribute('aria-current');
            }
        });
    }

    /* ---------- Star field ---------- */
    var ctx = bg.getContext('2d');
    var W = 0, H = 0, dpr = 1;
    var stars = [];
    var STAR_COLORS = ['60,196,207', '154,139,255', '255,132,102', '255,194,74'];
    var STAR_COUNT = 170;

    function resetStar(s, far) {
        s.x = (Math.random() - 0.5) * 2;
        s.y = (Math.random() - 0.5) * 2;
        s.z = far ? 0.9 + Math.random() * 0.1 : 0.04 + Math.random() * 0.06;
        s.c = STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)];
    }

    function sizeBg() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        W = window.innerWidth;
        H = window.innerHeight;
        bg.width = Math.round(W * dpr);
        bg.height = Math.round(H * dpr);
    }

    function initStars() {
        stars = [];
        for (var i = 0; i < STAR_COUNT; i++) {
            var s = {};
            resetStar(s, false);
            s.z = 0.05 + Math.random() * 0.95;
            stars.push(s);
        }
    }


    /* ---------- Perspective grid floor (drawn, so there is no huge DOM layer) ---------- */
    var GRID = 120;          // spacing in world px
    var FOCAL = 1100;        // matches the CSS perspective

    function drawGrid(camZ, camX) {
        var cx = W / 2;
        var cy = H * 0.45;
        var floorY = H * 0.71;                 // where the floor sits on the z = 0 plane
        var drop = floorY - cy;
        var offset = camZ % GRID;
        var n, s, sc, y, a;

        // Rows: lines across the floor, nearer rows are brighter.
        ctx.lineWidth = 1.2;
        for (n = 0; n < 70; n++) {
            s = n * GRID - offset - GRID;
            if (s < -600) { continue; }
            sc = FOCAL / (FOCAL + s);
            y = cy + drop * sc;
            if (y > H + 2) { continue; }
            a = Math.max(0, 0.55 * (1 - s / 5200));
            if (a <= 0.01) { break; }
            ctx.strokeStyle = 'rgba(60,196,207,' + a.toFixed(3) + ')';
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(W, y);
            ctx.stroke();
        }

        // Columns: lines running away from the viewer, meeting at the horizon.
        var sNear = -580;
        var sFar = 5600;
        var scNear = FOCAL / (FOCAL + sNear);
        var scFar = FOCAL / (FOCAL + sFar);
        var yNear = cy + drop * scNear;
        var yFar = cy + drop * scFar;
        ctx.lineWidth = 1.1;
        for (var m = -16; m <= 16; m++) {
            var wx = m * GRID - (camX % GRID);
            var x1 = cx + wx * scNear;
            var x2 = cx + wx * scFar;
            var g = ctx.createLinearGradient(0, yNear, 0, yFar);
            g.addColorStop(0, 'rgba(154,139,255,0.5)');
            g.addColorStop(1, 'rgba(154,139,255,0)');
            ctx.strokeStyle = g;
            ctx.beginPath();
            ctx.moveTo(x1, yNear);
            ctx.lineTo(x2, yFar);
            ctx.stroke();
        }
    }

    function drawStars() {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        drawGrid(camZNow, camXNow);
        var cx = W / 2;
        var cy = H * 0.45;
        var speed = 0.0006 + vel * 0.4;
        var streak = Math.abs(vel) * 0.4 * 3;
        ctx.lineCap = 'round';

        for (var i = 0; i < stars.length; i++) {
            var s = stars[i];
            s.z -= speed;
            if (s.z < 0.03) { resetStar(s, true); }
            if (s.z > 1.0) { resetStar(s, false); }

            var sx = cx + s.x * cx * 0.35 / s.z;
            var sy = cy + s.y * cy * 0.35 / s.z;
            if (sx < -40 || sx > W + 40 || sy < -40 || sy > H + 40) { resetStar(s, true); continue; }

            var alpha = Math.min(1, 0.15 + (1 - s.z) * 0.95);
            ctx.strokeStyle = 'rgba(' + s.c + ',' + alpha.toFixed(2) + ')';
            ctx.fillStyle = ctx.strokeStyle;

            if (streak > 0.004) {
                var z2 = s.z + (vel > 0 ? streak : -streak);
                var px = cx + s.x * cx * 0.35 / Math.max(z2, 0.03);
                var py = cy + s.y * cy * 0.35 / Math.max(z2, 0.03);
                ctx.lineWidth = 0.6 + (1 - s.z) * 1.8;
                ctx.beginPath();
                ctx.moveTo(px, py);
                ctx.lineTo(sx, sy);
                ctx.stroke();
            } else {
                var r = 0.5 + (1 - s.z) * 1.7;
                ctx.beginPath();
                ctx.arc(sx, sy, r, 0, 6.2832);
                ctx.fill();
            }
        }
    }

    /* ---------- Layout ---------- */
    function layout() {
        var step = stepPx();
        track.style.height = ((N - 1) * step + window.innerHeight) + 'px';
        panels.forEach(function (panel, k) {
            panel.style.setProperty('--k', k);
            panel.style.setProperty('--px', (PX[k] * window.innerWidth / 100) + 'px');
        });
        sizeBg();
    }

    /* ---------- Frame ---------- */
    // If the device cannot keep up, switch to a lighter look (static cubes, simpler shadows).
    function watchPerformance() {
        if (perfDone) { return; }
        var now = window.performance.now();
        if (!perfStart) { perfStart = now; return; }
        perfFrames++;
        if (perfFrames >= 80) {
            var avg = (now - perfStart) / perfFrames;
            perfDone = true;
            if (avg > 36) {
                root.classList.add('lite');
                STAR_COUNT = 90;
                initStars();
            }
        }
    }

    function frame() {
        watchPerformance();
        var target = eased(scrollFraction());
        var prev = cur;
        cur += (target - cur) * 0.085;
        if (Math.abs(target - cur) < 0.0004) { cur = target; }
        vel = cur - prev;

        var camZ = cur * D;
        camZNow = camZ;

        var base = clamp(cur, 0, N - 1);
        var k0 = Math.floor(base);
        var k1 = Math.min(k0 + 1, N - 1);
        var camX = (PX[k0] + (PX[k1] - PX[k0]) * smooth(base - k0)) * window.innerWidth / 100;

        camXNow = camX;
        ry += (mx * 3 - ry) * 0.06;
        rx += (-my * 2 - rx) * 0.06;

        world.style.transform = 'rotateX(' + rx.toFixed(3) + 'deg) rotateY(' + ry.toFixed(3) +
            'deg) translate3d(' + (-camX).toFixed(1) + 'px,0,' + camZ.toFixed(1) + 'px)';

        for (var k = 0; k < N; k++) {
            var z = camZ - k * D;                          // > 0 means the camera has passed it
            var over = Math.abs(z) - 0.12 * D;
            var range = z < 0 ? 1.05 * D : 0.42 * D;
            var o = over <= 0 ? 1 : clamp(1 - over / range, 0, 1);
            o = smooth(o);
            var p = panels[k];
            p.style.opacity = o.toFixed(3);
            p.classList.toggle('is-live', o > 0.7);
        }

        setActive(clamp(Math.round(cur), 0, N - 1));
        if (hint) { hint.classList.toggle('is-gone', cur > 0.25); }

        drawStars();
        raf = window.requestAnimationFrame(frame);
    }

    /* ---------- On / off ---------- */
    function enable() {
        if (on) { return; }
        on = true;
        root.classList.add('is-3d');
        buildRail();
        layout();
        initStars();
        activeIndex = -1;
        cur = -0.8;          // start slightly behind the first panel so it flies in
        vel = 0;

        var hash = window.location.hash;
        if (hash) {
            var target = document.querySelector(hash);
            var idx = target ? panels.indexOf(target) : -1;
            if (idx > 0) { goTo(idx, false); cur = idx - 0.8; }
        }
        raf = window.requestAnimationFrame(frame);
    }

    function disable() {
        if (!on) { return; }
        on = false;
        window.cancelAnimationFrame(raf);
        root.classList.remove('is-3d');
        world.style.transform = '';
        track.style.height = '';
        panels.forEach(function (p) {
            p.style.opacity = '';
            p.style.removeProperty('--k');
            p.style.removeProperty('--px');
            p.classList.remove('is-live');
        });
        navLinks.forEach(function (a) { a.removeAttribute('aria-current'); });
        activeIndex = -1;
    }

    function sync() {
        if (supports3d && query.matches) { enable(); } else { disable(); }
    }

    if (query.addEventListener) { query.addEventListener('change', sync); }
    else if (query.addListener) { query.addListener(sync); }

    var resizeTimer = 0;
    window.addEventListener('resize', function () {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(function () { if (on) { layout(); } }, 80);
    });

    document.addEventListener('visibilitychange', function () {
        if (!on) { return; }
        if (document.hidden) { window.cancelAnimationFrame(raf); }
        else { raf = window.requestAnimationFrame(frame); }
    });

    window.addEventListener('pointermove', function (e) {
        mx = (e.clientX / window.innerWidth - 0.5) * 2;
        my = (e.clientY / window.innerHeight - 0.5) * 2;
    });

    // Header links fly to the panel instead of jumping.
    navLinks.forEach(function (a) {
        a.addEventListener('click', function (e) {
            if (!on) { return; }
            e.preventDefault();
            goTo(parseInt(a.getAttribute('data-go'), 10), true);
        });
    });

    // Keyboard users: tabbing into a panel that is out of view flies the camera to it.
    document.addEventListener('focusin', function (e) {
        if (!on || !e.target.closest) { return; }
        var panel = e.target.closest('.panel');
        var k = panel ? panels.indexOf(panel) : -1;
        if (k > -1 && Math.abs(k - cur) > 0.6) { goTo(k, false); }
    });

    sync();
})();
