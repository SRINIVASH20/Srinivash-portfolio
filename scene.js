/* Hero 3D scene: 168 hourly demand bars (7 days x 24 hours), drawn with the
   plain 2D canvas API and a small hand-written 3D projection. No libraries.

   Teal bars are "actual" days, amber bars are the forecast days. The numbers
   are generated for illustration only. If canvas is unavailable, the flat SVG
   chart inside #stage stays visible instead. */
(function () {
    'use strict';

    var stage = document.getElementById('stage');
    if (!stage) { return; }

    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    if (!ctx) { return; }

    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Rotating 3D bar chart of hourly electricity demand over seven days. The last two days, in amber, are the forecast. Illustration only.');
    stage.appendChild(canvas);
    stage.classList.add('has-3d');

    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ---------- Data ---------- */
    var HOURS = 24;
    var DAYS = 7;
    var FORECAST_DAYS = 2;
    var COUNT = HOURS * DAYS;
    var GAP = 0.56;
    var DAY_GAP = GAP * 1.35;
    var HALF = 0.2;            // half of the bar's footprint
    var HEIGHT_SCALE = 0.95;

    function pseudo(n) {
        var x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
        return x - Math.floor(x);
    }

    // Two daily peaks. Actual days get small repeatable noise; forecast days
    // are smooth, the way a model output looks.
    function demand(hour, day) {
        var morning = 1.5 * Math.exp(-Math.pow(hour - 8, 2) / 7);
        var evening = 2.3 * Math.exp(-Math.pow(hour - 19.5, 2) / 9);
        var base = 0.7 + 0.25 * Math.sin((hour / 24) * Math.PI * 2 - 1.6);
        var weekend = (day === 5 || day === 6) ? 0.9 : 1;
        var value = (base + morning + evening) * weekend;
        if (day < DAYS - FORECAST_DAYS) {
            value += (pseudo(hour * 7 + day * 31) - 0.5) * 0.45;
        }
        return Math.max(0.35, value);
    }

    var bars = [];
    var maxValue = 0;
    var width = (HOURS - 1) * GAP;
    var depth = (DAYS - 1) * DAY_GAP;
    var d, h;

    for (d = 0; d < DAYS; d++) {
        for (h = 0; h < HOURS; h++) {
            var value = demand(h, d);
            if (value > maxValue) { maxValue = value; }
            bars.push({
                x: h * GAP - width / 2,
                z: d * DAY_GAP - depth / 2,
                value: value,
                forecast: d >= DAYS - FORECAST_DAYS,
                delay: h * 0.028 + d * 0.11,
                depth: 0
            });
        }
    }

    /* ---------- Colors (read from CSS variables, so the theme can change them) ---------- */
    var palette = {};

    function hexToRgb(hex) {
        var v = hex.trim().replace('#', '');
        if (v.length === 3) { v = v[0] + v[0] + v[1] + v[1] + v[2] + v[2]; }
        return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
    }

    function readPalette() {
        var css = getComputedStyle(document.documentElement);
        function get(name, fallback) {
            var v = css.getPropertyValue(name);
            return hexToRgb(v && v.trim() ? v : fallback);
        }
        palette.barLo = get('--bar-lo', '#9CC8CC');
        palette.barHi = get('--bar-hi', '#123038');
        palette.fcLo = get('--fc-lo', '#F8D788');
        palette.fcHi = get('--fc-hi', '#E39A00');
        palette.slab = get('--slab', '#E6ECE9');
        palette.slabEdge = get('--slab-edge', '#CBD6D3');
    }

    function mix(a, b, t) {
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    }

    function rgb(c, k) {
        var r = Math.max(0, Math.min(255, Math.round(c[0] * k)));
        var g = Math.max(0, Math.min(255, Math.round(c[1] * k)));
        var b = Math.max(0, Math.min(255, Math.round(c[2] * k)));
        return 'rgb(' + r + ',' + g + ',' + b + ')';
    }

    /* ---------- Projection ---------- */
    var W = 0;
    var H = 0;
    var dpr = 1;
    var unit = 1;

    var FOCAL = 40;
    var CAMERA = 24;
    var yaw = 0;
    var pitch = 0.62;
    var cosY, sinY, cosP, sinP;

    function setView() {
        cosY = Math.cos(yaw);
        sinY = Math.sin(yaw);
        cosP = Math.cos(pitch);
        sinP = Math.sin(pitch);
    }

    // World point -> [screenX, screenY, depth]. Larger depth is farther away.
    function project(x, y, z, out) {
        var rx = x * cosY + z * sinY;
        var rz = -x * sinY + z * cosY;
        var up = y * cosP + rz * sinP;
        var dep = rz * cosP - y * sinP;
        var s = FOCAL / (FOCAL + CAMERA + dep) * unit;
        out[0] = W / 2 + rx * s;
        out[1] = H * 0.54 - up * s;
        out[2] = dep;
        return out;
    }

    // Face definitions: normal, and the four corner offsets (sx, sy, sz) where
    // sx and sz are -1 or +1 in units of HALF, and sy is 0 (bottom) or 1 (top).
    var FACES = [
        { n: [0, 1, 0],  c: [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]] },     // top
        { n: [1, 0, 0],  c: [[1, 0, -1], [1, 0, 1], [1, 1, 1], [1, 1, -1]] },       // +x
        { n: [-1, 0, 0], c: [[-1, 0, 1], [-1, 0, -1], [-1, 1, -1], [-1, 1, 1]] },   // -x
        { n: [0, 0, 1],  c: [[1, 0, 1], [-1, 0, 1], [-1, 1, 1], [1, 1, 1]] },       // +z
        { n: [0, 0, -1], c: [[-1, 0, -1], [1, 0, -1], [1, 1, -1], [-1, 1, -1]] }    // -z
    ];

    // Light direction (toward the light), in camera space.
    var LIGHT = (function () {
        var v = [-0.35, 0.85, -0.45];
        var len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
        return [v[0] / len, v[1] / len, v[2] / len];
    })();

    var p0 = [0, 0, 0];
    var p1 = [0, 0, 0];
    var p2 = [0, 0, 0];
    var p3 = [0, 0, 0];
    var corners = [p0, p1, p2, p3];

    function faceShade(n) {
        // Rotate the face normal into camera space.
        var nx = n[0] * cosY + n[2] * sinY;
        var nz = -n[0] * sinY + n[2] * cosY;
        var ny = n[1] * cosP + nz * sinP;
        var nd = nz * cosP - n[1] * sinP;
        if (nd >= 0) { return -1; }            // facing away from the camera
        var dot = nx * LIGHT[0] + ny * LIGHT[1] + nd * LIGHT[2];
        return 0.55 + 0.45 * Math.max(0, dot);
    }

    function drawQuad(fill) {
        ctx.beginPath();
        ctx.moveTo(p0[0], p0[1]);
        ctx.lineTo(p1[0], p1[1]);
        ctx.lineTo(p2[0], p2[1]);
        ctx.lineTo(p3[0], p3[1]);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.strokeStyle = fill;      // same color stroke hides hairline seams
        ctx.lineWidth = 0.75;
        ctx.fill();
        ctx.stroke();
    }

    function drawSlab() {
        var sx = width / 2 + 0.7;
        var sz = depth / 2 + 0.8;
        project(-sx, 0, -sz, p0);
        project(sx, 0, -sz, p1);
        project(sx, 0, sz, p2);
        project(-sx, 0, sz, p3);
        ctx.beginPath();
        ctx.moveTo(p0[0], p0[1]);
        ctx.lineTo(p1[0], p1[1]);
        ctx.lineTo(p2[0], p2[1]);
        ctx.lineTo(p3[0], p3[1]);
        ctx.closePath();
        ctx.fillStyle = rgb(palette.slab, 1);
        ctx.fill();
        ctx.strokeStyle = rgb(palette.slabEdge, 1);
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    function easeOut(x) {
        return 1 - Math.pow(1 - x, 3);
    }

    var order = bars.slice();

    function drawBar(bar, grow) {
        var hgt = Math.max(0.001, bar.value * HEIGHT_SCALE * grow);
        var t = bar.value / maxValue;
        var base = bar.forecast ? mix(palette.fcLo, palette.fcHi, t) : mix(palette.barLo, palette.barHi, t);

        for (var f = 0; f < FACES.length; f++) {
            var face = FACES[f];
            var k = faceShade(face.n);
            if (k < 0) { continue; }
            for (var i = 0; i < 4; i++) {
                var c = face.c[i];
                project(bar.x + c[0] * HALF, c[1] * hgt, bar.z + c[2] * HALF, corners[i]);
            }
            drawQuad(rgb(base, k));
        }
    }

    function render(elapsed, intro) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);

        setView();
        drawSlab();

        // Painter's algorithm: farthest bars first.
        var k;
        for (k = 0; k < COUNT; k++) {
            var b = order[k];
            var tmp = project(b.x, 0, b.z, p0);
            b.depth = tmp[2];
        }
        order.sort(function (a, b2) { return b2.depth - a.depth; });

        for (k = 0; k < COUNT; k++) {
            var bar = order[k];
            var grow = intro ? easeOut(Math.min(Math.max((elapsed - bar.delay) / 0.9, 0), 1)) : 1;
            drawBar(bar, grow);
        }
    }

    /* ---------- Size ---------- */
    function resize() {
        var w = stage.clientWidth;
        var hh = stage.clientHeight;
        if (!w || !hh) { return; }
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        W = w;
        H = hh;
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        unit = W * 0.086;
    }

    /* ---------- Pointer tilt ---------- */
    var targetX = 0;
    var targetY = 0;
    var tiltX = 0;
    var tiltY = 0;

    stage.addEventListener('pointermove', function (e) {
        var rect = stage.getBoundingClientRect();
        targetX = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
        targetY = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    });
    stage.addEventListener('pointerleave', function () {
        targetX = 0;
        targetY = 0;
    });

    /* ---------- Loop ---------- */
    var running = false;
    var visible = true;
    var frameId = 0;
    var last = 0;
    var elapsed = 0;

    function updateView() {
        yaw = -0.55 + Math.sin(elapsed * 0.28) * 0.38 + tiltX * 0.35;
        pitch = 0.62 + tiltY * 0.08;
    }

    function tick(now) {
        if (!running) { return; }
        var dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        elapsed += dt;
        tiltX += (targetX - tiltX) * 0.06;
        tiltY += (targetY - tiltY) * 0.06;
        updateView();
        render(elapsed, elapsed < 3);
        frameId = window.requestAnimationFrame(tick);
    }

    function start() {
        if (running || reduceMotion) { return; }
        running = true;
        last = performance.now();
        frameId = window.requestAnimationFrame(tick);
    }

    function stop() {
        running = false;
        window.cancelAnimationFrame(frameId);
    }

    function refresh() {
        if (visible && !document.hidden) { start(); } else { stop(); }
    }

    function drawStill() {
        elapsed = 0;
        updateView();
        render(0, false);
    }

    function onResize() {
        resize();
        if (reduceMotion) { drawStill(); }
    }

    readPalette();
    resize();

    if ('ResizeObserver' in window) {
        new ResizeObserver(onResize).observe(stage);
    } else {
        window.addEventListener('resize', onResize);
    }

    // main.js fires this when the theme changes.
    document.addEventListener('themechange', function () {
        readPalette();
        if (reduceMotion || !running) { render(elapsed, false); }
    });

    if (reduceMotion) {
        drawStill();
    } else {
        if ('IntersectionObserver' in window) {
            new IntersectionObserver(function (entries) {
                visible = entries[0].isIntersecting;
                refresh();
            }, { threshold: 0.05 }).observe(stage);
        }
        document.addEventListener('visibilitychange', refresh);
        refresh();
    }
})();
