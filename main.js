import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { io } from "socket.io-client";

// --- エラー防止のため最速で定義 ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222222);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// テスト用の箱（これが見えれば成功）
const testBox = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x00ff00 })
);
testBox.position.z = -5;
scene.add(testBox);

// --- 変数準備 ---
let model, mixer;
const keys = {};
const clock = new THREE.Clock();
const socket = io("https://imori-server.onrender.com");

// --- 迷路の読み込み（エラーが起きても止まらないようにする） ---
const mazeLoader = new GLTFLoader();
mazeLoader.load('/models/maze.glb', (gltf) => {
    const maze = gltf.scene;
    maze.scale.set(10, 10, 10);
    scene.add(maze);
    console.log("Maze Success!");
}, undefined, (e) => console.log("Maze Load Skip:", e));

// --- プレイヤーの読み込み ---
const loader = new GLTFLoader();
loader.load('/models/idle.glb', (gltf) => {
    model = gltf.scene;
    scene.add(model);
    mixer = new THREE.AnimationMixer(model);
    if (gltf.animations[0]) mixer.clipAction(gltf.animations[0]).play();
}, undefined, (e) => console.log("Player Load Skip:", e));

// --- ループ処理（超安全設計） ---
function animate() {
    requestAnimationFrame(animate);
    
    const delta = clock.getDelta();
    if (mixer) mixer.update(delta);
    
    // testBoxを回転させる（動いているか確認用）
    testBox.rotation.y += 0.01;

    if (renderer && camera && scene) {
        renderer.render(scene, camera);
    }
}

animate();

// --- ウィンドウリサイズ対応（これも大事） ---
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});