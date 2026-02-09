import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { io } from "socket.io-client";

// 1. まずシーンとレンダラーを作る（これがないと MazeLoader が動かない）
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111); // 少し暗くすると007っぽい
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// ライトの追加
const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(5, 10, 7.5);
scene.add(light, new THREE.AmbientLight(0xffffff, 0.7));

// 2. 迷路の読み込み
const mazeLoader = new GLTFLoader();
mazeLoader.load('/models/maze.glb', (gltf) => {
  const mazeModel = gltf.scene;
  scene.add(mazeModel);
  mazeModel.traverse((child) => {
    if (child.isMesh) {
      child.material.side = THREE.DoubleSide; 
    }
  });
  console.log("Maze loaded!");
});

// 3. プレイヤーモデルの読み込み
const loader = new GLTFLoader();
let model, mixer;
const actions = {};
let activeAction;
let yaw = Math.PI;

loader.load('/models/idle.glb', (gltf) => {
  model = gltf.scene; // ★先に代入する！
  
  // 螺旋などを消す処理
  model.traverse((child) => {
    if (!child.isMesh && child !== model) child.visible = false;
    if (child.name.toLowerCase().includes("spiral")) child.visible = false;
  });

  scene.add(model);
  model.rotation.y = yaw;
  
  mixer = new THREE.AnimationMixer(model);
  actions['idle'] = mixer.clipAction(gltf.animations[1]);
  activeAction = actions['idle'];
  activeAction.play();

  // Walkの読み込み
  loader.load('/models/walk.glb', (gltfWalk) => {
    actions['walk'] = mixer.clipAction(gltfWalk.animations[0]);
  });
});

// --- 以下、Socket.io や animate 関数（以前と同じ） ---