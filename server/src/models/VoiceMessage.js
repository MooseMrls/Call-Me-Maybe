import mongoose from 'mongoose';

const voiceMessageSchema = new mongoose.Schema({
  label: { type: String, required: true, trim: true, maxlength: 80 },
  filename: { type: String, required: true },
  mimeType: { type: String, required: true },
  duration: { type: Number, required: true, default: 0 }, // seconds
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model('VoiceMessage', voiceMessageSchema);
