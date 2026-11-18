// Lobby, Authentication & Google Meet / Zoom Style Pre-Meeting Green Room
document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const rawInviteRoomId = urlParams.get('roomId');
  const inviteRoomId = rawInviteRoomId
    ? String(rawInviteRoomId).trim().toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-')
    : null;

  // Top Nav
  const userProfileNav = document.getElementById('userProfileNav');
  const userAvatarInitial = document.getElementById('userAvatarInitial');
  const userNameDisplay = document.getElementById('userNameDisplay');
  const logoutBtn = document.getElementById('logoutBtn');

  // Sections
  const authSection = document.getElementById('authSection');
  const dashboardSection = document.getElementById('dashboardSection');
  const inviteSection = document.getElementById('inviteSection');

  // Auth Card Elements
  const tabLogin = document.getElementById('tabLogin');
  const tabRegister = document.getElementById('tabRegister');
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const authError = document.getElementById('authError');
  const authSuccess = document.getElementById('authSuccess');

  // Invite Card Elements
  const inviteRoomIdBadge = document.getElementById('inviteRoomIdBadge');
  const invitePreviewVideo = document.getElementById('invitePreviewVideo');
  const inviteToggleMic = document.getElementById('inviteToggleMic');
  const inviteToggleCam = document.getElementById('inviteToggleCam');
  const inviteLoggedInBox = document.getElementById('inviteLoggedInBox');
  const inviteLoggedInName = document.getElementById('inviteLoggedInName');
  const btnInviteJoinLoggedIn = document.getElementById('btnInviteJoinLoggedIn');
  const btnInviteSwitchAccount = document.getElementById('btnInviteSwitchAccount');
  const inviteGuestBox = document.getElementById('inviteGuestBox');
  const inviteGuestName = document.getElementById('inviteGuestName');
  const btnInviteJoinGuest = document.getElementById('btnInviteJoinGuest');
  const btnInviteGoToLogin = document.getElementById('btnInviteGoToLogin');

  // Normal Dashboard Hardware Preview
  const previewVideo = document.getElementById('previewVideo');
  const previewToggleMic = document.getElementById('previewToggleMic');
  const previewToggleCam = document.getElementById('previewToggleCam');

  let activeStream = null;
  let isAudioEnabled = true;
  let isVideoEnabled = true;

  function showError(msg) {
    if (authError) {
      authError.textContent = msg;
      authError.style.display = 'block';
      setTimeout(() => { authError.style.display = 'none'; }, 5000);
    }
  }

  function showSuccess(msg) {
    if (authSuccess) {
      authSuccess.textContent = msg;
      authSuccess.style.display = 'block';
      setTimeout(() => { authSuccess.style.display = 'none'; }, 4000);
    }
  }

  // Camera & Mic Hardware Preview
  async function startPreview(videoTarget) {
    stopPreview();
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        activeStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true
        });
        if (videoTarget) {
          videoTarget.srcObject = activeStream;
        }
      }
    } catch (err) {
      console.warn('Could not acquire local preview devices:', err);
    }
  }

  function stopPreview() {
    if (activeStream) {
      activeStream.getTracks().forEach((track) => track.stop());
      activeStream = null;
    }
  }

  function setupMediaToggles(btnMic, btnCam) {
    if (btnMic) {
      btnMic.addEventListener('click', () => {
        if (activeStream) {
          isAudioEnabled = !isAudioEnabled;
          activeStream.getAudioTracks().forEach((t) => (t.enabled = isAudioEnabled));
          btnMic.classList.toggle('off', !isAudioEnabled);
          btnMic.innerHTML = isAudioEnabled ? '🎤' : '🔇';
        }
      });
    }

    if (btnCam) {
      btnCam.addEventListener('click', () => {
        if (activeStream) {
          isVideoEnabled = !isVideoEnabled;
          activeStream.getVideoTracks().forEach((t) => (t.enabled = isVideoEnabled));
          btnCam.classList.toggle('off', !isVideoEnabled);
          btnCam.innerHTML = isVideoEnabled ? '📹' : '🚫';
        }
      });
    }
  }

  setupMediaToggles(previewToggleMic, previewToggleCam);
  setupMediaToggles(inviteToggleMic, inviteToggleCam);

  // Switch tabs
  if (tabLogin && tabRegister) {
    tabLogin.addEventListener('click', () => {
      tabLogin.classList.add('active');
      tabRegister.classList.remove('active');
      loginForm.style.display = 'block';
      registerForm.style.display = 'none';
      if (authError) authError.style.display = 'none';
    });

    tabRegister.addEventListener('click', () => {
      tabRegister.classList.add('active');
      tabLogin.classList.remove('active');
      registerForm.style.display = 'block';
      loginForm.style.display = 'none';
      if (authError) authError.style.display = 'none';
    });
  }

  // Handle Register
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('regName').value.trim();
      const email = document.getElementById('regEmail').value.trim();
      const password = document.getElementById('regPassword').value;

      try {
        const data = await API.register(name, email, password);
        API.saveAuth(data.token, data.user);
        showSuccess('Account registered successfully!');
        setTimeout(() => {
          if (inviteRoomId) {
            stopPreview();
            window.location.href = `/room?roomId=${encodeURIComponent(inviteRoomId)}`;
          } else {
            renderView();
          }
        }, 700);
      } catch (err) {
        showError(err.message);
      }
    });
  }

  // Handle Login
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('loginEmail').value.trim();
      const password = document.getElementById('loginPassword').value;

      try {
        const data = await API.login(email, password);
        API.saveAuth(data.token, data.user);
        showSuccess('Login successful!');
        setTimeout(() => {
          if (inviteRoomId) {
            stopPreview();
            window.location.href = `/room?roomId=${encodeURIComponent(inviteRoomId)}`;
          } else {
            renderView();
          }
        }, 600);
      } catch (err) {
        showError(err.message);
      }
    });
  }

  // Handle Logout
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      stopPreview();
      API.clearAuth();
      renderView();
    });
  }

  // Room Creation / Manual Join from Dashboard
  const btnCreateRoom = document.getElementById('btnCreateRoom');
  const btnJoinRoom = document.getElementById('btnJoinRoom');
  const joinRoomInput = document.getElementById('joinRoomInput');

  if (btnCreateRoom) {
    btnCreateRoom.addEventListener('click', () => {
      const code1 = Math.random().toString(36).substring(2, 5);
      const code2 = Math.random().toString(36).substring(2, 6);
      const generatedRoomId = `${code1}-${code2}`;
      stopPreview();
      window.location.href = `/room?roomId=${encodeURIComponent(generatedRoomId)}`;
    });
  }

  if (btnJoinRoom && joinRoomInput) {
    const handleJoin = () => {
      const roomId = joinRoomInput.value.trim();
      if (!roomId) {
        alert('Please enter a valid Room Code.');
        return;
      }
      stopPreview();
      window.location.href = `/room?roomId=${encodeURIComponent(roomId)}`;
    };

    btnJoinRoom.addEventListener('click', handleJoin);
    joinRoomInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleJoin();
    });
  }

  // Invite Flow Actions (Google Meet / Zoom style)
  if (btnInviteJoinLoggedIn) {
    btnInviteJoinLoggedIn.addEventListener('click', () => {
      stopPreview();
      window.location.href = `/room?roomId=${encodeURIComponent(inviteRoomId)}`;
    });
  }

  if (btnInviteSwitchAccount) {
    btnInviteSwitchAccount.addEventListener('click', () => {
      API.clearAuth();
      renderView();
    });
  }

  if (btnInviteJoinGuest) {
    const handleGuestJoin = async () => {
      const name = inviteGuestName ? inviteGuestName.value.trim() : '';
      if (!name) {
        alert('Please enter your name to join the meeting.');
        if (inviteGuestName) inviteGuestName.focus();
        return;
      }

      btnInviteJoinGuest.disabled = true;
      btnInviteJoinGuest.textContent = 'Joining...';

      try {
        const data = await API.joinAsGuest(name);
        API.saveAuth(data.token, data.user);
        stopPreview();
        window.location.href = `/room?roomId=${encodeURIComponent(inviteRoomId)}`;
      } catch (err) {
        alert('Could not join: ' + err.message);
        btnInviteJoinGuest.disabled = false;
        btnInviteJoinGuest.textContent = '⚡ Join Meeting';
      }
    };

    btnInviteJoinGuest.addEventListener('click', handleGuestJoin);
    if (inviteGuestName) {
      inviteGuestName.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleGuestJoin();
      });
    }
  }

  if (btnInviteGoToLogin) {
    btnInviteGoToLogin.addEventListener('click', () => {
      if (inviteSection) inviteSection.style.display = 'none';
      if (authSection) authSection.style.display = 'block';
    });
  }

  // Master Render View Logic
  function renderView() {
    const token = API.getToken();
    const user = API.getCurrentUser();

    // Update Nav bar
    if (token && user) {
      if (userProfileNav) userProfileNav.style.display = 'flex';
      if (userNameDisplay) userNameDisplay.textContent = user.name;
      if (userAvatarInitial) userAvatarInitial.textContent = user.name.charAt(0).toUpperCase();
    } else {
      if (userProfileNav) userProfileNav.style.display = 'none';
    }

    // Case 1: User came via an invite link (e.g. ?roomId=abc-xyz)
    if (inviteRoomId) {
      if (authSection) authSection.style.display = 'none';
      if (dashboardSection) dashboardSection.style.display = 'none';
      if (inviteSection) inviteSection.style.display = 'block';

      if (inviteRoomIdBadge) inviteRoomIdBadge.textContent = inviteRoomId;

      if (token && user) {
        if (inviteLoggedInBox) inviteLoggedInBox.style.display = 'block';
        if (inviteGuestBox) inviteGuestBox.style.display = 'none';
        if (inviteLoggedInName) inviteLoggedInName.textContent = user.name;
      } else {
        if (inviteLoggedInBox) inviteLoggedInBox.style.display = 'none';
        if (inviteGuestBox) inviteGuestBox.style.display = 'block';
        if (inviteGuestName) setTimeout(() => inviteGuestName.focus(), 200);
      }

      startPreview(invitePreviewVideo);
      return;
    }

    // Case 2: Standard Dashboard (No invite link in URL)
    if (inviteSection) inviteSection.style.display = 'none';

    if (token && user) {
      if (authSection) authSection.style.display = 'none';
      if (dashboardSection) dashboardSection.style.display = 'block';
      startPreview(previewVideo);
    } else {
      if (authSection) authSection.style.display = 'block';
      if (dashboardSection) dashboardSection.style.display = 'none';
      stopPreview();
    }
  }

  // Initial render
  renderView();
});
