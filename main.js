import { io } from "socket.io-client";
const socket = io("http://localhost:3000");

const remotePlayers = {}; // 他人のモデルを保存するオブジェクト

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// --- 設定 ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa0a0a0);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(5, 10, 7.5);
scene.add(light, new THREE.AmbientLight(0xffffff, 0.7), new THREE.GridHelper(200, 50));

// --- 2. 迷路の読み込み（強制拡大） ---
const mazeLoader = new GLTFLoader();
mazeLoader.load('/models/maze.glb', (gltf) => {
    const maze = gltf.scene;
    maze.position.set(0, 0, 0); 
   //wze.scale.set(50, 50, 50); // 米粒サイズ対策で50倍に設定
    scene.add(maze);

    maze.traverse((child) => {
        if (child.isMesh) {
            child.material.side = THREE.DoubleSide; 
        }
    });
    console.log("Maze loaded successfully!");
}, undefined, (error) => console.error("Maze Load Error:", error));

// --- 変数 ---
let model, mixer;
const actions = {};    // アニメーション保存用
let activeAction;      // 現在のアクション
const clock = new THREE.Clock();
const keys = {};

let pitch = 0; 
let yaw = Math.PI; // 初期向き（奥）

// アニメーション切り替え関数
function fadeToAction(name, duration = 0.2) {
  const nextAction = actions[name];
  if (!nextAction || nextAction === activeAction) return;
  nextAction.reset().fadeIn(duration).play();
  if (activeAction) activeAction.fadeOut(duration);
  activeAction = nextAction;
}

// --- モデル読み込み ---
const loader = new GLTFLoader();

// 1. Idle版の読み込み
loader.load('/models/idle.glb', (gltf) => {
  model = gltf.scene;
  scene.add(model);
  model.rotation.y = yaw;

  mixer = new THREE.AnimationMixer(model);
  
  // Idle登録
  actions['idle'] = mixer.clipAction(gltf.animations[1]);
  activeAction = actions['idle'];
  activeAction.play();

  // 2. Walk版の読み込み（歩きアニメだけ流用）
  loader.load('/models/walk.glb', (gltfWalk) => {
    actions['walk'] = mixer.clipAction(gltfWalk.animations[0]);
    console.log("Walk loaded!");
  });
}, undefined, (error) => console.error("Load Error:", error));

// 他プレイヤーのモデルを生成する関数
function createRemotePlayer(id) {
  loader.load('/models/idle.glb', (gltf) => {
    const rModel = gltf.scene;
    scene.add(rModel);

    const rMixer = new THREE.AnimationMixer(rModel);
    const rActions = {
      idle: rMixer.clipAction(gltf.animations[0]),
      // walk用のアニメーションも必要なら読み込み処理を共通化して追加
    };
    rActions.idle.play();

    remotePlayers[id] = { model: rModel, mixer: rMixer, actions: rActions, currentAction: 'idle' };
  });
}

// サーバーからの更新を受け取る
socket.on("updatePlayers", (players) => {
  Object.keys(players).forEach((id) => {
    if (id === socket.id) return; // 自分は無視

    if (!remotePlayers[id]) {
      // まだいないプレイヤーなら作成
      createRemotePlayer(id);
    } else {
      // すでにいるプレイヤーなら座標と角度を更新
      const p = players[id];
      const remote = remotePlayers[id];
      if (remote.model) {
        remote.model.position.set(p.x, p.y, p.z);
        remote.model.rotation.y = p.yaw;
        // アニメーションの切り替え（簡易版）
        // if (p.action !== remote.currentAction) { ... fadeToAction ... }
      }
    }
  });
});

// 誰かがいなくなった時
socket.on("removePlayer", (id) => {
  if (remotePlayers[id]) {
    scene.remove(remotePlayers[id].model);
    delete remotePlayers[id];
  }
});

// --- 入力イベント ---
window.addEventListener('keydown', (e) => keys[e.code] = true);
window.addEventListener('keyup', (e) => keys[e.code] = false);
window.addEventListener('mousedown', (e) => { if (e.button === 2) isRightMBDown = true; });
window.addEventListener('mouseup', (e) => { if (e.button === 2) isRightMBDown = false; });
let isRightMBDown = false;
window.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('mousemove', (e) => {
  if (isRightMBDown) {
    const sensitivity = 0.002;
    yaw -= e.movementX * sensitivity;
    pitch -= e.movementY * sensitivity;
    pitch = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, pitch));
  }
});

// --- ループ処理 ---
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  if (mixer) mixer.update(delta);

  Object.values(remotePlayers).forEach(p => {
    if (p.mixer) p.mixer.update(delta);
  });

  if (model) {
    const moveSpeed = 0.15;
    let inputX = 0;
    let inputZ = 0;
    if (keys['KeyW']) inputZ -= 1;
    if (keys['KeyS']) inputZ += 1;
    if (keys['KeyA']) inputX -= 1;
    if (keys['KeyD']) inputX += 1;

    socket.emit("move", {
      x: model.position.x,
      y: model.position.y,
      z: model.position.z,
      yaw: model.rotation.y, // モデルの今の向きを送る
      action: activeAction === actions['walk'] ? 'walk' : 'idle'
    })

    if (inputX !== 0 || inputZ !== 0) {
      // 移動中：Walkへ
      fadeToAction('walk');

      const angle = Math.atan2(inputX, inputZ) + yaw;
      const targetQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
      model.quaternion.slerp(targetQuaternion, 0.15);

      model.position.x += Math.sin(angle) * moveSpeed;
      model.position.z += Math.cos(angle) * moveSpeed;
    } else {
      // 停止中：Idleへ
      fadeToAction('idle');
    }

    // 三人称カメラ追従
    const distance = 8; 
    camera.position.x = model.position.x + distance * Math.sin(yaw) * Math.cos(pitch);
    camera.position.y = model.position.y + distance * Math.sin(pitch) + 100
    camera.position.z = model.position.z + distance * Math.cos(yaw) * Math.cos(pitch);
    camera.lookAt(model.position.x, model.position.y + 1, model.position.z);
  }
  renderer.render(scene, camera);
}
animate();
