import type { SurveyQuestion } from "../types";

const LIKERT_AGREE = [
  "1 - strongly disagree",
  "2 - somewhat disagree",
  "3 - neither agree nor disagree",
  "4 - somewhat agree",
  "5 - strongly agree",
];

const LIKERT_AGREE_OPTIONAL = [
  "1 - strongly disagree",
  "2 - somewhat disagree",
  "3 - neither agree nor disagree",
  "4 - somewhat agree",
  "5 - strongly agree",
  "N/A - I didn't try this"
];

export const POST_SURVEY_QUESTIONS: SurveyQuestion[] = [
  { id: "naturalness", question: "The conversation felt natural and human-like.", options: LIKERT_AGREE },
  { id: "naturalness", question: "The voice itself sounded natural and human-like.", options: LIKERT_AGREE },
  { id: "responsiveness", question: "The voice responded promptly, without awkward pauses.", options: LIKERT_AGREE },
  { id: "emotional_expressiveness", question: "The voice expressed (positive/neutral) emotion appropriately during the conversation.", options: LIKERT_AGREE },
  { id: "emotional_expressiveness", question: "The voice was able to express negative emotion (anger, frustration, etc.) during the conversation when pushed.", options: LIKERT_AGREE_OPTIONAL },
  { id: "interruption_handling", question: "The voice handled interruptions or overlapping speech gracefully.", options: LIKERT_AGREE_OPTIONAL },
  { id: "content", question: "The content of the message responses was realistic (i. e. the agent said the kinds of things a real human would say in a conversation)", options: LIKERT_AGREE },
  { id: "overall_preference", question: "Overall, I enjoyed talking with this voice.", options: LIKERT_AGREE },
  { id: "comments", question: "Any other comments about this conversation?", placeholder: "Optional feedback...", optional: true },
];