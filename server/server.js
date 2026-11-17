const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const fileRoutes = require('./routes/files');
const { initSignaling } = require('./socket/signaling');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend from client folder
const clientPath = path.join(__dirname, '..', 'client');
app.use(express.static(clientPath));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/files', fileRoutes);

// Socket.io initialization with CORS
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  maxHttpBufferSize: 1e8 // 100 MB buffer for data transfers
});

// Initialize WebRTC, Whiteboard, and Realtime signaling
initSignaling(io);

// Friendly route handlers
app.get('/room', (req, res) => {
  res.sendFile(path.join(clientPath, 'room.html'));
});

app.get('*', (req, res) => {
  // If the path does not match an API route or static asset, return index.html
  res.sendFile(path.join(clientPath, 'index.html'));
});

// Start HTTP & WebSocket Server
server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 Video Conferencing & Collaboration Server running`);
  console.log(`🌐 Local URL: http://localhost:${PORT}`);
  console.log(`📡 WebSocket Signaling: ready`);
  console.log(`=======================================================`);
});
