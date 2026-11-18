// API Helper for HTTP Requests and Authentication
const API = {
  getToken() {
    return sessionStorage.getItem('room_token') || localStorage.getItem('token');
  },

  getCurrentUser() {
    try {
      const sessionUser = sessionStorage.getItem('room_user');
      if (sessionUser) return JSON.parse(sessionUser);
      const user = localStorage.getItem('user');
      return user ? JSON.parse(user) : null;
    } catch {
      return null;
    }
  },

  saveAuth(token, user) {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    sessionStorage.setItem('room_token', token);
    sessionStorage.setItem('room_user', JSON.stringify(user));
  },

  saveSessionAuth(token, user) {
    sessionStorage.setItem('room_token', token);
    sessionStorage.setItem('room_user', JSON.stringify(user));
  },

  clearAuth() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    sessionStorage.removeItem('room_token');
    sessionStorage.removeItem('room_user');
  },

  async request(endpoint, options = {}) {
    const headers = options.headers || {};
    const token = this.getToken();

    if (token && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (!(options.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(endpoint, {
      ...options,
      headers
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.message || `Request failed with status ${res.status}`);
    }
    return data;
  },

  async register(name, email, password) {
    return this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password })
    });
  },

  async login(email, password) {
    return this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
  },

  async joinAsGuest(name) {
    return this.request('/api/auth/guest', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
  },

  async verifyToken() {
    return this.request('/api/auth/me', {
      method: 'GET'
    });
  },

  async uploadFile(file, roomId) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('roomId', roomId);

    return this.request('/api/files/upload', {
      method: 'POST',
      body: formData
    });
  },

  async getRoomFiles(roomId) {
    return this.request(`/api/files/room/${roomId}`, {
      method: 'GET'
    });
  }
};
