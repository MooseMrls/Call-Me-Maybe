import mongoose from 'mongoose';

const voiceMessageSchema = new mongoose.Schema({
  label: { type: String, required: true, trim: true, maxlength: 80 },
  filename: { type: String, required: true },
  mimeType: { type: String, required: true },
  duration: { type: Number, required: true, default: 0 }, // seconds
  unlockAt: { type: Date, default: null },
  lockDurationSeconds: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model('VoiceMessage', voiceMessageSchema);
