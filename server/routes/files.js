const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authMiddleware } = require('../middleware/authMiddleware');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Memory index of shared files per room
const roomFilesIndex = {};

// Configure Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate safe filename: timestamp-random-originalName
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueSuffix}-${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// POST /api/files/upload
router.post('/upload', authMiddleware, upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }

    const roomId = req.body.roomId || 'general';
    const fileRecord = {
      id: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      roomId,
      uploader: {
        id: req.user.id,
        name: req.user.name
      },
      downloadUrl: `/api/files/download/${req.file.filename}`,
      uploadedAt: new Date().toISOString()
    };

    if (!roomFilesIndex[roomId]) {
      roomFilesIndex[roomId] = [];
    }
    roomFilesIndex[roomId].push(fileRecord);

    return res.status(201).json({
      success: true,
      message: 'File uploaded successfully',
      file: fileRecord
    });
  } catch (error) {
    console.error('File upload error:', error);
    return res.status(500).json({ success: false, message: 'Server error during file upload.' });
  }
});

// GET /api/files/download/:filename
router.get('/download/:filename', (req, res) => {
  try {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(uploadDir, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'File not found.' });
    }

    // Extract the original file name if possible
    const parts = filename.split('-');
    const originalName = parts.slice(2).join('-') || filename;

    res.download(filePath, originalName);
  } catch (error) {
    console.error('File download error:', error);
    return res.status(500).json({ success: false, message: 'Server error downloading file.' });
  }
});

// GET /api/files/room/:roomId
router.get('/room/:roomId', authMiddleware, (req, res) => {
  try {
    const { roomId } = req.params;
    const files = roomFilesIndex[roomId] || [];
    return res.json({ success: true, files });
  } catch (error) {
    console.error('Error fetching room files:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching room files.' });
  }
});

module.exports = router;
