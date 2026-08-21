import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import VoiceMessage from '../models/VoiceMessage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = file.mimetype.includes('mp4') ? 'm4a'
      : file.mimetype.includes('ogg') ? 'ogg'
      : 'webm';
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB safety cap
});

const router = express.Router();

// List all messages, newest first
router.get('/', async (req, res) => {
  const messages = await VoiceMessage.find().sort({ createdAt: -1 });
  res.json(messages);
});

// Upload a new recording
router.post('/', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file received.' });
    const count = await VoiceMessage.countDocuments();
    const message = await VoiceMessage.create({
      label: (req.body.label || '').trim() || `Message ${count + 1}`,
      filename: req.file.filename,
      mimeType: req.file.mimetype,
      duration: Number(req.body.duration) || 0,
    });
    res.status(201).json(message);
  } catch (err) {
    res.status(500).json({ error: 'Could not save the recording.' });
  }
});

// Delete a recording
router.delete('/:id', async (req, res) => {
  const message = await VoiceMessage.findById(req.params.id);
  if (!message) return res.status(404).json({ error: 'Message not found.' });

  const filePath = path.join(uploadsDir, message.filename);
  fs.unlink(filePath, () => {}); // best-effort file cleanup
  await message.deleteOne();
  res.status(204).end();
});

export default router;
