/* ============================================================
   RV — FORJA
   Motion layer.

   The particle field is one GPU-resident system carrying four
   shapes at once (product / field / components / mark). Scroll blends
   between them in the vertex shader, so the CPU never touches
   per-particle math — that's what buys us ~16k particles instead
   of the ~3.5k a JS morph loop could afford.
   ============================================================ */

(function () {
  'use strict';

  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var COARSE = window.matchMedia('(hover: none), (pointer: coarse)').matches;
  var hasGSAP = typeof window.gsap !== 'undefined';
  var hasTHREE = typeof window.THREE !== 'undefined';

  /* ------------------------------------------------------------
     1. The forge — Three.js particle field
     ------------------------------------------------------------ */

  var VERT = [
    'attribute vec3 aField;',
    'attribute vec3 aGrid;',
    'attribute vec3 aLogo;',
    'attribute float aSize;',
    'attribute float aSeed;',
    'attribute float aTint;',

    'uniform float uTime;',
    'uniform float uState;',   // 0 interface, 1 field, 2 component grid, 3 logo
    'uniform float uScale;',
    'uniform vec3  uMouse;',
    'uniform float uMouseForce;',

    'varying float vTint;',
    'varying float vFlicker;',
    'varying float vDepth;',

    'void main() {',
    // Chained blend: each stage takes over the previous one.
    '  vec3 p = position;',
    '  p = mix(p, aField, clamp(uState,       0.0, 1.0));',
    '  p = mix(p, aGrid,  clamp(uState - 1.0, 0.0, 1.0));',
    '  p = mix(p, aLogo,  clamp(uState - 2.0, 0.0, 1.0));',

    // Drift keyed to the emitter seed, so panels wander as rigid pieces and
    // their edges stay sharp. Kept tight while the product is on screen, opened
    // up for the looser shapes, and stilled as it snaps into the mark.
    '  float settle = 1.0 - clamp(uState - 2.0, 0.0, 1.0) * 0.92;',
    '  float drift = (0.07 + 0.1 * clamp(uState, 0.0, 1.0)) * settle;',
    '  float t = uTime;',
    '  p.x += sin(t * 0.62 + aSeed * 6.283) * drift;',
    '  p.y += cos(t * 0.71 + aSeed * 5.117) * drift;',
    '  p.z += sin(t * 0.53 + aSeed * 4.331) * drift;',

    // Cursor repulsion, in the system's local space.
    '  vec3 away = p - uMouse;',
    '  float d = length(away);',
    '  float push = uMouseForce * exp(-d * d * 0.045);',
    '  p += normalize(away + 0.0001) * push;',

    '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
    '  gl_Position = projectionMatrix * mv;',
    '  gl_PointSize = aSize * uScale / max(-mv.z, 0.1);',

    '  vTint = aTint;',
    '  vFlicker = 0.62 + 0.38 * sin(t * 1.9 + aSeed * 12.566);',
    '  vDepth = -mv.z;',
    '}'
  ].join('\n');

  var FRAG = [
    'precision mediump float;',

    'uniform vec3  uEmberLo;',
    'uniform vec3  uEmber;',
    'uniform vec3  uEmberHi;',
    'uniform float uOpacity;',

    'varying float vTint;',
    'varying float vFlicker;',
    'varying float vDepth;',

    // Signed distance to an equilateral triangle (iq).
    'float sdTri(vec2 p, float r) {',
    '  const float k = 1.7320508;',
    '  p.x = abs(p.x) - r;',
    '  p.y = p.y + r / k;',
    '  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;',
    '  p.x -= clamp(p.x, -2.0 * r, 0.0);',
    '  return -length(p) * sign(p.y);',
    '}',

    'void main() {',
    '  vec2 uv = gl_PointCoord - 0.5;',

    // Outlined triangle, like the reference constellation.
    '  float d = sdTri(vec2(uv.x, -uv.y), 0.30);',
    '  float edge = fwidth(d) + 0.012;',
    '  float outline = 1.0 - smoothstep(0.0, edge, abs(d) - 0.045);',

    // A soft core keeps sub-pixel particles from disappearing entirely.
    '  float core = exp(-dot(uv, uv) * 9.0) * 0.7;',
    '  float a = clamp(outline + core, 0.0, 1.0);',
    '  if (a < 0.01) discard;',

    // Ember ramp: light orange -> brand orange -> deep red, with rare white sparks.
    '  vec3 col = mix(uEmberLo, uEmber, smoothstep(0.0, 0.55, vTint));',
    '  col = mix(col, uEmberHi, smoothstep(0.55, 1.0, vTint));',
    '  col = mix(col, vec3(1.0), step(0.955, vTint) * 0.8);',

    // Depth fog so the far side of the cloud recedes into the void.
    '  float fog = clamp(1.30 - vDepth * 0.026, 0.20, 1.0);',

    // Additive blending multiplies rgb by alpha, so brightness has to live in
    // the colour term or the field washes out to grey dust.
    '  gl_FragColor = vec4(col * (1.15 + vFlicker * 0.95), a * uOpacity * fog);',
    '}'
  ].join('\n');

  function initForge() {
    var canvas = document.getElementById('forge-canvas');
    if (!canvas || !hasTHREE) return null;

    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        alpha: true,
        antialias: false,
        powerPreference: 'high-performance'
      });
    } catch (e) {
      return null; // No WebGL — the page stands on its own typography.
    }

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(window.innerWidth, window.innerHeight);

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 200);
    camera.position.z = 9;

    var isSmall = window.innerWidth < 900;
    var COUNT = REDUCED ? 3000 : (isSmall ? 6000 : 16000);

    var interfaceP = new Float32Array(COUNT * 3);
    var fieldP = new Float32Array(COUNT * 3);
    var gridP = new Float32Array(COUNT * 3);
    var logoP = new Float32Array(COUNT * 3);
    var sizes = new Float32Array(COUNT);
    var seeds = new Float32Array(COUNT);
    var tints = new Float32Array(COUNT);

    var TAU = Math.PI * 2;
    var tmp = [0, 0];

    /* ---- Emitters --------------------------------------------------------
       Each shape is a list of emitters carrying a weight. Particles are dealt
       out in proportion to that weight, so a long panel edge and a short label
       rule end up with the same line density instead of the short one clotting.

       Every emitter also carries its own seed. The drift in the vertex shader
       keys off that seed, so a panel wanders as a rigid piece rather than
       dissolving — which is the whole reason an interface can read here at all
       where a per-particle jitter would just blur the edges away. */

    function roundRect(x0, y0, x1, y1, rad) {
      var w = x1 - x0, h = y1 - y0, per = 2 * (w + h);
      return {
        w: per,
        seed: Math.random(),
        z: 0,
        s: function (out) {
          var t = Math.random() * per, px, py;
          if (t < w) { px = x0 + t; py = y0; }
          else if ((t -= w) < h) { px = x1; py = y0 + t; }
          else if ((t -= h) < w) { px = x1 - t; py = y1; }
          else { px = x0; py = y1 - (t - w); }
          // Project onto the rounded boundary. The corner radius is what makes
          // these read as interface instead of as wireframe boxes.
          var cx = Math.min(Math.max(px, x0 + rad), x1 - rad);
          var cy = Math.min(Math.max(py, y0 + rad), y1 - rad);
          var dx = px - cx, dy = py - cy;
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d > 0.0001) { px = cx + dx / d * rad; py = cy + dy / d * rad; }
          out[0] = px; out[1] = py;
        }
      };
    }

    function hLine(x0, x1, y) {
      var w = x1 - x0;
      return {
        w: w, seed: Math.random(), z: 0,
        s: function (out) { out[0] = x0 + Math.random() * w; out[1] = y; }
      };
    }

    function pick(list, total) {
      var r = Math.random() * total, acc = 0;
      for (var k = 0; k < list.length; k++) {
        acc += list[k].w;
        if (r <= acc) return list[k];
      }
      return list[list.length - 1];
    }

    function totalOf(list) {
      var s = 0;
      for (var k = 0; k < list.length; k++) s += list[k].w;
      return s;
    }

    /* ---- Shape 0: the product assembling ---------------------------------
       A dashboard in exploded perspective — sidebar, header, two cards, a bar
       chart and a list — deliberately echoing the real products further down
       the page. The panels sit at different depths so it reads as something
       being put together rather than a flat wireframe. */

    var ui = [];
    var UI = 0.72;   // overall scale of the assembled product

    function panel(x0, y0, x1, y1, z, rad, rows) {
      var e = roundRect(x0, y0, x1, y1, rad);
      e.z = z;
      ui.push(e);
      for (var k = 0; k < (rows || 0); k++) {
        var yy = y1 - 0.5 - k * 0.44;
        if (yy < y0 + 0.25) break;
        var l = hLine(x0 + 0.32, x0 + 0.32 + (x1 - x0 - 0.7) * (0.4 + Math.random() * 0.5), yy);
        l.z = z + 0.02;
        l.w *= 0.85;
        ui.push(l);
      }
    }

    panel(-5.4, -3.6, 5.4, 3.6, 0, 0.3);              // app frame
    panel(-5.4, -3.6, -2.8, 3.6, 0.06, 0.3);          // sidebar
    panel(-2.8, 2.5, 5.4, 3.6, 0.06, 0.3);            // top bar
    panel(-2.35, 0.35, 0.7, 2.2, 0.66, 0.22, 3);      // card
    panel(1.0, 0.35, 4.95, 2.2, 0.66, 0.22);          // chart card
    panel(-2.35, -3.15, 4.95, -0.15, 0.44, 0.22, 5);  // list

    for (var nv = 0; nv < 5; nv++) {                  // sidebar nav items
      var navEl = roundRect(-5.0, 2.18 - nv * 0.64, -3.25, 2.6 - nv * 0.64, 0.16);
      navEl.z = 0.1;
      ui.push(navEl);
    }

    for (var bar = 0; bar < 7; bar++) {               // bars in the chart card
      var bx = 1.38 + bar * 0.5;
      var barEl = roundRect(bx, 0.62, bx + 0.3, 0.62 + (0.28 + Math.random() * 1.15), 0.1);
      barEl.z = 0.7;
      ui.push(barEl);
    }

    var badge = roundRect(3.35, -1.5, 5.75, -0.82, 0.34);  // a piece still landing
    badge.z = 1.55;
    ui.push(badge);

    // Sparse dot grid behind the panels. Kept inside their footprint — spread
    // any wider and it is the backdrop, not the product, that collides with
    // the headline.
    var backdrop = {
      w: 30, seed: Math.random(), z: -2.4,
      s: function (out) {
        out[0] = (Math.round(Math.random() * 16) - 8) * 0.66;
        out[1] = (Math.round(Math.random() * 11) - 5.5) * 0.66;
      }
    };
    ui.push(backdrop);

    var uiTotal = totalOf(ui);

    /* ---- Shape 2: the component sheet ------------------------------------
       Buttons, inputs, toggles and cards on a grid with the centre left empty,
       so the sheet frames the copy instead of sitting underneath it. */

    var comps = [];
    for (var cgx = -7; cgx <= 7; cgx++) {
      for (var cgy = -5; cgy <= 5; cgy++) {
        var ccx = cgx * 2.4, ccy = cgy * 1.95;
        if (Math.abs(ccx) < 7.6 && Math.abs(ccy) < 4.8) continue;   // hole for the text
        var kind = Math.random(), ce;
        if (kind < 0.3) ce = roundRect(ccx - 0.72, ccy - 0.23, ccx + 0.72, ccy + 0.23, 0.23);
        else if (kind < 0.56) ce = roundRect(ccx - 0.88, ccy - 0.29, ccx + 0.88, ccy + 0.29, 0.09);
        else if (kind < 0.76) ce = roundRect(ccx - 0.46, ccy - 0.25, ccx + 0.46, ccy + 0.25, 0.25);
        else ce = roundRect(ccx - 0.82, ccy - 0.64, ccx + 0.82, ccy + 0.64, 0.16);
        ce.z = (Math.random() - 0.5) * 0.7;
        comps.push(ce);
      }
    }
    var compTotal = totalOf(comps);

    for (var i = 0; i < COUNT; i++) {
      var i3 = i * 3;

      // Shape 0 — the assembling product. Scaled to sit in the right-hand
      // column without its left edge reaching the copy.
      var el = pick(ui, uiTotal);
      el.s(tmp);
      interfaceP[i3] = tmp[0] * UI;
      interfaceP[i3 + 1] = tmp[1] * UI;
      interfaceP[i3 + 2] = (el.z + (Math.random() - 0.5) * 0.05) * UI;

      // Shape 1 — a wide, far grid. Through the work section the screenshots
      // are the subject, so the field retreats into depth and gets out of it.
      var side = Math.ceil(Math.sqrt(COUNT));
      var gx = (i % side) / (side - 1) - 0.5;
      var gy = Math.floor(i / side) / (side - 1) - 0.5;
      fieldP[i3] = gx * 34.0;
      fieldP[i3 + 1] = gy * 22.0;
      fieldP[i3 + 2] = Math.sin(gx * 11) * Math.cos(gy * 9) * 2.6;

      // Shape 2 — the component sheet.
      var ce2 = pick(comps, compTotal);
      ce2.s(tmp);
      gridP[i3] = tmp[0];
      gridP[i3 + 1] = tmp[1];
      gridP[i3 + 2] = ce2.z;

      // Shape 3 — overwritten once the mark is sampled.
      logoP[i3] = interfaceP[i3] * 0.5;
      logoP[i3 + 1] = interfaceP[i3 + 1] * 0.5;
      logoP[i3 + 2] = 0;

      sizes[i] = 0.011 + Math.random() * 0.028;
      // Panels drift as rigid pieces: the seed is the element's, not the
      // particle's, plus a hair of shimmer so it never looks frozen.
      seeds[i] = el.seed + Math.random() * 0.03;
      tints[i] = Math.random() < 0.03 ? 0.98 : Math.pow(Math.random(), 1.25) * 0.9;
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(interfaceP, 3));
    geo.setAttribute('aField', new THREE.BufferAttribute(fieldP, 3));
    geo.setAttribute('aGrid', new THREE.BufferAttribute(gridP, 3));
    geo.setAttribute('aLogo', new THREE.BufferAttribute(logoP, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geo.setAttribute('aTint', new THREE.BufferAttribute(tints, 1));

    var uniforms = {
      uTime: { value: 0 },
      uState: { value: 0 },
      uScale: { value: renderer.domElement.height * 0.5 },
      uMouse: { value: new THREE.Vector3(999, 999, 999) },
      uMouseForce: { value: 0 },
      uOpacity: { value: 0 },
      uEmberLo: { value: new THREE.Color('#ffc061') },
      uEmber: { value: new THREE.Color('#f08113') },
      uEmberHi: { value: new THREE.Color('#e94d1d') }
    };

    var material = new THREE.ShaderMaterial({
      uniforms: uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      extensions: { derivatives: true }
    });

    var field = new THREE.Points(geo, material);
    scene.add(field);

    /* --- Sample the RV mark into the logo target --- */
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      try {
        var S = 128;
        var c = document.createElement('canvas');
        c.width = c.height = S;
        var ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, S, S);
        var data = ctx.getImageData(0, 0, S, S).data;

        var pts = [];
        for (var y = 0; y < S; y++) {
          for (var x = 0; x < S; x++) {
            if (data[(y * S + x) * 4 + 3] > 120) {
              pts.push([(x - S / 2) * 0.058, -(y - S / 2) * 0.058]);
            }
          }
        }
        if (!pts.length) return;

        for (var k = pts.length - 1; k > 0; k--) {
          var j = (Math.random() * (k + 1)) | 0;
          var tmp = pts[k]; pts[k] = pts[j]; pts[j] = tmp;
        }

        var attr = geo.attributes.aLogo;
        for (var n = 0; n < COUNT; n++) {
          var p = pts[n % pts.length];
          attr.array[n * 3] = p[0] + (Math.random() - 0.5) * 0.05;
          attr.array[n * 3 + 1] = p[1] + (Math.random() - 0.5) * 0.05;
          attr.array[n * 3 + 2] = (Math.random() - 0.5) * 0.7;
        }
        attr.needsUpdate = true;
      } catch (e) {
        /* Tainted canvas (file://) — the fallback logo target stays. */
      }
    };
    img.src = 'assets/logo-orange.png';

    /* --- Placement: right of the headline on desktop, behind it on mobile --- */
    // Park it against the right edge of the frame rather than at a fixed world
    // offset: a constant x either clips on narrow desktops or drifts into the
    // copy on wide ones.
    function homeX() {
      if (window.innerWidth < 900) return 0;
      var halfW = Math.tan(camera.fov * Math.PI / 360) * camera.position.z * camera.aspect;
      return Math.max(3.2, halfW - 4.8);
    }
    // On phones there is no free column, so it drops below the copy and sits
    // further back — present as atmosphere, never over the headline.
    function homeY() { return window.innerWidth < 900 ? -2.6 : 0.15; }
    function homeZ() { return window.innerWidth < 900 ? -5.5 : 0; }

    var pointer = { x: 0, y: 0 };      // normalized -1..1
    var eased = { x: 0, y: 0 };
    var mouseWorld = new THREE.Vector3(999, 999, 999);
    var raw = new THREE.Vector3();
    var hasPointer = false;

    if (!COARSE) {
      window.addEventListener('mousemove', function (e) {
        hasPointer = true;
        pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
        pointer.y = -((e.clientY / window.innerHeight) * 2 - 1);
      }, { passive: true });

      window.addEventListener('mouseleave', function () { hasPointer = false; });
    }

    /* --- Scroll drives the morph: product -> field -> components -> mark --- */
    var stage = { a: 0, b: 0, c: 0, d: 0 };

    if (hasGSAP && window.ScrollTrigger && !REDUCED) {
      gsap.registerPlugin(ScrollTrigger);

      var link = function (sel, start, end, key) {
        var el = document.querySelector(sel);
        if (!el) return;
        ScrollTrigger.create({
          trigger: el,
          start: start,
          end: end,
          scrub: 1.1,
          onUpdate: function (self) { stage[key] = self.progress; }
        });
      };

      // The product must clear the frame before the real screenshots arrive —
      // nothing should compete with the proof.
      link('#trabalho', 'top 90%', 'top 25%', 'a');
      link('#capacidades', 'top 85%', 'top 20%', 'b');
      link('#contato', 'top 85%', 'center 62%', 'c');
      // The mark assembles, holds, then burns out over the footer.
      link('.footer', 'top bottom', 'top 55%', 'd');
    }

    var clock = new THREE.Clock();
    var running = true;
    var target = new THREE.Vector3();
    var spinY = 0;
    var prevT = 0;

    document.addEventListener('visibilitychange', function () {
      running = !document.hidden;
      if (running) { clock.getDelta(); frame(); }
    });

    function frame() {
      if (!running) return;
      requestAnimationFrame(frame);

      var t = clock.getElapsedTime();
      var dt = Math.min(0.05, t - prevT);
      prevT = t;
      uniforms.uTime.value = t;

      var state = stage.a + stage.b + stage.c;
      uniforms.uState.value = state;

      // Fade in against the clock, not the frame counter — a per-frame ramp
      // resolves twice as fast on a 120Hz panel as on a 60Hz one.
      var intro = Math.min(1, t / 1.4);

      // Brightness is choreographed against what each section is asking the eye
      // to do. Over the work, the real screenshots are the argument and the
      // field all but disappears. Over the component sheet it comes back, but
      // only enough to frame. The mark stays a watermark, never a competitor.
      var overWork = 1 - 0.72 * stage.a * (1 - stage.b);
      var overGrid = 1 - 0.34 * stage.b * (1 - stage.c);
      var overMark = 1 - 0.55 * stage.c;

      // On phones there is no empty column to put it in — it sits directly
      // behind the copy, so it drops to atmosphere.
      var narrow = window.innerWidth < 900 ? 0.5 : 1;

      uniforms.uOpacity.value =
        intro * overWork * overGrid * overMark * (1 - 0.85 * stage.d) * narrow;

      eased.x += (pointer.x - eased.x) * 0.045;
      eased.y += (pointer.y - eased.y) * 0.045;

      // Everything after the hero is centred: the component sheet has a hole
      // cut for the copy, and the mark belongs dead centre. Only the assembled
      // product sits off to one side.
      var toCenter = Math.min(1, Math.max(stage.a * 1.3, stage.c * 1.15));
      target.set(
        homeX() * (1 - toCenter) + eased.x * 0.85,
        homeY() * (1 - toCenter) + eased.y * 0.6,
        homeZ() * (1 - toCenter) - 6.0 * stage.a * (1 - stage.b)
      );
      field.position.lerp(target, 0.05);

      // The product is held near face-on with just enough three-quarter turn to
      // show the panels stacked in depth. Rotate it any further and the
      // rectangles skew into unreadable diamonds; spin it and it stops being an
      // interface at all. Only the later shapes, which have no silhouette to
      // protect, are free to turn.
      var spin = 1 - Math.min(1, stage.c * 1.4);
      var morphing = Math.min(1, stage.a * 1.5);
      var settled = 1 - morphing;
      spinY += dt * 0.55 * morphing;

      field.rotation.y = settled * (-0.34 + Math.sin(t * 0.17) * 0.07) + spinY;
      field.rotation.x = (settled * (0.13 + Math.sin(t * 0.21) * 0.035) + eased.y * 0.1) * spin;
      field.rotation.z = (settled * 0.015 + eased.x * 0.03) * spin;

      // Repulsion: unproject the cursor onto the field's own space.
      if (hasPointer && !COARSE) {
        raw.set(pointer.x, pointer.y, 0.5).unproject(camera);
        raw.sub(camera.position).normalize();
        raw.multiplyScalar(-camera.position.z / raw.z).add(camera.position);
        field.worldToLocal(raw);
        mouseWorld.lerp(raw, 0.18);
        uniforms.uMouseForce.value += (1.5 - uniforms.uMouseForce.value) * 0.06;
      } else {
        uniforms.uMouseForce.value += (0 - uniforms.uMouseForce.value) * 0.06;
      }
      uniforms.uMouse.value.copy(mouseWorld);

      renderer.render(scene, camera);
    }

    frame();

    var resizeRAF;
    window.addEventListener('resize', function () {
      cancelAnimationFrame(resizeRAF);
      resizeRAF = requestAnimationFrame(function () {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        uniforms.uScale.value = renderer.domElement.height * 0.5;
      });
    }, { passive: true });

    return field;
  }

  /* ------------------------------------------------------------
     2. Reveals
     ------------------------------------------------------------ */

  function initReveals() {
    if (!hasGSAP) {
      // Strip initial states so nothing stays invisible.
      document.documentElement.classList.remove('js');
      return;
    }
    gsap.registerPlugin(ScrollTrigger);

    if (REDUCED) {
      gsap.set('.reveal', { opacity: 1, y: 0 });
      gsap.set('.reveal-line > span', { y: 0 });
      return;
    }

    // Hero: masked lines rise first, everything else follows.
    var heroLines = document.querySelectorAll('.hero .reveal-line > span');
    gsap.to(heroLines, {
      y: 0,
      duration: 1.5,
      ease: 'expo.out',
      stagger: 0.11,
      delay: 0.25
    });

    var heroBits = document.querySelectorAll('.hero .reveal');
    gsap.to(heroBits, {
      opacity: 1,
      y: 0,
      duration: 1.2,
      ease: 'power3.out',
      stagger: 0.1,
      delay: 0.45
    });

    // Everything below the fold reveals on approach.
    gsap.utils.toArray('.reveal').forEach(function (el) {
      if (el.closest('.hero')) return;
      gsap.to(el, {
        opacity: 1,
        y: 0,
        duration: 1.05,
        ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 88%' }
      });
    });

    gsap.utils.toArray('.reveal-line > span').forEach(function (span) {
      if (span.closest('.hero')) return;
      gsap.to(span, {
        y: 0,
        duration: 1.3,
        ease: 'expo.out',
        scrollTrigger: { trigger: span, start: 'top 90%' }
      });
    });

    // Failsafe. Reveals ride on requestAnimationFrame, which a throttled tab or
    // a starved device can stall indefinitely. Copy must never be the casualty:
    // if the hero is still hidden well past its animation window, drop the
    // gating class and hand everything back to plain CSS.
    window.setTimeout(function () {
      var probe = document.querySelector('.hero .reveal');
      if (!probe || parseFloat(getComputedStyle(probe).opacity) > 0.9) return;
      document.documentElement.classList.remove('js');
      gsap.set('.reveal, .reveal-line > span', { clearProps: 'opacity,transform' });
    }, 4000);
  }

  /* ------------------------------------------------------------
     3. Work cards — real 3D tilt with a tracking specular
     ------------------------------------------------------------ */

  function initTilt() {
    if (COARSE || REDUCED) return;

    document.querySelectorAll('.work__item').forEach(function (item) {
      var card = item.querySelector('.work__card');
      var stage = item.querySelector('.work__stage');
      var glare = item.querySelector('.work__glare');
      if (!card || !stage) return;

      var raf = null;
      var box = null;

      function apply(e) {
        raf = null;
        if (!box) return;
        var px = (e.clientX - box.left) / box.width;
        var py = (e.clientY - box.top) / box.height;

        card.style.setProperty('--ry', ((px - 0.5) * 13).toFixed(2) + 'deg');
        card.style.setProperty('--rx', ((0.5 - py) * 9).toFixed(2) + 'deg');

        if (glare) {
          glare.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
          glare.style.setProperty('--my', (py * 100).toFixed(1) + '%');
        }
      }

      item.addEventListener('mouseenter', function () {
        box = stage.getBoundingClientRect();
        card.style.transitionDuration = '0.25s';
      });

      item.addEventListener('mousemove', function (e) {
        if (raf) return;
        raf = requestAnimationFrame(function () { apply(e); });
      }, { passive: true });

      item.addEventListener('mouseleave', function () {
        if (raf) { cancelAnimationFrame(raf); raf = null; }
        card.style.transitionDuration = '0.9s';
        card.style.setProperty('--rx', '0deg');
        card.style.setProperty('--ry', '0deg');
      });
    });
  }

  /* ------------------------------------------------------------
     4. Capability rows — a light source that follows the cursor
     ------------------------------------------------------------ */

  function initCapLight() {
    if (COARSE) return;
    document.querySelectorAll('.cap').forEach(function (cap) {
      var raf = null;
      cap.addEventListener('mousemove', function (e) {
        if (raf) return;
        raf = requestAnimationFrame(function () {
          raf = null;
          var b = cap.getBoundingClientRect();
          cap.style.setProperty('--mx', (e.clientX - b.left) + 'px');
          cap.style.setProperty('--my', (e.clientY - b.top) + 'px');
        });
      }, { passive: true });
    });
  }

  /* ------------------------------------------------------------
     5. Cursor
     ------------------------------------------------------------ */

  function initCursor() {
    if (COARSE || REDUCED) return;
    var ring = document.querySelector('.cursor');
    var dot = document.querySelector('.cursor__dot');
    if (!ring || !dot) return;

    var mx = window.innerWidth / 2, my = window.innerHeight / 2;
    var rx = mx, ry = my;

    window.addEventListener('mousemove', function (e) {
      mx = e.clientX; my = e.clientY;
      ring.classList.add('is-live');
      dot.classList.add('is-live');
      dot.style.transform = 'translate3d(' + mx + 'px,' + my + 'px,0)';
    }, { passive: true });

    document.addEventListener('mouseleave', function () {
      ring.classList.remove('is-live');
      dot.classList.remove('is-live');
    });

    (function loop() {
      requestAnimationFrame(loop);
      rx += (mx - rx) * 0.16;
      ry += (my - ry) * 0.16;
      ring.style.transform = 'translate3d(' + rx.toFixed(2) + 'px,' + ry.toFixed(2) + 'px,0)';
    })();

    var hot = 'a, button, .work__card, .cap, .ticker__item';
    document.querySelectorAll(hot).forEach(function (el) {
      el.addEventListener('mouseenter', function () { ring.classList.add('is-hot'); });
      el.addEventListener('mouseleave', function () { ring.classList.remove('is-hot'); });
    });
  }

  /* ------------------------------------------------------------
     6. Nav — condenses on scroll, hides on the way down
     ------------------------------------------------------------ */

  function initNav() {
    var nav = document.getElementById('nav');
    if (!nav) return;
    var last = window.scrollY;
    var ticking = false;

    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        var y = window.scrollY;
        nav.classList.toggle('is-stuck', y > 40);
        nav.classList.toggle('is-hidden', y > last && y > 420);
        last = y;
      });
    }, { passive: true });
  }

  /* ------------------------------------------------------------
     Boot
     ------------------------------------------------------------ */

  function boot() {
    initReveals();
    initForge();
    initTilt();
    initCapLight();
    initCursor();
    initNav();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
