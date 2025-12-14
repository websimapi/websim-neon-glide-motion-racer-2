import * as THREE from 'three';

export class Track {
    constructor(scene, world) {
        this.scene = scene;
        this.world = world; // Physics world
        this.curve = null;
        this.tubeMesh = null;
        this.length = 1000;
        this.segments = 200;
    }

    generate() {
        // Create a downhill path with curves
        const points = [];
        const slope = 0.5; // Downward slope factor

        for (let i = 0; i <= 20; i++) {
            const z = -i * 100;
            const y = -i * 30 + Math.sin(i * 0.5) * 10;
            const x = Math.sin(i * 0.8) * 80 + Math.cos(i * 0.3) * 40;
            points.push(new THREE.Vector3(x, y, z));
        }

        this.curve = new THREE.CatmullRomCurve3(points);
        this.curve.type = 'catmullrom';
        this.curve.tension = 0.5;

        // Visual Mesh
        const geometry = new THREE.TubeGeometry(this.curve, 200, 15, 8, false);
        const material = new THREE.MeshStandardMaterial({ 
            color: 0x222222, 
            roughness: 0.4,
            metalness: 0.8,
            side: THREE.DoubleSide,
            emissive: 0x001133,
            emissiveIntensity: 0.2,
            wireframe: false
        });

        // Create grid texture for retro feel
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#111';
        ctx.fillRect(0,0,512,512);
        ctx.strokeStyle = '#00f3ff';
        ctx.lineWidth = 2;
        // Draw grid
        for(let i=0; i<=512; i+=64) {
            ctx.beginPath(); ctx.moveTo(0,i); ctx.lineTo(512,i); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(i,0); ctx.lineTo(i,512); ctx.stroke();
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(20, 1);
        material.map = tex;

        this.tubeMesh = new THREE.Mesh(geometry, material);
        this.tubeMesh.receiveShadow = true;
        this.scene.add(this.tubeMesh);

        // Physics Body (Simplified as a static mesh approximation or series of boxes)
        // For accurate physics on a tube, we usually use a heightfield or trimesh.
        // Given Cannon-es limitations with complex trimeshes, we will rely on 
        // a simple "stay on curve" logic for the player gravity, or just simple ground planes locally.
        // For this demo, let's assume the player sticks to the curve center mathematically 
        // or add invisible planes for segments. 
        // BETTER: Use trimesh for collision.

        // Note: Trimesh in Cannon is expensive. 
        // Strategy: We will calculate player height relative to spline in Update loop
        // and apply forces to keep them on track, rather than full mesh collision.

        // Add visual decor (Neon rings)
        for (let i = 1; i < 200; i+=10) {
            const pt = this.curve.getPoint(i/200);
            const tan = this.curve.getTangent(i/200);
            const ringGeo = new THREE.TorusGeometry(18, 0.5, 8, 32);
            const ringMat = new THREE.MeshBasicMaterial({ color: 0xff00ff });
            const ring = new THREE.Mesh(ringGeo, ringMat);
            ring.position.copy(pt);
            ring.lookAt(pt.clone().add(tan));
            this.scene.add(ring);
        }
    }

    getPointAt(t) {
        return this.curve.getPointAt(Math.max(0, Math.min(1, t)));
    }

    getTangentAt(t) {
        return this.curve.getTangentAt(Math.max(0, Math.min(1, t)));
    }
}