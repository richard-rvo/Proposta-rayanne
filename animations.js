/* ============================================================
   RV — FORJA
   Motion layer.

   The particle field is one GPU-resident system carrying four
   shapes at once (lamp / lattice / woven knot / mark). Scroll blends
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
  var loaderProgress = 0;
  var processMotion = { progress: 0, active: 0 };

  function setLoaderProgress(value, label) {
    loaderProgress = Math.max(loaderProgress, Math.min(100, value));
    var root = document.documentElement;
    var output = document.querySelector('[data-loader-progress]');
    var status = document.querySelector('[data-loader-label]');
    var formatted = Math.round(loaderProgress);

    root.style.setProperty('--loader-progress', (loaderProgress / 100).toFixed(3));
    root.style.setProperty('--loader-glow-scale', (0.72 + loaderProgress * 0.0028).toFixed(3));
    root.style.setProperty('--loader-glow-opacity', (0.28 + loaderProgress * 0.0072).toFixed(3));
    if (output) output.textContent = (formatted < 10 ? '0' : '') + formatted;
    if (status && label) status.textContent = label;
  }

  function wait(ms) {
    return new Promise(function (resolve) { window.setTimeout(resolve, ms); });
  }

  function waitForFonts() {
    if (!document.fonts || !document.fonts.ready) {
      setLoaderProgress(72, 'Estrutura pronta');
      return Promise.resolve();
    }

    return Promise.race([document.fonts.ready, wait(2200)]).then(function () {
      setLoaderProgress(76, 'Tipografia pronta');
    });
  }

  function waitForLoaderMark() {
    var mark = document.querySelector('.loader__mark');
    if (!mark || mark.complete) {
      setLoaderProgress(84, 'Identidade pronta');
      return Promise.resolve();
    }

    return Promise.race([
      new Promise(function (resolve) {
        mark.addEventListener('load', resolve, { once: true });
        mark.addEventListener('error', resolve, { once: true });
      }),
      wait(1600)
    ]).then(function () {
      setLoaderProgress(84, 'Identidade pronta');
    });
  }

  function waitForWarmFrames() {
    return new Promise(function (resolve) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          setLoaderProgress(92, 'Movimento sincronizado');
          resolve();
        });
      });
    });
  }

  function waitForMarkSculpture(forge) {
    if (!forge || !forge.ready) return Promise.resolve();

    return Promise.race([forge.ready, wait(1800)]).then(function () {
      setLoaderProgress(96, 'Símbolo RV preparado');
    });
  }

  function releaseLoader() {
    setLoaderProgress(100, 'Experiência pronta');

    window.setTimeout(function () {
      initReveals();
      initProcessTimeline();
      window.clearTimeout(window.__rvLoaderFailsafe);
      document.documentElement.classList.remove('is-loading');

      if (hasGSAP && window.ScrollTrigger) {
        window.setTimeout(function () { ScrollTrigger.refresh(); }, 50);
      }
    }, REDUCED ? 20 : 180);
  }

  /* ------------------------------------------------------------
     1. The forge — Three.js particle field
     ------------------------------------------------------------ */

  var VERT = [
    'attribute vec3 aLattice;',
    'attribute vec3 aKnot;',
    'attribute vec3 aProcess;',
    'attribute vec3 aProcessOrigin;',
    'attribute float aProcessPhase;',
    'attribute vec3 aLogo;',
    'attribute float aLogoKeep;',
    'attribute float aSize;',
    'attribute float aSeed;',
    'attribute float aTint;',

    'uniform float uTime;',
    'uniform float uState;',   // 0 lamp, 1 lattice, 2 woven knot, 3 mark
    'uniform float uProcessMix;',
    'uniform float uProcessBuild;',
    'uniform float uProcessCos;',
    'uniform float uProcessSin;',
    'uniform float uBurst;',   // knot explosion before the RV mark assembles
    'uniform float uScale;',
    'uniform vec3  uMouse;',
    'uniform float uMouseForce;',

    'varying float vTint;',
    'varying float vFlicker;',
    'varying float vDepth;',
    'varying float vProcessAlpha;',
    'varying float vProcessHeat;',
    'varying float vLogoVisibility;',

    'void main() {',
    // Chained blend: each stage takes over the previous one.
    '  vec3 p = position;',
    '  p = mix(p, aLattice, clamp(uState,       0.0, 1.0));',
    '  p = mix(p, aKnot,    clamp(uState - 1.0, 0.0, 1.0));',
    '  float logoMix = clamp(uState - 2.0, 0.0, 1.0);',
    '  float processInfluence = uProcessMix * (1.0 - logoMix);',
    '  float processLayer = 1.0;',
    '  float processBand = 0.0;',
    // The branch is uniform for the whole draw call. Hero, work and the settled
    // RV mark skip the process-only assembly math entirely.
    '  if (processInfluence > 0.001) {',
    '    processLayer = smoothstep(aProcessPhase - 0.10, aProcessPhase + 0.08, uProcessBuild);',
    '    float liveMask = smoothstep(0.78, 0.84, aProcessPhase) * smoothstep(0.76, 0.94, uProcessBuild);',
    '    vec3 processLive = aProcess;',
    '    processLive.xz = mat2(uProcessCos, -uProcessSin, uProcessSin, uProcessCos) * processLive.xz;',
    '    vec3 processTarget = mix(aProcessOrigin, mix(aProcess, processLive, liveMask), processLayer);',
    '    processBand = exp(-pow((uProcessBuild - aProcessPhase) * 6.5, 2.0));',
    '    p = mix(p, processTarget, processInfluence);',
    '  }',
    '  p = mix(p, aLogo, logoMix);',

    // Drift keyed to the emitter seed, so panels wander as rigid pieces and
    // their edges stay sharp. Kept tight while the product is on screen, opened
    // up for the looser shapes, and stilled as it snaps into the mark.
    '  float settle = 1.0 - clamp(uState - 2.0, 0.0, 1.0) * 0.92;',
    '  float drift = (0.07 + 0.1 * clamp(uState, 0.0, 1.0)) * settle;',
    '  drift *= mix(1.0, 0.18, processInfluence);',
    '  float t = uTime;',
    '  p.x += sin(t * 0.62 + aSeed * 6.283) * drift;',
    '  p.y += cos(t * 0.71 + aSeed * 5.117) * drift;',
    '  p.z += sin(t * 0.53 + aSeed * 4.331) * drift;',

    // Scroll-driven breakup: particles travel radially in uneven clusters,
    // then retrace the same path while the RV target assembles.
    '  float burst = smoothstep(0.0, 1.0, uBurst);',
    '  vec3 burstNoise = vec3(',
    '    sin(aSeed * 91.73 + 0.4),',
    '    cos(aSeed * 73.19 + 1.7),',
    '    sin(aSeed * 57.41 + 2.8)',
    '  );',
    '  vec3 burstDir = normalize(p * 0.34 + burstNoise * 1.65 + 0.0001);',
    '  float burstDistance = 2.2 + fract(aSeed * 37.17) * 5.2;',
    '  p += burstDir * burstDistance * burst;',
    '  p += burstNoise * sin(t * 0.34 + aSeed * 18.0) * burst * 0.32;',

    // Cursor repulsion, in the system's local space.
    '  vec3 away = p - uMouse;',
    '  float d = length(away);',
    '  float push = uMouseForce * exp(-d * d * 0.045) * mix(1.0, 0.22, processInfluence);',
    '  p += normalize(away + 0.0001) * push;',

    '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
    '  gl_Position = projectionMatrix * mv;',
    // The hero gets large, legible triangles; the transitional fields become
    // finer so a dense morph never turns into a wall in front of the content.
    '  float stateSize = mix(1.0, 0.38, smoothstep(0.0, 1.0, uState));',
    '  stateSize = mix(stateSize, 0.68, smoothstep(1.0, 2.0, uState));',
    '  stateSize = mix(stateSize, 0.86, smoothstep(2.0, 3.0, uState));',
    '  float processSize = mix(1.0, 1.0 + processBand * 0.58, processInfluence);',
    '  stateSize = mix(stateSize, 0.76, processInfluence);',
    '  gl_PointSize = aSize * stateSize * processSize * uScale / max(-mv.z, 0.1);',

    '  vTint = aTint;',
    '  vFlicker = 0.62 + 0.38 * sin(t * 1.9 + aSeed * 12.566);',
    '  vDepth = -mv.z;',
    '  vProcessAlpha = mix(1.0, mix(0.008, 1.0, processLayer), processInfluence);',
    '  vProcessHeat = processBand * processLayer * processInfluence;',
    // The sampled mark contains many visually identical points. Fade a stable
    // subset out only near the end of the logo morph to cut dense overdraw.
    '  float logoKeep = step(0.30, aLogoKeep);',
    '  vLogoVisibility = mix(1.0, logoKeep, smoothstep(0.48, 0.92, logoMix));',
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
    'varying float vProcessAlpha;',
    'varying float vProcessHeat;',
    'varying float vLogoVisibility;',

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
    // Reject redundant logo particles before the signed-distance and colour
    // work. All process and hero particles still use the complete field.
    '  if (vLogoVisibility < 0.02) discard;',
    '  vec2 uv = gl_PointCoord - 0.5;',

    // Outlined triangle, like the reference constellation.
    '  float d = sdTri(vec2(uv.x, -uv.y), 0.30);',
    '  float edge = fwidth(d) + 0.012;',
    '  float outline = 1.0 - smoothstep(0.0, edge, abs(d) - 0.045);',

    // A very faint core protects sub-pixel points without filling the larger
    // triangles. At hero scale the glyph remains visibly outlined.
    '  float core = exp(-dot(uv, uv) * 10.0) * 0.13;',
    '  float a = clamp(outline + core, 0.0, 1.0) * vProcessAlpha * vLogoVisibility;',
    '  if (a < 0.01) discard;',

    // Ember ramp: light orange -> brand orange -> deep red, with rare white sparks.
    '  vec3 col = mix(uEmberLo, uEmber, smoothstep(0.0, 0.55, vTint));',
    '  col = mix(col, uEmberHi, smoothstep(0.55, 1.0, vTint));',
    '  col = mix(col, vec3(1.0), step(0.955, vTint) * 0.8);',
    '  col = mix(col, vec3(1.0, 0.93, 0.74), vProcessHeat * 0.88);',

    // Depth fog so the far side of the cloud recedes into the void.
    '  float fog = clamp(1.30 - vDepth * 0.026, 0.20, 1.0);',

    '  gl_FragColor = vec4(col * (0.82 + vFlicker * 0.34), a * uOpacity * fog * 0.92);',
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
    // Density control. With larger glyphs, fewer particles keep the drawings
    // open and let every outlined triangle remain individually legible.
    var PARTICLE_COUNT = {
      reduced: 1600,
      mobile: 3400,
      desktop: 28000
    };
    var COUNT = REDUCED
      ? PARTICLE_COUNT.reduced
      : (isSmall ? PARTICLE_COUNT.mobile : PARTICLE_COUNT.desktop);

    // Global control for the outlined triangle glyphs that build every form.
    // This changes each triangle, independently from the sculptures' scale.
    var PARTICLE_GLYPH_SCALE = 0.5;

    var heroP = new Float32Array(COUNT * 3);
    var latticeP = new Float32Array(COUNT * 3);
    var knotP = new Float32Array(COUNT * 3);
    var processP = new Float32Array(COUNT * 3);
    var processOriginP = new Float32Array(COUNT * 3);
    var processPhases = new Float32Array(COUNT);
    var logoP = new Float32Array(COUNT * 3);
    var logoKeep = new Float32Array(COUNT);
    var sizes = new Float32Array(COUNT);
    var seeds = new Float32Array(COUNT);
    var tints = new Float32Array(COUNT);

    var TAU = Math.PI * 2;
    var tmp3 = [0, 0, 0];
    var tmpOrigin = [0, 0, 0];

    /* ---- Emitters --------------------------------------------------------
       Each shape is a list of emitters carrying a weight. Particles are dealt
       out in proportion to that weight, so a long curve and a short one end up
       with the same line density instead of the short one clotting.

       Every emitter also carries its own seed. The drift in the vertex shader
       keys off that seed, so a curve wanders as a rigid piece rather than
       dissolving — which is what keeps the wireframe sharp where a per-particle
       jitter would blur it into a cloud. */

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

    /* ---- Shape 0: the idea, engineered ------------------------------------
       A volumetric lamp built from a dense glass shell, precision contour
       curves, a real helical screw base and a hot filament. The earlier lamp
       was only a sparse wireframe; this one has enough information to hold up
       as the hero object even when the camera stops moving. */

    // Main size control for the animated hero object. Raise these values to
    // give the sculpture more presence; lower them to create more breathing room.
    var HERO_OBJECT_SCALE = isSmall ? 1.90 : 2.08;
    var heroE = [];

    function hE(w, glow, sz, f) {
      heroE.push({ w: w, glow: glow, sz: sz, seed: Math.random(), f: f });
    }

    function glassR(y) {
      if (y >= 0.52) {
        var dy = (y - 1.34) / 1.48;
        return 1.48 * Math.sqrt(Math.max(0, 1 - dy * dy));
      }
      var shoulder = 1.48 * Math.sqrt(1 - Math.pow((0.52 - 1.34) / 1.48, 2));
      var t = Math.min(1, (0.52 - y) / 1.02);
      return shoulder + (0.53 - shoulder) * (0.5 - 0.5 * Math.cos(Math.PI * t));
    }

    // Glass volume — dense enough to reveal curvature, open enough to keep the
    // filament visible through it. The small radial offset adds thickness.
    hE(128, 0.5, 0.66, function (o) {
      var y = -0.5 + Math.random() * 3.25;
      var a = Math.random() * TAU;
      var r = glassR(y) + (Math.random() - 0.5) * 0.055;
      o[0] = Math.cos(a) * r;
      o[1] = y;
      o[2] = Math.sin(a) * r;
    });

    // Bright silhouette hems and meridians keep the lamp crisp at a glance.
    hE(34, 0.08, 0.82, function (o) {
      var y = -0.5 + Math.random() * 3.25;
      o[0] = -glassR(y); o[1] = y; o[2] = 0;
    });
    hE(34, 0.08, 0.82, function (o) {
      var y = -0.5 + Math.random() * 3.25;
      o[0] = glassR(y); o[1] = y; o[2] = 0;
    });
    [-0.02, 1.72].forEach(function (yy) {
      var rr = glassR(yy);
      hE(TAU * rr * 1.05, 0.16, 0.78, function (o) {
        var a = Math.random() * TAU;
        o[0] = Math.cos(a) * rr; o[1] = yy; o[2] = Math.sin(a) * rr;
      });
    });

    // Neck and metal base: a dense cylinder plus one continuous screw thread.
    hE(42, 0.72, 0.94, function (o) {
      var y = -2.12 + Math.random() * 1.48;
      var a = Math.random() * TAU;
      var r = 0.55 + (Math.random() - 0.5) * 0.06;
      o[0] = Math.cos(a) * r; o[1] = y; o[2] = Math.sin(a) * r;
    });
    hE(54, 0.28, 1.22, function (o) {
      var u = Math.random();
      var a = u * TAU * 7.2;
      var r = 0.61 + Math.sin(a * 0.5) * 0.025;
      o[0] = Math.cos(a) * r;
      o[1] = -0.68 - u * 1.5;
      o[2] = Math.sin(a) * r;
    });
    hE(10, 0.18, 1.22, function (o) {
      var a = Math.random() * TAU;
      var r = Math.sqrt(Math.random()) * 0.34;
      o[0] = Math.cos(a) * r; o[1] = -2.28; o[2] = Math.sin(a) * r;
    });

    // The bright tungsten coil and its two support posts sit inside the glass.
    hE(24, 0.01, 1.55, function (o) {
      var u = Math.random();
      var coil = u * TAU * 8;
      o[0] = -0.55 + u * 1.1;
      o[1] = 0.92 + Math.cos(coil) * 0.23;
      o[2] = Math.sin(coil) * 0.23;
    });
    hE(18, 0.04, 1.3, function (o) {
      var side = Math.random() < 0.5 ? -1 : 1;
      var u = Math.random();
      o[0] = side * (0.48 - u * 0.06);
      o[1] = -0.52 + u * 1.52;
      o[2] = 0;
    });

    // A restrained halo of free triangles borrows the Dala sense of scale and
    // makes the sculpture feel suspended in a much larger field.
    hE(18, 0.38, 0.78, function (o) {
      var a = Math.random() * TAU;
      var r = 2.05 + Math.pow(Math.random(), 0.55) * 1.6;
      o[0] = Math.cos(a) * r;
      o[1] = -0.1 + Math.sin(a) * r * 0.72 + (Math.random() - 0.5) * 1.8;
      o[2] = (Math.random() - 0.5) * 2.5;
    });

    var heroTotal = totalOf(heroE);

    /* ---- Shape 2: three disciplines, one continuous system ---------------
       A trefoil knot replaces the literal component boxes. Three luminous
       rails share one path: design, engineering and intelligence moving as a
       single system. Sparse particles fill the tube just enough to reveal its
       depth without turning the form into a solid mesh. */

    function sampleKnot(out, index) {
      var u = Math.random() * TAU;
      var P = 2, Q = 3;
      var major = 4.65;
      var minor = 1.42;
      var pu = P * u, qu = Q * u;
      var cpu = Math.cos(pu), spu = Math.sin(pu);
      var cqu = Math.cos(qu), squ = Math.sin(qu);
      var ring = major + minor * cqu;

      var cx = ring * cpu;
      var cy = ring * spu;
      var cz = minor * squ;

      // Analytic tangent and a stable local frame around the knot.
      var tx = -P * ring * spu - minor * Q * squ * cpu;
      var ty = P * ring * cpu - minor * Q * squ * spu;
      var tz = minor * Q * cqu;
      var tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;

      var nx = cpu * cqu;
      var ny = spu * cqu;
      var nz = squ;
      var nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;

      var bx = ty * nz - tz * ny;
      var by = tz * nx - tx * nz;
      var bz = tx * ny - ty * nx;
      var bl = Math.sqrt(bx * bx + by * by + bz * bz) || 1;
      bx /= bl; by /= bl; bz /= bl;

      var rail = index % 3;
      var angle = rail * TAU / 3 + Math.sin(u * 6) * 0.13;
      var tube = 0.33 + (Math.random() - 0.5) * 0.075;

      // Every seventh point sits inside the rails, making the crossings read
      // as volume while the majority preserves three crisp flowing lines.
      if (index % 7 === 0) {
        angle = Math.random() * TAU;
        tube = Math.sqrt(Math.random()) * 0.48;
      }

      var ca = Math.cos(angle), sa = Math.sin(angle);
      out[0] = (cx + (nx * ca + bx * sa) * tube) * 1.08;
      out[1] = (cy + (ny * ca + by * sa) * tube) * 0.72;
      out[2] = cz + (nz * ca + bz * sa) * tube;
    }

    /* ---- Process sculpture: the product core ------------------------------
       One object accumulates meaning instead of swapping metaphors at every
       step. A hot nucleus becomes a blueprint, the blueprint gets a structural
       cage, and the finished machine receives live signal orbits. */

    function randomDirection(out) {
      var z = Math.random() * 2 - 1;
      var a = Math.random() * TAU;
      var r = Math.sqrt(Math.max(0, 1 - z * z));
      out[0] = Math.cos(a) * r;
      out[1] = z;
      out[2] = Math.sin(a) * r;
    }

    function sampleProcess(out, origin, index) {
      var group = Math.random();
      var a, r, u, z, ring, theta, phi, direction;
      var phase;

      if (group < 0.16) {
        // 01 — Conversation: a compact, hot nucleus with an internal coil.
        phase = -0.06;
        if (index % 4 === 0) {
          u = Math.random();
          a = u * TAU * 7.5;
          r = 0.34 + Math.sin(a * 0.5) * 0.035;
          out[0] = Math.cos(a) * r;
          out[1] = -0.82 + u * 1.64;
          out[2] = Math.sin(a) * r;
        } else {
          randomDirection(out);
          r = 0.72 + Math.random() * 0.22;
          out[0] *= r;
          out[1] *= r;
          out[2] *= r;
        }

        origin[0] = out[0] * 0.72 + (Math.random() - 0.5) * 0.08;
        origin[1] = out[1] * 0.72 + (Math.random() - 0.5) * 0.08;
        origin[2] = out[2] * 0.72 + (Math.random() - 0.5) * 0.08;
        return phase;
      }

      if (group < 0.42) {
        // 02 — Design: orthogonal construction rings and measured axes.
        phase = 0.26 + Math.random() * 0.045;
        ring = index % 4;
        a = Math.random() * TAU;
        r = 3.05 + (Math.random() - 0.5) * 0.1;

        if (ring === 0) {
          out[0] = Math.cos(a) * r;
          out[1] = Math.sin(a) * r * 0.72;
          out[2] = (Math.random() - 0.5) * 0.08;
        } else if (ring === 1) {
          out[0] = Math.cos(a) * r;
          out[1] = (Math.random() - 0.5) * 0.08;
          out[2] = Math.sin(a) * r * 0.86;
        } else if (ring === 2) {
          out[0] = (Math.random() - 0.5) * 0.08;
          out[1] = Math.cos(a) * r * 0.72;
          out[2] = Math.sin(a) * r * 0.86;
        } else {
          direction = index % 3;
          u = Math.random() * 2 - 1;
          out[0] = direction === 0 ? u * 3.45 : (Math.random() - 0.5) * 0.05;
          out[1] = direction === 1 ? u * 2.5 : (Math.random() - 0.5) * 0.05;
          out[2] = direction === 2 ? u * 2.9 : (Math.random() - 0.5) * 0.05;
        }
      } else if (group < 0.82) {
        // 03 — Construction: latitude/longitude ribs plus radial braces.
        phase = 0.58 + Math.random() * 0.055;
        ring = index % 3;

        if (ring === 0) {
          z = ((index % 11) / 10) * 1.8 - 0.9;
          a = Math.random() * TAU;
          r = Math.sqrt(Math.max(0, 1 - z * z));
          out[0] = Math.cos(a) * r * 3.35;
          out[1] = z * 2.45;
          out[2] = Math.sin(a) * r * 2.85;
        } else if (ring === 1) {
          phi = (index % 14) / 14 * TAU;
          theta = Math.random() * Math.PI;
          out[0] = Math.sin(theta) * Math.cos(phi) * 3.35;
          out[1] = Math.cos(theta) * 2.45;
          out[2] = Math.sin(theta) * Math.sin(phi) * 2.85;
        } else {
          randomDirection(out);
          u = 0.34 + Math.random() * 0.66;
          out[0] *= 3.35 * u;
          out[1] *= 2.45 * u;
          out[2] *= 2.85 * u;
        }
      } else {
        // 04 — Live: wide signal paths and a sparse operational halo.
        phase = 0.84 + Math.random() * 0.055;
        ring = index % 4;
        a = Math.random() * TAU;
        r = 4.15 + Math.random() * 0.55;

        if (ring === 0) {
          out[0] = Math.cos(a) * r;
          out[1] = Math.sin(a) * r * 0.58;
          out[2] = Math.sin(a * 3) * 0.16;
        } else if (ring === 1) {
          out[0] = Math.cos(a) * r * 0.88;
          out[1] = Math.sin(a) * r * 0.42;
          out[2] = Math.sin(a) * r * 0.72;
        } else if (ring === 2) {
          out[0] = Math.sin(a) * r * 0.62;
          out[1] = Math.cos(a) * r * 0.7;
          out[2] = Math.sin(a) * r * 0.76;
        } else {
          randomDirection(out);
          r = 3.8 + Math.pow(Math.random(), 0.55) * 1.35;
          out[0] *= r;
          out[1] *= r * 0.65;
          out[2] *= r * 0.8;
        }
      }

      // Future layers wait close to the core, then travel outward as their
      // timeline segment ignites.
      randomDirection(origin);
      r = 0.55 + Math.pow(Math.random(), 1.7) * 0.9;
      origin[0] *= r;
      origin[1] *= r;
      origin[2] *= r;
      return phase;
    }

    for (var i = 0; i < COUNT; i++) {
      var i3 = i * 3;

      // Shape 0 — the lamp.
      var be = pick(heroE, heroTotal);
      be.f(tmp3);
      heroP[i3] = tmp3[0] * HERO_OBJECT_SCALE;
      heroP[i3 + 1] = tmp3[1] * HERO_OBJECT_SCALE;
      heroP[i3 + 2] = tmp3[2] * HERO_OBJECT_SCALE;

      // Shape 1 — a wide, far grid. Through the work section the screenshots
      // are the subject, so the field sits behind them as architecture.
      var side = Math.ceil(Math.sqrt(COUNT));
      var gx = (i % side) / (side - 1) - 0.5;
      var gy = Math.floor(i / side) / (side - 1) - 0.5;
      latticeP[i3] = gx * 34.0;
      latticeP[i3 + 1] = gy * 22.0;
      latticeP[i3 + 2] = Math.sin(gx * 11) * Math.cos(gy * 9) * 2.6;

      // Shape 2 — the woven trefoil.
      sampleKnot(tmp3, i);
      knotP[i3] = tmp3[0];
      knotP[i3 + 1] = tmp3[1];
      knotP[i3 + 2] = tmp3[2];

      // The process engine accumulates four layers from a shared nucleus.
      processPhases[i] = sampleProcess(tmp3, tmpOrigin, i);
      processP[i3] = tmp3[0];
      processP[i3 + 1] = tmp3[1];
      processP[i3 + 2] = tmp3[2];
      processOriginP[i3] = tmpOrigin[0];
      processOriginP[i3 + 1] = tmpOrigin[1];
      processOriginP[i3 + 2] = tmpOrigin[2];

      // Shape 3 — overwritten once the mark is sampled.
      logoP[i3] = heroP[i3] * 0.6;
      logoP[i3 + 1] = heroP[i3 + 1] * 0.6;
      logoP[i3 + 2] = 0;
      logoKeep[i] = Math.random();

      sizes[i] = (0.05 + Math.random() * 0.068) * be.sz * PARTICLE_GLYPH_SCALE;
      seeds[i] = be.seed + Math.random() * 0.03;
      // Tint ramps light -> brand -> deep red, so the filament sits at the
      // bottom of the ramp and the glass higher up.
      tints[i] = Math.random() < 0.025
        ? 1
        : Math.max(0, Math.min(0.94, be.glow + (Math.random() - 0.5) * 0.12));
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(heroP, 3));
    geo.setAttribute('aLattice', new THREE.BufferAttribute(latticeP, 3));
    geo.setAttribute('aKnot', new THREE.BufferAttribute(knotP, 3));
    geo.setAttribute('aProcess', new THREE.BufferAttribute(processP, 3));
    geo.setAttribute('aProcessOrigin', new THREE.BufferAttribute(processOriginP, 3));
    geo.setAttribute('aProcessPhase', new THREE.BufferAttribute(processPhases, 1));
    geo.setAttribute('aLogo', new THREE.BufferAttribute(logoP, 3));
    geo.setAttribute('aLogoKeep', new THREE.BufferAttribute(logoKeep, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geo.setAttribute('aTint', new THREE.BufferAttribute(tints, 1));

    var uniforms = {
      uTime: { value: 0 },
      uState: { value: 0 },
      uProcessMix: { value: 0 },
      uProcessBuild: { value: 0 },
      uProcessCos: { value: 1 },
      uProcessSin: { value: 0 },
      uBurst: { value: 0 },
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
      blending: THREE.NormalBlending,
      extensions: { derivatives: true }
    });

    var field = new THREE.Points(geo, material);
    // Morph targets extend far beyond the hero's original bounding sphere.
    field.frustumCulled = false;
    scene.add(field);

    /* --- Build the existing RV mark as a volumetric particle sculpture ----
       The monogram is not painted black in the PNG: it is transparent space
       carved through the orange tile. Reading the alpha channel preserves both
       the outer silhouette and the complete RV cutout, exactly as the earlier
       implementation did. The contour then gets a restrained extrusion. */
    var sculptureResolve;
    var sculptureReady = new Promise(function (resolve) { sculptureResolve = resolve; });
    var logoTargetReady = false;
    var LOGO_OBJECT_SCALE = isSmall ? 0.052 : 0.060;
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      try {
        var S = 128;
        var c = document.createElement('canvas');
        c.width = c.height = S;
        var ctx = c.getContext('2d', { willReadFrequently: true });
        var ratio = img.naturalWidth / img.naturalHeight;
        var drawW = ratio >= 1 ? S : S * ratio;
        var drawH = ratio >= 1 ? S / ratio : S;
        var drawX = (S - drawW) * 0.5;
        var drawY = (S - drawH) * 0.5;
        ctx.clearRect(0, 0, S, S);
        ctx.drawImage(img, drawX, drawY, drawW, drawH);
        var data = ctx.getImageData(0, 0, S, S).data;

        function isMarkPixel(x, y) {
          if (x < 0 || x >= S || y < 0 || y >= S) return false;
          var at = (y * S + x) * 4;
          return data[at + 3] > 120;
        }

        var pts = [];
        var edges = [];
        var minX = S, maxX = 0, minY = S, maxY = 0;
        for (var y = 0; y < S; y++) {
          for (var x = 0; x < S; x++) {
            if (!isMarkPixel(x, y)) continue;
            var point = [x, y];
            pts.push(point);
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);

            if (!isMarkPixel(x - 1, y) || !isMarkPixel(x + 1, y) ||
                !isMarkPixel(x, y - 1) || !isMarkPixel(x, y + 1)) {
              edges.push(point);
            }
          }
        }
        if (!pts.length) {
          sculptureResolve(false);
          return;
        }

        for (var k = pts.length - 1; k > 0; k--) {
          var j = (Math.random() * (k + 1)) | 0;
          var tmp = pts[k]; pts[k] = pts[j]; pts[j] = tmp;
        }
        for (var e = edges.length - 1; e > 0; e--) {
          var ej = (Math.random() * (e + 1)) | 0;
          var et = edges[e]; edges[e] = edges[ej]; edges[ej] = et;
        }

        var centreX = (minX + maxX) * 0.5;
        var centreY = (minY + maxY) * 0.5;
        var attr = geo.attributes.aLogo;
        for (var n = 0; n < COUNT; n++) {
          var useEdge = edges.length && n % 4 === 0;
          var source = useEdge ? edges : pts;
          var p = source[n % source.length];
          var depth = useEdge ? 1.05 : 0.72;
          attr.array[n * 3] = (p[0] - centreX) * LOGO_OBJECT_SCALE + (Math.random() - 0.5) * 0.045;
          attr.array[n * 3 + 1] = -(p[1] - centreY) * LOGO_OBJECT_SCALE + (Math.random() - 0.5) * 0.045;
          attr.array[n * 3 + 2] = (Math.random() - 0.5) * depth;
        }
        attr.needsUpdate = true;
        logoTargetReady = true;
        sculptureResolve(true);
      } catch (e) {
        sculptureResolve(false);
      }
    };
    img.onerror = function () { sculptureResolve(false); };
    img.src = 'assets/logo-gradient.png';

    /* --- Placement: hero object and closing mark follow their DOM columns - */
    var home = new THREE.Vector3();
    var markHome = new THREE.Vector3();
    var heroVisual = document.querySelector('.hero__visual');
    var closeVisual = document.querySelector('.close__visual');
    var markScreenX = 0.74;
    var markDocumentY = window.innerHeight * 0.5;
    var markMeasured = false;
    var markScrollY = NaN;

    function updateHome() {
      var halfW = Math.tan(camera.fov * Math.PI / 360) * camera.position.z * camera.aspect;
      var halfH = Math.tan(camera.fov * Math.PI / 360) * camera.position.z;
      var rect = heroVisual ? heroVisual.getBoundingClientRect() : null;
      var isNarrow = window.innerWidth < 900;
      var screenX = rect ? (rect.left + rect.width * 0.5) / window.innerWidth : 0.74;
      var screenY = rect
        ? (rect.top + (isNarrow ? 0 : window.scrollY) + rect.height * (isNarrow ? 0.64 : 0.48)) / window.innerHeight
        : 0.5;

      if (isNarrow) {
        // On a stacked layout the object follows its reserved DOM plinth into
        // view, instead of sitting behind the CTA on the first phone screen.
        home.set((screenX * 2 - 1) * halfW, -(screenY * 2 - 1) * halfH, -1.8);
      } else {
        // Desktop always resolves the lamp as if the document were at scroll 0.
        // That preserves the original composition when a reverse scroll reaches
        // the hero before its DOM column is physically centred in the viewport.
        home.set((screenX * 2 - 1) * halfW, -(screenY * 2 - 1) * halfH, -0.25);
      }
    }

    function measureMarkHome() {
      var rect = closeVisual ? closeVisual.getBoundingClientRect() : null;
      if (rect) {
        markScreenX = (rect.left + rect.width * 0.5) / window.innerWidth;
        markDocumentY = rect.top + window.scrollY + rect.height * 0.5;
        markMeasured = true;
      }
      markScrollY = NaN;
      updateMarkHome(true);
    }

    function updateMarkHome(force) {
      var scrollY = window.scrollY;
      if (!force && scrollY === markScrollY) return;
      markScrollY = scrollY;

      var halfW = Math.tan(camera.fov * Math.PI / 360) * camera.position.z * camera.aspect;
      var halfH = Math.tan(camera.fov * Math.PI / 360) * camera.position.z;
      var screenX = markMeasured ? markScreenX : 0.74;
      var screenY = markMeasured ? (markDocumentY - scrollY) / window.innerHeight : 0.5;
      var depth = window.innerWidth < 900 ? -1.15 : -0.35;

      // The closing section can sit several viewports away during a fast reverse
      // scroll. Keeping its projected target bounded prevents the particle field
      // from accumulating a huge off-screen position before it becomes the lamp
      // again in the hero.
      screenX = Math.max(0.08, Math.min(0.92, screenX));
      screenY = Math.max(0.1, Math.min(0.9, screenY));

      markHome.set(
        (screenX * 2 - 1) * halfW,
        -(screenY * 2 - 1) * halfH,
        depth
      );
    }

    updateHome();
    measureMarkHome();
    field.position.copy(home);

    // Layout can settle once more after fonts and assets resolve. These are the
    // only extra DOM measurements; the animation loop uses the cached document
    // coordinate and the current scroll offset.
    window.addEventListener('load', measureMarkHome, { once: true });
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(measureMarkHome);
    }

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

    /* --- Scroll drives the morph: lamp -> lattice -> knot -> mark --- */
    var stage = { a: 0, b: 0, c: 0, d: 0 };
    var procDim = 0;
    var processMix = 0;
    var whoBurst = 0;
    var spinY = 0;
    var heroNeedsRestore = false;

    function restoreHeroState() {
      // Reverse scrolling crosses several independent triggers. Reset them as a
      // single state when the first morph reaches zero, so the lamp cannot keep
      // the footer opacity, burst, rotation or an off-screen mark position.
      stage.a = 0;
      stage.b = 0;
      stage.c = 0;
      stage.d = 0;
      procDim = 0;
      processMix = 0;
      processMotion.progress = 0;
      processMotion.active = 0;
      whoBurst = 0;
      spinY = 0;
      uniforms.uState.value = 0;
      uniforms.uProcessMix.value = 0;
      uniforms.uProcessBuild.value = 0;
      uniforms.uBurst.value = 0;
      updateHome();
      field.position.copy(home);
      heroNeedsRestore = false;
    }

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
          onUpdate: function (self) {
            stage[key] = self.progress;
            if (key === 'a' && self.progress > 0.001) heroNeedsRestore = true;
          },
          onLeave: function () {
            stage[key] = 1;
            if (key === 'a') heroNeedsRestore = true;
          },
          onLeaveBack: function () { stage[key] = 0; }
        });
      };

      // The lamp clears the frame as the real screenshots arrive, the lattice
      // sits behind them, and the woven knot takes over for the capabilities.
      link('#trabalho', 'top 90%', 'top 25%', 'a');
      link('#capacidades', 'top 85%', 'top 20%', 'b');
      link('#contato', 'top 85%', 'center 62%', 'c');

      // The capabilities sculpture dips through the process section, letting
      // the four clear steps own that part of the page without visual noise.
      var proc = document.querySelector('#processo');
      if (proc) {
        ScrollTrigger.create({
          trigger: proc,
          start: 'top bottom',
          end: 'bottom top',
          scrub: 0.8,
          onUpdate: function (self) {
            procDim = 1 - Math.abs(self.progress * 2 - 1);
          },
          onLeave: function () { procDim = 0; },
          onLeaveBack: function () { procDim = 0; }
        });

        // Before the sticky sequence begins, the three-discipline knot folds
        // into the process nucleus. The build itself is then driven by the same
        // normalized progress that illuminates steps 01–04.
        ScrollTrigger.create({
          trigger: proc,
          start: 'top 90%',
          end: 'top 20%',
          onUpdate: function (self) { processMix = self.progress; },
          onLeave: function () { processMix = 1; },
          onLeaveBack: function () { processMix = 0; }
        });
      }

      // As the personal section arrives, the knot breaks apart early. It stays
      // dispersed until the contact section pulls the same points into the RV.
      var who = document.querySelector('#quem');
      if (who) {
        ScrollTrigger.create({
          trigger: who,
          start: 'top 90%',
          end: 'top 28%',
          scrub: 0.65,
          onUpdate: function (self) {
            whoBurst = Math.min(1, self.progress * 1.35);
          },
          onLeave: function () { whoBurst = 1; },
          onLeaveBack: function () { whoBurst = 0; }
        });
      }

      // The mark assembles, holds, then burns out over the footer.
      link('.footer', 'top bottom', 'top 55%', 'd');
    }

    var clock = new THREE.Clock();
    var running = true;
    var target = new THREE.Vector3();
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

      // The transition to the hero is a discrete restoration point. Snapping
      // once here is intentional: it removes stale placement from the closing
      // mark while all ordinary scrolling remains smoothly interpolated.
      if (stage.a > 0.001) heroNeedsRestore = true;
      else if (heroNeedsRestore) restoreHeroState();

      // The lamp owns the hero outright — it does not morph until you scroll.
      uniforms.uState.value = stage.a + stage.b + stage.c;
      uniforms.uProcessMix.value = processMix;
      uniforms.uProcessBuild.value = processMotion.progress;
      if (processMix > 0.001 && stage.c < 0.999) {
        var processAngle = t * 0.11;
        uniforms.uProcessCos.value = Math.cos(processAngle);
        uniforms.uProcessSin.value = Math.sin(processAngle);
      }
      // The burst reaches its widest point through "Quem faz" and collapses as
      // the contact morph advances, producing a true explode -> assemble beat.
      var burst = whoBurst * (1 - Math.min(1, stage.c * 1.18));
      uniforms.uBurst.value = burst;

      // Fade in against the clock, not the frame counter — a per-frame ramp
      // resolves twice as fast on a 120Hz panel as on a 60Hz one.
      var intro = Math.min(1, t / 1.4);

      // The lattice remains visible through the projects as a topographic map.
      // It supports the screenshots at half strength instead of disappearing.
      // The knot then takes over for capabilities, and the RV sculpture returns
      // to full presence inside its own column beside the closing CTA.
      var overWork = 1 - 0.52 * stage.a * (1 - stage.b);
      var overKnot = 1 - 0.48 * stage.b * (1 - stage.c);
      var overProcess = 1 - (0.72 - processMix * 0.42) * procDim;
      var overMark = 1 - (logoTargetReady ? 0.08 : 0.96) * stage.c;

      // On phones there is no empty column to put it in — it sits directly
      // behind the copy, so it drops to atmosphere.
      var narrowBase = window.innerWidth < 900 ? 0.58 : 1;
      var narrow = narrowBase + (1 - narrowBase) * stage.c;
      var burstDim = 1 - burst * 0.42;

      uniforms.uOpacity.value =
        intro * overWork * overKnot * overProcess * overMark *
        (1 - 0.85 * stage.d) * narrow * burstDim;

      eased.x += (pointer.x - eased.x) * 0.045;
      eased.y += (pointer.y - eased.y) * 0.045;

      if (window.innerWidth < 900 && stage.a < 0.2) updateHome();
      if (stage.c > 0.001) updateMarkHome();

      // Transitional fields sit at the centre. As the final morph resolves, the
      // mark moves into the reserved right-hand column just like the hero lamp.
      var toCenter = Math.min(1, stage.a * 1.3);
      var toMark = Math.min(1, stage.c * 1.2);
      var processShiftX = processMix * (window.innerWidth < 900 ? 0 : 0.65);
      var workDepth = -2.6 * stage.a * (1 - stage.b);
      var knotDepth = -1.45 * stage.b * (1 - stage.c);
      var baseX = home.x * (1 - toCenter);
      var baseY = home.y * (1 - toCenter);
      var baseZ = home.z * (1 - toCenter) + workDepth + knotDepth;
      target.set(
        baseX * (1 - toMark) + markHome.x * toMark + processShiftX * (1 - toMark) + eased.x * (0.85 - toMark * 0.3),
        baseY * (1 - toMark) + markHome.y * toMark + eased.y * (0.6 - toMark * 0.18),
        baseZ * (1 - toMark) + markHome.z * toMark
      );
      // A long reverse scroll should settle the sculpture back in the hero
      // before the user notices the old section offset lingering onscreen.
      var heroReturnBoost = 1 - Math.min(1, stage.a * 12);
      field.position.lerp(target, 0.05 + heroReturnBoost * 0.07);

      // The lamp and RV mark both hold deliberate three-quarter views. The mark
      // keeps a slow living rotation so its extrusion remains visible.
      var morphing = Math.min(1, stage.a * 1.5);
      var settled = 1 - morphing;
      spinY = (spinY + dt * 0.55 * morphing) % TAU;
      if (morphing < 0.02) spinY *= 0.88;

      var mapLock = Math.min(1, stage.a * 1.25);
      var knotLock = Math.min(1, stage.b * 1.25);
      // Never let rotation accumulated in later sections turn the restored
      // lamp edge-on when the page returns to the top.
      var freeY = settled * (-0.42 + Math.sin(t * 0.16) * 0.07) + spinY * morphing;
      var freeX = settled * (0.07 + Math.sin(t * 0.19) * 0.025) + eased.y * 0.065;
      var freeZ = settled * (-0.045) + eased.x * 0.026;

      // Face the lattice toward the camera with a cartographic tilt. Tiny
      // changes in angle keep the terrain alive without ever turning edge-on.
      var mapY = -0.08 + Math.sin(t * 0.1) * 0.028;
      var mapX = -0.52 + Math.sin(t * 0.085) * 0.035;
      var mapZ = Math.sin(t * 0.075) * 0.018;
      var knotY = -0.18 + Math.sin(t * 0.16) * 0.16;
      var knotX = -0.22 + Math.sin(t * 0.13) * 0.07;
      var knotZ = Math.sin(t * 0.11) * 0.035;
      var processY = -0.31 + Math.sin(t * 0.12) * 0.075;
      var processX = -0.16 + Math.sin(t * 0.1) * 0.035;
      var processZ = -0.025 + Math.sin(t * 0.08) * 0.018;

      var logoLock = Math.min(1, stage.c * 1.25);
      var logoY = -0.34 + Math.sin(t * 0.21) * 0.11 + eased.x * 0.025;
      var logoX = 0.07 + Math.sin(t * 0.17) * 0.045 + eased.y * 0.025;
      var logoZ = -0.025 + Math.sin(t * 0.12) * 0.018;
      var mappedY = freeY * (1 - mapLock) + mapY * mapLock;
      var mappedX = freeX * (1 - mapLock) + mapX * mapLock;
      var mappedZ = freeZ * (1 - mapLock) + mapZ * mapLock;
      var preLogoY = mappedY * (1 - knotLock) + knotY * knotLock;
      var preLogoX = mappedX * (1 - knotLock) + knotX * knotLock;
      var preLogoZ = mappedZ * (1 - knotLock) + knotZ * knotLock;

      preLogoY = preLogoY * (1 - processMix) + processY * processMix;
      preLogoX = preLogoX * (1 - processMix) + processX * processMix;
      preLogoZ = preLogoZ * (1 - processMix) + processZ * processMix;

      field.rotation.y = preLogoY * (1 - logoLock) + logoY * logoLock;
      field.rotation.x = preLogoX * (1 - logoLock) + logoX * logoLock;
      field.rotation.z = preLogoZ * (1 - logoLock) + logoZ * logoLock;

      // Repulsion: unproject the cursor onto the field's own space.
      if (hasPointer && !COARSE) {
        raw.set(pointer.x, pointer.y, 0.5).unproject(camera);
        raw.sub(camera.position).normalize();
        raw.multiplyScalar(-camera.position.z / raw.z).add(camera.position);
        field.worldToLocal(raw);
        mouseWorld.lerp(raw, 0.18);
        uniforms.uMouseForce.value += (0.9 - uniforms.uMouseForce.value) * 0.06;
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
      updateHome();
      measureMarkHome();
      });
    }, { passive: true });

    return { field: field, ready: sculptureReady };
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
     3. Process — one scroll-driven, fully reversible sequence
     ------------------------------------------------------------ */

  function initProcessTimeline() {
    var process = document.querySelector('#processo');
    if (!process) return;

    var steps = Array.prototype.slice.call(process.querySelectorAll('[data-process-step]'));
    if (!steps.length) return;

    function render(progress) {
      var p = Math.max(0, Math.min(1, progress));
      // The line finishes slightly before the sticky section releases, leaving
      // the fourth step a deliberate reading beat instead of activating at the
      // exact final pixel of the scroll range.
      var lineProgress = Math.min(1, p / 0.82);
      var active = Math.min(
        steps.length - 1,
        Math.floor(lineProgress * (steps.length - 1) + 0.0001)
      );

      processMotion.progress = lineProgress;
      processMotion.active = active;
      process.style.setProperty('--process-progress', lineProgress.toFixed(4));
      process.setAttribute('data-active-step', String(active + 1));

      steps.forEach(function (step, index) {
        var isActive = index === active;
        step.classList.toggle('is-active', isActive);
        step.classList.toggle('is-past', index < active);
        if (isActive) step.setAttribute('aria-current', 'step');
        else step.removeAttribute('aria-current');
      });
    }

    render(0);

    if (!hasGSAP || !window.ScrollTrigger || REDUCED) {
      if (!hasGSAP || !window.ScrollTrigger) {
        process.style.setProperty('--process-progress', '1');
      }
      return;
    }

    gsap.registerPlugin(ScrollTrigger);
    var state = { progress: 0 };

    gsap.to(state, {
      progress: 1,
      ease: 'none',
      onUpdate: function () { render(state.progress); },
      scrollTrigger: {
        trigger: process,
        start: function () {
          return window.innerWidth >= 900 ? 'top top' : 'top 72%';
        },
        end: function () {
          return window.innerWidth >= 900 ? 'bottom bottom' : 'bottom 38%';
        },
        scrub: 0.55,
        invalidateOnRefresh: true
      }
    });
  }

  /* ------------------------------------------------------------
     4. Work cards — real 3D tilt with a tracking specular
     ------------------------------------------------------------ */

  function initTilt() {
    if (COARSE || REDUCED) return;

    document.querySelectorAll('.work__item').forEach(function (item) {
      var card = item.querySelector('.work__card');
      var stage = item.querySelector('.work__stage');
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
     5. Capability rows — a light source that follows the cursor
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
     6. Cursor
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
     7. Nav — condenses on scroll, hides on the way down
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
    setLoaderProgress(12, 'Iniciando a forja');
    var forge = initForge();
    setLoaderProgress(forge ? 52 : 42, forge ? 'Escultura pronta' : 'Modo essencial');
    if (!forge) document.documentElement.classList.add('no-forge');
    if (forge && forge.ready) {
      forge.ready.then(function (ok) {
        if (!ok) document.documentElement.classList.add('no-logo-sculpture');
      });
    }

    initTilt();
    initCapLight();
    initCursor();
    initNav();

    Promise.all([
      waitForFonts(),
      waitForLoaderMark(),
      waitForWarmFrames(),
      waitForMarkSculpture(forge),
      wait(REDUCED ? 160 : 620)
    ]).then(releaseLoader, releaseLoader);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
