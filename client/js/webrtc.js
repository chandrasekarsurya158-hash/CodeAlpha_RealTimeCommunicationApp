// WebRTC Peer-to-Peer Mesh Manager with Open-Relay TURN Fallback, Fullscreen Presentation Spotlight & Host Roles
class WebRTCManager {
  constructor({ socket, roomId, currentUser, onParticipantChange }) {
    this.socket = socket;
    this.roomId = roomId;
    this.currentUser = currentUser || { id: 'user_' + Date.now(), name: 'Guest', isHost: false };
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

  // 1. Initialize Local Media Stream with Multi-Tier Fallbacks
  async initLocalStream() {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });
    } catch (err1) {
      console.warn('Standard video+audio failed, trying video only...', err1);
      try {
        const vidStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const silentAudio = this.createSilentAudioTrack();
        this.localStream = new MediaStream([...vidStream.getVideoTracks(), silentAudio]);
      } catch (err2) {
        console.warn('Video failed, trying audio only...', err2);
        try {
          const audStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const canvasVideo = this.createCanvasVideoTrack(this.currentUser.name);
          this.localStream = new MediaStream([...audStream.getAudioTracks(), canvasVideo]);
        } catch (err3) {
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
      localVideo.muted = true;
      localVideo.play().catch(() => {});
    }

    const localCard = document.getElementById('localVideoCard');
    if (localCard) {
      localCard.classList.add('has-video');
      localCard.classList.remove('video-off');
    }

    return this.localStream;
  }

  // Generates animated avatar video track from Canvas
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
        const role = user.isHost ? 'Host 👑' : 'Member';
        window.showToast(`${user.name || 'A participant'} (${role}) joined`);
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

    // Remote peer media state (muted, camera off, screen share)
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
          // Put this card into the dedicated Presentation Fullscreen Spotlight stage!
          this.setPresentationMode(`video-card-${socketId}`, true);
        } else {
          // If this card was presenting, remove presentation stage mode
          this.setPresentationMode(`video-card-${socketId}`, false);

          if (isVideoOff) {
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
      this.setPresentationMode(`video-card-${socketId}`, false);
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

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') {
        console.warn(`[ICE] Failed for ${peerSocketId}, attempting automatic restart...`);
        try {
          pc.restartIce();
        } catch {}
      }
    };

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

  // 4. Render or Update Remote Video Card Tile in Grid with Host vs Member Badge
  renderRemoteVideoCard(peerSocketId, user) {
    const videoGrid = document.getElementById('videoGrid');
    if (!videoGrid) return;

    let card = document.getElementById(`video-card-${peerSocketId}`);
    const peerUser = user || this.peerProfiles[peerSocketId] || { name: 'Participant', id: peerSocketId, isHost: false };
    const name = peerUser.name || 'Participant';
    const userIdDisplay = this.shortId(peerUser.id || peerSocketId);
    const initial = name.charAt(0).toUpperCase();
    const isHost = Boolean(peerUser.isHost);
    const roleBadgeText = isHost ? '👑 Host' : 'Member';
    const roleBadgeClass = isHost ? 'badge-host' : 'badge-member';

    if (!card) {
      card = document.createElement('div');
      card.id = `video-card-${peerSocketId}`;
      card.className = 'video-card';

      card.innerHTML = `
        <video id="video-${peerSocketId}" autoplay playsinline></video>
        <div class="avatar-fallback">
          <div class="avatar-circle">${initial}</div>
          <span class="avatar-name" style="font-size:0.95rem; font-weight:600;">${name}</span>
          <span class="avatar-id-badge" style="font-size:0.75rem; color:#94a3b8; font-family:monospace;">ID: ${userIdDisplay}</span>
        </div>
        <div class="screen-share-badge" style="display:none;">🖥️ Presenting Screen</div>
        <div class="connection-status-tag">
          <span class="badge ${roleBadgeClass}" style="margin-right:4px;">${roleBadgeText}</span>
          <span class="status-pill connecting">Connecting...</span>
        </div>
        <div class="video-meta">
          <div class="user-name-badge">
            <span class="peer-name">${name}</span>
            <span class="badge ${roleBadgeClass}" style="font-size:0.7rem; padding:1px 6px;">${roleBadgeText}</span>
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

      // Update role badges
      const roleBadges = card.querySelectorAll('.badge-host, .badge-member');
      roleBadges.forEach((rb) => {
        rb.className = `badge ${roleBadgeClass}`;
        rb.textContent = roleBadgeText;
      });
    }
  }

  // 5. Dedicated Presentation Spotlight / Fullscreen Mode
  setPresentationMode(cardId, isPresenting) {
    const grid = document.getElementById('videoGrid');
    const targetCard = document.getElementById(cardId);
    if (!grid) return;

    if (isPresenting && targetCard) {
      grid.classList.add('has-presentation');
      // Ensure all other cards lose the presenting-stage class
      grid.querySelectorAll('.video-card').forEach((c) => {
        if (c !== targetCard) c.classList.remove('presenting-stage');
      });

      targetCard.classList.add('presenting-stage');
      targetCard.classList.add('has-video');
      targetCard.classList.remove('video-off');

      // Add prominent Fullscreen button to the presentation stage
      let fsBtn = targetCard.querySelector('.btn-presentation-fullscreen');
      if (!fsBtn) {
        fsBtn = document.createElement('button');
        fsBtn.type = 'button';
        fsBtn.className = 'btn-presentation-fullscreen';
        fsBtn.innerHTML = '<span>⛶</span><span>Fullscreen</span>';
        fsBtn.title = 'View Presentation in Fullscreen';
        fsBtn.onclick = (e) => {
          e.stopPropagation();
          if (!document.fullscreenElement) {
            targetCard.requestFullscreen().catch(() => {});
            fsBtn.innerHTML = '<span>✕</span><span>Exit Fullscreen</span>';
          } else {
            document.exitFullscreen().catch(() => {});
            fsBtn.innerHTML = '<span>⛶</span><span>Fullscreen</span>';
          }
        };
        targetCard.appendChild(fsBtn);
      }
    } else {
      if (targetCard) {
        targetCard.classList.remove('presenting-stage');
        const fsBtn = targetCard.querySelector('.btn-presentation-fullscreen');
        if (fsBtn) fsBtn.remove();
      }

      // Check if any other card is still presenting
      const anyStillPresenting = grid.querySelector('.video-card.presenting-stage');
      if (!anyStillPresenting) {
        grid.classList.remove('has-presentation');
        this.updateGridLayout();
      }
    }
  }

  // Attach Remote Media Stream to Video & Dedicated Audio Elements
  attachRemoteStream(peerSocketId, stream) {
    this.renderRemoteVideoCard(peerSocketId);

    const card = document.getElementById(`video-card-${peerSocketId}`);
    if (!card) return;

    // 1. Separate Audio Output: Unmuted audio element plays voice
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length > 0) {
      let audioEl = document.getElementById(`audio-${peerSocketId}`);
      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.id = `audio-${peerSocketId}`;
        audioEl.autoplay = true;
        audioEl.playsInline = true;
        const container = document.getElementById('remoteAudioContainer') || document.body;
        container.appendChild(audioEl);
      }
      const audioStream = new MediaStream(audioTracks);
      if (audioEl.srcObject !== audioStream) {
        audioEl.srcObject = audioStream;
        audioEl.muted = false;
        audioEl.volume = 1.0;
        audioEl.play().catch((err) => {
          console.warn('Audio waiting for tap/interaction:', err);
          const banner = document.getElementById('audioUnlockBanner');
          if (banner) banner.style.display = 'flex';
        });
      }
    }

    // 2. Video Output: MUST be muted=true so Chrome/Safari NEVER blocks video autoplay!
    const videoEl = card.querySelector('video');
    const videoTracks = stream.getVideoTracks();
    if (videoEl && videoTracks.length > 0) {
      videoEl.muted = true; // Crucial for Chrome Autoplay compliance!
      videoEl.autoplay = true;
      videoEl.playsInline = true;

      if (videoEl.srcObject !== stream) {
        videoEl.srcObject = stream;
      }

      const showVideo = () => {
        card.classList.add('has-video');
        card.classList.remove('video-off');
      };

      videoEl.onloadedmetadata = showVideo;
      videoEl.onplaying = showVideo;

      const p = videoEl.play();
      if (p !== undefined) {
        p.then(showVideo).catch(() => showVideo());
      }
      showVideo();
    }

    const statusPill = card.querySelector('.status-pill');
    if (statusPill) {
      statusPill.textContent = 'Live 🟢';
      statusPill.className = 'status-pill connected';
    }
  }

  shortId(id) {
    if (!id) return '';
    const parts = String(id).split('_');
    if (parts.length > 2) {
      return parts[parts.length - 1];
    }
    return String(id).substring(0, 8);
  }

  // 6. Remove Peer
  removePeer(peerSocketId) {
    this.setPresentationMode(`video-card-${peerSocketId}`, false);

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

  // 7. Audio Toggle
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

  // 8. Video Toggle
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

  // 9. Screen Sharing: Presents in Dedicated Fullscreen Spotlight Stage
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

        // Put local card into the Fullscreen Presentation Spotlight Stage!
        this.setPresentationMode('localVideoCard', true);

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

    // Remove Presentation Spotlight Mode
    this.setPresentationMode('localVideoCard', false);

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

  // 10. Update Layout and Count
  updateGridLayout() {
    const videoGrid = document.getElementById('videoGrid');
    if (!videoGrid || videoGrid.classList.contains('has-presentation')) return;

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

  // 11. Clean up everything on call exit
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
