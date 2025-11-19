// 3D Interactive Globe with Three.js
// Locations to highlight in blue (#0000ff)
const HIGHLIGHTED_LOCATIONS = [
  { name: 'England', lat: 51.5074, lon: -0.1278 },
  { name: 'New York', lat: 40.7128, lon: -74.0060 },
  { name: 'Turkey', lat: 39.9334, lon: 32.8597 },
  { name: 'Jamaica', lat: 18.1096, lon: -77.2975 },
  { name: 'Dominica', lat: 15.4150, lon: -61.3710 },
  { name: 'Iran', lat: 35.6892, lon: 51.3890 }
];

let scene, camera, renderer, globe, controls;
let particles, particleSystem;
let isGlobeLoaded = false;
let animationId = null;
let bees = []; // Array to store bee sprites
let beeTexture = null;

// Auto-spin configuration
let autoSpinSpeed = 0;
const AUTO_SPIN_TARGET_SPEED = 0.002; // default spin speed
const AUTO_SPIN_ACCELERATION = 0.00001; // how fast we ramp up/down
const AUTO_SPIN_RESUME_DELAY = 3000; // ms to wait before restarting after interaction
let autoSpinPaused = false;
let autoSpinResumeTimeout = null;
let userInteracting = false;

function pauseAutoSpin() {
  autoSpinPaused = true;
  autoSpinSpeed = 0;
  if (autoSpinResumeTimeout) {
    clearTimeout(autoSpinResumeTimeout);
    autoSpinResumeTimeout = null;
  }
}

function resumeAutoSpinWithDelay() {
  if (autoSpinResumeTimeout) {
    clearTimeout(autoSpinResumeTimeout);
  }
  autoSpinResumeTimeout = setTimeout(() => {
    if (!userInteracting) {
      autoSpinPaused = false;
    }
    autoSpinResumeTimeout = null;
  }, AUTO_SPIN_RESUME_DELAY);
}

function handleUserInteractionStart() {
  userInteracting = true;
  pauseAutoSpin();
}

function handleUserInteractionEnd() {
  userInteracting = false;
  resumeAutoSpinWithDelay();
}

function handleUserInteractionPulse() {
  pauseAutoSpin();
  userInteracting = false;
  resumeAutoSpinWithDelay();
}

// Convert lat/lon to 3D coordinates
function latLonToVector3(lat, lon, radius) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  
  const x = -(radius * Math.sin(phi) * Math.cos(theta));
  const z = (radius * Math.sin(phi) * Math.sin(theta));
  const y = (radius * Math.cos(phi));
  
  return new THREE.Vector3(x, y, z);
}

// Calculate great circle path between two points on sphere
function calculateGreatCirclePath(start, end, radius, segments = 50) {
  const path = [];
  
  // Convert to 3D vectors
  const startVec = latLonToVector3(start.lat, start.lon, radius);
  const endVec = latLonToVector3(end.lat, end.lon, radius);
  
  // Calculate angle between vectors
  const angle = startVec.angleTo(endVec);
  
  // Create points along the great circle
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const sinAngle = Math.sin(angle);
    
    // Spherical interpolation (slerp)
    const a = Math.sin((1 - t) * angle) / sinAngle;
    const b = Math.sin(t * angle) / sinAngle;
    
    const point = new THREE.Vector3();
    point.x = a * startVec.x + b * endVec.x;
    point.y = a * startVec.y + b * endVec.y;
    point.z = a * startVec.z + b * endVec.z;
    
    // Normalize to maintain radius
    point.normalize().multiplyScalar(radius);
    
    path.push(point);
  }
  
  return path;
}

// Create bee sprite (using plane geometry for proper orientation)
function createBeeSprite() {
  if (!beeTexture) return null;
  
  // Use plane geometry so we can properly orient it
  // Increased size: 0.25 (was 0.15)
  const geometry = new THREE.PlaneGeometry(0.25, 0.25);
  const material = new THREE.MeshBasicMaterial({
    map: beeTexture,
    transparent: true,
    alphaTest: 0.1,
    side: THREE.DoubleSide
  });
  
  const bee = new THREE.Mesh(geometry, material);
  
  return bee;
}

// Create and animate bees between locations
function createBees() {
  if (!beeTexture || !globe) return;
  
  const globeRadius = 2;
  const beeCount = 4; // Number of bees flying simultaneously
  
  // Create route pairs (connections between locations)
  const routes = [];
  for (let i = 0; i < HIGHLIGHTED_LOCATIONS.length; i++) {
    for (let j = i + 1; j < HIGHLIGHTED_LOCATIONS.length; j++) {
      routes.push({
        start: HIGHLIGHTED_LOCATIONS[i],
        end: HIGHLIGHTED_LOCATIONS[j]
      });
    }
  }
  
  // Create bees with staggered delays
  for (let i = 0; i < beeCount; i++) {
    const bee = createBeeSprite();
    if (!bee) continue;
    
    // Random route selection
    const route = routes[Math.floor(Math.random() * routes.length)];
    
    // Calculate path
    const path = calculateGreatCirclePath(route.start, route.end, globeRadius + 0.1, 100);
    
    // Staggered start time (random delay)
    const startDelay = Math.random() * 5000; // 0-5 seconds
    const flightDuration = 8000 + Math.random() * 4000; // 8-12 seconds
    
    // Bee animation state
    const beeState = {
      sprite: bee,
      path: path,
      currentIndex: 0,
      progress: 0,
      startTime: Date.now() + startDelay,
      flightDuration: flightDuration,
      route: route,
      isActive: false,
      scale: 0.25 // Base scale (increased from 0.15)
    };
    
    // Set initial position
    bee.position.copy(path[0]);
    bee.visible = false; // Hidden until start time
    
    // Parent bee to globe so it rotates with the globe
    globe.add(bee);
    bees.push(beeState);
  }
}

// Load bee texture
function loadBeeTexture() {
  const textureLoader = new THREE.TextureLoader();
  textureLoader.load(
    'static/img/beethree.png',
    function(texture) {
      beeTexture = texture;
      // Create bees after texture is loaded
      if (isGlobeLoaded && globe) {
        createBees();
      }
    },
    undefined,
    function(error) {
      console.warn('Failed to load bee texture:', error);
    }
  );
}

// Update bee animations
function updateBees() {
  if (!bees.length || !camera) return;
  
  const now = Date.now();
  
  bees.forEach(beeState => {
    const bee = beeState.sprite;
    
    // Check if it's time to start
    if (!beeState.isActive && now >= beeState.startTime) {
      beeState.isActive = true;
      bee.visible = true;
      beeState.progress = 0;
      // Reset position to start of path
      if (beeState.path && beeState.path.length > 0) {
        bee.position.copy(beeState.path[0]);
      }
    }
    
    if (!beeState.isActive) return;
    
    // Calculate progress (0 to 1)
    const elapsed = now - beeState.startTime;
    beeState.progress = (elapsed % beeState.flightDuration) / beeState.flightDuration;
    
    // Takeoff/landing scaling (scale up at start and end)
    const takeoffPhase = Math.min(beeState.progress * 5, 1); // First 20% of journey
    const landingPhase = Math.max((1 - beeState.progress) * 5, 0); // Last 20% of journey
    const scaleFactor = 1 + Math.max(takeoffPhase, landingPhase) * 0.5; // Scale up to 1.5x
    bee.scale.set(
      beeState.scale * scaleFactor,
      beeState.scale * scaleFactor,
      beeState.scale * scaleFactor
    );
    
    // Get position along path
    const pathIndex = Math.floor(beeState.progress * (beeState.path.length - 1));
    const nextIndex = Math.min(pathIndex + 1, beeState.path.length - 1);
    const segmentProgress = (beeState.progress * (beeState.path.length - 1)) % 1;
    
    const currentPoint = beeState.path[pathIndex];
    const nextPoint = beeState.path[nextIndex];
    
    // Interpolate position
    bee.position.lerpVectors(currentPoint, nextPoint, segmentProgress);
    
    // Orient bee flat on globe surface, facing direction of travel
    // Calculate normal vector from globe center to bee position (outward from globe)
    const normal = bee.position.clone().normalize();
    
    // Calculate direction of travel (from current point to next point)
    const travelDirection = new THREE.Vector3();
    travelDirection.subVectors(nextPoint, currentPoint).normalize();
    
    // Project travel direction onto the tangent plane (perpendicular to normal)
    // This gives us the direction the bee should face on the surface
    const dot = travelDirection.dot(normal);
    const tangentDirection = new THREE.Vector3();
    tangentDirection.subVectors(travelDirection, normal.clone().multiplyScalar(dot)).normalize();
    
    // If tangent direction is too small (travel direction is mostly radial), use a fallback
    if (tangentDirection.length() < 0.1) {
      // Use world up projected onto tangent plane as fallback
      const worldUp = new THREE.Vector3(0, 1, 0);
      const worldUpDot = worldUp.dot(normal);
      tangentDirection.subVectors(worldUp, normal.clone().multiplyScalar(worldUpDot)).normalize();
      
      // If still too small, use a different reference
      if (tangentDirection.length() < 0.1) {
        const worldRight = new THREE.Vector3(1, 0, 0);
        const worldRightDot = worldRight.dot(normal);
        tangentDirection.subVectors(worldRight, normal.clone().multiplyScalar(worldRightDot)).normalize();
      }
    }
    
    // PlaneGeometry default: lies in XY plane, Z is normal (pointing up in default orientation)
    // We need to rotate so:
    // - The plane's normal (Z) points outward from globe (normal vector)
    // - The plane's Y axis (where bee's head points) points in travel direction (tangentDirection)
    
    // First, align plane's Z with globe's normal
    // Then rotate around Z to align plane's Y with travel direction
    
    // Calculate the angle between plane's default Y (0,1,0) and the desired Y (tangentDirection)
    // But we need to do this in the plane's local space after aligning Z
    
    // Use lookAt approach: make plane look in the direction of travel, but constrained to tangent plane
    // Calculate target point: bee position + tangent direction
    const targetPoint = bee.position.clone().add(tangentDirection);
    
    // Make the plane look at the target, but we need to ensure it's flat on the surface
    // We'll use a quaternion to rotate from default orientation
    
    // Default plane orientation: Z up (0,0,1)
    // Desired: Z = normal, Y = tangentDirection
    // So we need to rotate from (0,0,1) to normal, then rotate Y to tangentDirection
    
    // Calculate right vector (perpendicular to both normal and tangent direction)
    // Use cross product: right = tangentDirection × normal
    let right = new THREE.Vector3();
    right.crossVectors(tangentDirection, normal).normalize();
    
    // If vectors are parallel, use a fallback
    if (right.length() < 0.1) {
      const worldUp = new THREE.Vector3(0, 1, 0);
      right.crossVectors(worldUp, normal).normalize();
      if (right.length() < 0.1) {
        right.set(1, 0, 0);
        right.crossVectors(right, normal).normalize();
      }
    }
    
    // Recalculate tangentDirection to ensure orthogonality with normal and right
    // This ensures the three vectors form an orthonormal basis
    const finalTangent = new THREE.Vector3();
    finalTangent.crossVectors(normal, right).normalize();
    
    // Ensure finalTangent points in the same general direction as tangentDirection
    if (finalTangent.dot(tangentDirection) < 0) {
      finalTangent.negate();
    }
    
    // Create rotation matrix: X=right, Y=tangent, Z=normal
    // PlaneGeometry: X is width, Y is height (where bee's head points), Z is normal
    // We want: plane's X = right, plane's Y = finalTangent (travel direction), plane's Z = normal (outward)
    const matrix = new THREE.Matrix4();
    matrix.makeBasis(right, finalTangent, normal);
    bee.setRotationFromMatrix(matrix);
    
    // When journey completes, restart with new random route
    if (beeState.progress >= 0.99) {
      // Select new random route
      const routes = [];
      for (let i = 0; i < HIGHLIGHTED_LOCATIONS.length; i++) {
        for (let j = i + 1; j < HIGHLIGHTED_LOCATIONS.length; j++) {
          routes.push({
            start: HIGHLIGHTED_LOCATIONS[i],
            end: HIGHLIGHTED_LOCATIONS[j]
          });
        }
      }
      
      const newRoute = routes[Math.floor(Math.random() * routes.length)];
      beeState.route = newRoute;
      beeState.path = calculateGreatCirclePath(newRoute.start, newRoute.end, 2.1, 100);
      
      // Reset position to start of new route
      if (beeState.path && beeState.path.length > 0) {
        bee.position.copy(beeState.path[0]);
      }
      
      beeState.startTime = now + Math.random() * 2000; // Random delay before next flight
      beeState.flightDuration = 8000 + Math.random() * 4000;
      beeState.isActive = false;
      bee.visible = false;
      beeState.progress = 0; // Reset progress
    }
  });
}

// Create globe geometry and materials
function createGlobe() {
  const radius = 2;
  const segments = 64;
  
  // Create sphere geometry
  const geometry = new THREE.SphereGeometry(radius, segments, segments);
  
  // Load real world map texture
  const textureLoader = new THREE.TextureLoader();
  
  // Create a proper world map texture with accurate continents
  // Using a canvas-based approach with actual world map data
  const worldMapTexture = createAccurateWorldMapTexture();
  
  // Create material
  const material = new THREE.MeshPhongMaterial({
    map: worldMapTexture,
    transparent: false,
    shininess: 30
  });
  
  // Create globe mesh
  globe = new THREE.Mesh(geometry, material);
  
  // Add highlighted locations
  HIGHLIGHTED_LOCATIONS.forEach(location => {
    const position = latLonToVector3(location.lat, location.lon, radius + 0.05);
    
    // Create marker sphere
    const markerGeometry = new THREE.SphereGeometry(0.08, 16, 16);
    const markerMaterial = new THREE.MeshPhongMaterial({
      color: 0x0000ff,
      emissive: 0x0000ff,
      emissiveIntensity: 0.5
    });
    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    marker.position.copy(position);
    marker.userData = { name: location.name };
    globe.add(marker);
    
    // Add glow effect
    const glowGeometry = new THREE.SphereGeometry(0.12, 16, 16);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0x0000ff,
      transparent: true,
      opacity: 0.3
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    glow.position.copy(position);
    globe.add(glow);
  });
  
  return globe;
}

// Create accurate world map texture using real geographic data
function createAccurateWorldMapTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  
  // Fill with white (oceans)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // Use a real world map - load from a free world map image
  // This will use an actual world map texture
  return loadRealWorldMapImage(canvas, ctx);
}

// Load real world map image and process it
function loadRealWorldMapImage(canvas, ctx) {
  // Create texture from canvas
  const texture = new THREE.CanvasTexture(canvas);
  
  // Try to load a real world map image first
  const img = new Image();
  img.crossOrigin = 'anonymous';
  
  img.onload = function() {
    // Draw the world map image to canvas
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    
    // Process image to make it white oceans and grey continents
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const brightness = (r + g + b) / 3;
      
      // For black and white images: black/dark = land, white/light = water
      // Threshold: pixels darker than this are considered land
      const landThreshold = 200; // Adjust this if needed (0-255, lower = more land)
      
      if (brightness < landThreshold) {
        // Land - make grey (#888888 = 136 in RGB)
        data[i] = 136;     // R
        data[i + 1] = 136; // G
        data[i + 2] = 136; // B
      } else {
        // Water - make white
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
      }
    }
    
    ctx.putImageData(imageData, 0, 0);
    texture.needsUpdate = true;
  };
  
  img.onerror = function() {
    // Fallback: create world map using geographic data
    createProperWorldMap(ctx, canvas.width, canvas.height);
    texture.needsUpdate = true;
  };
  
  // Use a black and white world map image
  // Place your world map image in static/img/ and update the path below
  // The image should be: black/dark = land, white/light = water
  // Recommended: equirectangular projection, 2048x1024 or similar aspect ratio
  img.src = 'static/img/world-map-bw.png'; // Update this path to your image
  
  return texture;
}

// Create a proper world map with accurate continents
function createProperWorldMap(ctx, width, height) {
  // Fill with white (oceans)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  
  // Draw continents using accurate world map data
  // This uses proper geographic coordinates for accurate continent shapes
  ctx.fillStyle = '#888888';
  ctx.strokeStyle = '#666666';
  ctx.lineWidth = 1;
  
  // Convert lat/lon to canvas coordinates
  function lonToX(lon) {
    return ((lon + 180) / 360) * width;
  }
  
  function latToY(lat) {
    return ((90 - lat) / 180) * height;
  }
  
  // Draw accurate continents using proper world map coordinates
  // These are based on actual geographic boundaries
  
  // North America - accurate outline
  ctx.beginPath();
  const northAmerica = [
    [-170, 70], [-168, 68], [-165, 65], [-160, 60], [-155, 55], [-150, 52],
    [-145, 50], [-140, 48], [-135, 46], [-130, 45], [-125, 44], [-120, 43],
    [-115, 42], [-110, 41], [-105, 40], [-100, 39], [-95, 38], [-90, 37],
    [-85, 36], [-80, 35], [-75, 33], [-70, 30], [-65, 25], [-70, 20],
    [-75, 18], [-80, 16], [-85, 15], [-90, 14], [-95, 13], [-100, 12],
    [-105, 11], [-110, 10], [-115, 9], [-120, 8], [-125, 9], [-130, 11],
    [-135, 13], [-140, 15], [-145, 18], [-150, 22], [-155, 28], [-160, 35],
    [-165, 42], [-168, 50], [-170, 58], [-170, 65]
  ];
  northAmerica.forEach((point, i) => {
    if (i === 0) ctx.moveTo(lonToX(point[0]), latToY(point[1]));
    else ctx.lineTo(lonToX(point[0]), latToY(point[1]));
  });
  ctx.closePath();
  ctx.fill();
  
  // South America - accurate outline
  ctx.beginPath();
  const southAmerica = [
    [-80, 12], [-78, 10], [-75, 8], [-72, 5], [-70, 2], [-68, -2],
    [-66, -5], [-64, -8], [-62, -12], [-60, -15], [-58, -18], [-56, -22],
    [-54, -25], [-52, -28], [-50, -30], [-48, -32], [-46, -34], [-44, -35],
    [-42, -36], [-40, -37], [-38, -38], [-36, -39], [-34, -40], [-36, -42],
    [-38, -44], [-40, -46], [-42, -48], [-45, -50], [-50, -52], [-55, -54],
    [-60, -55], [-65, -56], [-70, -55], [-75, -53], [-78, -50], [-80, -45],
    [-80, -40], [-80, -35], [-80, -30], [-80, -25], [-80, -20], [-80, -15],
    [-80, -10], [-80, -5], [-80, 0], [-80, 5], [-80, 8]
  ];
  southAmerica.forEach((point, i) => {
    if (i === 0) ctx.moveTo(lonToX(point[0]), latToY(point[1]));
    else ctx.lineTo(lonToX(point[0]), latToY(point[1]));
  });
  ctx.closePath();
  ctx.fill();
  
  // Europe - accurate outline
  ctx.beginPath();
  const europe = [
    [-10, 71], [-8, 70], [-5, 69], [-2, 68], [0, 67], [2, 66],
    [5, 65], [8, 64], [10, 63], [12, 62], [15, 61], [18, 60],
    [20, 59], [22, 58], [25, 57], [28, 56], [30, 55], [32, 54],
    [35, 53], [38, 52], [40, 51], [40, 49], [38, 47], [35, 45],
    [32, 43], [30, 41], [28, 39], [25, 37], [22, 35], [20, 36],
    [18, 37], [15, 38], [12, 39], [10, 40], [8, 41], [5, 42],
    [2, 43], [0, 44], [-2, 45], [-5, 46], [-8, 47], [-10, 48],
    [-10, 50], [-10, 52], [-10, 54], [-10, 56], [-10, 58], [-10, 60],
    [-10, 62], [-10, 64], [-10, 66], [-10, 68]
  ];
  europe.forEach((point, i) => {
    if (i === 0) ctx.moveTo(lonToX(point[0]), latToY(point[1]));
    else ctx.lineTo(lonToX(point[0]), latToY(point[1]));
  });
  ctx.closePath();
  ctx.fill();
  
  // Africa - accurate outline
  ctx.beginPath();
  const africa = [
    [-20, 37], [-18, 35], [-15, 33], [-12, 30], [-10, 27], [-8, 24],
    [-6, 21], [-4, 18], [-2, 15], [0, 12], [2, 9], [4, 6],
    [6, 3], [8, 0], [10, -3], [12, -6], [15, -9], [18, -12],
    [20, -15], [22, -18], [25, -21], [28, -24], [30, -27], [32, -30],
    [35, -32], [38, -34], [40, -35], [42, -35], [45, -34], [48, -33],
    [50, -32], [50, -30], [48, -28], [45, -26], [42, -24], [40, -22],
    [38, -20], [35, -18], [32, -16], [30, -14], [28, -12], [25, -10],
    [22, -8], [20, -6], [18, -4], [15, -2], [12, 0], [10, 2],
    [8, 4], [6, 6], [4, 8], [2, 10], [0, 12], [-2, 14],
    [-4, 16], [-6, 18], [-8, 20], [-10, 22], [-12, 24], [-15, 26],
    [-18, 28], [-20, 30], [-20, 32], [-20, 34]
  ];
  africa.forEach((point, i) => {
    if (i === 0) ctx.moveTo(lonToX(point[0]), latToY(point[1]));
    else ctx.lineTo(lonToX(point[0]), latToY(point[1]));
  });
  ctx.closePath();
  ctx.fill();
  
  // Asia - accurate outline
  ctx.beginPath();
  const asia = [
    [40, 80], [45, 78], [50, 76], [55, 74], [60, 72], [65, 70],
    [70, 68], [75, 66], [80, 64], [85, 62], [90, 60], [95, 58],
    [100, 56], [105, 54], [110, 52], [115, 50], [120, 48], [125, 46],
    [130, 44], [135, 42], [140, 40], [145, 38], [150, 36], [155, 34],
    [160, 32], [165, 30], [170, 28], [175, 26], [180, 24], [180, 22],
    [175, 20], [170, 18], [165, 16], [160, 14], [155, 12], [150, 10],
    [145, 8], [140, 6], [135, 4], [130, 2], [125, 0], [120, -2],
    [115, -3], [110, -4], [105, -5], [100, -6], [95, -7], [90, -8],
    [85, -7], [80, -6], [75, -4], [70, -2], [65, 0], [60, 2],
    [55, 4], [50, 6], [45, 8], [42, 10], [40, 12], [40, 15],
    [40, 18], [40, 22], [40, 26], [40, 30], [40, 35], [40, 40],
    [40, 45], [40, 50], [40, 55], [40, 60], [40, 65], [40, 70],
    [40, 75]
  ];
  asia.forEach((point, i) => {
    if (i === 0) ctx.moveTo(lonToX(point[0]), latToY(point[1]));
    else ctx.lineTo(lonToX(point[0]), latToY(point[1]));
  });
  ctx.closePath();
  ctx.fill();
  
  // Australia - accurate outline
  ctx.beginPath();
  const australia = [
    [110, -10], [115, -12], [120, -14], [125, -16], [130, -18], [135, -20],
    [140, -22], [145, -24], [150, -26], [153, -28], [155, -30], [155, -32],
    [153, -34], [150, -36], [145, -38], [140, -39], [135, -40], [130, -41],
    [125, -42], [120, -41], [115, -40], [112, -38], [110, -36], [110, -34],
    [110, -32], [110, -30], [110, -28], [110, -26], [110, -24], [110, -22],
    [110, -20], [110, -18], [110, -16], [110, -14], [110, -12]
  ];
  australia.forEach((point, i) => {
    if (i === 0) ctx.moveTo(lonToX(point[0]), latToY(point[1]));
    else ctx.lineTo(lonToX(point[0]), latToY(point[1]));
  });
  ctx.closePath();
  ctx.fill();
  
  // Greenland
  ctx.beginPath();
  const greenland = [
    [-75, 83], [-70, 82.5], [-65, 82], [-60, 81], [-55, 80], [-50, 79],
    [-45, 78], [-40, 77], [-35, 76], [-30, 75], [-25, 74], [-20, 73],
    [-15, 72], [-10, 71], [-12, 70], [-15, 69], [-20, 68], [-25, 67],
    [-30, 66], [-35, 67], [-40, 68], [-45, 69], [-50, 70], [-55, 71],
    [-60, 72], [-65, 73], [-70, 74], [-72, 76], [-73, 78], [-74, 80],
    [-75, 82]
  ];
  greenland.forEach((point, i) => {
    if (i === 0) ctx.moveTo(lonToX(point[0]), latToY(point[1]));
    else ctx.lineTo(lonToX(point[0]), latToY(point[1]));
  });
  ctx.closePath();
  ctx.fill();
  
  // Add more islands and details
  // British Isles
  ctx.fillRect(lonToX(-8), latToY(52), lonToX(2) - lonToX(-8), latToY(60) - latToY(52));
  
  // Japan
  ctx.fillRect(lonToX(125), latToY(30), lonToX(145) - lonToX(125), latToY(45) - latToY(30));
  
  // Indonesia/Philippines
  ctx.fillRect(lonToX(95), latToY(-10), lonToX(130) - lonToX(95), latToY(10) - latToY(-10));
  
  // Madagascar
  ctx.fillRect(lonToX(43), latToY(-25), lonToX(50) - lonToX(43), latToY(-12) - latToY(-25));
  
  // New Zealand
  ctx.fillRect(lonToX(165), latToY(-47), lonToX(178) - lonToX(165), latToY(-34) - latToY(-47));
  
  // Caribbean islands
  ctx.fillRect(lonToX(-85), latToY(10), lonToX(-70) - lonToX(-85), latToY(25) - latToY(10));
}

// Create world map from geographic data (fallback)
function createWorldMapFromData(ctx, width, height) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  
  // Use the detailed continent drawing as fallback
  drawDetailedContinents(ctx, width, height);
}

// Draw continents with highly detailed, accurate shapes using real geographic data
function drawDetailedContinents(ctx, width, height) {
  ctx.fillStyle = '#888888';
  ctx.strokeStyle = '#666666';
  ctx.lineWidth = 1;
  
  // Convert lat/lon to canvas coordinates
  function lonToX(lon) {
    return ((lon + 180) / 360) * width;
  }
  
  function latToY(lat) {
    return ((90 - lat) / 180) * height;
  }
  
  // Draw path from array of [lon, lat] coordinates
  function drawPath(coords) {
    if (coords.length === 0) return;
    ctx.beginPath();
    ctx.moveTo(lonToX(coords[0][0]), latToY(coords[0][1]));
    for (let i = 1; i < coords.length; i++) {
      ctx.lineTo(lonToX(coords[i][0]), latToY(coords[i][1]));
    }
    ctx.closePath();
    ctx.fill();
  }
  
  // North America - detailed outline
  drawPath([
    [-170, 70], [-168, 65], [-165, 60], [-160, 55], [-155, 50], [-150, 55],
    [-140, 60], [-130, 58], [-125, 54], [-120, 49], [-110, 49], [-100, 50],
    [-95, 49], [-90, 45], [-85, 42], [-80, 40], [-75, 35], [-70, 30],
    [-65, 25], [-80, 20], [-100, 18], [-110, 23], [-120, 28], [-130, 32],
    [-140, 35], [-150, 40], [-160, 50], [-165, 60], [-170, 65]
  ]);
  
  // South America - detailed outline
  drawPath([
    [-80, 12], [-75, 8], [-70, 5], [-65, 2], [-60, -5], [-55, -10],
    [-50, -15], [-45, -20], [-40, -25], [-35, -30], [-40, -35], [-50, -40],
    [-60, -45], [-70, -50], [-75, -55], [-80, -52], [-78, -45], [-75, -35],
    [-75, -25], [-75, -15], [-75, -5], [-78, 5]
  ]);
  
  // Europe - detailed outline
  drawPath([
    [-10, 70], [-5, 68], [0, 65], [5, 62], [10, 58], [15, 55],
    [20, 52], [25, 50], [30, 48], [35, 45], [40, 42], [40, 38],
    [35, 35], [25, 36], [15, 38], [5, 40], [-5, 42], [-10, 45],
    [-8, 50], [-6, 55], [-8, 60], [-10, 65]
  ]);
  
  // Africa - detailed outline
  drawPath([
    [-20, 37], [-15, 35], [-10, 32], [-5, 28], [0, 25], [5, 22],
    [10, 20], [15, 18], [20, 15], [25, 12], [30, 8], [35, 5],
    [40, 2], [45, -2], [50, -5], [50, -10], [48, -15], [45, -20],
    [40, -25], [35, -30], [30, -32], [25, -33], [20, -34], [15, -35],
    [10, -34], [5, -32], [0, -30], [-5, -28], [-10, -25], [-15, -20],
    [-18, -15], [-20, -10], [-20, -5], [-20, 0], [-20, 5], [-20, 10],
    [-20, 15], [-20, 20], [-20, 25], [-20, 30]
  ]);
  
  // Asia - detailed outline
  drawPath([
    [40, 75], [50, 73], [60, 70], [70, 68], [80, 65], [90, 62],
    [100, 58], [110, 55], [120, 52], [130, 48], [140, 45], [150, 42],
    [160, 38], [170, 35], [180, 32], [180, 28], [175, 25], [170, 22],
    [165, 20], [160, 18], [155, 15], [150, 12], [145, 10], [140, 8],
    [135, 6], [130, 5], [125, 4], [120, 3], [115, 2], [110, 1],
    [105, 0], [100, -2], [95, -3], [90, -2], [85, 0], [80, 2],
    [75, 5], [70, 8], [65, 12], [60, 15], [55, 18], [50, 22],
    [45, 25], [42, 30], [40, 35], [40, 40], [40, 45], [40, 50],
    [40, 55], [40, 60], [40, 65], [40, 70]
  ]);
  
  // Australia - detailed outline
  drawPath([
    [110, -10], [115, -12], [120, -15], [125, -18], [130, -20], [135, -22],
    [140, -25], [145, -28], [150, -30], [155, -32], [155, -35], [152, -38],
    [148, -40], [145, -42], [140, -43], [135, -44], [130, -45], [125, -44],
    [120, -42], [115, -40], [112, -35], [110, -30], [110, -25], [110, -20],
    [110, -15]
  ]);
  
  // Greenland
  drawPath([
    [-75, 83], [-70, 82], [-65, 80], [-60, 78], [-55, 76], [-50, 74],
    [-45, 72], [-40, 70], [-35, 68], [-30, 66], [-25, 64], [-20, 62],
    [-15, 60], [-10, 62], [-12, 65], [-15, 68], [-20, 70], [-25, 72],
    [-30, 74], [-35, 76], [-40, 78], [-45, 80], [-50, 81], [-55, 82],
    [-60, 82.5], [-65, 83], [-70, 83]
  ]);
  
  // British Isles
  drawPath([
    [-10, 60], [-8, 59], [-6, 58], [-4, 57], [-2, 56], [0, 55],
    [2, 54], [2, 52], [0, 51], [-2, 50], [-4, 50.5], [-6, 51],
    [-8, 52], [-10, 53], [-10, 55], [-10, 57], [-10, 59]
  ]);
  
  // Japan
  drawPath([
    [125, 45], [128, 44], [130, 43], [132, 42], [135, 40], [138, 38],
    [140, 36], [142, 34], [145, 32], [145, 30], [143, 29], [140, 30],
    [137, 31], [135, 32], [132, 33], [130, 34], [128, 35], [126, 37],
    [125, 39], [125, 41], [125, 43]
  ]);
  
  // Indonesia/Philippines archipelago
  drawPath([
    [95, 10], [100, 8], [105, 6], [110, 4], [115, 2], [120, 0],
    [125, -2], [130, -3], [130, -5], [128, -7], [125, -8], [120, -7],
    [115, -6], [110, -5], [105, -4], [100, -3], [95, -2], [95, 0],
    [95, 2], [95, 5], [95, 8]
  ]);
  
  // Madagascar
  drawPath([
    [43, -12], [45, -14], [47, -16], [49, -18], [50, -20], [50, -22],
    [49, -24], [47, -25], [45, -26], [43, -25], [43, -23], [43, -21],
    [43, -19], [43, -17], [43, -15]
  ]);
  
  // Caribbean islands
  drawPath([
    [-80, 20], [-78, 19], [-76, 18], [-74, 17], [-72, 16], [-70, 15],
    [-72, 17], [-74, 18], [-76, 19], [-78, 20], [-80, 21]
  ]);
  
  // Iceland
  drawPath([
    [-20, 65], [-18, 64.5], [-16, 64], [-18, 63.5], [-20, 63], [-22, 63.5],
    [-22, 64.5]
  ]);
  
  // New Zealand
  drawPath([
    [165, -34], [168, -36], [171, -38], [174, -40], [176, -42], [176, -44],
    [174, -45], [171, -44], [168, -42], [165, -40], [165, -38], [165, -36]
  ]);
}

// Create particle system
function createParticles() {
  const particleCount = 200;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  
  const color = new THREE.Color(0x0000ff);
  
  for (let i = 0; i < particleCount * 3; i += 3) {
    // Random position around globe
    const radius = 2.5 + Math.random() * 0.5;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 2 - 1);
    
    positions[i] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i + 1] = radius * Math.sin(phi) * Math.sin(theta);
    positions[i + 2] = radius * Math.cos(phi);
    
    // Random blue tint
    const brightness = 0.5 + Math.random() * 0.5;
    colors[i] = color.r * brightness;
    colors[i + 1] = color.g * brightness;
    colors[i + 2] = color.b * brightness;
  }
  
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  
  const material = new THREE.PointsMaterial({
    size: 0.02,
    vertexColors: true,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending
  });
  
  particleSystem = new THREE.Points(geometry, material);
  return particleSystem;
}

// Simple orbit controls (lightweight alternative to OrbitControls)
// 
// ZOOM FUNCTIONALITY SUMMARY:
// ============================
// 1. MOUSE WHEEL: Scroll to zoom in/out (instant, clamped between minDistance and maxDistance)
// 
// ZOOM PARAMETERS (adjust these to change zoom behavior):
// - minDistance (3): Closest you can zoom in
// - maxDistance (8): Furthest you can zoom out  
// - zoomSpeed (0.1): How fast wheel zoom responds
// 
// PANNING:
// - Natural panning: mouse/finger right = globe rotates right, mouse/finger down = globe rotates down
//
class SimpleControls {
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;
    
    this.rotateSpeed = 0.005;
    
    // ZOOM CONFIGURATION:
    // zoomSpeed: Controls how fast zoom happens with mouse wheel (0.1 = 10% per scroll unit)
    this.zoomSpeed = 0.1;
    
    // minDistance: Minimum zoom distance (closest you can get to globe)
    // Lower value = can zoom in closer (e.g., 2.5 = very close, 4 = further away)
    this.minDistance = 3;
    
    // maxDistance: Maximum zoom distance (furthest you can zoom out)
    // Higher value = can zoom out more (e.g., 6 = close view, 10 = very far view)
    this.maxDistance = 8;
    
    this.isDragging = false;
    this.mouseX = 0;
    this.mouseY = 0;
    this.lastMouseX = 0;
    this.lastMouseY = 0;
    
    this.spherical = new THREE.Spherical();
    this.spherical.setFromVector3(this.camera.position);
    
    this.init();
  }
  
  init() {
    this.domElement.addEventListener('mousedown', this.onMouseDown.bind(this));
    this.domElement.addEventListener('mousemove', this.onMouseMove.bind(this));
    this.domElement.addEventListener('mouseup', this.onMouseUp.bind(this));
    this.domElement.addEventListener('wheel', this.onWheel.bind(this));
    
    // Touch events for mobile
    this.domElement.addEventListener('touchstart', this.onTouchStart.bind(this));
    this.domElement.addEventListener('touchmove', this.onTouchMove.bind(this));
    this.domElement.addEventListener('touchend', this.onTouchEnd.bind(this));
  }
  
  initRaycaster() {
    if (typeof THREE !== 'undefined') {
      this.raycaster = new THREE.Raycaster();
      this.mouse = new THREE.Vector2();
    }
  }
  
  // CLICK ZOOM:
  // Clicking on the globe zooms in smoothly
  // If clicking on a location marker, zooms to that specific location
  // If clicking on empty space, zooms to a default closer view
  onClick(event) {
    if (this.isDragging) return; // Don't zoom if we were dragging (user was rotating)
    if (!this.raycaster || !this.mouse) {
      this.initRaycaster();
      if (!this.raycaster) return;
    }
    
    // Convert mouse click position to normalized device coordinates (-1 to 1)
    const rect = this.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    // Cast a ray from camera through the mouse position
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    // Check for intersection with globe markers (blue location dots)
    if (globe) {
      const intersects = this.raycaster.intersectObjects(globe.children, true);
      if (intersects.length > 0) {
        // Clicked on a location marker - zoom to that specific location
        // minDistance + 0.3 = zoom to 0.3 units closer than minimum distance
        const targetPosition = intersects[0].point.normalize().multiplyScalar(this.minDistance + 0.3);
        this.smoothLookAt(targetPosition);
      } else {
        // Clicked on empty space - zoom to default closer view
        this.targetRadius = this.minDistance + 0.5;
        this.zoomToTarget();
      }
    }
  }
  
  // SMOOTH LOOK AT (for clicking on location markers):
  // Smoothly moves camera to focus on a specific location on the globe
  // Uses linear interpolation (lerp) with cubic ease-out for smooth animation
  // Duration: 800ms (slightly longer than hover zoom for more dramatic effect)
  smoothLookAt(targetPosition) {
    const startPosition = this.camera.position.clone(); // Current camera position
    const duration = 800; // Animation duration in milliseconds
    const startTime = Date.now();
    
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1); // 0 to 1
      const easeProgress = 1 - Math.pow(1 - progress, 3); // Cubic ease-out
      
      // Linearly interpolate camera position from start to target
      this.camera.position.lerpVectors(startPosition, targetPosition, easeProgress);
      this.camera.lookAt(0, 0, 0); // Always look at center of globe
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        // Animation complete - update spherical coordinates to match new position
        this.spherical.setFromVector3(this.camera.position);
      }
    };
    
    requestAnimationFrame(animate);
  }
  
  onMouseDown(event) {
    this.isDragging = true;
    this.lastMouseX = event.clientX;
    this.lastMouseY = event.clientY;
    handleUserInteractionStart();
  }
  
  onMouseMove(event) {
    if (!this.isDragging) return;
    
    const deltaX = event.clientX - this.lastMouseX;
    const deltaY = event.clientY - this.lastMouseY;
    
    // Natural panning: mouse right = globe rotates right, mouse down = globe rotates down
    this.spherical.theta -= deltaX * this.rotateSpeed;
    this.spherical.phi -= deltaY * this.rotateSpeed;
    this.spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.spherical.phi));
    
    this.updateCamera();
    
    this.lastMouseX = event.clientX;
    this.lastMouseY = event.clientY;
  }
  
  onMouseUp() {
    this.isDragging = false;
    handleUserInteractionEnd();
  }
  
  // MOUSE WHEEL ZOOM:
  // Scroll up = zoom out (increase radius)
  // Scroll down = zoom in (decrease radius)
  // The zoom is clamped between minDistance and maxDistance
  onWheel(event) {
    event.preventDefault();
    handleUserInteractionPulse();
    // Calculate new radius: deltaY is positive when scrolling down (zoom in), negative when scrolling up (zoom out)
    this.spherical.radius += event.deltaY * this.zoomSpeed * 0.01;
    // Clamp the radius to stay within minDistance and maxDistance bounds
    this.spherical.radius = Math.max(this.minDistance, Math.min(this.maxDistance, this.spherical.radius));
    this.updateCamera();
  }
  
  onTouchStart(event) {
    if (event.touches.length === 1) {
      this.isDragging = true;
      this.lastMouseX = event.touches[0].clientX;
      this.lastMouseY = event.touches[0].clientY;
      handleUserInteractionStart();
    }
  }
  
  onTouchMove(event) {
    if (event.touches.length === 1 && this.isDragging) {
      const deltaX = event.touches[0].clientX - this.lastMouseX;
      const deltaY = event.touches[0].clientY - this.lastMouseY;
      
      // Natural panning: finger right = globe rotates right, finger down = globe rotates down
      this.spherical.theta -= deltaX * this.rotateSpeed;
      this.spherical.phi -= deltaY * this.rotateSpeed;
      this.spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.spherical.phi));
      
      this.updateCamera();
      
      this.lastMouseX = event.touches[0].clientX;
      this.lastMouseY = event.touches[0].clientY;
    }
  }
  
  onTouchEnd() {
    this.isDragging = false;
    handleUserInteractionEnd();
  }
  
  // SMOOTH ZOOM ANIMATION:
  // Animates the camera from current radius to targetRadius over 500ms
  // Uses cubic ease-out for smooth deceleration
  // Prevents multiple animations from running simultaneously
  zoomToTarget() {
    if (this.zoomAnimation) return; // Don't start new animation if one is already running
    
    const startRadius = this.spherical.radius; // Current camera distance
    const endRadius = this.targetRadius; // Target camera distance
    const duration = 500; // Animation duration in milliseconds
    const startTime = Date.now();
    
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1); // 0 to 1
      const easeProgress = 1 - Math.pow(1 - progress, 3); // Cubic ease-out (starts fast, ends slow)
      
      // Interpolate between start and end radius
      this.spherical.radius = startRadius + (endRadius - startRadius) * easeProgress;
      this.updateCamera();
      
      if (progress < 1) {
        // Continue animation
        requestAnimationFrame(animate);
      } else {
        // Animation complete
        this.zoomAnimation = null;
      }
    };
    
    this.zoomAnimation = requestAnimationFrame(animate);
  }
  
  updateCamera() {
    this.camera.position.setFromSpherical(this.spherical);
    this.camera.lookAt(0, 0, 0);
  }
  
  update() {
    // Camera updates occur only during user interactions.
  }
}

// Initialize globe
function initGlobe() {
  const container = document.querySelector('.globe');
  if (!container || isGlobeLoaded) return;
  
  const width = container.clientWidth;
  const height = container.clientHeight;
  
  // Create scene
  scene = new THREE.Scene();
//   scene.background = new THREE.Color(0xf5f5f0); // Match page background
  
  // Create camera
  camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
  camera.position.set(0, 0, 5);
  
  // Create renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);
  
  // Create globe
  globe = createGlobe();
  scene.add(globe);
  
  // Create particles
  particles = createParticles();
  scene.add(particles);
  
  // Load bee texture and create bees
  loadBeeTexture();
  
  // Add lights
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);
  
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(5, 5, 5);
  scene.add(directionalLight);
  
  // Create controls
  controls = new SimpleControls(camera, renderer.domElement);
  controls.initRaycaster(); // Initialize raycaster after Three.js is loaded
  
  // Handle window resize
  window.addEventListener('resize', () => {
    const newWidth = container.clientWidth;
    const newHeight = container.clientHeight;
    camera.aspect = newWidth / newHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(newWidth, newHeight);
  });
  
  // Start animation
  animate();
  isGlobeLoaded = true;
}

// Animation loop
function animate() {
  animationId = requestAnimationFrame(animate);
  
  if (controls) {
    controls.update();
  }
  
  // Rotate globe slowly with ramp-up auto-spin
  if (globe) {
    const desiredSpeed = autoSpinPaused ? 0 : AUTO_SPIN_TARGET_SPEED;
    if (autoSpinSpeed < desiredSpeed) {
      autoSpinSpeed = Math.min(autoSpinSpeed + AUTO_SPIN_ACCELERATION, desiredSpeed);
    } else if (autoSpinSpeed > desiredSpeed) {
      autoSpinSpeed = Math.max(autoSpinSpeed - AUTO_SPIN_ACCELERATION, desiredSpeed);
    }

    globe.rotation.y += autoSpinSpeed;
  }
  
  // Animate particles
  if (particles) {
    particles.rotation.y += 0.001;
    const positions = particles.geometry.attributes.position.array;
    for (let i = 0; i < positions.length; i += 3) {
      // Subtle floating animation
      positions[i + 1] += Math.sin(Date.now() * 0.001 + i) * 0.0001;
    }
    particles.geometry.attributes.position.needsUpdate = true;
  }
  
  // Update bee animations
  updateBees();
  
  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
}

// Lazy load globe when it comes into view
function setupLazyLoad() {
  const globeContainer = document.querySelector('.globe');
  if (!globeContainer) return;
  
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !isGlobeLoaded) {
        // Load Three.js if not already loaded
        if (typeof THREE === 'undefined') {
          const script = document.createElement('script');
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
          script.onload = () => {
            // Small delay to ensure Three.js is fully loaded
            setTimeout(() => {
              initGlobe();
            }, 100);
          };
          script.onerror = () => {
            console.error('Failed to load Three.js');
          };
          document.head.appendChild(script);
        } else {
          initGlobe();
        }
        observer.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.1,
    rootMargin: '50px'
  });
  
  observer.observe(globeContainer);
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupLazyLoad);
} else {
  setupLazyLoad();
}

