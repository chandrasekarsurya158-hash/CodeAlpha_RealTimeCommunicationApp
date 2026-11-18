// In-memory state for rooms and whiteboard
const rooms = {}; // roomId -> { [socketId]: { socketId, user, isAudioMuted, isVideoOff, isScreenSharing } }
const whiteboardHistory = {}; // roomId -> [ strokeData ]

function initSignaling(io) {
  io.on('connection', (socket) => {
    let currentRoomId = null;
    let currentUser = null;

    // Helper to sanitize room ID (e.g. "571 ia1f" -> "571-1a1f")
    const sanitizeRoom = (id) => String(id || 'general').trim().toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');

    // --- 1. WebRTC & Room Management ---
    socket.on('join-room', ({ roomId, user }) => {
      const cleanRoom = sanitizeRoom(roomId);
      currentRoomId = cleanRoom;

      socket.join(cleanRoom);

      if (!rooms[cleanRoom]) {
        rooms[cleanRoom] = {};
      }

      // Ensure user profile is valid and unique per tab
      let peerUser = user ? { ...user } : { id: 'usr_' + socket.id.substring(0, 5), name: 'Guest_' + socket.id.substring(0, 4) };

      // If the same user ID joins twice (e.g. 2 tabs on the same laptop), differentiate them so both can join!
      const existingUserWithSameId = Object.values(rooms[cleanRoom]).find(
        (p) => p.user && p.user.id === peerUser.id && p.socketId !== socket.id
      );
      if (existingUserWithSameId) {
        peerUser.id = peerUser.id + '_' + socket.id.substring(0, 4);
        peerUser.name = peerUser.name + ' (Tab 2)';
      }

      // First person to enter/create the room is the HOST; anyone joining after is a MEMBER
      const isFirstUser = Object.keys(rooms[cleanRoom]).length === 0;
      peerUser.isHost = isFirstUser;
      peerUser.role = isFirstUser ? 'Host' : 'Member';
      currentUser = peerUser;

      // Collect existing participants to send to the newly joined peer
      const existingParticipants = Object.values(rooms[cleanRoom]);

      // Add new peer to room registry
      rooms[cleanRoom][socket.id] = {
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
      socket.to(cleanRoom).emit('user-joined', {
        socketId: socket.id,
        user: currentUser
      });

      // 3. Send current whiteboard history to the new user
      if (whiteboardHistory[cleanRoom] && whiteboardHistory[cleanRoom].length > 0) {
        socket.emit('whiteboard-sync-history', whiteboardHistory[cleanRoom]);
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
      const clean = sanitizeRoom(roomId);
      if (rooms[clean] && rooms[clean][socket.id]) {
        rooms[clean][socket.id].isAudioMuted = isAudioMuted;
        rooms[clean][socket.id].isVideoOff = isVideoOff;
        rooms[clean][socket.id].isScreenSharing = isScreenSharing;

        socket.to(clean).emit('peer-media-state', {
          socketId: socket.id,
          isAudioMuted,
          isVideoOff,
          isScreenSharing
        });
      }
    });

    // --- 2. Collaborative Whiteboard ---
    socket.on('whiteboard-draw', ({ roomId, drawData }) => {
      const clean = sanitizeRoom(roomId);
      if (!clean || !drawData) return;
      if (!whiteboardHistory[clean]) {
        whiteboardHistory[clean] = [];
      }

      if (whiteboardHistory[clean].length > 5000) {
        whiteboardHistory[clean].shift();
      }
      whiteboardHistory[clean].push(drawData);

      socket.to(clean).emit('whiteboard-draw', drawData);
    });

    socket.on('whiteboard-clear', ({ roomId }) => {
      const clean = sanitizeRoom(roomId);
      if (!clean) return;
      whiteboardHistory[clean] = [];
      io.to(clean).emit('whiteboard-clear');
    });

    socket.on('whiteboard-request-sync', ({ roomId }) => {
      const clean = sanitizeRoom(roomId);
      if (clean && whiteboardHistory[clean]) {
        socket.emit('whiteboard-sync-history', whiteboardHistory[clean]);
      }
    });

    // --- 3. In-Room Chat & File Broadcast ---
    socket.on('chat-message', ({ roomId, message, user, timestamp }) => {
      const clean = sanitizeRoom(roomId);
      if (!clean) return;
      io.to(clean).emit('chat-message', {
        id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        user: user || currentUser,
        message,
        timestamp: timestamp || new Date().toISOString()
      });
    });

    socket.on('file-shared', ({ roomId, file }) => {
      const clean = sanitizeRoom(roomId);
      if (!clean || !file) return;
      io.to(clean).emit('file-shared', {
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
