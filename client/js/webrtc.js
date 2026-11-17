// WebRTC Peer-to-Peer Mesh Manager
class WebRTCManager {
  constructor({ socket, roomId, currentUser, onParticipantChange }) {
    this.socket = socket;
    this.roomId = roomId;
    this.currentUser = currentUser;
    this.onParticipantChange = onParticipantChange;

    this.localStream = null;
    this.screenStream = null;
    this.peerConnections = {}; // socketId -> RTCPeerConnection
    this.peerProfiles = {}; // socketId -> user profile

    this.isAudioMuted = false;
    this.isVideoOff = false;
    this.isScreenSharing = false;

    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ]
    };
  }

  // 1. Initialize Local Media Stream
  async initLocalStream() {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true
      });

      const localVideo = document.getElementById('localVideo');
      if (localVideo) {
        localVideo.srcObject = this.localStream;
      }
      return this.localStream;
    } catch (error) {
      console.warn('Could not access camera/mic, falling back to dummy/audio stream:', error);
      // Fallback: create empty audio track or alert user
      alert('Camera or Microphone access was denied or not found. You will join in view-only mode.');
      this.localStream = new MediaStream();
      return this.localStream;
    }
  }

  // 2. Set up Socket Signaling Listeners
  setupSignaling() {
    // When we join, server returns all existing users in the room
    this.socket.on('all-users', async ({ users }) => {
      for (const peer of users) {
        this.peerProfiles[peer.socketId] = peer.user;
        // Create an offer to each existing peer
        await this.createPeerConnection(peer.socketId, true);
      }
      this.updateParticipantCount();
    });

    // When another user joins after us
    this.socket.on('user-joined', ({ socketId, user }) => {
      this.peerProfiles[socketId] = user;
      this.updateParticipantCount();
      if (window.showToast) {
        window.showToast(`${user.name || 'A participant'} joined the call`);
      }
    });

    // Relay for SDP Offers, Answers, and ICE candidates
    this.socket.on('signal', async ({ from, signalData, user }) => {
      if (user) {
        this.peerProfiles[from] = user;
      }

      let pc = this.peerConnections[from];
      if (!pc) {
        pc = await this.createPeerConnection(from, false);
      }

      try {
        if (signalData.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(signalData.sdp));

          if (signalData.sdp.type === 'offer') {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            this.socket.emit('signal', {
              to: from,
              signalData: { sdp: pc.localDescription }
            });
          }
        } else if (signalData.candidate) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(signalData.candidate));
          } catch (e) {
            console.error('Error adding ICE candidate:', e);
          }
        }
      } catch (err) {
        console.error('Signaling processing error:', err);
      }
    });

    // Peer media state update (muted, camera off, screenshare)
    this.socket.on('peer-media-state', ({ socketId, isAudioMuted, isVideoOff, isScreenSharing }) => {
      const card = document.getElementById(`video-card-${socketId}`);
      if (card) {
        card.classList.toggle('video-off', isVideoOff);
        const micBadge = card.querySelector('.mic-badge');
        if (micBadge) {
          micBadge.classList.toggle('muted', isAudioMuted);
          micBadge.innerHTML = isAudioMuted ? '🔇' : '🎤';
        }
        const screenBadge = card.querySelector('.screen-share-badge');
        if (screenBadge) {
          screenBadge.style.display = isScreenSharing ? 'block' : 'none';
        }
      }
    });

    // Peer left
    this.socket.on('user-left', ({ socketId, user }) => {
      this.removePeer(socketId);
      const name = user ? user.name : 'A participant';
      if (window.showToast) {
        window.showToast(`${name} left the call`);
      }
    });
  }

  // 3. Create Peer Connection & Bind Events
  async createPeerConnection(peerSocketId, isInitiator) {
    if (this.peerConnections[peerSocketId]) {
      return this.peerConnections[peerSocketId];
    }

    const pc = new RTCPeerConnection(this.rtcConfig);
    this.peerConnections[peerSocketId] = pc;

    // Add local tracks to peer connection
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        pc.addTrack(track, this.localStream);
      });
    }

    // ICE Candidate generation
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('signal', {
          to: peerSocketId,
          signalData: { candidate: event.candidate }
        });
      }
    };

    // Remote Track received
    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      this.renderRemoteVideo(peerSocketId, remoteStream);
    };

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.removePeer(peerSocketId);
      }
    };

    // If initiator, generate SDP offer
    if (isInitiator) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        this.socket.emit('signal', {
          to: peerSocketId,
          signalData: { sdp: pc.localDescription }
        });
      } catch (err) {
        console.error('Error creating offer for peer:', err);
      }
    }

    return pc;
  }

  // 4. Render Remote Video Tile in Grid
  renderRemoteVideo(peerSocketId, stream) {
    const videoGrid = document.getElementById('videoGrid');
    if (!videoGrid) return;

    let card = document.getElementById(`video-card-${peerSocketId}`);
    const peerUser = this.peerProfiles[peerSocketId] || { name: 'Participant' };
    const initial = peerUser.name.charAt(0).toUpperCase();

    if (!card) {
      card = document.createElement('div');
      card.id = `video-card-${peerSocketId}`;
      card.className = 'video-card';

      card.innerHTML = `
        <video id="video-${peerSocketId}" autoplay playsinline></video>
        <div class="avatar-fallback">
          <div class="avatar-circle">${initial}</div>
          <span style="font-size:0.9rem; font-weight:600;">${peerUser.name}</span>
        </div>
        <div class="screen-share-badge" style="display:none;">🖥️ Presenting Screen</div>
        <div class="video-meta">
          <div class="user-name-badge">
            <span>${peerUser.name}</span>
          </div>
          <div class="mic-badge">🎤</div>
        </div>
      `;
      videoGrid.appendChild(card);
      this.updateGridLayout();
    }

    const videoEl = card.querySelector('video');
    if (videoEl && videoEl.srcObject !== stream) {
      videoEl.srcObject = stream;
    }
  }

  // 5. Remove Peer
  removePeer(peerSocketId) {
    if (this.peerConnections[peerSocketId]) {
      this.peerConnections[peerSocketId].close();
      delete this.peerConnections[peerSocketId];
    }
    delete this.peerProfiles[peerSocketId];

    const card = document.getElementById(`video-card-${peerSocketId}`);
    if (card) {
      card.remove();
      this.updateGridLayout();
    }
    this.updateParticipantCount();
  }

  // 6. Audio Toggle
  toggleAudio() {
    if (!this.localStream) return false;
    this.isAudioMuted = !this.isAudioMuted;
    this.localStream.getAudioTracks().forEach((track) => {
      track.enabled = !this.isAudioMuted;
    });

    const localMicBadge = document.getElementById('localMicBadge');
    if (localMicBadge) {
      localMicBadge.classList.toggle('muted', this.isAudioMuted);
      localMicBadge.innerHTML = this.isAudioMuted ? '🔇' : '🎤';
    }

    this.socket.emit('media-state-changed', {
      roomId: this.roomId,
      isAudioMuted: this.isAudioMuted,
      isVideoOff: this.isVideoOff,
      isScreenSharing: this.isScreenSharing
    });

    return !this.isAudioMuted;
  }

  // 7. Video Toggle
  toggleVideo() {
    if (!this.localStream) return false;
    this.isVideoOff = !this.isVideoOff;
    this.localStream.getVideoTracks().forEach((track) => {
      track.enabled = !this.isVideoOff;
    });

    const localVideoCard = document.getElementById('localVideoCard');
    if (localVideoCard) {
      localVideoCard.classList.toggle('video-off', this.isVideoOff);
    }

    this.socket.emit('media-state-changed', {
      roomId: this.roomId,
      isAudioMuted: this.isAudioMuted,
      isVideoOff: this.isVideoOff,
      isScreenSharing: this.isScreenSharing
    });

    return !this.isVideoOff;
  }

  // 8. Screen Sharing via getDisplayMedia
  async toggleScreenShare() {
    if (!this.isScreenSharing) {
      try {
        this.screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: 'always' },
          audio: false
        });

        const screenTrack = this.screenStream.getVideoTracks()[0];

        // Replace track on all active peer connections
        for (const socketId in this.peerConnections) {
          const pc = this.peerConnections[socketId];
          const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
          if (sender) {
            await sender.replaceTrack(screenTrack);
          }
        }

        // Display screen track on local video tile
        const localVideo = document.getElementById('localVideo');
        if (localVideo) {
          localVideo.srcObject = this.screenStream;
          localVideo.classList.add('screen-sharing');
        }

        const localScreenBadge = document.getElementById('localScreenBadge');
        if (localScreenBadge) {
          localScreenBadge.style.display = 'block';
        }

        this.isScreenSharing = true;

        // When user stops sharing from browser chrome bar
        screenTrack.onended = () => {
          this.stopScreenSharing();
        };

        this.socket.emit('media-state-changed', {
          roomId: this.roomId,
          isAudioMuted: this.isAudioMuted,
          isVideoOff: this.isVideoOff,
          isScreenSharing: true
        });

        return true;
      } catch (err) {
        console.warn('Screen sharing cancelled or error:', err);
        return false;
      }
    } else {
      this.stopScreenSharing();
      return false;
    }
  }

  async stopScreenSharing() {
    if (!this.isScreenSharing) return;

    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
    }

    // Revert back to local webcam video track
    const camTrack = this.localStream ? this.localStream.getVideoTracks()[0] : null;

    for (const socketId in this.peerConnections) {
      const pc = this.peerConnections[socketId];
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
      if (sender && camTrack) {
        await sender.replaceTrack(camTrack);
      }
    }

    const localVideo = document.getElementById('localVideo');
    if (localVideo && this.localStream) {
      localVideo.srcObject = this.localStream;
      localVideo.classList.remove('screen-sharing');
    }

    const localScreenBadge = document.getElementById('localScreenBadge');
    if (localScreenBadge) {
      localScreenBadge.style.display = 'none';
    }

    this.isScreenSharing = false;

    // Update screen share button UI state if present
    const btnScreen = document.getElementById('btnToggleScreen');
    if (btnScreen) {
      btnScreen.classList.remove('active');
    }

    this.socket.emit('media-state-changed', {
      roomId: this.roomId,
      isAudioMuted: this.isAudioMuted,
      isVideoOff: this.isVideoOff,
      isScreenSharing: false
    });
  }

  // 9. Update Layout and Count
  updateGridLayout() {
    const videoGrid = document.getElementById('videoGrid');
    if (!videoGrid) return;

    const cards = videoGrid.querySelectorAll('.video-card');
    const count = Math.min(cards.length, 9);
    videoGrid.setAttribute('data-count', count.toString());
  }

  updateParticipantCount() {
    const totalCount = Object.keys(this.peerProfiles).length + 1; // peers + self
    if (this.onParticipantChange) {
      this.onParticipantChange(totalCount, this.peerProfiles);
    }
  }

  // 10. Clean up everything on call exit
  destroy() {
    this.stopScreenSharing();
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
    for (const id in this.peerConnections) {
      this.peerConnections[id].close();
    }
    this.peerConnections = {};
  }
}
