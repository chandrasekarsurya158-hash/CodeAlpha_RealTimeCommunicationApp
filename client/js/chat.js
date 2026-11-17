// In-Call Real-Time Chat & File Sharing Manager
class ChatAndFileManager {
  constructor({ socket, roomId, currentUser }) {
    this.socket = socket;
    this.roomId = roomId;
    this.currentUser = currentUser;

    this.messagesContainer = document.getElementById('chatMessages');
    this.chatInput = document.getElementById('chatInput');
    this.btnSendChat = document.getElementById('btnSendChat');
    this.filesListContainer = document.getElementById('filesListContainer');
    this.fileDropzone = document.getElementById('fileDropzone');
    this.fileInput = document.getElementById('fileInput');

    this.unreadCount = 0;
    this.isDrawerOpen = false;

    this.init();
  }

  init() {
    this.bindChatEvents();
    this.bindFileEvents();
    this.setupSocketListeners();
    this.loadInitialRoomFiles();
  }

  bindChatEvents() {
    const sendMessage = () => {
      const text = this.chatInput.value.trim();
      if (!text) return;

      this.socket.emit('chat-message', {
        roomId: this.roomId,
        message: text,
        user: this.currentUser,
        timestamp: new Date().toISOString()
      });

      this.chatInput.value = '';
    };

    if (this.btnSendChat) {
      this.btnSendChat.addEventListener('click', sendMessage);
    }

    if (this.chatInput) {
      this.chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
      });
    }
  }

  bindFileEvents() {
    if (!this.fileDropzone || !this.fileInput) return;

    this.fileDropzone.addEventListener('click', () => {
      this.fileInput.click();
    });

    this.fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this.uploadFile(e.target.files[0]);
      }
    });

    // Drag and Drop
    this.fileDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.fileDropzone.classList.add('dragover');
    });

    this.fileDropzone.addEventListener('dragleave', () => {
      this.fileDropzone.classList.remove('dragover');
    });

    this.fileDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.fileDropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        this.uploadFile(e.dataTransfer.files[0]);
      }
    });
  }

  async uploadFile(file) {
    if (file.size > 50 * 1024 * 1024) {
      alert('File size exceeds the 50MB limit.');
      return;
    }

    if (window.showToast) {
      window.showToast(`Uploading ${file.name}...`);
    }

    try {
      const result = await API.uploadFile(file, this.roomId);
      if (result.success && result.file) {
        // Broadcast to all peers in the room
        this.socket.emit('file-shared', {
          roomId: this.roomId,
          file: result.file
        });

        if (window.showToast) {
          window.showToast(`Shared "${file.name}" with room!`);
        }
      }
    } catch (err) {
      console.error('File upload error:', err);
      alert('Failed to upload file: ' + err.message);
    } finally {
      if (this.fileInput) this.fileInput.value = '';
    }
  }

  async loadInitialRoomFiles() {
    try {
      const data = await API.getRoomFiles(this.roomId);
      if (data.success && Array.isArray(data.files)) {
        data.files.forEach((file) => this.renderFileItem(file));
      }
    } catch (err) {
      console.warn('Could not load room files:', err);
    }
  }

  setupSocketListeners() {
    // Receive text message
    this.socket.on('chat-message', (data) => {
      this.renderChatMessage(data);
      if (!this.isDrawerOpen) {
        this.incrementUnreadBadge();
      }
    });

    // Receive shared file notification
    this.socket.on('file-shared', ({ file, sharedBy }) => {
      this.renderFileItem(file);
      if (!this.isDrawerOpen) {
        this.incrementUnreadBadge();
      }
      if (window.showToast) {
        window.showToast(`${sharedBy.name || 'Participant'} shared: ${file.originalName}`);
      }
    });
  }

  renderChatMessage({ user, message, timestamp }) {
    if (!this.messagesContainer) return;

    const isSelf = user.id === this.currentUser.id;
    const timeFormatted = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const msgEl = document.createElement('div');
    msgEl.className = `chat-bubble ${isSelf ? 'self' : 'other'}`;
    msgEl.innerHTML = `
      <div class="chat-sender">${isSelf ? 'You' : user.name}</div>
      <div class="chat-text">${this.escapeHTML(message)}</div>
      <div class="chat-time">${timeFormatted}</div>
    `;

    this.messagesContainer.appendChild(msgEl);
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  renderFileItem(file) {
    if (!this.filesListContainer) return;

    // Check if already displayed
    if (document.getElementById(`file-${file.id}`)) return;

    const formattedSize = this.formatBytes(file.size);
    const uploaderName = file.uploader ? file.uploader.name : 'Unknown';

    const item = document.createElement('div');
    item.id = `file-${file.id}`;
    item.className = 'file-item-card';
    item.innerHTML = `
      <div class="file-icon">📄</div>
      <div class="file-details">
        <div class="file-name" title="${this.escapeHTML(file.originalName)}">${this.escapeHTML(file.originalName)}</div>
        <div class="file-sub">${formattedSize} • by ${this.escapeHTML(uploaderName)}</div>
      </div>
      <a class="file-download-btn" href="${file.downloadUrl}" download="${this.escapeHTML(file.originalName)}" target="_blank">Download</a>
    `;

    this.filesListContainer.prepend(item);
  }

  formatBytes(bytes) {
    if (!+bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }

  escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, (tag) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }

  incrementUnreadBadge() {
    this.unreadCount++;
    const badge = document.getElementById('chatBadge');
    if (badge) {
      badge.textContent = this.unreadCount > 9 ? '9+' : this.unreadCount;
      badge.style.display = 'flex';
    }
  }

  clearUnreadBadge() {
    this.unreadCount = 0;
    const badge = document.getElementById('chatBadge');
    if (badge) {
      badge.style.display = 'none';
      badge.textContent = '0';
    }
  }

  setDrawerOpen(isOpen) {
    this.isDrawerOpen = isOpen;
    if (isOpen) {
      this.clearUnreadBadge();
    }
  }
}
