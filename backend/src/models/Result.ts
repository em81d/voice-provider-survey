// backend/src/models/Result.ts
import mongoose from 'mongoose';

const ResultSchema = new mongoose.Schema({
  // Define the fields that match your existing survey data
  timestamp: { type: Date, default: Date.now },
  provider: String,
  voiceId: String,
  data: Object // Or define specific fields
});

export const Result = mongoose.model('Result', ResultSchema);