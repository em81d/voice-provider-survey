import type { SurveyQuestion } from "../types";

const LIKERT_AGREE = [
  "1 - strongly disagree",
  "2 - somewhat disagree",
  "3 - neither agree nor disagree",
  "4 - somewhat agree",
  "5 - strongly agree",
];

export const POST_SURVEY_QUESTIONS: SurveyQuestion[] = [
  { id: "naturalness", question: "The voice sounded natural and human-like.", options: LIKERT_AGREE },
  { id: "responsiveness", question: "The voice responded promptly, without awkward pauses.", options: LIKERT_AGREE },
  { id: "emotional_expressiveness", question: "The voice expressed emotion appropriately during the conversation.", options: LIKERT_AGREE },
  { id: "interruption_handling", question: "The voice handled interruptions or overlapping speech gracefully.", options: LIKERT_AGREE },
  { id: "overall_preference", question: "Overall, I enjoyed talking with this voice.", options: LIKERT_AGREE },
  { id: "comments", question: "Any other comments about this conversation?", placeholder: "Optional feedback...", optional: true },
];