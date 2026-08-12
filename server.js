const path = require('path');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const httpServer = require('http').createServer(app);
const io = new Server(httpServer);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  socket.on('join-room', ({ roomId, name }) => {
    const safeRoom = String(roomId || '').trim().slice(0, 40);
    const safeName = String(name || 'Visitante').trim().slice(0, 24) || 'Visitante';
    if (!safeRoom) return socket.emit('app-error', 'Informe o código da sala.');

    socket.join(safeRoom);
    socket.data.roomId = safeRoom;
    socket.data.name = safeName;

    const peers = [...(io.sockets.adapter.rooms.get(safeRoom) || [])]
      .filter((id) => id !== socket.id)
      .map((id) => ({ id, name: io.sockets.sockets.get(id)?.data.name || 'Visitante' }));

    socket.emit('room-joined', { roomId: safeRoom, peers });
    socket.to(safeRoom).emit('peer-joined', { id: socket.id, name: safeName });
  });

  socket.on('signal', ({ target, data }) => {
    if (target) io.to(target).emit('signal', { from: socket.id, data, name: socket.data.name });
  });

  socket.on('disconnecting', () => {
    if (socket.data.roomId) {
      socket.to(socket.data.roomId).emit('peer-left', { id: socket.id, name: socket.data.name });
    }
  });
});

function startServer(port = PORT) {
  return new Promise((resolve) => {
    httpServer.listen(port, '127.0.0.1', () => {
      const address = httpServer.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      console.log(`VoiceUp aberto em http://localhost:${actualPort}`);
      resolve(actualPort);
    });
  });
}

if (require.main === module) startServer();

module.exports = { startServer, httpServer };
