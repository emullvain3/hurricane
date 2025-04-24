import * as THREE from 'three';
import { OrbitControls } from 'orbit';

// Get references to DOM elements already in HTML
const container = document.querySelector('.container');
const animationContainer = document.querySelector('.animation-container');
const controlsContainer = document.querySelector('.controls-container');
const yearInput = document.getElementById('year-input');
const goButton = document.getElementById('go-button');
const currentYearDisplay = document.getElementById('current-year-display');
const playPauseButton = document.getElementById('play-pause');
const speed1xButton = document.getElementById('speed-1x');
const speed2xButton = document.getElementById('speed-2x');
const keepTracksCheckbox = document.getElementById('keep-tracks');
const dimOverlay = document.querySelector('.dim-overlay');
const welcomePopup = document.getElementById('welcome-popup');
const closePopupButton = document.getElementById('close-popup');
const factsDiv = document.getElementById('hurricane-facts');

// Initialize the welcome popup
function initializeWelcomePopup() {
    // Show popup when page loads
    welcomePopup.style.display = 'flex';
    
    // Add event listener to close button
    closePopupButton.addEventListener('click', () => {
        welcomePopup.style.display = 'none';
        
        // Make sure the dimming overlay is also hidden
        if (dimOverlay) {
            dimOverlay.style.display = 'none';
        }
    });
}

// Set up the scene
const scene = new THREE.Scene();
const aspectRatio = (window.innerWidth * 0.6667) / window.innerHeight;
const camera = new THREE.PerspectiveCamera(75, aspectRatio, 0.1, 1000);
camera.position.z = 10;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth * 0.6667, window.innerHeight);
renderer.domElement.className = 'renderer-canvas';
animationContainer.appendChild(renderer.domElement);

// Add raycaster for hurricane selection
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function createGlobe() {
    const radius = 5;
    const earth = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 64, 64),
        new THREE.MeshBasicMaterial({
            map: new THREE.TextureLoader().load('assets/earth_4.jpg')
        })
    );
    scene.add(earth);
    scene.add(new THREE.AmbientLight(0xffffff));
    return earth;
}

function latLonToVector3(lat, lon, radius = 5) {
    const latRad = lat * (Math.PI/180);
    const lonRad = -lon * (Math.PI/180);
    const x = radius * Math.cos(latRad) * Math.cos(lonRad);
    const y = radius * Math.sin(latRad);
    const z = radius * Math.cos(latRad) * Math.sin(lonRad);
    return new THREE.Vector3(x,y,z);
}

const earth = createGlobe();

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 5.5;
controls.maxDistance = 20;

const predefinedColors = [
    0xFF0000, 0x00FF00, 0x0000FF, 0xFFFF00, 
    0xFF00FF, 0x00FFFF, 0xFF8000, 0x8000FF, 
    0x0080FF, 0xFF0080, 0x80FF00, 0x00FF80
];

const BASE_TRACK_COLOR = 0x808080; // Gray color for all tracks
const CATEGORY_COLORS = {
    0: 0x0000FF,  // Blue for tropical depression/storm
    1: 0x00FF00,  // Green for category 1
    2: 0xFFFF00,  // Yellow for category 2
    3: 0xFF8000,  // Orange for category 3
    4: 0xFF0000,  // Red for category 4
    5: 0xFF00FF   // Magenta for category 5
};

scene.add(new THREE.DirectionalLight(0xffffff, 1).position.set(5, 5, 5));

// Speed control setup
const baseSpeed = 10;
let currentSpeed = baseSpeed;

playPauseButton.textContent = '▶';

playPauseButton.addEventListener('click', () => {
    if (hurricaneManager.isPlaying) {
        hurricaneManager.pauseAnimation();
        playPauseButton.textContent = '▶';
    } else {
        hurricaneManager.resumeAnimation();
        playPauseButton.textContent = '⏸';
        
        // If in focus mode, disable it
        if (hurricaneManager.isSelected) {
            hurricaneManager.isSelected = false;
            hurricaneManager.disableFocusMode();
        }
    }
});

speed1xButton.addEventListener('click', () => {
    currentSpeed = baseSpeed;
    speed1xButton.classList.add('active');
    speed2xButton.classList.remove('active');
    if (hurricaneManager && hurricaneManager.animationId) {
        hurricaneManager.resetAnimation();
    }
});

speed2xButton.addEventListener('click', () => {
    currentSpeed = baseSpeed * 2;
    speed2xButton.classList.add('active');
    speed1xButton.classList.remove('active');
    if (hurricaneManager && hurricaneManager.animationId) {
        hurricaneManager.resetAnimation();
    }
});

const ROTATION_SPEED = 0.3;

class HurricaneManager {
    constructor(scene) {
        this.scene = scene;
        this.hurricanesData = {};
        this.windSpeeds = {};
        this.categories = {};
        this.pressures = {};
        this.hurricaneYears = {};
        this.availableYears = new Set();
        this.currentTrack = [];
        this.drawnPoints = [];
        this.hurricanePath = null;
        this.animationId = null;
        this.isPlaying = false;
        this.currentIndex = 0;
        this.currentHurricaneName = '';
        this.hurricaneNames = [];
        this.currentHurricaneIndex = 0;
        this.allTracks = [];
        this.isSelected = false;
        this.originalMarkerScale = 1.0;
        this.focusOverlay = null;
        this.selectedYear = 'all';
        
        // Create hurricane marker
        const planeGeometry = new THREE.PlaneGeometry(1.0, 1.0);
        const textureLoader = new THREE.TextureLoader();
        const hurricaneTexture = textureLoader.load('assets/hurricane.png');
        
        const planeMaterial = new THREE.MeshBasicMaterial({
            map: hurricaneTexture,
            transparent: true,
            depthTest: true,
            depthWrite: true,
            side: THREE.DoubleSide,
            color: 0xFFFFFF
        });
        
        this.marker = new THREE.Mesh(planeGeometry, planeMaterial);
        this.marker.scale.set(1.0, 1.0, 1.0);
        this.marker.visible = false;
        scene.add(this.marker);
        
        // Create focus overlay for darkening scene (not actually used now)
        this.createFocusOverlay();
        
        // Set up event handlers
        this.setupEventHandlers();
    }
    
    createFocusOverlay() {
        const overlayGeometry = new THREE.SphereGeometry(50, 32, 32);
        const overlayMaterial = new THREE.MeshBasicMaterial({
            color: 0x000000,
            transparent: true,
            opacity: 0.0,
            side: THREE.BackSide,
            depthWrite: false
        });
        
        this.focusOverlay = new THREE.Mesh(overlayGeometry, overlayMaterial);
        this.focusOverlay.visible = false;
        this.scene.add(this.focusOverlay);
    }
    
    setupEventHandlers() {
        if (yearInput && goButton) {
            goButton.addEventListener('click', () => {
                const year = yearInput.value.trim();
                if (!year) {
                    alert('Please enter a year between 1851 and 2024');
                    return;
                }
                if (year < 1851 || year > 2024) {
                    alert('Year must be between 1851 and 2024');
                    return;
                }
                this.selectedYear = year;
                if (currentYearDisplay)
                    currentYearDisplay.textContent = `Year: ${year}`;
                // Clear previously loaded data
                this.clearAllTracks();
                this.hurricaneNames = [];
                this.currentHurricaneIndex = 0;
                this.loadHurricanesForYear(year);
            });
        }
    }
    
    updateLabel(uniqueKey) {
        this.currentHurricaneName = uniqueKey;
        
        const nameElement = document.getElementById('current-hurricane-name');
        if (nameElement) {
            // Extract just the name part from the unique key (before the _AL)
            const displayName = uniqueKey.split('_')[0];
            const stormId = uniqueKey.split('_')[1] || '';
            nameElement.textContent = `${displayName} (${stormId})`;
        }
    }
    
    getCategoryFromWindSpeed(windSpeed) {
        if (windSpeed < 39) return 0;  // Tropical depression
        if (windSpeed < 74) return 0;  // Tropical storm
        if (windSpeed < 96) return 1;  // Category 1
        if (windSpeed < 111) return 2; // Category 2
        if (windSpeed < 130) return 3; // Category 3
        if (windSpeed < 157) return 4; // Category 4
        return 5; // Category 5
    }
    
    getCategoryName(category, windSpeed) {
        if (category === 0) {
            if (windSpeed < 39) return "Tropical Depression";
            return "Tropical Storm";
        }
        return `Category ${category}`;
    }
    
    displayHurricane(hurricaneName) {
        // Get year for display
        const year = this.hurricaneYears[hurricaneName] || 'Unknown';
        if (currentYearDisplay && year !== 'Unknown') {
            currentYearDisplay.textContent = `Year: ${year}`;
        }
        
        // Apply track visibility rules
        if (!keepTracksCheckbox || !keepTracksCheckbox.checked) {
            this.clearAllTracks();
        } else {
            if (this.hurricanePath) {
                this.allTracks.push(this.hurricanePath);
                this.hurricanePath = null;
            }
        }
        
        this.currentTrack = this.hurricanesData[hurricaneName] || [];
        if (this.currentTrack.length > 0) {
            this.drawnPoints = [this.currentTrack[0]];
            
            const material = new THREE.LineBasicMaterial({
                color: BASE_TRACK_COLOR,
                linewidth: 5
            });
            
            const geometry = new THREE.BufferGeometry().setFromPoints(this.drawnPoints);
            this.hurricanePath = new THREE.Line(geometry, material);
            
            this.scene.add(this.hurricanePath);
            
            this.updateLabel(hurricaneName);
            
            this.resetAnimation();
        }
    }
    
    clearAllTracks() {
        for (const track of this.allTracks) {
            this.scene.remove(track);
        }
        this.allTracks = [];
        
        if (this.hurricanePath) {
            this.scene.remove(this.hurricanePath);
            this.hurricanePath = null;
        }
    }
    
    moveToNextHurricane() {
        // Add current track to all tracks if keeping tracks
        if (keepTracksCheckbox && keepTracksCheckbox.checked && this.hurricanePath) {
            this.allTracks.push(this.hurricanePath);
            this.hurricanePath = null;
        }
        
        // Debug: Check how many hurricanes are available
        console.log(`Moving to next hurricane. Total hurricanes: ${this.hurricaneNames.length}, Current index: ${this.currentHurricaneIndex}`);
        
        // Make sure we have hurricanes to display
        if (this.hurricaneNames.length === 0) {
            console.error("No hurricanes available to display");
            return;
        }
        
        // Move to the next hurricane
        this.currentHurricaneIndex = (this.currentHurricaneIndex + 1) % this.hurricaneNames.length;
        const nextHurricaneName = this.hurricaneNames[this.currentHurricaneIndex];
        
        console.log(`Now showing hurricane: ${nextHurricaneName} (index ${this.currentHurricaneIndex})`);
        
        // Make sure we're not showing the same hurricane again
        if (nextHurricaneName === this.currentHurricaneName) {
            console.warn("Same hurricane selected again, might be only one hurricane available");
        }
        
        // Display the selected hurricane
        this.displayHurricane(nextHurricaneName);
    }
    
    resetAnimation() {
        if (this.currentTrack.length > 0) {
            const position = this.currentTrack[0].clone();
            position.normalize().multiplyScalar(5.1);
            this.marker.position.copy(position);
            this.marker.lookAt(0, 0, 0);
            const up = position.clone().normalize();
            this.marker.up.copy(up);
            this.marker.visible = true;
            this.drawnPoints = [this.currentTrack[0]];
            this.currentIndex = 0;
            this.updatePath();
            
            // Reset selection state
            this.isSelected = false;
            this.disableFocusMode();
            
            // Reset marker to normal scale
            this.marker.scale.set(1.0, 1.0, 1.0);
            
            // Clear facts panel
            this.updateFactsPanel();
        } else {
            this.marker.visible = false;
        }
        this.animateHurricane();
    }
    
    updatePath() {
        if (this.hurricanePath) {
            this.scene.remove(this.hurricanePath);
            // If keeping tracks, don't completely remove the reference
            if (keepTracksCheckbox && keepTracksCheckbox.checked) {
                this.allTracks.push(this.hurricanePath);
            }
        }
        
        // If we have only one point, we can't draw segments yet
        if (this.drawnPoints.length < 2) {
            return;
        }
        
        // Create line segments (multiple individual lines) instead of a continuous line
        const positions = [];
        const colors = [];
        
        // Create segments for each pair of consecutive points
        for (let i = 0; i < this.drawnPoints.length - 1; i++) {
            const point1 = this.drawnPoints[i];
            const point2 = this.drawnPoints[i + 1];
            
            // Get the wind speed and category for this segment
            const windSpeed = this.windSpeeds[this.currentHurricaneName][i];
            const category = this.getCategoryFromWindSpeed(windSpeed);
            const color = CATEGORY_COLORS[category];
            
            // Convert hex color to RGB
            const r = ((color >> 16) & 255) / 255;
            const g = ((color >> 8) & 255) / 255;
            const b = (color & 255) / 255;
            
            // Add the line segment (2 points per segment)
            positions.push(point1.x, point1.y, point1.z);
            positions.push(point2.x, point2.y, point2.z);
            
            // Same color for both vertices of the segment
            colors.push(r, g, b);
            colors.push(r, g, b);
        }
        
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        
        // Use thicker lines
        const material = new THREE.LineBasicMaterial({
            vertexColors: true,
            linewidth: 5 // Increased from 3 to 5 for thicker lines
        });
        
        // Use LineSegments instead of Line
        this.hurricanePath = new THREE.LineSegments(geometry, material);
        this.scene.add(this.hurricanePath);
    }
    
    animateHurricane() {
        if (this.animationId) {
            clearTimeout(this.animationId);
        }
        
        const moveMarker = () => {
            if (!this.isPlaying) return;
            
            if (this.currentIndex < this.currentTrack.length) {
                const position = this.currentTrack[this.currentIndex].clone();
                position.normalize().multiplyScalar(5.1);
                this.marker.position.copy(position);
                this.marker.lookAt(0, 0, 0);
                const up = position.clone().normalize();
                this.marker.up.copy(up);
                this.marker.rotateZ(ROTATION_SPEED);
                
                // Log wind speed and category at current position
                const windSpeed = this.windSpeeds[this.currentHurricaneName][this.currentIndex];
                const category = this.getCategoryFromWindSpeed(windSpeed);
                const categoryName = this.getCategoryName(category, windSpeed);
                
                if (this.currentIndex >= this.drawnPoints.length) {
                    this.drawnPoints.push(this.currentTrack[this.currentIndex]);
                    this.updatePath();
                }
                
                this.currentIndex++;
                const delay = Math.floor(4000 / currentSpeed);
                this.animationId = setTimeout(() => requestAnimationFrame(moveMarker), delay);
            } else {
                console.log(`Reached end of hurricane track. Moving to next hurricane.`);
                this.moveToNextHurricane();
            }
        };
        
        if (this.currentTrack.length > 0) {
            moveMarker();
        } else {
            console.warn("Cannot animate: track has no points");
            // If current track has no points, try moving to the next hurricane
            this.moveToNextHurricane();
        }
    }

    async loadHurricanesForYear(year) {
        try {
            const response = await fetch('hurricane.csv');
            const text = await response.text();
            const rows = text.split("\n");
            
            let currentHurricane = "";
            // Use a Set to ensure unique hurricane names
            const uniqueHurricaneSet = new Set();
            // Reset data containers
            this.hurricanesData = {};
            this.windSpeeds = {};
            this.categories = {};
            this.hurricaneYears = {};
            
            rows.forEach((row, index) => {
                // Skip empty rows
                if (!row.trim()) return;
                
                // Split by comma and trim whitespace
                let cols = row.split(",").map(col => col.trim());
                
                // Detect a header row: starts with basin ID (e.g., "AL062004") *and* the next column is the NAME (not a numeric timestamp)
                if (cols[0] && cols[0].match(/^AL\d{6}$/) && cols.length >= 2 && isNaN(Number(cols[1]))) {
                    // This is a hurricane header - extract the name from column 1 (index 1)
                    if (cols[1]) {
                        currentHurricane = cols[1];
                        
                        // Extract year from the ID (last 4 characters)
                        const currentYear = cols[0].slice(-4);
                        this.availableYears.add(currentYear);
                        
                        // Use storm ID to create a unique key that includes name and storm ID
                        const stormId = cols[0]; // AL062004 format
                        const uniqueKey = `${currentHurricane}_${stormId}`;
                        
                        uniqueHurricaneSet.add(uniqueKey);
                        this.hurricanesData[uniqueKey] = [];
                        this.windSpeeds[uniqueKey] = [];
                        this.categories[uniqueKey] = [];
                        this.hurricaneYears[uniqueKey] = currentYear;
                        this.pressures[uniqueKey] = [];
                        
                        // Store current storm ID for data rows
                        this.currentStormId = uniqueKey;
                    }
                    return; // Skip processing the rest of a header row
                }
                
                // Make sure we have enough columns for a data row and we have a current hurricane
                if (cols.length < 7 || !currentHurricane) return;
                
                // Extract latitude, longitude, wind speed and pressure
                let lat = parseFloat(cols[4]);
                let lon = parseFloat(cols[5]);
                let windSpeed = parseFloat(cols[6]);
                let pressure = cols.length >= 8 ? parseFloat(cols[7]) : null;
                
                if (cols[4].includes("S")) lat *= -1;
                if (cols[5].includes("W")) lon *= -1;
                
                if (!isNaN(lat) && !isNaN(lon)) {
                    const point = latLonToVector3(lat, lon);
                    this.hurricanesData[this.currentStormId].push(point);
                    this.windSpeeds[this.currentStormId].push(windSpeed);
                    this.categories[this.currentStormId].push(this.getCategoryFromWindSpeed(windSpeed));
                    
                    // Add pressure if available
                    if (pressure !== null && !isNaN(pressure)) {
                        this.pressures[this.currentStormId].push(pressure);
                    }
                }
            });
            
            // Convert unique Set to array
            this.hurricaneNames = Array.from(uniqueHurricaneSet);
            
            // Filter to only hurricanes from the requested year
            if (year !== 'all') {
                this.hurricaneNames = this.hurricaneNames.filter(name => this.hurricaneYears[name] === year);
            }

            console.log(`Loaded ${this.hurricaneNames.length} hurricanes for year ${year}`);
            
            // Debug: List all loaded hurricanes
            this.hurricaneNames.forEach((name, index) => {
                console.log(`Hurricane ${index}: ${name} (${this.hurricaneYears[name]}) - ${this.hurricanesData[name].length} points`);
            });
            
            this.currentHurricaneIndex = 0;
            
            if (this.hurricaneNames.length > 0) {
                this.displayHurricane(this.hurricaneNames[0]);
                this.isPlaying = true;
            } else {
                alert('No hurricanes found for ' + year);
            }
        } catch (error) {
            console.error("Error loading hurricane data:", error);
        }
    }
    
    filterHurricanesByYear() {
        // If showing all years, use the full list of hurricane names
        if (this.selectedYear === 'all') {
            this.hurricaneNames = Object.keys(this.hurricanesData);
        } else {
            // Filter hurricane names by selected year
            this.hurricaneNames = Object.keys(this.hurricanesData).filter(
                name => this.hurricaneYears[name] === this.selectedYear
            );
        }
        
        console.log(`Filtered to ${this.hurricaneNames.length} hurricanes for year: ${this.selectedYear}`);
        
        // Debug: Show the filtered list of hurricanes
        this.hurricaneNames.forEach((name, index) => {
            console.log(`Filtered Hurricane ${index}: ${name} (${this.hurricaneYears[name]})`);
        });
        
        // Reset to the first hurricane in the filtered list
        this.currentHurricaneIndex = 0;
        
        // Apply track visibility rules
        this.applyTrackVisibilityRules();
        
        // Display the first hurricane in the filtered list
        if (this.hurricaneNames.length > 0) {
            this.displayHurricane(this.hurricaneNames[0]);
        } else {
            const nameElement = document.getElementById('current-hurricane-name');
            if (nameElement) {
                nameElement.textContent = "No hurricanes found";
            }
            
            this.marker.visible = false;
        }
    }
    
    applyTrackVisibilityRules() {
        if (!keepTracksCheckbox || !keepTracksCheckbox.checked) {
            // If checkbox is unchecked, remove all existing tracks
            this.clearAllTracks();
        }
        // If checked, keep all tracks (default behavior)
    }
    
    toggleSelection() {
        this.isSelected = !this.isSelected;
        
        if (this.isSelected) {
            this.enableFocusMode();
            this.pauseAnimation();
            playPauseButton.textContent = '▶';
            this.updateFactsPanel();
        } else {
            this.disableFocusMode();
            this.resumeAnimation();
            playPauseButton.textContent = '⏸';
        }
    }
    
    enableFocusMode() {
        // Store original scale
        this.originalMarkerScale = this.marker.scale.x;
        
        // Enlarge the hurricane
        this.marker.scale.set(2.5, 2.5, 2.5);
        
        // Increase brightness of hurricane to make it stand out
        this.marker.material.color.set(0xFFFFFF); // Pure white
        
        // Make sure the dimming overlay is NOT displayed
        if (dimOverlay) {
            dimOverlay.style.display = 'none';
        }
    }
    
    disableFocusMode() {
        // Restore original scale
        this.marker.scale.set(
            this.originalMarkerScale,
            this.originalMarkerScale,
            this.originalMarkerScale
        );
        
        // Make sure the dimming overlay is NOT displayed
        if (dimOverlay) {
            dimOverlay.style.display = 'none';
        }
    }
    
    updateFactsPanel() {
        if (!factsDiv) return;
        
        if (!this.isSelected || !this.currentHurricaneName) {
            factsDiv.innerHTML = '<p>Select a hurricane to view details</p>';
            return;
        }
        
        const windSpeeds = this.windSpeeds[this.currentHurricaneName] || [];
        const maxWindSpeed = windSpeeds.length > 0 ? Math.max(...windSpeeds) : 'N/A';
        
        const pressures = this.pressures[this.currentHurricaneName] || [];
        const minPressure = pressures.length > 0 ? Math.min(...pressures) : 'N/A';
        
        const dataPoints = this.hurricanesData[this.currentHurricaneName]?.length || 0;
        
        const categories = this.categories[this.currentHurricaneName] || [];
        const maxCategory = categories.length > 0 ? Math.max(...categories) : 0;
        const maxCategoryName = this.getCategoryName(maxCategory, maxWindSpeed);
        
        const year = this.hurricaneYears[this.currentHurricaneName] || 'Unknown';
        const displayName = this.currentHurricaneName.split('_')[0];
        
        // Clone the template and show it
        const template = document.querySelector('.facts-template').cloneNode(true);
        template.style.display = 'block';
        
        // Update the template with hurricane data
        template.querySelector('#fact-name').textContent = displayName;
        template.querySelector('#fact-year').textContent = year;
        template.querySelector('#fact-wind').textContent = `${maxWindSpeed} knots`;
        template.querySelector('#fact-pressure').textContent = minPressure !== 'N/A' ? `${minPressure} mb` : 'N/A';
        template.querySelector('#fact-category').textContent = maxCategoryName;
        template.querySelector('#fact-points').textContent = dataPoints;
        
        // Clear and add the populated template
        factsDiv.innerHTML = '';
        factsDiv.appendChild(template);
    }
    
    pauseAnimation() {
        if (this.animationId) {
            clearTimeout(this.animationId);
            this.animationId = null;
        }
        this.isPlaying = false;
    }
    
    resumeAnimation() {
        if (!this.isPlaying && this.currentTrack.length > 0) {
            this.isPlaying = true;
            this.animateHurricane();
        }
    }
}

const hurricaneManager = new HurricaneManager(scene);

// Handle mouse clicks on the hurricane
function onMouseClick(event) {
    // If the welcome popup is visible, don't process clicks on the globe
    if (welcomePopup.style.display === 'flex') {
        return;
    }
    
    // Calculate mouse position in normalized device coordinates
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    // Update the picking ray with the camera and mouse position
    raycaster.setFromCamera(mouse, camera);
    
    // Calculate objects intersecting the picking ray
    const intersects = raycaster.intersectObject(hurricaneManager.marker);
    
    if (intersects.length > 0) {
        // Hurricane was clicked
        hurricaneManager.toggleSelection();
    }
}

renderer.domElement.addEventListener('click', onMouseClick, false);

async function initialize() {
    // First create the globe to ensure it's visible
    const earth = createGlobe();
    
    try {
        const hurricaneNames = await hurricaneManager.loadHurricaneData();
        
        if (hurricaneNames.length > 0) {
            hurricaneManager.displayHurricane(hurricaneNames[0]);
            hurricaneManager.isPlaying = true; // Ensure animation starts
        } else {
            console.error("No hurricane data was loaded!");
        }
    } catch (error) {
        console.error("Error during initialization:", error);
    }
    
    // Show the welcome popup after data is loaded
    initializeWelcomePopup();
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    
    // Make the hurricane marker rotate slowly when paused
    if (hurricaneManager && hurricaneManager.marker.visible) {
        if (hurricaneManager.isSelected) {
            hurricaneManager.marker.rotateZ(ROTATION_SPEED * 0.01);
        }
    }
    
    renderer.render(scene, camera);
}

window.addEventListener('resize', onWindowResize, false);

function onWindowResize() {
    const width = window.innerWidth * 0.6667;
    const height = window.innerHeight;
    const newAspectRatio = width / height;
    
    camera.aspect = newAspectRatio;
    camera.updateProjectionMatrix();
    
    renderer.setSize(width, height, true);
}

// Start the animation loop first to ensure the scene renders
animate();

// Then initialize the data
initialize();
