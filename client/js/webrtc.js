// WebRTC Peer-to-Peer Mesh Manager with Open-Relay TURN Fallback, Robust Screen Share & Audio Engine
class WebRTCManager {
  constructor({ socket, roomId, currentUser, onParticipantChange }) {
    this.socket = socket;
    this.roomId = roomId;
    this.currentUser = currentUser || { id: 'user_' + Date.now(), name: 'Guest' };
    this.onParticipantChange = onParticipantChange;

    this.localStream = null;
    this.screenStream = null;
    this.peerConnections = {}; // socketId -> RTCPeerConnection
    this.peerProfiles = {}; // socketId -> user profile
    this.iceQueues = {}; // socketId -> [ RTCIceCandidate ]
    this.remoteStreams = {}; // socketId -> MediaStream

    this.isAudioMuted = false;
    this.isVideoOff = false;
    this.isScreenSharing = false;

    // Public STUN & Free Open-Relay TURN configuration for cloud deployments (Render, Heroku, AWS)
    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:stun.services.mozilla.com' },
        { urls: 'stun:global.stun.twilio.com:3478' },
        {
          urls: 'turn:openrelay.metered.ca:80',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        },
        {
          urls: 'turn:openrelay.metered.ca:443',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        },
        {
          urls: 'turn:openrelay.metered.ca:443?transport=tcp',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        }
      ],
      iceCandidatePoolSize: 10
    };

    // Unlock audio on any user interaction for browser autoplay compliance
    this.setupAutoplayUnlock();
  }

  // Set up autoplay audio/video unlock listener
  setupAutoplayUnlock() {
    const unlock = () => {
      const banner = document.getElementById('audioUnlockBanner');
      if (banner) banner.style.display = 'none';

      const mediaElements = document.querySelectorAll('video, audio');
      mediaElements.forEach((m) => {
        if (m.paused && m.id !== 'previewVideo') {
          m.play().catch(() => {});
        }
      });
    };

    document.addEventListener('click', unlock, { passive: true });
    document.addEventListener('touchstart', unlock, { passive: true });
    document.addEventListener('keydown', unlock, { passive: true });

    const banner = document.getElementById('audioUnlockBanner');
    if (banner) {
      banner.addEventListener('click', unlock);
    }
  }

  // 1. Initialize Local Media Stream with Multi-Tier Fallbacks (Resolves Laptop Camera/Mic Conflicts)
  async initLocalStream() {
    // Tier 1: Relaxed video + audio
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });
    } catch (err1) {
      console.warn('Standard video+audio failed, trying video only...', err1);
      // Tier 2: Video only (mic unavailable or in use by another app like WhatsApp Web)
      try {
        const vidStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const silentAudio = this.createSilentAudioTrack();
        this.localStream = new MediaStream([...vidStream.getVideoTracks(), silentAudio]);
      } catch (err2) {
        console.warn('Video failed, trying audio only...', err2);
        // Tier 3: Audio only (webcam in use by another tab or laptop driver issue)
        try {
          const audStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const canvasVideo = this.createCanvasVideoTrack(this.currentUser.name);
          this.localStream = new MediaStream([...audStream.getAudioTracks(), canvasVideo]);
        } catch (err3) {
          // Tier 4: Synthetic video & audio (permissions denied)
          console.warn('All hardware access denied, using synthetic stream...', err3);
          const canvasVideo = this.createCanvasVideoTrack(this.currentUser.name);
          const silentAudio = this.createSilentAudioTrack();
          this.localStream = new MediaStream([canvasVideo, silentAudio]);

          if (window.showToast) {
            window.showToast('Camera/Mic blocked. Please allow permissions in browser address bar (🔒 icon).', 6000);
          }
        }
      }
    }

    const localVideo = document.getElementById('localVideo');
    if (localVideo) {
      localVideo.srcObject = this.localStream;
      localVideo.muted = true; // Always mute self to avoid echo
      localVideo.play().catch(() => {});
    }

    const localCard = document.getElementById('localVideoCard');
    if (localCard) {
      localCard.classList.add('has-video');
      localCard.classList.remove('video-off');
    }

    return this.localStream;
  }

  // Generates a 25fps animated avatar video track from HTML5 Canvas
  createCanvasVideoTrack(name) {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    const initial = (name || 'U').charAt(0).toUpperCase();

    let step = 0;
    const draw = () => {
      step += 0.03;
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const radius = 64 + Math.sin(step) * 4;
      const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      grad.addColorStop(0, '#3b82f6');
      grad.addColorStop(1, '#8b5cf6');

      ctx.beginPath();
      ctx.arc(canvas.width / 2, canvas.height / 2 - 14, radius, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.shadowColor = 'rgba(59, 130, 246, 0.5)';
      ctx.shadowBlur = 20;
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.font = 'bold 54px -apple-system, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(initial, canvas.width / 2, canvas.height / 2 - 14);

      ctx.font = '600 18px -apple-system, sans-serif';
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(name || 'Participant', canvas.width / 2, canvas.height / 2 + 75);
    };

    draw();
    setInterval(draw, 40);
    return canvas.captureStream(25).getVideoTracks()[0];
  }

  // Generates a silent Web Audio track
  createSilentAudioTrack() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const dst = ctx.createMediaStreamDestination();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(dst);
      osc.start();
      return dst.stream.getAudioTracks()[0];
    } catch {
      return new MediaStream().getAudioTracks()[0];
    }
  }

  // 2. Set up Socket Signaling Listeners
  setupSignaling() {
    this.socket.on('all-users', async ({ users }) => {
      for (const peer of users) {
        this.peerProfiles[peer.socketId] = peer.user;
        this.renderRemoteVideoCard(peer.socketId, peer.user);
        await this.createPeerConnection(peer.socketId, true);
      }
      this.updateParticipantCount();
    });

    this.socket.on('user-joined', async ({ socketId, user }) => {
      this.peerProfiles[socketId] = user;
      this.renderRemoteVideoCard(socketId, user);
      this.updateParticipantCount();

      if (window.showToast) {
        window.showToast(`${user.name || 'A participant'} (ID: ${this.shortId(user.id)}) joined`);
      }
    });

    this.socket.on('signal', async ({ from, signalData, user }) => {
      if (user) {
        this.peerProfiles[from] = user;
        this.renderRemoteVideoCard(from, user);
      }

      let pc = this.peerConnections[from];
      if (!pc) {
        pc = await this.createPeerConnection(from, false);
      }

      try {
        if (signalData.sdp) {
          const desc = new RTCSessionDescription(signalData.sdp);
          await pc.setRemoteDescription(desc);

          // Flush queued candidates
          if (this.iceQueues[from] && this.iceQueues[from].length > 0) {
            const queue = [...this.iceQueues[from]];
            this.iceQueues[from] = [];
            for (const cand of queue) {
              if (cand && cand.candidate) {
                try {
                  await pc.addIceCandidate(new RTCIceCandidate(cand));
                } catch (e) {
                  console.warn('Error adding queued candidate:', e);
                }
              }
            }
          }

          if (desc.type === 'offer') {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            this.socket.emit('signal', {
              to: from,
              signalData: { sdp: pc.localDescription }
            });
          }
        } else if (signalData.candidate) {
          const cand = signalData.candidate;
          if (!cand || !cand.candidate) return;

          if (pc.remoteDescription && pc.remoteDescription.type) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            } catch (e) {
              console.warn('Error adding ICE candidate:', e);
            }
          } else {
            if (!this.iceQueues[from]) {
              this.iceQueues[from] = [];
            }
            this.iceQueues[from].push(cand);
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
        const videoEl = card.querySelector('video');

        if (isScreenSharing) {
          card.classList.add('has-video');
          card.classList.remove('video-off');
          if (videoEl) {
            videoEl.classList.add('screen-sharing');
            videoEl.play().catch(() => {});
          }
        } else if (isVideoOff) {
          card.classList.remove('has-video');
          card.classList.add('video-off');
        } else {
          card.classList.add('has-video');
          card.classList.remove('video-off');
          if (videoEl) {
            videoEl.classList.remove('screen-sharing');
            videoEl.play().catch(() => {});
          }
        }

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

    this.socket.on('user-left', ({ socketId, user }) => {
      this.removePeer(socketId);
      const name = user ? user.name : 'A participant';
      const uid = user ? this.shortId(user.id) : '';
      if (window.showToast) {
        window.showToast(`${name} (ID: ${uid}) left the call`);
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
    this.iceQueues[peerSocketId] = [];

    // Add local tracks to peer connection
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        pc.addTrack(track, this.localStream);
      });
    }

    // ICE Candidate generation
    pc.onicecandidate = (event) => {
      if (event.candidate && event.candidate.candidate) {
        this.socket.emit('signal', {
          to: peerSocketId,
          signalData: { candidate: event.candidate }
        });
      }
    };

    // Remote Track received
    pc.ontrack = (event) => {
      let remoteStream = event.streams && event.streams[0];
      if (!remoteStream) {
        if (!this.remoteStreams[peerSocketId]) {
          this.remoteStreams[peerSocketId] = new MediaStream();
        }
        this.remoteStreams[peerSocketId].addTrack(event.track);
        remoteStream = this.remoteStreams[peerSocketId];
      } else {
        this.remoteStreams[peerSocketId] = remoteStream;
      }

      this.attachRemoteStream(peerSocketId, remoteStream);
    };

    // Monitor ICE connection state & trigger automatic ICE restart if network changes
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') {
        console.warn(`[ICE] Failed for ${peerSocketId}, attempting automatic restart...`);
        try {
          pc.restartIce();
        } catch {}
      }
    };

    // Track overall connection state
    pc.onconnectionstatechange = () => {
      const statusPill = document.querySelector(`#video-card-${peerSocketId} .status-pill`);
      if (statusPill) {
        if (pc.connectionState === 'connected') {
          statusPill.textContent = 'Live 🟢';
          statusPill.className = 'status-pill connected';
        } else if (pc.connectionState === 'connecting') {
          statusPill.textContent = 'Connecting...';
          statusPill.className = 'status-pill connecting';
        }
      }

      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.removePeer(peerSocketId);
      }
    };

    // If initiator, generate SDP offer
    if (isInitiator) {
      try {
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true
        });
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

  // 4. Render or Update Remote Video Card Tile in Grid
  renderRemoteVideoCard(peerSocketId, user) {
    const videoGrid = document.getElementById('videoGrid');
    if (!videoGrid) return;

    let card = document.getElementById(`video-card-${peerSocketId}`);
    const peerUser = user || this.peerProfiles[peerSocketId] || { name: 'Participant', id: peerSocketId };
    const name = peerUser.name || 'Participant';
    const userIdDisplay = this.shortId(peerUser.id || peerSocketId);
    const initial = name.charAt(0).toUpperCase();

    if (!card) {
      card = document.createElement('div');
      card.id = `video-card-${peerSocketId}`;
      card.className = 'video-card'; // Starts with avatar showing by default until frames arrive

      card.innerHTML = `
        <video id="video-${peerSocketId}" autoplay playsinline></video>
        <div class="avatar-fallback">
          <div class="avatar-circle">${initial}</div>
          <span class="avatar-name" style="font-size:0.95rem; font-weight:600;">${name}</span>
          <span class="avatar-id-badge" style="font-size:0.75rem; color:#94a3b8; font-family:monospace;">ID: ${userIdDisplay}</span>
        </div>
        <div class="screen-share-badge" style="display:none;">🖥️ Presenting Screen</div>
        <div class="connection-status-tag">
          <span class="status-pill connecting">Connecting...</span>
        </div>
        <div class="video-meta">
          <div class="user-name-badge">
            <span class="peer-name">${name}</span>
            <span class="user-id-tag">ID: ${userIdDisplay}</span>
          </div>
          <div class="mic-badge">🎤</div>
        </div>
      `;
      videoGrid.appendChild(card);
      this.updateGridLayout();
    } else {
      const nameEl = card.querySelector('.peer-name');
      if (nameEl) nameEl.textContent = name;
      const idTag = card.querySelector('.user-id-tag');
      if (idTag) idTag.textContent = `ID: ${userIdDisplay}`;
      const avatarName = card.querySelector('.avatar-name');
      if (avatarName) avatarName.textContent = name;
      const avatarId = card.querySelector('.avatar-id-badge');
      if (avatarId) avatarId.textContent = `ID: ${userIdDisplay}`;
    }
  }

  // Attach Remote Media Stream to Video & Dedicated Audio Elements
  attachRemoteStream(peerSocketId, stream) {
    this.renderRemoteVideoCard(peerSocketId);

    const card = document.getElementById(`video-card-${peerSocketId}`);
    if (!card) return;

    // Dedicated unmuted audio element in global container (guarantees voice plays on mobile & desktop)
    let audioEl = document.getElementById(`audio-${peerSocketId}`);
    if (!audioEl) {
      audioEl = document.createElement('audio');
      audioEl.id = `audio-${peerSocketId}`;
      audioEl.autoplay = true;
      audioEl.playsInline = true;
      const container = document.getElementById('remoteAudioContainer') || document.body;
      container.appendChild(audioEl);
    }
    if (audioEl.srcObject !== stream) {
      audioEl.srcObject = stream;
      audioEl.muted = false;
      audioEl.volume = 1.0;
      audioEl.play().catch((err) => {
        console.warn('Audio play restricted until user gesture:', err);
        const banner = document.getElementById('audioUnlockBanner');
        if (banner) banner.style.display = 'flex';
      });
    }

    const videoEl = card.querySelector('video');
    if (videoEl) {
      if (videoEl.srcObject !== stream) {
        videoEl.srcObject = stream;
        videoEl.muted = false;
        videoEl.volume = 1.0;
      }

      videoEl.onloadedmetadata = () => {
        card.classList.add('has-video');
        videoEl.play().catch(() => {});
      };

      videoEl.onplaying = () => {
        card.classList.add('has-video');
      };

      videoEl.play().catch((err) => {
        console.warn('Video play waiting for interaction:', err);
      });
    }

    const statusPill = card.querySelector('.status-pill');
    if (statusPill) {
      statusPill.textContent = 'Live 🟢';
      statusPill.className = 'status-pill connected';
    }
  }

  // Helper to shorten ID
  shortId(id) {
    if (!id) return '';
    const parts = String(id).split('_');
    if (parts.length > 2) {
      return parts[parts.length - 1];
    }
    return String(id).substring(0, 8);
  }

  // 5. Remove Peer
  removePeer(peerSocketId) {
    if (this.peerConnections[peerSocketId]) {
      this.peerConnections[peerSocketId].close();
      delete this.peerConnections[peerSocketId];
    }
    delete this.peerProfiles[peerSocketId];
    delete this.iceQueues[peerSocketId];
    delete this.remoteStreams[peerSocketId];

    const audioEl = document.getElementById(`audio-${peerSocketId}`);
    if (audioEl) audioEl.remove();

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
      localVideoCard.classList.toggle('has-video', !this.isVideoOff);
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
          let sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');

          if (!sender) {
            const transceiver = pc.getTransceivers().find(
              (t) => t.sender && ((t.sender.track && t.sender.track.kind === 'video') || (t.receiver && t.receiver.track && t.receiver.track.kind === 'video'))
            );
            if (transceiver && transceiver.sender) {
              sender = transceiver.sender;
            }
          }

          if (sender) {
            await sender.replaceTrack(screenTrack);
          } else {
            pc.addTrack(screenTrack, this.screenStream);
          }
        }

        const localVideo = document.getElementById('localVideo');
        if (localVideo) {
          localVideo.srcObject = this.screenStream;
          localVideo.classList.add('screen-sharing');
          localVideo.play().catch(() => {});
        }

        const localCard = document.getElementById('localVideoCard');
        if (localCard) {
          localCard.classList.add('has-video');
          localCard.classList.remove('video-off');
        }

        const localScreenBadge = document.getElementById('localScreenBadge');
        if (localScreenBadge) {
          localScreenBadge.style.display = 'block';
        }

        this.isScreenSharing = true;

        screenTrack.onended = () => {
          this.stopScreenSharing();
        };

        this.socket.emit('media-state-changed', {
          roomId: this.roomId,
          isAudioMuted: this.isAudioMuted,
          isVideoOff: false,
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

    const camTrack = this.localStream ? this.localStream.getVideoTracks()[0] : null;

    for (const socketId in this.peerConnections) {
      const pc = this.peerConnections[socketId];
      let sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
      if (sender && camTrack) {
        await sender.replaceTrack(camTrack);
      }
    }

    const localVideo = document.getElementById('localVideo');
    if (localVideo && this.localStream) {
      localVideo.srcObject = this.localStream;
      localVideo.classList.remove('screen-sharing');
      localVideo.play().catch(() => {});
    }

    const localCard = document.getElementById('localVideoCard');
    if (localCard) {
      if (this.isVideoOff) {
        localCard.classList.remove('has-video');
        localCard.classList.add('video-off');
      } else {
        localCard.classList.add('has-video');
        localCard.classList.remove('video-off');
      }
    }

    const localScreenBadge = document.getElementById('localScreenBadge');
    if (localScreenBadge) {
      localScreenBadge.style.display = 'none';
    }

    this.isScreenSharing = false;

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
    const totalCount = Object.keys(this.peerProfiles).length + 1;
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
    this.iceQueues = {};
    this.remoteStreams = {};
  }
}
