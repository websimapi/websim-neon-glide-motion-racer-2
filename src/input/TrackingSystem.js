import * as THREE from 'three';

export class TrackingSystem {
    constructor(videoElement, canvasElement, pipCanvas) {
        this.video = videoElement;
        this.canvas = canvasElement;
        this.ctx = this.canvas.getContext('2d');
        this.pipCtx = pipCanvas.getContext('2d');

        // State
        this.isReady = false;
        this.poseResults = null;
        this.handResults = null;

        // Metrics
        this.leanAngle = 0; // -1 to 1 (Left to Right)
        this.crouchFactor = 0; // 0 (standing) to 1 (full crouch)
        this.isJumping = false;
        this.handsTogether = false;
        this.handsRaised = false;

        // Calibration
        this.calibrationData = {
            centerHipX: 0.5,
            standingHeight: 0.5
        };

        // Smoothing
        this.leanHistory = [];
        this.historySize = 10;

        this.init();
    }

    async init() {
        // Initialize MediaPipe Pose
        this.pose = new window.Pose({locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
        }});

        this.pose.setOptions({
            modelComplexity: 1,
            smoothLandmarks: true,
            enableSegmentation: false,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        this.pose.onResults(this.onPoseResults.bind(this));

        // Initialize MediaPipe Hands
        this.hands = new window.Hands({locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
        }});

        this.hands.setOptions({
            maxNumHands: 2,
            modelComplexity: 1,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        this.hands.onResults(this.onHandResults.bind(this));

        // Setup Camera
        this.camera = new window.Camera(this.video, {
            onFrame: async () => {
                // Parallel-ish execution
                await Promise.all([
                    this.pose.send({image: this.video}),
                    this.hands.send({image: this.video})
                ]);
            },
            width: 640,
            height: 480
        });
    }

    start() {
        this.camera.start();
    }

    onPoseResults(results) {
        this.poseResults = results;
        this.drawResults();
        this.processPoseLogic(results);
    }

    onHandResults(results) {
        this.handResults = results;
        this.processHandLogic(results);
    }

    calibrate() {
        if (!this.poseResults || !this.poseResults.poseLandmarks) return false;

        const landmarks = this.poseResults.poseLandmarks;
        const leftHip = landmarks[23];
        const rightHip = landmarks[24];
        const nose = landmarks[0];

        // Store center hip X
        this.calibrationData.centerHipX = (leftHip.x + rightHip.x) / 2;

        // Store standing height (approx nose y)
        this.calibrationData.standingHeight = nose.y;

        console.log("Calibrated:", this.calibrationData);
        return true;
    }

    processPoseLogic(results) {
        if (!results.poseLandmarks) return;

        const landmarks = results.poseLandmarks;

        // 1. Calculate Lean (Shoulders relative to Hips center)
        const leftShoulder = landmarks[11];
        const rightShoulder = landmarks[12];
        const leftHip = landmarks[23];
        const rightHip = landmarks[24];
        const nose = landmarks[0];

        const shoulderMidX = (leftShoulder.x + rightShoulder.x) / 2;
        const hipMidX = (leftHip.x + rightHip.x) / 2;

        // Relative to calibrated center or just dynamic
        // Raw lean: offset of shoulders vs hips
        let rawLean = (shoulderMidX - hipMidX) * 5; // Multiplier for sensitivity

        // Smoothing
        this.leanHistory.push(rawLean);
        if (this.leanHistory.length > this.historySize) this.leanHistory.shift();
        this.leanAngle = this.leanHistory.reduce((a, b) => a + b, 0) / this.leanHistory.length;

        // Clamp
        this.leanAngle = Math.max(-1, Math.min(1, this.leanAngle));

        // 2. Calculate Crouch/Jump (Nose Y position)
        // If nose is significantly lower than standing height -> crouch
        // If nose is significantly higher -> jump (or check ankles)

        // Simple crouch:
        const currentHeight = nose.y;
        const heightDiff = currentHeight - this.calibrationData.standingHeight;

        // If heightDiff is positive, we are lower (Y goes down in screen space)
        this.crouchFactor = Math.max(0, Math.min(1, heightDiff * 3));

        // Jump detection (upwards velocity or high position)
        // Check if ankles are high? or just use head position relative to top
        this.isJumping = (heightDiff < -0.1);
    }

    processHandLogic(results) {
        if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
            this.handsTogether = false;
            this.handsRaised = false;
            return;
        }

        // Gesture: Hands Raised (Boost or Jump)
        let handsAboveHead = true;
        let leftHandPos = null;
        let rightHandPos = null;

        // Note: We need pose data to know where head is reliably,
        // but can approximate with Y coords < 0.3

        for (const landmarks of results.multiHandLandmarks) {
            const wrist = landmarks[0];
            if (wrist.y > 0.4) handsAboveHead = false; // 0 is top
        }
        this.handsRaised = handsAboveHead;

        // Gesture: Hands Together (Boost)
        if (results.multiHandLandmarks.length === 2) {
            const hand1 = results.multiHandLandmarks[0][0]; // wrist
            const hand2 = results.multiHandLandmarks[1][0]; // wrist

            const dist = Math.sqrt(Math.pow(hand1.x - hand2.x, 2) + Math.pow(hand1.y - hand2.y, 2));
            this.handsTogether = (dist < 0.15); // Close together
        } else {
            this.handsTogether = false;
        }
    }

    drawResults() {
        // Clear canvases
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.pipCtx.clearRect(0, 0, this.pipCtx.canvas.width, this.pipCtx.canvas.height);

        // Draw to Calibration Canvas
        this.ctx.save();
        this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);

        if (this.poseResults && this.poseResults.poseLandmarks) {
            window.drawConnectors(this.ctx, this.poseResults.poseLandmarks, window.POSE_CONNECTIONS,
                 {color: '#00FF00', lineWidth: 4});
            window.drawLandmarks(this.ctx, this.poseResults.poseLandmarks,
                 {color: '#FF0000', lineWidth: 2});
        }
        if (this.handResults && this.handResults.multiHandLandmarks) {
            for (const landmarks of this.handResults.multiHandLandmarks) {
                window.drawConnectors(this.ctx, landmarks, window.HAND_CONNECTIONS,
                     {color: '#00CCFF', lineWidth: 4});
                window.drawLandmarks(this.ctx, landmarks,
                     {color: '#FF00FF', lineWidth: 2});
            }
        }
        this.ctx.restore();

        // Draw simple skeleton to PIP
        this.pipCtx.fillStyle = '#000';
        this.pipCtx.fillRect(0,0,this.pipCtx.canvas.width, this.pipCtx.canvas.height);

        if (this.poseResults && this.poseResults.poseLandmarks) {
             // Draw simplified skeleton for PIP
             const lm = this.poseResults.poseLandmarks;
             const w = this.pipCtx.canvas.width;
             const h = this.pipCtx.canvas.height;

             this.pipCtx.strokeStyle = '#00f3ff';
             this.pipCtx.lineWidth = 2;
             this.pipCtx.beginPath();
             // Shoulders
             this.pipCtx.moveTo(lm[11].x * w, lm[11].y * h);
             this.pipCtx.lineTo(lm[12].x * w, lm[12].y * h);
             // Body
             this.pipCtx.moveTo((lm[11].x + lm[12].x)/2 * w, (lm[11].y + lm[12].y)/2 * h);
             this.pipCtx.lineTo((lm[23].x + lm[24].x)/2 * w, (lm[23].y + lm[24].y)/2 * h);
             this.pipCtx.stroke();
        }
    }

    getControlInput() {
        return {
            steering: this.leanAngle, // -1 to 1
            throttle: this.handsTogether ? 1.0 : 0.0, // Boost
            brake: this.crouchFactor > 0.5 ? 1.0 : 0.0,
            jump: this.isJumping || this.handsRaised
        };
    }
}