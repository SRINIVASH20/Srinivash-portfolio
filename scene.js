/* Hero 3D scene: 168 hourly demand bars (7 days x 24 hours).
   Teal bars are "actual" days, amber bars are the forecast days.
   The numbers are generated for illustration only. If WebGL or Three.js is
   unavailable, the flat SVG chart in index.html stays visible instead. */
(function () {
    'use strict';

    var stage = document.getElementById('stage');
    if (!stage || !window.THREE) { return; }

    var THREE = window.THREE;
    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var renderer;
    try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (err) {
        return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);

    var canvas = renderer.domElement;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Rotating 3D bar chart of hourly electricity demand over seven days. The last two days, in amber, are the forecast. Illustration only.');
    stage.appendChild(canvas);
    stage.classList.add('has-3d');

    var HOURS = 24;
    var DAYS = 7;
    var FORECAST_DAYS = 2;
    var COUNT = HOURS * DAYS;
    var GAP = 0.56;
    var BAR = 0.4;
    var HEIGHT_SCALE = 0.95;

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(32, 560 / 330, 0.1, 100);
    camera.position.set(0, 8.2, 17);
    camera.lookAt(0, 1.2, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    var sun = new THREE.DirectionalLight(0xffffff, 0.85);
    sun.position.set(6, 12, 8);
    scene.add(sun);

    var group = new THREE.Group();
    scene.add(group);

    // Demand model: morning and evening peaks. Actual days get small, repeatable
    // noise; forecast days are smooth, like a model output.
    function pseudo(n) {
        var x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
        return x - Math.floor(x);
    }

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

    var heights = new Array(COUNT);
    var maxH = 0;
    var i, d, h;
    for (d = 0; d < DAYS; d++) {
        for (h = 0; h < HOURS; h++) {
            var v = demand(h, d);
            heights[d * HOURS + h] = v;
            if (v > maxH) { maxH = v; }
        }
    }

    var geometry = new THREE.BoxGeometry(1, 1, 1);
    var material = new THREE.MeshLambertMaterial({ color: 0xffffff });
    var bars = new THREE.InstancedMesh(geometry, material, COUNT);
    group.add(bars);

    var lowActual = new THREE.Color(0x9CC8CC);
    var highActual = new THREE.Color(0x123038);
    var lowForecast = new THREE.Color(0xF8D788);
    var highForecast = new THREE.Color(0xE39A00);
    var tmp = new THREE.Color();

    var width = (HOURS - 1) * GAP;
    var depth = (DAYS - 1) * GAP * 1.35;
    var xs = new Array(COUNT);
    var zs = new Array(COUNT);
    var delays = new Array(COUNT);

    for (d = 0; d < DAYS; d++) {
        for (h = 0; h < HOURS; h++) {
            i = d * HOURS + h;
            xs[i] = h * GAP - width / 2;
            zs[i] = d * GAP * 1.35 - depth / 2;
            delays[i] = h * 0.028 + d * 0.11;
            var t = heights[i] / maxH;
            if (d >= DAYS - FORECAST_DAYS) {
                tmp.copy(lowForecast).lerp(highForecast, t);
            } else {
                tmp.copy(lowActual).lerp(highActual, t);
            }
            bars.setColorAt(i, tmp);
        }
    }
    bars.instanceColor.needsUpdate = true;

    // Base slab under the bars.
    var slab = new THREE.Mesh(
        new THREE.BoxGeometry(width + 1.2, 0.14, depth + 1.4),
        new THREE.MeshLambertMaterial({ color: 0xE6ECE9 })
    );
    slab.position.y = -0.07;
    group.add(slab);

    var dummy = new THREE.Object3D();

    function easeOut(x) {
        return 1 - Math.pow(1 - x, 3);
    }

    function layoutBars(elapsed) {
        var done = true;
        for (var k = 0; k < COUNT; k++) {
            var p = Math.min(Math.max((elapsed - delays[k]) / 0.9, 0), 1);
            if (p < 1) { done = false; }
            var hh = Math.max(0.001, heights[k] * HEIGHT_SCALE * easeOut(p));
            dummy.position.set(xs[k], hh / 2, zs[k]);
            dummy.scale.set(BAR, hh, BAR);
            dummy.updateMatrix();
            bars.setMatrixAt(k, dummy.matrix);
        }
        bars.instanceMatrix.needsUpdate = true;
        return done;
    }

    // Pointer tilt
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

    function resize() {
        var w = stage.clientWidth;
        var hgt = stage.clientHeight;
        if (!w || !hgt) { return; }
        renderer.setSize(w, hgt, false);
        camera.aspect = w / hgt;
        camera.updateProjectionMatrix();
    }

    var clock = new THREE.Clock();
    var elapsed = 0;
    var introDone = false;
    var running = false;
    var visible = true;
    var frameId = 0;

    function draw() {
        var yaw = -0.55 + Math.sin(elapsed * 0.28) * 0.38;
        group.rotation.y = yaw + tiltX * 0.35;
        group.rotation.x = tiltY * 0.12;
        renderer.render(scene, camera);
    }

    function tick() {
        if (!running) { return; }
        var dt = Math.min(clock.getDelta(), 0.05);
        elapsed += dt;
        if (!introDone) { introDone = layoutBars(elapsed); }
        tiltX += (targetX - tiltX) * 0.06;
        tiltY += (targetY - tiltY) * 0.06;
        draw();
        frameId = window.requestAnimationFrame(tick);
    }

    function start() {
        if (running || reduceMotion) { return; }
        running = true;
        clock.getDelta();
        frameId = window.requestAnimationFrame(tick);
    }

    function stop() {
        running = false;
        window.cancelAnimationFrame(frameId);
    }

    function refresh() {
        if (visible && !document.hidden) { start(); } else { stop(); }
    }

    resize();
    if ('ResizeObserver' in window) {
        new ResizeObserver(function () {
            resize();
            if (reduceMotion) { draw(); }
        }).observe(stage);
    } else {
        window.addEventListener('resize', function () {
            resize();
            if (reduceMotion) { draw(); }
        });
    }

    if (reduceMotion) {
        // One still frame, fully grown, no animation.
        elapsed = 0;
        layoutBars(99);
        draw();
    } else {
        layoutBars(0);
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
