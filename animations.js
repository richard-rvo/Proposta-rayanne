gsap.registerPlugin(ScrollTrigger);

// --- Three.js AI Brain Constellation Exploding Animation ---
// Refined with Dala logic + RV Logo Reformation at the end!
function initThreeJS() {
  const canvas = document.getElementById('hero-3d-canvas');
  if (!canvas) return;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // Create an outlined triangle texture
  function createTriangleTexture() {
    const texCanvas = document.createElement('canvas');
    texCanvas.width = 64;
    texCanvas.height = 64;
    const ctx = texCanvas.getContext('2d');
    
    ctx.beginPath();
    ctx.moveTo(32, 12);
    ctx.lineTo(54, 52);
    ctx.lineTo(10, 52);
    ctx.closePath();
    
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    
    return new THREE.CanvasTexture(texCanvas);
  }

  const triangleTexture = createTriangleTexture();

  // The Constellation
  const particleCount = 3500;
  const geometry = new THREE.BufferGeometry();
  
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);
  const randomOffsets = new Float32Array(particleCount);
  
  // RV Brand Palette
  const colorPalette = [
    new THREE.Color('#f08113'),
    new THREE.Color('#f8a23b'),
    new THREE.Color('#e94d1d'),
    new THREE.Color('#ffffff'),
    new THREE.Color('#ffc885')
  ];

  const originalPositions = new Float32Array(particleCount * 3);
  const targetPositions = new Float32Array(particleCount * 3);
  const logoPositions = new Float32Array(particleCount * 3);

  for (let i = 0; i < particleCount; i++) {
    // 1. Brain/Cloud Shape (Organic, two hemispheres)
    const u = Math.random();
    const v = Math.random();
    const theta = u * 2.0 * Math.PI;
    const phi = Math.acos(2.0 * v - 1.0);
    
    // Base radius with volume
    let r = Math.cbrt(Math.random()) * 6; 
    
    // Add "folds" (sulci/gyri) using high frequency sine waves
    const folds = (Math.sin(theta * 10) * Math.cos(phi * 10)) * 0.6;
    r += folds;

    let x = r * Math.sin(phi) * Math.cos(theta);
    let y = r * Math.sin(phi) * Math.sin(theta) * 0.75; // flatter on Y
    let z = r * Math.cos(phi) * 1.1; // elongated front-to-back

    // Split into two hemispheres with a small gap
    if (x > 0) {
      x += 0.4;
    } else {
      x -= 0.4;
    }

    // Add a tiny bit of random noise
    x += (Math.random() - 0.5) * 0.3;
    y += (Math.random() - 0.5) * 0.3;
    z += (Math.random() - 0.5) * 0.3;

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    
    originalPositions[i * 3] = x;
    originalPositions[i * 3 + 1] = y;
    originalPositions[i * 3 + 2] = z;
    
    // 2. Exploded Target Positions (Ambient Field)
    targetPositions[i * 3] = (Math.random() - 0.5) * 50;
    targetPositions[i * 3 + 1] = (Math.random() - 0.5) * 50;
    targetPositions[i * 3 + 2] = (Math.random() - 0.5) * 30 - 15;

    // 3. Fallback Logo Positions (will be overwritten when image loads)
    logoPositions[i * 3] = targetPositions[i * 3];
    logoPositions[i * 3 + 1] = targetPositions[i * 3 + 1];
    logoPositions[i * 3 + 2] = targetPositions[i * 3 + 2];

    // Colors
    const randomColor = colorPalette[Math.floor(Math.random() * colorPalette.length)];
    colors[i * 3] = randomColor.r;
    colors[i * 3 + 1] = randomColor.g;
    colors[i * 3 + 2] = randomColor.b;
    
    // Sizes (smaller for finer detail)
    sizes[i] = Math.random() * 0.3 + 0.1;
    
    // Random offset
    randomOffsets[i] = Math.random() * Math.PI * 2;
  }

  // Load Logo and map pixels to 3D positions
  const img = new Image();
  img.src = 'assets/logo-orange.png';
  img.onload = () => {
    const tmpCanvas = document.createElement('canvas');
    const size = 100;
    tmpCanvas.width = size;
    tmpCanvas.height = size;
    const ctx = tmpCanvas.getContext('2d', { willReadFrequently: true });
    
    // Draw image centered in the temporary canvas
    ctx.drawImage(img, 0, 0, size, size);
    const imgData = ctx.getImageData(0, 0, size, size).data;
    
    const validPixels = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const alpha = imgData[(y * size + x) * 4 + 3];
        if (alpha > 100) { 
           // Map 2D pixel to 3D coordinate (scaled up)
           // Canvas Y goes down, 3D Y goes up, so we invert Y
           validPixels.push({ 
             x: (x - size/2) * 0.25, 
             y: -(y - size/2) * 0.25, 
             z: (Math.random() - 0.5) * 1.5 // slight depth noise so it's not totally flat
           });
        }
      }
    }
    
    if (validPixels.length > 0) {
      // Shuffle pixels so they map randomly
      validPixels.sort(() => Math.random() - 0.5);
      
      for (let i = 0; i < particleCount; i++) {
        const pixel = validPixels[i % validPixels.length];
        logoPositions[i * 3] = pixel.x;
        logoPositions[i * 3 + 1] = pixel.y;
        logoPositions[i * 3 + 2] = pixel.z;
      }
    }
  };

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aRandom', new THREE.BufferAttribute(randomOffsets, 1));
  
  const material = new THREE.PointsMaterial({
    size: 0.25,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    sizeAttenuation: true,
    map: triangleTexture,
    depthWrite: false,
    blending: THREE.AdditiveBlending 
  });

  const particleSystem = new THREE.Points(geometry, material);
  
  if (window.innerWidth < 1024) {
    particleSystem.position.set(0, 5, -12);
  } else {
    particleSystem.position.set(10, 0, -10);
  }

  scene.add(particleSystem);
  camera.position.z = 8;

  const animState = { explosionProgress: 0, logoProgress: 0 };

  // GSAP ScrollTrigger 1: Explode the Brain
  ScrollTrigger.create({
    trigger: "#solucoes",
    start: "top bottom", 
    end: "top 20%",
    scrub: 1.5,
    onUpdate: (self) => {
      animState.explosionProgress = Math.pow(self.progress, 1.5);
    }
  });

  // GSAP ScrollTrigger 2: Form the Logo
  ScrollTrigger.create({
    trigger: "#contato",
    start: "top bottom", 
    end: "center center",
    scrub: 1.5,
    onUpdate: (self) => {
      animState.logoProgress = Math.pow(self.progress, 1.5);
    }
  });

  let mouseX = 0;
  let mouseY = 0;
  let targetX = 0;
  let targetY = 0;
  const windowHalfX = window.innerWidth / 2;
  const windowHalfY = window.innerHeight / 2;

  document.addEventListener('mousemove', (event) => {
    mouseX = (event.clientX - windowHalfX) * 0.001;
    mouseY = (event.clientY - windowHalfY) * 0.001;
  });

  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    const elapsedTime = clock.getElapsedTime();

    targetX = mouseX * 0.3;
    targetY = mouseY * 0.3;
    
    // When forming the logo, center the system on screen
    const targetSystemX = (window.innerWidth < 1024) ? 0 : (10 * (1 - animState.logoProgress));
    const targetSystemY = (window.innerWidth < 1024) ? 5 * (1 - animState.logoProgress) : 0;
    
    // Smoothly follow mouse
    particleSystem.position.x += 0.05 * ((targetSystemX + targetX) - particleSystem.position.x);
    particleSystem.position.y += 0.05 * ((targetSystemY + targetY) - particleSystem.position.y);
    
    // Constant base rotation so it feels alive
    const rotationMult = 1.0 - animState.logoProgress;
    particleSystem.rotation.y += 0.005 * rotationMult;
    particleSystem.rotation.x = Math.sin(elapsedTime * 0.2) * 0.1 * rotationMult; // Subtle vertical nod
    
    const posAttribute = geometry.attributes.position;
    const offsetAttribute = geometry.attributes.aRandom;
    
    for (let i = 0; i < particleCount; i++) {
      const ix = i * 3;
      const iy = i * 3 + 1;
      const iz = i * 3 + 2;
      
      const rOffset = offsetAttribute.array[i];
      
      // Calculate current position by mixing original and exploded
      let cx = THREE.MathUtils.lerp(originalPositions[ix], targetPositions[ix], animState.explosionProgress);
      let cy = THREE.MathUtils.lerp(originalPositions[iy], targetPositions[iy], animState.explosionProgress);
      let cz = THREE.MathUtils.lerp(originalPositions[iz], targetPositions[iz], animState.explosionProgress);
      
      // Then mix exploded with Logo
      cx = THREE.MathUtils.lerp(cx, logoPositions[ix], animState.logoProgress);
      cy = THREE.MathUtils.lerp(cy, logoPositions[iy], animState.logoProgress);
      cz = THREE.MathUtils.lerp(cz, logoPositions[iz], animState.logoProgress);

      // Increase base organic drift so the brain looks alive even before scroll
      const baseDrift = 0.15;
      const driftMult = (baseDrift + (animState.explosionProgress * 1.5)) * (1.0 - animState.logoProgress * 0.95);
      const breatheX = Math.sin(elapsedTime * 0.8 + rOffset) * driftMult;
      const breatheY = Math.cos(elapsedTime * 0.9 + rOffset) * driftMult;
      const breatheZ = Math.sin(elapsedTime * 1.0 + rOffset) * driftMult;
      
      posAttribute.array[ix] = cx + breatheX;
      posAttribute.array[iy] = cy + breatheY;
      posAttribute.array[iz] = cz + breatheZ;
    }
    posAttribute.needsUpdate = true;

    renderer.render(scene, camera);
  }

  animate();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

function initGSAP() {
  const heroTexts = document.querySelectorAll('.hero .reveal-text');
  heroTexts.forEach((text, i) => {
    gsap.fromTo(text, 
      { y: 60, opacity: 0 },
      { y: 0, opacity: 1, duration: 1.4, delay: 0.1 + (i * 0.15), ease: "power4.out" }
    );
  });

  const fadeElements = document.querySelectorAll('.reveal-fade');
  fadeElements.forEach(el => {
    gsap.fromTo(el,
      { y: 50, opacity: 0 },
      { 
        scrollTrigger: {
          trigger: el,
          start: "top 85%",
        },
        y: 0, 
        opacity: 1, 
        duration: 1.2, 
        ease: "power3.out" 
      }
    );
  });
}

function initMagneticButtons() {
  const magnets = document.querySelectorAll('.magnetic-btn, .magnetic-card');
  magnets.forEach(magnet => {
    magnet.addEventListener('mousemove', (e) => {
      const position = magnet.getBoundingClientRect();
      const x = e.clientX - position.left - position.width / 2;
      const y = e.clientY - position.top - position.height / 2;
      const isCard = magnet.classList.contains('magnetic-card');
      const strength = isCard ? 0.03 : 0.15; 
      
      gsap.to(magnet, { x: x * strength, y: y * strength, duration: 0.5, ease: "power2.out" });
    });
    
    magnet.addEventListener('mouseleave', () => {
      gsap.to(magnet, { x: 0, y: 0, duration: 0.7, ease: "elastic.out(1, 0.3)" });
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initThreeJS();
  initGSAP();
  initMagneticButtons();
});
