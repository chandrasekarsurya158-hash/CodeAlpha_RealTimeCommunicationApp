// Room Controller & Orchestrator
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Toast Notification Helper
  const toastContainer = document.getElementById('toastContainer');
  window.showToast = function (message, duration = 3500) {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span>ℹ️</span><span>${message}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  };

  // 2. Extract Room ID from Query Parameter
  const urlParams = new URLSearchParams(window.location.search);
  const roomId = urlParams.get('roomId') || 'general-meet';

  // 3. Authentication Verification
  let currentUser = API.getCurrentUser();
  const token = API.getToken();

  if (!token || !currentUser) {
    // If not authenticated, redirect to the Google Meet/Zoom style invite pre-join page
    window.location.href = `/?roomId=${encodeURIComponent(roomId)}`;
    return;
  }

  function shortId(id) {
    if (!id) return '';
    const parts = String(id).split('_');
    if (parts.length > 2) {
      return parts[parts.length - 1];
    }
    return String(id).substring(0, 8);
  }

  const myShortId = shortId(currentUser.id);

  // Display Room ID and My User ID on Header
  const roomIdDisplay = document.getElementById('roomIdDisplay');
  if (roomIdDisplay) roomIdDisplay.textContent = roomId;

  const myIdDisplay = document.getElementById('myIdDisplay');
  if (myIdDisplay) myIdDisplay.textContent = myShortId;

  const localUserNameTag = document.getElementById('localUserNameTag');
  if (localUserNameTag) localUserNameTag.textContent = `${currentUser.name} (You)`;

  const localUserIdTag = document.getElementById('localUserIdTag');
  if (localUserIdTag) localUserIdTag.textContent = `ID: ${myShortId}`;

  const localAvatarInitial = document.getElementById('localAvatarInitial');
  if (localAvatarInitial) localAvatarInitial.textContent = currentUser.name.charAt(0).toUpperCase();

  // 4. Copy Room Code & Invite Link Handlers
  const btnCopyRoomId = document.getElementById('btnCopyRoomId');
  if (btnCopyRoomId) {
    btnCopyRoomId.addEventListener('click', () => {
      navigator.clipboard.writeText(roomId);
      window.showToast('Room Code copied to clipboard!');
    });
  }

  const btnCopyInviteLink = document.getElementById('btnCopyInviteLink');
  if (btnCopyInviteLink) {
    btnCopyInviteLink.addEventListener('click', () => {
      const inviteUrl = `${window.location.origin}/?roomId=${encodeURIComponent(roomId)}`;
      navigator.clipboard.writeText(inviteUrl);
      window.showToast('Invite link copied! Send it to participants.');
    });
  }

  // 5. Initialize Socket.io Connection
  const socket = io({
    transports: ['websocket', 'polling']
  });

  // 6. Initialize WebRTC Mesh Manager
  const participantsList = document.getElementById('participantsList');
  const participantCountPill = document.getElementById('participantCountPill');

  const onParticipantChange = (count, peerProfiles) => {
    if (participantCountPill) {
      participantCountPill.textContent = `${count} ${count === 1 ? 'person' : 'people'}`;
    }

    if (participantsList) {
      participantsList.innerHTML = '';

      // Add self
      const selfItem = document.createElement('div');
      selfItem.className = 'participant-item';
      selfItem.innerHTML = `
        <div class="part-info">
          <div class="part-avatar">${currentUser.name.charAt(0).toUpperCase()}</div>
          <div>
            <div class="part-name">${currentUser.name} (You)</div>
            <div class="part-id-sub">ID: ${myShortId}</div>
          </div>
        </div>
        <div class="part-badges">
          <span class="badge badge-primary">Host</span>
        </div>
      `;
      participantsList.appendChild(selfItem);

      // Add other peers
      for (const socketId in peerProfiles) {
        const peer = peerProfiles[socketId];
        const peerShortId = shortId(peer.id || socketId);
        const peerItem = document.createElement('div');
        peerItem.className = 'participant-item';
        peerItem.innerHTML = `
          <div class="part-info">
            <div class="part-avatar" style="background:#8b5cf6;">${peer.name.charAt(0).toUpperCase()}</div>
            <div>
              <div class="part-name">${peer.name}</div>
              <div class="part-id-sub">ID: ${peerShortId}</div>
            </div>
          </div>
          <div class="part-badges">
            <span class="badge badge-success">Participant</span>
          </div>
        `;
        participantsList.appendChild(peerItem);
      }
    }
  };

  const webrtc = new WebRTCManager({
    socket,
    roomId,
    currentUser,
    onParticipantChange
  });

  // Start local camera & microphone
  await webrtc.initLocalStream();

  // Setup WebRTC signaling handlers
  webrtc.setupSignaling();

  // Join the room via socket
  socket.emit('join-room', {
    roomId,
    user: currentUser
  });

  // 7. Initialize Collaborative Whiteboard
  const whiteboard = new WhiteboardManager({
    socket,
    roomId
  });

  // 8. Initialize In-Call Chat & File Sharing
  const chatAndFiles = new ChatAndFileManager({
    socket,
    roomId,
    currentUser
  });

  // 9. UI Controls (Bottom Dock)
  const btnToggleMic = document.getElementById('btnToggleMic');
  const btnToggleCam = document.getElementById('btnToggleCam');
  const btnToggleScreen = document.getElementById('btnToggleScreen');
  const btnToggleWhiteboard = document.getElementById('btnToggleWhiteboard');
  const btnToggleChat = document.getElementById('btnToggleChat');
  const btnLeaveRoom = document.getElementById('btnLeaveRoom');

  // Mic Toggle
  if (btnToggleMic) {
    btnToggleMic.addEventListener('click', () => {
      const isUnmuted = webrtc.toggleAudio();
      btnToggleMic.classList.toggle('danger-toggle', !isUnmuted);
      btnToggleMic.title = isUnmuted ? 'Mute Microphone' : 'Unmute Microphone';
      btnToggleMic.querySelector('.icon').textContent = isUnmuted ? '🎤' : '🔇';
    });
  }

  // Camera Toggle
  if (btnToggleCam) {
    btnToggleCam.addEventListener('click', () => {
      const isVideoOn = webrtc.toggleVideo();
      btnToggleCam.classList.toggle('danger-toggle', !isVideoOn);
      btnToggleCam.title = isVideoOn ? 'Turn Off Camera' : 'Turn On Camera';
      btnToggleCam.querySelector('.icon').textContent = isVideoOn ? '📹' : '🚫';

      const localCard = document.getElementById('localVideoCard');
      if (localCard) {
        localCard.classList.toggle('has-video', isVideoOn);
        localCard.classList.toggle('video-off', !isVideoOn);
      }
    });
  }

  // Screen Share Toggle
  if (btnToggleScreen) {
    btnToggleScreen.addEventListener('click', async () => {
      const isSharing = await webrtc.toggleScreenShare();
      btnToggleScreen.classList.toggle('active', isSharing);
      btnToggleScreen.title = isSharing ? 'Stop Presenting' : 'Share Screen';
    });
  }

  // Whiteboard Modal Toggle
  const whiteboardOverlay = document.getElementById('whiteboardOverlay');
  const btnCloseWhiteboard = document.getElementById('btnCloseWhiteboard');

  const toggleWhiteboard = () => {
    const isActive = whiteboardOverlay.classList.toggle('active');
    btnToggleWhiteboard.classList.toggle('active', isActive);
    if (isActive) {
      window.dispatchEvent(new Event('resize'));
    }
  };

  if (btnToggleWhiteboard) btnToggleWhiteboard.addEventListener('click', toggleWhiteboard);
  if (btnCloseWhiteboard) btnCloseWhiteboard.addEventListener('click', toggleWhiteboard);

  // Side Drawer (Chat / Files / Participants) Toggle
  const sideDrawer = document.getElementById('sideDrawer');
  const btnCloseDrawer = document.getElementById('btnCloseDrawer');

  const toggleDrawer = () => {
    const isCollapsed = sideDrawer.classList.toggle('collapsed');
    btnToggleChat.classList.toggle('active', !isCollapsed);
    chatAndFiles.setDrawerOpen(!isCollapsed);
  };

  if (btnToggleChat) btnToggleChat.addEventListener('click', toggleDrawer);
  if (btnCloseDrawer) btnCloseDrawer.addEventListener('click', toggleDrawer);

  // Drawer Tabs Switching (Chat, Files, Participants)
  const drawerTabs = document.querySelectorAll('.drawer-tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');

  drawerTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      drawerTabs.forEach((t) => t.classList.remove('active'));
      tabPanes.forEach((p) => p.classList.remove('active'));

      tab.classList.add('active');
      const target = tab.getAttribute('data-target');
      const targetPane = document.getElementById(target);
      if (targetPane) targetPane.classList.add('active');
    });
  });

  // Leave Room
  if (btnLeaveRoom) {
    btnLeaveRoom.addEventListener('click', () => {
      if (confirm('Are you sure you want to leave this call?')) {
        socket.emit('leave-room');
        webrtc.destroy();
        window.location.href = '/';
      }
    });
  }

  // 10. Call Duration Timer
  const callTimer = document.getElementById('callTimer');
  let secondsElapsed = 0;
  setInterval(() => {
    secondsElapsed++;
    const hrs = Math.floor(secondsElapsed / 3600);
    const mins = Math.floor((secondsElapsed % 3600) / 60);
    const secs = secondsElapsed % 60;

    const formatted = [
      hrs > 0 ? String(hrs).padStart(2, '0') : null,
      String(mins).padStart(2, '0'),
      String(secs).padStart(2, '0')
    ].filter(Boolean).join(':');

    if (callTimer) callTimer.textContent = formatted;
  }, 1000);

  // Window unload cleanup
  window.addEventListener('beforeunload', () => {
    socket.emit('leave-room');
    webrtc.destroy();
  });
});
