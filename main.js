import { io } from "socket.io-client";
const socket = io("https://imori-server.onrender.com")

const remotePlayers = {}; // 他人のモデルを保存するオブジェクト

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// --- 設定 ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(5, 10, 7.5);
scene.add(light, new THREE.AmbientLight(0xffffff, 0.7), new THREE.GridHelper(200, 50));


// --- フィールドの見た目変更（真っ白空間Ver.） ---

// 1. 背景を真っ白にする
scene.background = new THREE.Color(0xffffff); 

// 2. 霧（フォグ）を追加して遠くを白く飛ばす
scene.fog = new THREE.Fog(0xffffff, 10, 50);

// 3. 地面も「白」にする
const floorGeometry = new THREE.PlaneGeometry(1000, 1000); 
const floorMaterial = new THREE.MeshStandardMaterial({ 
    color: 0xffffff, // ここを 0xffffff に！
    roughness: 1.0 
});
const floor = new THREE.Mesh(floorGeometry, floorMaterial);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

// 4. グリッドは一旦消す（もし線が欲しければコメントアウトを外してね）
// scene.add(new THREE.GridHelper(200, 50, 0xcccccc, 0xeeeeee)); 

// --- 変数 ---
let model, mixer;
const actions = {};    // アニメーション保存用
let activeAction;      // 現在のアクション
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
    if (id === socket.id) return;

    if (!remotePlayers[id]) {
      createRemotePlayer(id);
    } else {
      const p = players[id];
      const remote = remotePlayers[id];
      if (remote.model) {
        // 直接 set せずに、目標地点（targetPos）として保存する
        remote.targetPos = new THREE.Vector3(p.x, p.y, p.z);
        remote.model.rotation.y = p.yaw;
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
    
    // 目標地点がある場合、じわじわ近づける（補間処理）
    if (p.model && p.targetPos) {
      p.model.position.lerp(p.targetPos, 0.2); // 0.2は近づくスピード（0.1〜0.3で調整）
    }
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

// --- 当たり判定（強化版） ---
    Object.values(remotePlayers).forEach(remote => {
      if (remote.model) {
        const d = model.position.distanceTo(remote.model.position); // 名前を 'd' にして衝突回避
        const minDistance = 1.8; 

        if (d < minDistance) {
          const direction = new THREE.Vector3()
            .subVectors(model.position, remote.model.position)
            .normalize();
          
          const overlap = minDistance - d;
          
          model.position.x += direction.x * overlap;
          model.position.z += direction.z * overlap;
          
          inputX = 0;
          inputZ = 0;
        }
      }
    }); // ← ここで forEach を閉じる！

    // 三人称カメラ追従
    const camDist = 8; // 名前を 'camDist' にすると安全！
    camera.position.x = model.position.x + camDist * Math.sin(yaw) * Math.cos(pitch);
    camera.position.y = model.position.y + camDist * Math.sin(pitch) + 3;
    camera.position.z = model.position.z + camDist * Math.cos(yaw) * Math.cos(pitch);
    camera.lookAt(model.position.x, model.position.y + 1, model.position.z);
  } // ← ここで if(model) を閉じる

  renderer.render(scene, camera);
} // ← ここで animate 関数を閉じる

animate();