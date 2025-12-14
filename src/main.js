import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { TrackingSystem } from './input/TrackingSystem.js';
import { Track } from './game/Track.js';
import { Player } from './game/Player.js';

// --- Globals ---
let scene, camera, renderer, world;
let track, player;
let peers = {};
let trackingSystem;
let lastTime = 0;
let isCalibrated = false;

// --- DOM Elements ---
const canvas = document.getElementById('gl-canvas');
const videoElement = document.getElementById('input-video');
const calibrationOverlay = document.getElementById('calibration-overlay');
const pipCanvas = document.getElementById('pip-canvas');
const startBtn = document.getElementById('start-btn');
const speedVal = document.getElementById('speed-val');
const scoreVal = document.getElementById('score-val');
const debugLean = document.getElementById('debug-lean');
const debugY = document.getElementById('debug-y');

// --- Input Fallback (Keyboard) ---
const keys = { w: false, a: false, s: false, d: false, space: false };
window.addEventListener('keydown', (e) => {
    if (e.key === ' ') keys.space = true;
    if (e.key === 'w') keys.w = true;
    if (e.key === 's') keys.s = true;
    if (e.key === 'a') keys.a = true;
    if (e.key === 'd') keys.d = true;
});
window.addEventListener('keyup', (e) => {
    if (e.key === ' ') keys.space = false;
    if (e.key === 'w') keys.w = false;
    if (e.key === 's') keys.s = false;
    if (e.key === 'a') keys.a = false;
    if (e.key === 'd') keys.d = false;
});

function getKeyboardInput() {
    return {
        steering: (keys.d ? -1 : 0) + (keys.a ? 1 : 0), // A is left (positive lean in my logic?) check later
        throttle: keys.w ? 1 : 0,
        brake: keys.s ? 1 : 0,
        jump: keys.space
    };
}

// --- Initialization ---
async function init() {
    // 1. Setup Three.js
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000a14);
    scene.fog = new THREE.FogExp2(0x000a14, 0.002);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;

    // Lights
    const ambientLight = new THREE.AmbientLight(0x404040, 2);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(50, 100, 50);
    dirLight.castShadow = true;
    scene.add(dirLight);

    // 2. Setup Physics
    world = new CANNON.World();
    world.gravity.set(0, -9.82, 0);

    // 3. Setup Game Objects
    track = new Track(scene, world);
    track.generate();

    player = new Player(scene, world);

    // 4. Setup Input
    trackingSystem = new TrackingSystem(videoElement, document.getElementById('calibration-canvas'), pipCanvas);

    // 5. Setup Network
    const room = new WebsimSocket();
    await room.initialize();
    room.subscribePresence((presence) => {
        // Handle other players
        for (const id in presence) {
            if (id === room.clientId) continue;
            const pData = presence[id];
            if (!peers[id]) {
                // Create new peer avatar
                const p = new Player(scene, world, 0xff0000); // Red for enemies
                peers[id] = p;
                // Remove physics body from peers, we just visualize them
                world.removeBody(p.body);
            }
            // Update peer transform
            if (pData.x !== undefined) {
                peers[id].mesh.position.set(pData.x, pData.y, pData.z);
                peers[id].mesh.rotation.set(pData.rx, pData.ry, pData.rz);
            }
        }

        // Cleanup disconnected
        for (const id in peers) {
            if (!presence[id]) {
                scene.remove(peers[id].mesh);
                delete peers[id];
            }
        }

        // Update rank
        document.getElementById('total-players').innerText = Object.keys(presence).length;
    });

    // 6. UI Listeners
    startBtn.addEventListener('click', () => {
        if (trackingSystem.calibrate()) {
            isCalibrated = true;
            calibrationOverlay.classList.add('hidden');
        }
    });

    // Skip calibration shortcut (space)
    window.addEventListener('keydown', (e) => {
        if(e.code === 'Space' && !isCalibrated) {
            isCalibrated = true;
            calibrationOverlay.classList.add('hidden');
        }
    });

    // Start Camera
    trackingSystem.start();

    // Polling for calibration readiness
    setInterval(() => {
        if (!isCalibrated && trackingSystem.poseResults) {
            startBtn.disabled = false;
            startBtn.innerText = "Calibrate & Start Race";

            // Debug text
            debugLean.innerText = trackingSystem.leanAngle.toFixed(2);
            debugY.innerText = trackingSystem.crouchFactor.toFixed(2);
        }
    }, 100);

    // Network Loop
    setInterval(() => {
        if (isCalibrated) {
            room.updatePresence(player.getState());
        }
    }, 50); // 20Hz update

    requestAnimationFrame(animate);
}

function animate(time) {
    requestAnimationFrame(animate);

    const dt = (time - lastTime) / 1000;
    lastTime = time;

    if (!isCalibrated) return;

    world.step(1/60);

    // Input mixing
    let input = getKeyboardInput();

    // If tracking is active and confident, override/mix
    // Note: In real app, we'd detect if user is actually present
    if (trackingSystem.poseResults) {
        const motionInput = trackingSystem.getControlInput();
        // Priority to motion if values are non-zero
        if (Math.abs(motionInput.steering) > 0.1) input.steering = -motionInput.steering; // Flip for intuitive mirror
        if (motionInput.throttle) input.throttle = 1;
        if (motionInput.jump) input.jump = true;
    }

    // Update Player
    const stats = player.update(input, track, dt);

    // Update Camera
    // Follow player
    const offset = new THREE.Vector3(0, 5, -10);
    offset.applyQuaternion(player.mesh.quaternion);
    const camPos = player.mesh.position.clone().add(offset);
    camera.position.lerp(camPos, 0.1);
    camera.lookAt(player.mesh.position);

    // Update HUD
    speedVal.innerText = stats.speed;
    scoreVal.innerText = stats.score;

    renderer.render(scene, camera);
}

// Window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

init();