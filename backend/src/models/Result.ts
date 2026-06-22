// backend/src/models/Result.ts
import mongoose from 'mongoose';

// One sub-document holding the post-survey answers. The field names mirror the
// question `id`s in frontend/src/data/postSurveyQuestions.ts — keep the two in
// sync when you add/rename a question. Everything is a String because that's
// exactly what Survey.tsx submits (Likert options and free-text are all stored
// as strings, keyed by question id).
const AnswersSchema = new mongoose.Schema(
  {
    conversation_naturalness: String,
    voice_naturalness: String,
    responsiveness: String,
    emotional_expressiveness: String,
    negative_emotional_expressiveness: String,
    interruption_handling: String,
    content: String,
    overall_preference: String,
    comments: String,
  },
  { _id: false }
);

// One record per completed trial. Matches the ResultRecord shape built in
// backend/src/routes/session.ts.
const ResultSchema = new mongoose.Schema({
  token: String,                          // session token that produced this trial
  provider: String,                       // hidden provider under test (google/elevenlabs/hume)
  voiceId: String,                        // hidden voice id under test
  answers: AnswersSchema,                 // the participant's post-survey answers
  startedAt: String,                      // ISO timestamp from /api/session/start
  completedAt: String,                    // ISO timestamp when the survey was submitted
  timestamp: { type: Date, default: Date.now }, // server-side insert time
});

export const Result = mongoose.model('Result', ResultSchema);
