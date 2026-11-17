# OmniConnect - Real-Time Video Conferencing & Collaboration Web App

A complete, production-grade Real-Time Video Conferencing and Collaboration platform (similar to Google Meet / Zoom) built with **Node.js**, **Express**, **Socket.io**, and **WebRTC** for the backend, and modern **HTML5**, **CSS3**, and **JavaScript** for the frontend.

---

## ✨ Features

### 1. 🔐 User Authentication & Session Security
- User registration and login system.
- Secure password hashing using **bcryptjs** (salt rounds: 10).
- Stateless authentication with **JSON Web Tokens (JWT)**.
- Protected REST endpoints and client-side authentication guards.
- User profile display and session persistence across page refreshes.

### 2. 📹 Multi-User Video Calling & Signaling (WebRTC + Socket.io)
- **Room-based Architecture**: Create instant unique rooms (e.g. `meet-abc-xyz`) or join any room code.
- **Mesh WebRTC Architecture**: Direct peer-to-peer audio and video streaming using `RTCPeerConnection` and Google STUN servers (`stun:stun.l.google.com:19302`).
- **Real-Time Signaling**: Socket.io handles peer discovery, SDP Offers, SDP Answers, and ICE Candidates.
- **Dynamic Responsive Video Grid**: Intelligently re-layouts video tiles according to the active participant count (1 to 9+ users).
- **In-Call Media Controls**:
  - 🎤 Toggle Microphone (Mute / Unmute) with live status badge.
  - 📹 Toggle Camera (Turn Video On / Off) with animated avatar fallbacks.
  - 📞 Leave Call / End Session with track cleanup.

### 3. 🖥️ Screen Sharing (`getDisplayMedia` API)
- Built-in screen presenter utilizing the browser's native `navigator.mediaDevices.getDisplayMedia` API.
- Seamless video track replacement (`RTCRtpSender.replaceTrack`) without renegotiation teardown.
- Automatic fallback to webcam when the user stops screen sharing via either the UI button or the browser's native stop-share bar.
- Visual "Presenting Screen" badge displayed across all participant views.

### 4. 🎨 Collaborative Real-Time Whiteboard
- Responsive HTML5 Canvas whiteboard modal.
- Multi-user drawing synchronization in real-time over Socket.io.
- **Tools Included**:
  - ✏️ Pen / Brush with adjustable stroke thickness slider (1px to 25px).
  - 🧹 Eraser tool.
  - 🎨 Full RGB color picker palette.
  - 🗑️ "Clear Canvas" synchronized across all participants in the room.
  - 📥 "Save as PNG" export to download whiteboard captures locally.
- Full stroke history replay when new participants join an ongoing meeting.
- Resolution-independent coordinate normalization (0.0 to 1.0) so drawing matches accurately on all screen sizes and DPI displays.

### 5. 📁 File Sharing & In-Call Chat
- **In-Call Chat**: Instant messaging sidebar with user name tags and message timestamps.
- **File Sharing**:
  - Drag-and-drop zone and file picker.
  - Secure backend upload endpoint powered by `multer` (supports PDFs, docs, slides, images, and archives up to 50MB).
  - Instant room broadcast via Socket.io notifying all participants of new files.
  - In-room file repository with one-click direct download buttons and human-readable file sizes.
- Unread message & file notification badge counters on the bottom dock.

---

## 📁 Project Structure

```text
RealTimeCommunicationApp/
├── package.json              # Root runner for convenient start & dev
├── README.md                 # Project documentation & setup guide
├── client/                   # Frontend Web Application
│   ├── index.html            # Lobby, Authentication & Hardware Preview
│   ├── room.html             # Main Meeting Room & Video Interface
│   ├── css/
│   │   └── style.css         # Dark theme UI, responsive grid & modals
│   └── js/
│       ├── api.js            # REST API client & JWT storage
│       ├── auth.js           # Auth forms & device check preview
│       ├── webrtc.js         # WebRTC mesh & screen share engine
│       ├── whiteboard.js     # HTML5 canvas synchronization engine
│       ├── chat.js           # Real-time chat & file sharing manager
│       └── room.js           # Room UI coordinator & control handlers
└── server/                   # Backend Server
    ├── .env                  # Environment configuration
    ├── .env.example          # Sample environment variables
    ├── package.json          # Server dependencies & scripts
    ├── server.js             # Express & Socket.io server entry point
    ├── data/
    │   ├── userStore.js      # File-backed user repository
    │   └── users.json        # Persistent user records
    ├── middleware/
    │   └── authMiddleware.js # JWT verification middleware
    ├── routes/
    │   ├── auth.js           # Registration, login & profile endpoints
    │   └── files.js          # File upload & download endpoints
    ├── socket/
    │   └── signaling.js      # WebRTC signaling, whiteboard & chat sockets
    └── uploads/              # Local storage directory for shared files
```

---

## 🚀 Quick Start Guide

### Prerequisites
- **Node.js** (v18.0.0 or higher recommended)
- **npm** (v9.0.0 or higher)
- A modern web browser with WebRTC support (Google Chrome, Mozilla Firefox, Microsoft Edge, Brave, or Safari).

---

### Step 1: Install Dependencies

From the project root:
```bash
npm install
```
*(Or navigate to `server/` and run `npm install`)*

---

### Step 2: Start the Server

From the project root:
```bash
npm start
```
*(For auto-reloading development mode, run `npm run dev`)*

The server will initialize on:
```
=======================================================
🚀 Video Conferencing & Collaboration Server running
🌐 Local URL: http://localhost:5000
📡 WebSocket Signaling: ready
=======================================================
```

---

### Step 3: Access the Application

1. Open your browser and navigate to:
   ```
   http://localhost:5000
   ```
2. **Create an Account**:
   - Click **Create Account** tab.
   - Enter your name, email, and password (minimum 6 characters).
   - Click **Create Free Account**.
3. **Start a Call**:
   - Preview your camera & microphone in the lobby device preview.
   - Click **⚡ Start Instant Meeting** to create a fresh room, or enter a custom Room ID and click **Join**.
4. **Invite Peers / Multi-User Testing**:
   - Open a second browser tab (or an **Incognito Window** / a different browser like Firefox or Edge).
   - Go to `http://localhost:5000` and register/login with a second account (e.g. `bob@example.com`).
   - Click **🔗 Copy Invite** or copy the Room ID from the first window, paste it into the second window's join input, and click **Join**.
   - Both users will connect peer-to-peer with live video, audio, shared whiteboard, and file exchange!

---

## 📡 API & Socket Reference

### REST Endpoints
| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `POST` | `/api/auth/register` | Register new user with name, email & password | No |
| `POST` | `/api/auth/login` | Login and receive JWT access token | No |
| `GET` | `/api/auth/me` | Fetch authenticated user profile | Yes (Bearer Token) |
| `POST` | `/api/files/upload` | Upload a shared file into a meeting room | Yes (Bearer Token) |
| `GET` | `/api/files/room/:roomId` | List all files shared in a specific room | Yes (Bearer Token) |
| `GET` | `/api/files/download/:filename` | Download a shared file with original name | No |

### WebSocket Signaling Events
| Event | Direction | Description |
|---|---|---|
| `join-room` | Client ➔ Server | User enters a room with `{ roomId, user }` |
| `all-users` | Server ➔ Client | Sends list of existing participants to the joiner |
| `user-joined` | Server ➔ Room | Informs existing participants that a new peer joined |
| `signal` | Bidirectional | Relays SDP Offers, SDP Answers & ICE candidates |
| `media-state-changed` | Client ➔ Server ➔ Room | Relays mic muted, video off, and screen share flags |
| `whiteboard-draw` | Client ➔ Server ➔ Room | Synchronizes normalized draw coordinates and brush styles |
| `whiteboard-clear` | Client ➔ Server ➔ Room | Clears canvas for all participants in the room |
| `whiteboard-sync-history` | Server ➔ Client | Sends full drawing history to newly joined participants |
| `chat-message` | Client ➔ Server ➔ Room | Broadcasts text messages with author and timestamp |
| `file-shared` | Client ➔ Server ➔ Room | Broadcasts shared file metadata to participants |
| `user-left` | Server ➔ Room | Cleans up peer connection when a user disconnects |

---

## 💡 Notes for Testing & Local Development
- **Permissions**: When prompted, allow camera and microphone access.
- **Localhost Exception**: Browsers permit WebRTC and `navigator.mediaDevices` on `localhost` without HTTPS. When deploying to a public server or domain, HTTPS is required by browser security policies for media devices and screen capture.
- **Screen Sharing**: Works best on desktop browsers (Chrome, Edge, Firefox). You can select an entire screen, an application window, or a specific browser tab.

---

## 📄 License
This project is open-source and available under the [MIT License](LICENSE).
