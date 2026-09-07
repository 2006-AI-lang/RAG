/* ============================================================
   FitQA - 互动粒子背景 · 知识粒子星云
   ------------------------------------------------------------
   全屏 Canvas 粒子层：粒子始终缓慢缓漂，鼠标靠近时聚集、
   粒子间连线变亮，并在光标处呈现柔光。纯原生实现，无依赖。
   降级：prefers-reduced-motion 时仅渲染一帧静态粒子；
        触屏/粗指针设备只保留缓漂，不跟踪触摸。
   ============================================================ */
(function () {
    'use strict';

    if (document.getElementById('bg-canvas')) return; // 防止重复初始化

    // ---------- 配置 ----------
    var CONFIG = {
        maxDpr: 2,               // DPR 上限，避免高分屏开销过大
        areaPerParticle: 16000,  // 每多少平方像素生成一个粒子
        countMin: 60,
        countMax: 140,
        touchFactor: 0.6,        // 触屏设备粒子数量倍率
        radiusMin: 0.8,
        radiusMax: 2.2,
        spriteScale: 7,          // 柔光精灵相对粒子核心半径的绘制倍数
        attractRadius: 160,      // 粒子被光标吸引的半径(px)
        linkDist: 120,           // 粒子连线的距离阈值(px)
        linkHighlightDist: 240,  // 连线"点亮"的光标影响半径(px)
        glowRadius: 200,         // 光标处柔光半径(px)
        glowAlpha: 0.10,         // 光标柔光透明度
        pointerLerp: 0.1,        // 光标平滑跟随系数（越小越拖尾）
        idleTimeout: 2500,       // 停止移动多少 ms 后互动渐隐
        linkAlphaBase: 0.055,    // 常态连线透明度上限
        linkAlphaActive: 0.19,   // 光标附近连线透明度上限
        boostMax: 0.4,           // 光标附近粒子的亮度增益
        palette: {
            green:  { rgb: [48, 177, 90],  weight: 0.70 },
            orange: { rgb: [255, 159, 10], weight: 0.20 },
            blue:   { rgb: [0, 122, 255],  weight: 0.10 }
        }
    };

    var reducedMotionQ = window.matchMedia('(prefers-reduced-motion: reduce)');
    var coarseQ = window.matchMedia('(hover: none) and (pointer: coarse)');
    var reduced = reducedMotionQ.matches;
    var coarse = coarseQ.matches;

    var canvas = document.createElement('canvas');
    canvas.id = 'bg-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);

    var ctx = canvas.getContext('2d');
    var dpr = 1;
    var width = 0;
    var height = 0;
    var particles = [];
    var sprites = {}; // 每种颜色一个预渲染柔光精灵

    var mouse = { x: -9999, y: -9999, tx: -9999, ty: -9999, lastMove: -Infinity };
    var rafId = null;
    var destroyed = false;

    // ---------- 工具 ----------
    function clamp(v, min, max) {
        return v < min ? min : (v > max ? max : v);
    }

    function rand(min, max) {
        return min + Math.random() * (max - min);
    }

    function smoothstep01(x) {
        var t = clamp(x, 0, 1);
        return t * t * (3 - 2 * t);
    }

    // ---------- 精灵与粒子 ----------
    function makeSprite(rgb) {
        var size = 64;
        var s = document.createElement('canvas');
        s.width = s.height = size;
        var c = s.getContext('2d');
        var g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        var base = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',';
        g.addColorStop(0, base + '0.55)');
        g.addColorStop(0.35, base + '0.22)');
        g.addColorStop(1, base + '0)');
        c.fillStyle = g;
        c.fillRect(0, 0, size, size);
        return s;
    }

    function pickSprite() {
        var r = Math.random();
        if (r < CONFIG.palette.green.weight) return sprites.green;
        if (r < CONFIG.palette.green.weight + CONFIG.palette.orange.weight) return sprites.orange;
        return sprites.blue;
    }

    function buildParticles() {
        particles = [];
        var area = width * height;
        var count = Math.round(area / CONFIG.areaPerParticle);
        count = clamp(count, CONFIG.countMin, CONFIG.countMax);
        if (coarse) count = Math.round(count * CONFIG.touchFactor);
        count = Math.max(24, count);

        var margin = 40;
        var w = width + margin * 2;
        var h = height + margin * 2;
        for (var i = 0; i < count; i++) {
            particles.push({
                x: Math.random() * w - margin,
                y: Math.random() * h - margin,
                vx: rand(-0.12, 0.12),
                vy: rand(-0.12, 0.12),
                radius: rand(CONFIG.radiusMin, CONFIG.radiusMax),
                alpha: rand(0.55, 1),
                freq: rand(0.25, 0.8),
                phase: rand(0, Math.PI * 2),
                sprite: pickSprite()
            });
        }
    }

    // ---------- 尺寸 ----------
    function resize() {
        dpr = clamp(window.devicePixelRatio || 1, 1, CONFIG.maxDpr);
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        buildParticles();
    }

    // ---------- 渲染 ----------
    function renderFrame(now) {
        var i, j, p, q, dx, dy, dist, alpha, s;
        var t = now * 0.001;

        // 光标平滑跟随，并计算互动强度（停止移动后 2.5s 内渐隐）
        var influence = 0;
        if (!reduced && !coarse && mouse.lastMove !== -Infinity) {
            mouse.x += (mouse.tx - mouse.x) * CONFIG.pointerLerp;
            mouse.y += (mouse.ty - mouse.y) * CONFIG.pointerLerp;
            influence = 1 - clamp((now - mouse.lastMove) / CONFIG.idleTimeout, 0, 1);
            influence = smoothstep01(influence);
        }

        ctx.clearRect(0, 0, width, height);

        // 光标柔光（垫在粒子下方）
        if (influence > 0.01) {
            ctx.globalAlpha = CONFIG.glowAlpha * influence;
            ctx.drawImage(
                sprites.green,
                mouse.x - CONFIG.glowRadius,
                mouse.y - CONFIG.glowRadius,
                CONFIG.glowRadius * 2,
                CONFIG.glowRadius * 2
            );
            ctx.globalAlpha = 1;
        }

        // 粒子连线 + 粒子间轻微互斥（避免聚集时堆成一点）
        var linkMax = CONFIG.linkDist;
        var sepMin = 26;
        var hlR2 = CONFIG.linkHighlightDist * CONFIG.linkHighlightDist;
        for (i = 0; i < particles.length; i++) {
            p = particles[i];
            for (j = i + 1; j < particles.length; j++) {
                q = particles[j];
                dx = p.x - q.x;
                if (dx > linkMax || dx < -linkMax) continue;
                dy = p.y - q.y;
                if (dy > linkMax || dy < -linkMax) continue;
                dist = Math.sqrt(dx * dx + dy * dy);
                if (dist >= linkMax) continue;

                // 互斥：防止粒子在光标处堆叠
                if (dist < sepMin && dist > 0.01) {
                    var push = (1 - dist / sepMin) * 0.04;
                    var inv = 1 / dist;
                    p.vx += dx * inv * push;
                    p.vy += dy * inv * push;
                    q.vx -= dx * inv * push;
                    q.vy -= dy * inv * push;
                }

                // 连线：至少一端靠近光标时明显加深
                var nearMouse = 0;
                if (influence > 0.01) {
                    var d1 = (p.x - mouse.x) * (p.x - mouse.x) + (p.y - mouse.y) * (p.y - mouse.y);
                    var d2 = (q.x - mouse.x) * (q.x - mouse.x) + (q.y - mouse.y) * (q.y - mouse.y);
                    if (d1 < hlR2 || d2 < hlR2) {
                        nearMouse = 1 - Math.min(d1, d2) / hlR2;
                    }
                }

                alpha = (1 - dist / linkMax) *
                    (CONFIG.linkAlphaBase + CONFIG.linkAlphaActive * influence * nearMouse);
                if (alpha <= 0.003) continue;

                ctx.strokeStyle = 'rgba(48, 177, 90, ' + alpha.toFixed(3) + ')';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(q.x, q.y);
                ctx.stroke();
            }
        }

        // 粒子：光标吸引 + 速度阻尼 + 正弦缓漂
        for (i = 0; i < particles.length; i++) {
            p = particles[i];

            if (influence > 0.01) {
                dx = mouse.x - p.x;
                dy = mouse.y - p.y;
                dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < CONFIG.attractRadius && dist > 0.01) {
                    var force = (1 - dist / CONFIG.attractRadius) * influence * 0.85;
                    p.vx += (dx / dist) * force;
                    p.vy += (dy / dist) * force;
                }
            }

            p.vx *= 0.92;
            p.vy *= 0.92;
            p.x += p.vx + Math.sin(t * p.freq + p.phase) * 0.12;
            p.y += p.vy + Math.cos(t * p.freq * 0.8 + p.phase * 1.7) * 0.12;

            // 越界回绕（带边距，避免柔光突然消失）
            var m = 60;
            if (p.x < -m) p.x = width + m;
            else if (p.x > width + m) p.x = -m;
            if (p.y < -m) p.y = height + m;
            else if (p.y > height + m) p.y = -m;

            // 亮度：靠近光标时微增
            alpha = p.alpha;
            if (influence > 0.01) {
                dx = mouse.x - p.x;
                dy = mouse.y - p.y;
                dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < CONFIG.attractRadius) {
                    var boost = (1 - dist / CONFIG.attractRadius) * influence * CONFIG.boostMax;
                    alpha = clamp(alpha + boost, 0, 1);
                }
            }

            s = p.radius * CONFIG.spriteScale;
            ctx.globalAlpha = alpha;
            ctx.drawImage(p.sprite, p.x - s / 2, p.y - s / 2, s, s);
        }
        ctx.globalAlpha = 1;
    }

    // ---------- 静态帧（减少动态效果时使用） ----------
    function renderStatic() {
        ctx.clearRect(0, 0, width, height);
        var i, p, s;
        for (i = 0; i < particles.length; i++) {
            p = particles[i];
            s = p.radius * CONFIG.spriteScale;
            ctx.globalAlpha = p.alpha;
            ctx.drawImage(p.sprite, p.x - s / 2, p.y - s / 2, s, s);
        }
        ctx.globalAlpha = 1;
    }

    // ---------- 循环控制 ----------
    function frame(now) {
        if (destroyed || reduced) return;
        renderFrame(now);
        rafId = window.requestAnimationFrame(frame);
    }

    function start() {
        if (rafId === null) {
            rafId = window.requestAnimationFrame(frame);
        }
    }

    function stop() {
        if (rafId !== null) {
            window.cancelAnimationFrame(rafId);
            rafId = null;
        }
    }

    // ---------- 事件 ----------
    function onPointerMove(e) {
        mouse.tx = e.clientX;
        mouse.ty = e.clientY;
        mouse.lastMove = performance.now();
    }

    function onVisibility() {
        if (document.hidden) {
            stop();
        } else if (!reduced) {
            start();
        }
    }

    function onResize() {
        resize();
        if (reduced) renderStatic();
    }

    function onModeChange() {
        reduced = reducedMotionQ.matches;
        coarse = coarseQ.matches;

        if (reduced) {
            window.removeEventListener('pointermove', onPointerMove);
            stop();
            resize();
            renderStatic();
        } else {
            if (coarse) {
                window.removeEventListener('pointermove', onPointerMove);
            } else if (mouse.lastMove === -Infinity) {
                window.addEventListener('pointermove', onPointerMove, { passive: true });
            }
            resize();
            start();
        }
    }

    // ---------- 初始化 ----------
    sprites.green = makeSprite(CONFIG.palette.green.rgb);
    sprites.orange = makeSprite(CONFIG.palette.orange.rgb);
    sprites.blue = makeSprite(CONFIG.palette.blue.rgb);

    resize();

    if (!reduced && !coarse) {
        window.addEventListener('pointermove', onPointerMove, { passive: true });
    }

    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    document.addEventListener('visibilitychange', onVisibility);

    // 运行时切换系统偏好（减少动态效果 / 触屏模式）
    try {
        reducedMotionQ.addEventListener('change', onModeChange);
        coarseQ.addEventListener('change', onModeChange);
    } catch (err) {
        reducedMotionQ.addListener(onModeChange);
        coarseQ.addListener(onModeChange);
    }

    window.addEventListener('pagehide', function () {
        destroyed = true;
        stop();
    }, { once: true });

    if (reduced) {
        renderStatic();
    } else {
        start();
    }
})();
