const { Server } = require("socket.io");

// 3000番ポートでサーバーを起動
const io = new Server(3000, {
  cors: {
    origin: "*", // どこからの接続も許可
  },
});

const players = {}; // 全プレイヤーの座標を保存

io.on("connection", (socket) => {
  console.log("誰かが接続しました:", socket.id);

  // 新しいプレイヤーを登録
  players[socket.id] = { x: 0, y: 0, z: 0, yaw: 0, action: 'idle' };

  // 全員に現在のプレイヤー一覧を送る
  io.emit("updatePlayers", players);

  // 誰かが動いた時
  socket.on("move", (data) => {
    if (players[socket.id]) {
      players[socket.id] = data;
      // 自分以外に「この人動いたよ」と伝える
      socket.broadcast.emit("updatePlayers", players);
    }
  });

  // 誰かが切断した時
  socket.on("disconnect", () => {
    delete players[socket.id];
    io.emit("removePlayer", socket.id);
    console.log("誰かが去りました:", socket.id);
  });
});

console.log("サーバーがポート3000で起動しました！");