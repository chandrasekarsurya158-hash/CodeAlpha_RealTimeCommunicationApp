// In-memory state for rooms and whiteboard
const rooms = {}; // roomId -> { [socketId]: { socketId, user, isAudioMuted, isVideoOff, isScreenSharing } }
const whiteboardHistory = {}; // roomId -> [ strokeData ]

function initSignaling(io) {
  io.on('connection', (socket) => {
    let currentRoomId = null;
    let currentUser = null;

    // --- 1. WebRTC & Room Management ---
    socket.on('join-room', ({ roomId, user }) => {
      currentRoomId = roomId;
      currentUser = user || { id: socket.id, name: 'Guest_' + socket.id.substring(0, 4) };

      socket.join(roomId);

      if (!rooms[roomId]) {
        rooms[roomId] = {};
      }

      // First person to enter/create the room is the HOST; anyone joining after is a MEMBER
      const isFirstUser = Object.keys(rooms[roomId]).length === 0;
      currentUser.isHost = isFirstUser;
      currentUser.role = isFirstUser ? 'Host' : 'Member';

      // Collect existing participants to send to the newly joined peer
      const existingParticipants = Object.values(rooms[roomId]);

      // Add new peer to room registry
      rooms[roomId][socket.id] = {
        socketId: socket.id,
        user: currentUser,
        isAudioMuted: false,
        isVideoOff: false,
        isScreenSharing: false,
        joinedAt: new Date().toISOString()
      };

      // 1. Inform the new user about their role and existing peers
      socket.emit('room-joined', {
        isHost: isFirstUser,
        role: isFirstUser ? 'Host' : 'Member',
        selfUser: currentUser
      });

      socket.emit('all-users', {
        users: existingParticipants,
        selfSocketId: socket.id
      });

      // 2. Broadcast to all other peers in the room that a new user joined
      socket.to(roomId).emit('user-joined', {
        socketId: socket.id,
        user: currentUser
      });

      // 3. Send current whiteboard history to the new user
      if (whiteboardHistory[roomId] && whiteboardHistory[roomId].length > 0) {
        socket.emit('whiteboard-sync-history', whiteboardHistory[roomId]);
      }
    });

    // Relay WebRTC signaling messages (Offer, Answer, ICE candidates)
    socket.on('signal', ({ to, signalData }) => {
      io.to(to).emit('signal', {
        from: socket.id,
        signalData,
        user: currentUser
      });
    });

    // Media state toggles (mic muted, camera off, screen share)
    socket.on('media-state-changed', ({ roomId, isAudioMuted, isVideoOff, isScreenSharing }) => {
      if (rooms[roomId] && rooms[roomId][socket.id]) {
        rooms[roomId][socket.id].isAudioMuted = isAudioMuted;
        rooms[roomId][socket.id].isVideoOff = isVideoOff;
        rooms[roomId][socket.id].isScreenSharing = isScreenSharing;

        socket.to(roomId).emit('peer-media-state', {
          socketId: socket.id,
          isAudioMuted,
          isVideoOff,
          isScreenSharing
        });
      }
    });

    // --- 2. Collaborative Whiteboard ---
    socket.on('whiteboard-draw', ({ roomId, drawData }) => {
      if (!roomId || !drawData) return;
      if (!whiteboardHistory[roomId]) {
        whiteboardHistory[roomId] = [];
      }

      // Limit history to last 5000 strokes to prevent unbounded memory growth
      if (whiteboardHistory[roomId].length > 5000) {
        whiteboardHistory[roomId].shift();
      }
      whiteboardHistory[roomId].push(drawData);

      // Relay to all peers in the room except sender
      socket.to(roomId).emit('whiteboard-draw', drawData);
    });

    socket.on('whiteboard-clear', ({ roomId }) => {
      if (!roomId) return;
      whiteboardHistory[roomId] = [];
      // Notify everyone in the room (including sender) to clear
      io.to(roomId).emit('whiteboard-clear');
    });

    socket.on('whiteboard-request-sync', ({ roomId }) => {
      if (roomId && whiteboardHistory[roomId]) {
        socket.emit('whiteboard-sync-history', whiteboardHistory[roomId]);
      }
    });

    // --- 3. In-Room Chat & File Broadcast ---
    socket.on('chat-message', ({ roomId, message, user, timestamp }) => {
      if (!roomId) return;
      io.to(roomId).emit('chat-message', {
        id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        user: user || currentUser,
        message,
        timestamp: timestamp || new Date().toISOString()
      });
    });

    socket.on('file-shared', ({ roomId, file }) => {
      if (!roomId || !file) return;
      io.to(roomId).emit('file-shared', {
        file,
        sharedBy: currentUser,
        timestamp: new Date().toISOString()
      });
    });

    // --- 4. Disconnect & Leave Room ---
    const handleLeave = () => {
      if (currentRoomId && rooms[currentRoomId] && rooms[currentRoomId][socket.id]) {
        const wasHost = rooms[currentRoomId][socket.id].user?.isHost;
        delete rooms[currentRoomId][socket.id];

        // Notify other room members
        socket.to(currentRoomId).emit('user-left', {
          socketId: socket.id,
          user: currentUser
        });

        const remaining = Object.values(rooms[currentRoomId]);
        if (remaining.length > 0) {
          // If the host left, pass host status to the next member
          if (wasHost) {
            remaining[0].user.isHost = true;
            remaining[0].user.role = 'Host';
            io.to(currentRoomId).emit('host-changed', {
              newHostSocketId: remaining[0].socketId,
              newHostUser: remaining[0].user
            });
          }
        } else {
          delete rooms[currentRoomId];
          delete whiteboardHistory[currentRoomId];
        }
      }
    };

    socket.on('leave-room', handleLeave);
    socket.on('disconnect', handleLeave);
  });
}

module.exports = { initSignaling };
