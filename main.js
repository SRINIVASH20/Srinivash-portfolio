/* Site behavior: theme toggle, mobile menu, active section, copy email.
   Plain JavaScript, no dependencies. */
(function () {
    'use strict';

    var root = document.documentElement;

    /* ---------- Theme ---------- */
    var themeButton = document.getElementById('themeToggle');
    var themeMeta = document.querySelector('meta[name="theme-color"]');
    var THEME_COLORS = { light: '#F3F6F4', dark: '#0F1D21' };

    function currentTheme() {
        return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    }

    function applyTheme(theme, save) {
        root.setAttribute('data-theme', theme);
        if (themeMeta) { themeMeta.setAttribute('content', THEME_COLORS[theme]); }
        if (themeButton) {
            themeButton.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
        }
        if (save) {
            try { localStorage.setItem('theme', theme); } catch (err) { /* storage can be blocked */ }
        }
        document.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
    }

    if (themeButton) {
        applyTheme(currentTheme(), false);
        themeButton.addEventListener('click', function () {
            applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', true);
        });
    }

    // Follow the system setting until the visitor makes their own choice.
    if (window.matchMedia) {
        var query = window.matchMedia('(prefers-color-scheme: dark)');
        var onSystemChange = function (e) {
            var saved = null;
            try { saved = localStorage.getItem('theme'); } catch (err) { /* ignore */ }
            if (!saved) { applyTheme(e.matches ? 'dark' : 'light', false); }
        };
        if (query.addEventListener) { query.addEventListener('change', onSystemChange); }
    }

    /* ---------- Mobile menu ---------- */
    var menuButton = document.getElementById('menuToggle');
    var nav = document.getElementById('siteNav');

    function setMenu(open) {
        if (!menuButton || !nav) { return; }
        menuButton.setAttribute('aria-expanded', open ? 'true' : 'false');
        nav.classList.toggle('open', open);
    }

    if (menuButton && nav) {
        menuButton.addEventListener('click', function () {
            setMenu(menuButton.getAttribute('aria-expanded') !== 'true');
        });
        nav.addEventListener('click', function (e) {
            if (e.target.tagName === 'A') { setMenu(false); }
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { setMenu(false); }
        });
    }

    /* ---------- Highlight the section being read ---------- */
    if (nav && 'IntersectionObserver' in window) {
        var links = nav.querySelectorAll('a[href^="#"]');
        var byId = {};
        var sections = [];

        Array.prototype.forEach.call(links, function (link) {
            var id = link.getAttribute('href').slice(1);
            var section = document.getElementById(id);
            if (section) {
                byId[id] = link;
                sections.push(section);
            }
        });

        var setCurrent = function (id) {
            Array.prototype.forEach.call(links, function (link) {
                if (link === byId[id]) {
                    link.setAttribute('aria-current', 'location');
                } else {
                    link.removeAttribute('aria-current');
                }
            });
        };

        var spy = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) { setCurrent(entry.target.id); }
            });
        }, { rootMargin: '-35% 0px -60% 0px' });

        sections.forEach(function (section) { spy.observe(section); });

        // Nothing is current while the hero is on screen.
        var hero = document.querySelector('.hero');
        if (hero) {
            new IntersectionObserver(function (entries) {
                if (entries[0].isIntersecting && entries[0].intersectionRatio > 0.6) {
                    Array.prototype.forEach.call(links, function (link) { link.removeAttribute('aria-current'); });
                }
            }, { threshold: [0.6] }).observe(hero);
        }
    }

    /* ---------- Copy email ---------- */
    var copyButton = document.getElementById('copyEmail');
    var copyStatus = document.getElementById('copyStatus');
    var statusTimer = 0;

    function announce(message) {
        if (!copyStatus) { return; }
        copyStatus.textContent = message;
        window.clearTimeout(statusTimer);
        statusTimer = window.setTimeout(function () { copyStatus.textContent = ''; }, 2600);
    }

    function fallbackCopy(text) {
        var area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.top = '-1000px';
        document.body.appendChild(area);
        area.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
        document.body.removeChild(area);
        return ok;
    }

    if (copyButton) {
        copyButton.addEventListener('click', function () {
            var email = copyButton.getAttribute('data-email');
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(email).then(function () {
                    announce('Email copied');
                }, function () {
                    announce(fallbackCopy(email) ? 'Email copied' : 'Copy failed. Select the address and copy it.');
                });
            } else {
                announce(fallbackCopy(email) ? 'Email copied' : 'Copy failed. Select the address and copy it.');
            }
        });
    }
})();
