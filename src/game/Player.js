import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export class Player {
    constructor(scene, world, color = 0x00f3ff) {
        this.scene = scene;
        this.world = world;
        
        this.mesh = new THREE.Group();
        
        // Board
        const boardGeo = new THREE.BoxGeometry(1.5, 0.2, 4);
        const boardMat = new THREE.MeshStandardMaterial({ 
            color: 0x333333,
            roughness: 0.2,
            metalness: 0.8
        });
        this.boardMesh = new THREE.Mesh(boardGeo, boardMat);
        
        // Glow
        const glowGeo = new THREE.BoxGeometry(1.6, 0.25, 4.1);
        const glowMat = new THREE.MeshBasicMaterial({ 
            color: color, 
            transparent: true, 
            opacity: 0.5 
        });
        this.glowMesh = new THREE.Mesh(glowGeo, glowMat);
        
        this.mesh.add(this.boardMesh);
        this.mesh.add(this.glowMesh);
        
        // Avatar (Simple primitive representation)
        const bodyGeo = new THREE.ConeGeometry(0.5, 2, 8);
        const bodyMat = new THREE.MeshStandardMaterial({ color: color });
        this.avatarMesh = new THREE.Mesh(bodyGeo, bodyMat);
        this.avatarMesh.position.y = 1.2;
        this.avatarMesh.rotation.x = -Math.PI/2; // Point forward-ish
        this.mesh.add(this.avatarMesh);

        this.scene.add(this.mesh);

        // Physics
        const shape = new CANNON.Box(new CANNON.Vec3(0.75, 0.1, 2));
        this.body = new CANNON.Body({
            mass: 50,
            position: new CANNON.Vec3(0, 10, 0),
            shape: shape,
            linearDamping: 0.5, // Air resistance
            angularDamping: 0.8
        });
        this.world.addBody(this.body);

        // Game State
        this.speed = 0;
        this.progress = 0; // 0 to 1 along track
        this.boostEnergy = 100;
        this.score = 0;
    }

    update(input, track, dt) {
        // We use a "Kinematic-ish" control where we follow the track spline 
        // but allow physics to handle local collisions and inertia.
        
        // 1. Determine position along track
        // Project current position onto track spline to find 't'
        // For simplicity, we increment 't' based on speed.
        
        const maxSpeed = 0.5 * (input.throttle ? 2.0 : 1.0); // Boost multiplier
        const acceleration = 0.05;
        
        if (this.speed < maxSpeed) {
            this.speed += acceleration * dt;
        }
        
        // Apply steering (local X offset)
        // We actually want to apply forces to the physics body, but constrain it to the track "tube".
        
        // Simplified Logic: 
        // Move along curve at 'speed'. 
        // 'input.steering' shifts position perpendicularly to the curve tangent.
        
        this.progress += (this.speed * dt) / 1000; // Normalize by track length approx
        if (this.progress > 1) this.progress = 0; // Loop

        const trackPos = track.getPointAt(this.progress);
        const tangent = track.getTangentAt(this.progress);
        const normal = new THREE.Vector3(0, 1, 0).applyAxisAngle(tangent, 0); // Up vector relative to track?
        const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();
        
        // Calculate target position
        // Steering -1 to 1 maps to -trackWidth/2 to trackWidth/2
        const laneOffset = -input.steering * 8; 
        
        const targetPos = trackPos.clone()
            .add(binormal.clone().multiplyScalar(laneOffset))
            .add(new THREE.Vector3(0, 2, 0)); // Hover height

        // Physics body lerp to target (Hover effect)
        // Instead of hard setting, we apply spring force towards target position
        // This allows physics collisions to still work
        
        const currentPos = new THREE.Vector3(this.body.position.x, this.body.position.y, this.body.position.z);
        
        // Spring force
        const k = 50;
        const dist = targetPos.clone().sub(currentPos);
        const force = dist.multiplyScalar(k);
        
        this.body.applyForce(new CANNON.Vec3(force.x, force.y, force.z), this.body.position);
        
        // Damping gravity to simulate hover
        this.body.applyForce(new CANNON.Vec3(0, 490, 0), this.body.position); // Counter gravity approx (m*g)
        
        // Rotation alignment
        // Board should look along tangent, and bank based on steering
        const lookTarget = currentPos.clone().add(tangent);
        this.mesh.lookAt(lookTarget);
        
        // Banking
        this.mesh.rotateZ(-input.steering * 0.5);
        this.mesh.rotateX(input.brake ? 0.2 : 0); // Lean back to brake/crouch
        
        // Jump
        if (input.jump && this.mesh.position.y < targetPos.y + 1.0) {
             this.body.velocity.y += 10;
        }

        // Sync mesh to physics
        this.mesh.position.copy(this.body.position);
        // We override rotation for visual flair, physics rotation is less important for a hoverboard arcade feel
        this.body.quaternion.copy(this.mesh.quaternion);

        return {
            speed: Math.floor(this.speed * 200), // Display speed
            score: Math.floor(this.progress * 10000)
        };
    }
    
    // For multiplayer sync
    getState() {
        return {
            x: this.mesh.position.x,
            y: this.mesh.position.y,
            z: this.mesh.position.z,
            rx: this.mesh.rotation.x,
            ry: this.mesh.rotation.y,
            rz: this.mesh.rotation.z
        };
    }
}