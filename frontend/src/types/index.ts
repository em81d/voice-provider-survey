import type { ReactNode } from "react";

export interface SurveyQuestion {
  id: string;
  question: ReactNode;
  placeholder?: string;
  options?: string[];
  // When present, the question is a ranking question: the user orders these
  // attributes from most to least important. The answer is stored as the
  // chosen attributes joined in order (see RANK_DELIM in Survey.tsx).
  ranking?: string[];
  optional?: boolean;
}
