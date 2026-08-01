/* ============================================================
   RV — FORJA
   Motion layer.

   The particle field is one GPU-resident system carrying four
   shapes at once (neural / gear / lattice / logo). Scroll blends
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
    'attribute vec3 aGear;',
    'attribute vec3 aLattice;',
    'attribute vec3 aLogo;',
    'attribute float aSize;',
    'attribute float aSeed;',
    'attribute float aTint;',

    'uniform float uTime;',
    'uniform float uState;',   // 0 neural, 1 gear, 2 lattice, 3 logo
    'uniform float uScale;',
    'uniform vec3  uMouse;',
    'uniform float uMouseForce;',

    'varying float vTint;',
    'varying float vFlicker;',
    'varying float vDepth;',

    'void main() {',
    // Chained blend: each stage takes over the previous one.
    '  vec3 p = position;',
    '  p = mix(p, aGear,    clamp(uState,        0.0, 1.0));',
    '  p = mix(p, aLattice, clamp(uState - 1.0,  0.0, 1.0));',
    '  p = mix(p, aLogo,    clamp(uState - 2.0,  0.0, 1.0));',

    // Organic drift. Kept tight while the neural mass is on screen — anything
    // larger smears the sulci back into a cloud — then opened up for the
    // looser shapes, and stilled as the field snaps into the logo.
    '  float settle = 1.0 - clamp(uState - 2.0, 0.0, 1.0) * 0.92;',
    '  float drift = (0.05 + 0.11 * clamp(uState, 0.0, 1.0)) * settle;',
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

    var neural = new Float32Array(COUNT * 3);
    var gear = new Float32Array(COUNT * 3);
    var lattice = new Float32Array(COUNT * 3);
    var logo = new Float32Array(COUNT * 3);
    var sizes = new Float32Array(COUNT);
    var seeds = new Float32Array(COUNT);
    var tints = new Float32Array(COUNT);

    var TAU = Math.PI * 2;

    /* Cortical ridge field. Returns ~0 in a sulcus, ~1 on a gyral crest.
       Layered sinusoids at coprime-ish frequencies wander over the surface
       instead of tiling like a single product would. */
    function gyrus(x, y, z) {
      var s = Math.sin(x * 2.6 + z * 1.3)
        + Math.sin(z * 3.0 - y * 1.7) * 0.95
        + Math.sin(y * 3.4 + x * 1.1) * 0.8;
      return Math.pow(0.5 + 0.5 * Math.cos(s * 2.0), 2.2);
    }

    // Anatomy, in the cerebrum's own frame: +z forward, +y up, +x right.
    var A = 2.75, B = 3.25, C = 4.7;    // cerebrum semi-axes
    var NS = 0.88;                      // overall scale of the neural mass
    var STEM = 0.035, CEREB = 0.15;     // share of particles per structure

    for (var i = 0; i < COUNT; i++) {
      var i3 = i * 3;

      /* --- Shape 0: the neural mass. ---
         Three structures, because a lone ellipsoid reads as a fuzzy blob no
         matter how it is folded: a cerebrum split by a deep midline fissure,
         a finely-banded cerebellum at the lower rear, and a short stem.
         Particles are rejection-sampled toward the crests — with additive
         points it is density contrast, not displacement, that draws the
         folds. Sulci and the fissure become genuine dark valleys. */
      var role = Math.random();
      var g = 1, nx, ny, nz;

      if (role < STEM) {
        // Brain stem: a short tapered tube dropping ahead of the cerebellum.
        var sT = Math.random();
        var sRad = (0.58 - sT * 0.24) * Math.sqrt(Math.random());
        var sAng = Math.random() * TAU;
        nx = Math.cos(sAng) * sRad;
        ny = -2.0 - sT * 1.9;
        nz = -1.3 + Math.sin(sAng) * sRad - sT * 0.35;
        g = 0.5;
      } else {
        // Shared unit-sphere sampling for cerebrum and cerebellum.
        var sx, sy, sz, accept, tries = 0;
        var cerebellum = role < STEM + CEREB;

        do {
          var th = Math.random() * TAU;
          var ph = Math.acos(2 * Math.random() - 1);
          var sp = Math.sin(ph);
          sx = sp * Math.cos(th);
          sy = Math.cos(ph);
          sz = sp * Math.sin(th);

          if (cerebellum) {
            // Folia: fine parallel bands, far tighter than cortical gyri.
            g = Math.pow(0.5 + 0.5 * Math.cos(sy * 17 + sz * 5), 1.3);
            accept = 0.18 + 0.82 * g;
          } else {
            g = gyrus(sx, sy, sz);
            // The longitudinal fissure — the most legible cue in a front or
            // top view. Thin the midline out, strongest over the crown.
            var fis = Math.exp(-(sx * sx) / 0.012) * Math.min(1, Math.max(0, sy + 0.2) * 1.7);
            accept = (0.08 + 0.92 * g) * (1 - 0.92 * fis);
            // Carve the back-bottom notch the cerebellum sits in. Without this
            // the two masses overlap and read as one lump.
            var notch = Math.max(0, -sz - 0.1) * Math.max(0, -sy - 0.05) * 5.0;
            accept *= Math.max(0.02, 1 - notch);
          }
          tries++;
        } while (Math.random() > accept && tries < 7);

        // Hollow shell: a filled volume washes the folds out.
        var rr = 0.89 + Math.pow(Math.random(), 0.6) * 0.11;
        rr *= 1 - (1 - g) * 0.17;

        if (cerebellum) {
          nx = sx * 1.5 * rr;
          ny = -2.05 + sy * 1.0 * rr;
          nz = -3.15 + sz * 1.45 * rr;
        } else {
          var fis2 = Math.exp(-(sx * sx) / 0.012) * Math.min(1, Math.max(0, sy + 0.2) * 1.7);
          rr *= 1 - 0.2 * fis2;
          nx = sx * A * rr;
          ny = sy * B * rr;
          nz = sz * C * rr;
          nx += (sx >= 0 ? 0.15 : -0.15) * fis2;  // widen the cleft
          if (ny < 0) ny *= 0.8;                  // brains are flat underneath
          // Occipital taper: the back is lower and blunter than the forehead.
          var zt = nz / C;
          if (zt < 0) ny -= Math.pow(-zt, 2) * 0.55;
        }
      }

      neural[i3] = (nx + (Math.random() - 0.5) * 0.1) * NS;
      neural[i3 + 1] = (ny + (Math.random() - 0.5) * 0.1) * NS;
      neural[i3 + 2] = (nz + (Math.random() - 0.5) * 0.1) * NS;

      /* --- Shape 1: gear. A toothed torus — the automation frame.
         Sized so the hole clears the text column: the ring frames copy against
         the edges of the viewport instead of sitting behind it. --- */
      var gu = Math.random() * TAU;
      var gv = Math.random() * TAU;
      var toothPhase = (gu * 16) / TAU;
      var tooth = (toothPhase - Math.floor(toothPhase)) < 0.5 ? 0.8 : 0.0;
      var R = 7.9 + tooth;
      var tr = 1.05;
      gear[i3] = (R + tr * Math.cos(gv)) * Math.cos(gu);
      gear[i3 + 1] = (R + tr * Math.cos(gv)) * Math.sin(gu);
      gear[i3 + 2] = tr * Math.sin(gv) * 1.6;

      /* --- Shape 2: lattice. A rippling structural grid, spread wide and held
         back so depth fog reads it as architecture, not foreground. --- */
      var side = Math.ceil(Math.sqrt(COUNT));
      var gx = (i % side) / (side - 1) - 0.5;
      var gy = Math.floor(i / side) / (side - 1) - 0.5;
      lattice[i3] = gx * 34.0;
      lattice[i3 + 1] = gy * 22.0;
      lattice[i3 + 2] = Math.sin(gx * 11) * Math.cos(gy * 9) * 2.6;

      /* --- Shape 3: logo. Overwritten once the mark is sampled. --- */
      logo[i3] = neural[i3] * 2.4;
      logo[i3 + 1] = neural[i3 + 1] * 2.4;
      logo[i3 + 2] = neural[i3 + 2] * 0.4;

      // Crests carry the larger, hotter particles; sulci stay cool and fine.
      // Size does double duty as brightness under additive blending.
      sizes[i] = (0.011 + Math.random() * 0.030) * (0.72 + 0.62 * g);
      seeds[i] = Math.random();
      // Tint ramps light -> brand -> deep red, so crests must skew LOW to read
      // as lit. Sparks stay scattered, like something firing.
      tints[i] = Math.random() < 0.02 ? 0.98 : Math.pow(Math.random(), 1 + g * 1.1) * 0.93;
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(neural, 3));
    geo.setAttribute('aGear', new THREE.BufferAttribute(gear, 3));
    geo.setAttribute('aLattice', new THREE.BufferAttribute(lattice, 3));
    geo.setAttribute('aLogo', new THREE.BufferAttribute(logo, 3));
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
    // Park the mass against the right edge of the frame rather than at a fixed
    // world offset: a constant x either clips on narrow desktops or drifts into
    // the copy on wide ones.
    function homeX() {
      if (window.innerWidth < 900) return 0;
      var halfW = Math.tan(camera.fov * Math.PI / 360) * camera.position.z * camera.aspect;
      return Math.max(3.4, halfW - 4.9);
    }
    // On phones there is no free column, so the mass drops below the copy and
    // sits further back — present as atmosphere, never over the headline.
    function homeY() { return window.innerWidth < 900 ? -2.4 : 0.2; }
    function homeZ() { return window.innerWidth < 900 ? -4.5 : 0; }

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

    /* --- Scroll drives the morph: neural -> gear -> lattice -> logo --- */
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

      // The cloud must be out of the way before the first paragraph is read,
      // so the neural -> gear opening starts as the manifesto enters view.
      link('#metodo', 'top 85%', 'top 5%', 'a');
      link('#trabalho', 'top bottom', 'top 35%', 'b');
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

      // Through the copy-heavy middle of the page the field steps back so it
      // never costs the body text contrast. The logo finale is held back too:
      // it should read as a monumental watermark behind the closing statement,
      // not compete with it.
      var mid = Math.min(1, stage.a + stage.b);

      // On phones there is no empty column to put the field in — it sits
      // directly behind the copy, so it drops to atmosphere.
      var narrow = window.innerWidth < 900 ? 0.5 : 1;

      uniforms.uOpacity.value =
        intro * (1 - 0.45 * mid * (1 - stage.c)) * (1 - 0.58 * stage.c) *
        (1 - 0.85 * stage.d) * narrow;

      eased.x += (pointer.x - eased.x) * 0.045;
      eased.y += (pointer.y - eased.y) * 0.045;

      // Centre as soon as the ring starts forming — a centred ring frames the
      // copy, while an off-centre one would drag its rim across the text.
      var toCenter = Math.min(1, Math.max(stage.a * 1.3, stage.c * 1.15));
      target.set(
        homeX() * (1 - toCenter) + eased.x * 0.85,
        homeY() * (1 - toCenter) + eased.y * 0.6,
        homeZ() * (1 - toCenter) - 7.0 * stage.b * (1 - stage.c)
      );
      field.position.lerp(target, 0.05);

      // The neural state holds a readable three-quarter view, tipped just far
      // enough forward to expose the midline fissure. Spinning it would average
      // the folds back into the blob they came from — only the later shapes,
      // which have no silhouette to protect, are allowed to turn.
      var spin = 1 - Math.min(1, stage.c * 1.4);
      var morphing = Math.min(1, stage.a * 1.5);
      var settled = 1 - morphing;
      spinY += dt * 1.1 * morphing;

      // Near side-on: the sagittal profile — frontal bulge, occipital taper,
      // cerebellum and stem — is what makes a brain a brain. A front view just
      // reads as a sphere with a slot in it.
      field.rotation.y = settled * (-1.18 + Math.sin(t * 0.15) * 0.20) + spinY;
      field.rotation.x = (settled * (0.14 + Math.sin(t * 0.19) * 0.05) + eased.y * 0.14) * spin;
      field.rotation.z = eased.x * 0.04 * spin;

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
