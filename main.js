import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { io } from "socket.io-client";

const socket = io("https://imori-server.onrender.com");
const remotePlayers = {}; 

// --- 1. シーン・レンダラーの初期化（ここを先に書く） ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111); // 007風に暗めに
//ene.fog = new THREE.Fog(0x111111, 10, 50);


const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(5, 10, 7.5);
scene.add(light, new THREE.AmbientLight(0xffffff, 0.7));

// --- 2. 迷路の読み込み ---
const mazeLoader = new GLTFLoader();
mazeLoader.load('/models/maze.glb', (gltf) => {
    const maze = gltf.scene;

    // 迷路を原点 (0, 0, 0) に強制配置
    maze.position.set(0, 0, 0); 
    
    // もし小さすぎ/大きすぎたらここで調整（とりあえず2倍にしてみる例）
    maze.scale.set(50, 50, 50);

  
    scene.add(maze);
    maze.traverse((child) => {
        if (child.isMesh) {
            child.material.side = THREE.DoubleSide; 
        }
    });
    console.log("Maze loaded!");
}, undefined, (error) => console.error("Maze Load Error:", error));

// --- 3. 変数定義 ---
let model, mixer;
const actions = {};
let activeAction;
const clock = new THREE.Clock();
const keys = {};
let pitch = 0; 
let yaw = Math.PI;
let isRightMBDown = false;

// --- 4. モデル読み込み（順番を修正） ---
const loader = new GLTFLoader();

loader.load('/models/idle.glb', (gltf) => {
    model = gltf.scene; // ★先に代入する
    scene.add(model);
    model.rotation.y = yaw;

    // 螺旋などを隠す
    model.traverse((child) => {
        if (!child.isMesh && child !== model) child.visible = false;
        if (child.name.toLowerCase().includes("spiral") || child.name.toLowerCase().includes("circle")) {
            child.visible = false;
        }
    });

    mixer = new THREE.AnimationMixer(model);
    actions['idle'] = mixer.clipAction(gltf.animations[1] || gltf.animations[0]);
    activeAction = actions['idle'];
    activeAction.play();

    loader.load('/models/walk.glb', (gltfWalk) => {
        actions['walk'] = mixer.clipAction(gltfWalk.animations[0]);
        console.log("Walk loaded!");
    });
});

// --- 5. 通信・関数類 ---
function fadeToAction(name, duration = 0.2) {
    const nextAction = actions[name];
    if (!nextAction || nextAction === activeAction) return;
    nextAction.reset().fadeIn(duration).play();
    if (activeAction) activeAction.fadeOut(duration);
    activeAction = nextAction;
}

function createRemotePlayer(id) {
    loader.load('/models/idle.glb', (gltf) => {
        const rModel = gltf.scene;
        scene.add(rModel);
        const rMixer = new THREE.AnimationMixer(rModel);
        const rActions = {
            idle: rMixer.clipAction(gltf.animations[1] || gltf.animations[0]),
        };
        rActions.idle.play();
        remotePlayers[id] = { model: rModel, mixer: rMixer, actions: rActions };
    });
}

socket.on("updatePlayers", (players) => {
    Object.keys(players).forEach((id) => {
        if (id === socket.id) return;
        if (!remotePlayers[id]) {
            createRemotePlayer(id);
        } else {
            const p = players[id];
            const remote = remotePlayers[id];
            if (remote.model) {
                remote.targetPos = new THREE.Vector3(p.x, p.y, p.z);
                remote.model.rotation.y = p.yaw;
            }
        }
    });
});

socket.on("removePlayer", (id) => {
    if (remotePlayers[id]) {
        scene.remove(remotePlayers[id].model);
        delete remotePlayers[id];
    }
});

// --- 6. イベントリスナー ---
window.addEventListener('keydown', (e) => keys[e.code] = true);
window.addEventListener('keyup', (e) => keys[e.code] = false);
window.addEventListener('mousedown', (e) => { if (e.button === 2) isRightMBDown = true; });
window.addEventListener('mouseup', (e) => { if (e.button === 2) isRightMBDown = false; });
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('mousemove', (e) => {
    if (isRightMBDown) {
        yaw -= e.movementX * 0.002;
        pitch -= e.movementY * 0.002;
        pitch = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, pitch));
    }
});

// --- 7. ループ処理 ---
function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    if (mixer) mixer.update(delta);

    Object.values(remotePlayers).forEach(p => {
        if (p.mixer) p.mixer.update(delta);
        if (p.model && p.targetPos) p.model.position.lerp(p.targetPos, 0.2);
    });

    if (model) {
        const moveSpeed = 0.15;
        let inputX = 0, inputZ = 0;
        if (keys['KeyW']) inputZ -= 1;
        if (keys['KeyS']) inputZ += 1;
        if (keys['KeyA']) inputX -= 1;
        if (keys['KeyD']) inputX += 1;

        if (inputX !== 0 || inputZ !== 0) {
            fadeToAction('walk');
            const angle = Math.atan2(inputX, inputZ) + yaw;
            const targetQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
            model.quaternion.slerp(targetQuaternion, 0.15);
            model.position.x += Math.sin(angle) * moveSpeed;
            model.position.z += Math.cos(angle) * moveSpeed;
        } else {
            fadeToAction('idle');
        }

        socket.emit("move", {
            x: model.position.x, y: model.position.y, z: model.position.z,
            yaw: model.rotation.y,
            action: activeAction === actions['walk'] ? 'walk' : 'idle'
        });

        // カメラ追従
        const camDist = 8;
        camera.position.x = model.position.x + camDist * Math.sin(yaw) * Math.cos(pitch);
        camera.position.y = model.position.y + camDist * Math.sin(pitch) + 3;
        camera.position.z = model.position.z + camDist * Math.cos(yaw) * Math.cos(pitch);
        camera.lookAt(model.position.x, model.position.y + 1, model.position.z);
    }
    renderer.render(scene, camera);
}

animate();