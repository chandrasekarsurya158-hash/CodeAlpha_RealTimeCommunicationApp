// Collaborative HTML5 Canvas Whiteboard
class WhiteboardManager {
  constructor({ socket, roomId }) {
    this.socket = socket;
    this.roomId = roomId;

    this.canvas = document.getElementById('whiteboardCanvas');
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.container = document.querySelector('.whiteboard-canvas-container');

    this.isDrawing = false;
    this.currentTool = 'pen'; // 'pen' or 'eraser'
    this.currentColor = '#1e293b'; // Default dark ink
    this.brushSize = 3;

    this.lastX = 0;
    this.lastY = 0;

    if (this.canvas) {
      this.initCanvas();
      this.bindEvents();
      this.setupSocketListeners();
    }
  }

  initCanvas() {
    // Set internal resolution matching DOM size
    const resize = () => {
      if (!this.container || !this.canvas) return;
      const rect = this.container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      // Preserve image content during window resize
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = this.canvas.width;
      tempCanvas.height = this.canvas.height;
      const tempCtx = tempCanvas.getContext('2d');
      if (tempCtx && this.canvas.width > 0 && this.canvas.height > 0) {
        tempCtx.drawImage(this.canvas, 0, 0);
      }

      this.canvas.width = rect.width;
      this.canvas.height = rect.height;

      // Fill with clean white background
      this.ctx.fillStyle = '#ffffff';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      if (tempCtx && tempCanvas.width > 0) {
        this.ctx.drawImage(tempCanvas, 0, 0);
      }
    };

    window.addEventListener('resize', resize);
    // Observe container size changes (e.g. when opening whiteboard)
    if (window.ResizeObserver && this.container) {
      new ResizeObserver(resize).observe(this.container);
    }
    setTimeout(resize, 100);
  }

  bindEvents() {
    // Coordinate calculation normalized to 0..1 so different window sizes sync perfectly
    const getPos = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return {
        x: (clientX - rect.left) / rect.width,
        y: (clientY - rect.top) / rect.height
      };
    };

    const startDrawing = (e) => {
      this.isDrawing = true;
      const pos = getPos(e);
      this.lastX = pos.x;
      this.lastY = pos.y;
    };

    const draw = (e) => {
      if (!this.isDrawing) return;
      e.preventDefault();

      const pos = getPos(e);
      const drawData = {
        prevX: this.lastX,
        prevY: this.lastY,
        currX: pos.x,
        currY: pos.y,
        color: this.currentTool === 'eraser' ? '#ffffff' : this.currentColor,
        size: this.currentTool === 'eraser' ? this.brushSize * 3 : this.brushSize,
        isEraser: this.currentTool === 'eraser'
      };

      this.drawStroke(drawData);

      // Broadcast stroke to peers in the room
      this.socket.emit('whiteboard-draw', {
        roomId: this.roomId,
        drawData
      });

      this.lastX = pos.x;
      this.lastY = pos.y;
    };

    const stopDrawing = () => {
      this.isDrawing = false;
    };

    // Mouse bindings
    this.canvas.addEventListener('mousedown', startDrawing);
    this.canvas.addEventListener('mousemove', draw);
    this.canvas.addEventListener('mouseup', stopDrawing);
    this.canvas.addEventListener('mouseleave', stopDrawing);

    // Touch bindings
    this.canvas.addEventListener('touchstart', startDrawing, { passive: false });
    this.canvas.addEventListener('touchmove', draw, { passive: false });
    this.canvas.addEventListener('touchend', stopDrawing);

    // Toolbar bindings
    const toolPen = document.getElementById('wbToolPen');
    const toolEraser = document.getElementById('wbToolEraser');
    const colorPicker = document.getElementById('wbColorPicker');
    const brushSlider = document.getElementById('wbBrushSlider');
    const btnClear = document.getElementById('wbBtnClear');
    const btnDownload = document.getElementById('wbBtnDownload');

    if (toolPen) {
      toolPen.addEventListener('click', () => {
        this.currentTool = 'pen';
        toolPen.classList.add('active');
        if (toolEraser) toolEraser.classList.remove('active');
      });
    }

    if (toolEraser) {
      toolEraser.addEventListener('click', () => {
        this.currentTool = 'eraser';
        toolEraser.classList.add('active');
        if (toolPen) toolPen.classList.remove('active');
      });
    }

    if (colorPicker) {
      colorPicker.addEventListener('input', (e) => {
        this.currentColor = e.target.value;
        if (this.currentTool === 'eraser' && toolPen) {
          toolPen.click();
        }
      });
    }

    if (brushSlider) {
      brushSlider.addEventListener('input', (e) => {
        this.brushSize = parseInt(e.target.value, 10);
      });
    }

    if (btnClear) {
      btnClear.addEventListener('click', () => {
        if (confirm('Clear the whiteboard for all participants in this room?')) {
          this.clearCanvas();
          this.socket.emit('whiteboard-clear', { roomId: this.roomId });
        }
      });
    }

    if (btnDownload) {
      btnDownload.addEventListener('click', () => {
        const link = document.createElement('a');
        link.download = `whiteboard-${this.roomId}-${Date.now()}.png`;
        link.href = this.canvas.toDataURL('image/png');
        link.click();
      });
    }
  }

  // Draw stroke on local canvas using normalized 0..1 coordinates
  drawStroke({ prevX, prevY, currX, currY, color, size }) {
    if (!this.ctx || !this.canvas) return;

    const w = this.canvas.width;
    const h = this.canvas.height;

    this.ctx.beginPath();
    this.ctx.moveTo(prevX * w, prevY * h);
    this.ctx.lineTo(currX * w, currY * h);
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = size;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.stroke();
    this.ctx.closePath();
  }

  clearCanvas() {
    if (!this.ctx || !this.canvas) return;
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  setupSocketListeners() {
    // Receive stroke from a peer
    this.socket.on('whiteboard-draw', (drawData) => {
      this.drawStroke(drawData);
    });

    // Receive clear action from a peer
    this.socket.on('whiteboard-clear', () => {
      this.clearCanvas();
      if (window.showToast) {
        window.showToast('Whiteboard was cleared by a participant');
      }
    });

    // Receive full history on joining
    this.socket.on('whiteboard-sync-history', (historyList) => {
      if (Array.isArray(historyList)) {
        historyList.forEach((stroke) => this.drawStroke(stroke));
      }
    });
  }
}
