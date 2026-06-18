// frontend/src/components/Survey.tsx
//
// Generic question-by-question survey renderer, ported from the original
// ChatDashboard's Survey component but decoupled from ChatMode — it takes
// a title + a flat question list, so it works for the post-call survey
// (and any other survey you add later) without dragging along
// systemPrompt/icon/etc. it doesn't need.

import { useState } from "react";
import type { SurveyQuestion } from "../types";

// Ranking answers are stored as one string, items joined in chosen order
// (most important first).
export const RANK_DELIM = " > ";

interface SurveyProps {
  title: string;
  questions: SurveyQuestion[];
  onComplete: (answers: Record<string, string>) => void;
  onBack: () => void;
}

export default function Survey({ title, questions, onComplete, onBack }: SurveyProps) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const question = questions[index];
  const isFirst = index === 0;
  const isLast = index === questions.length - 1;

  const rankingSelection = question.ranking
    ? (answers[question.id]?.split(RANK_DELIM).filter(Boolean) ?? [])
    : [];

  const isAnswered = (): boolean => {
    if (question.ranking) return rankingSelection.length === question.ranking.length;
    if (question.options) return !!answers[question.id];
    if (question.optional) return true;
    return (answers[question.id] ?? "").trim().length > 0;
  };

  const setAnswer = (value: string) => {
    setAnswers((prev) => ({ ...prev, [question.id]: value }));
  };

  const handleRankClick = (item: string) => {
    const idx = rankingSelection.indexOf(item);
    const next = idx === -1 ? [...rankingSelection, item] : rankingSelection.filter((i) => i !== item);
    setAnswer(next.join(RANK_DELIM));
  };

  const handleBack = () => {
    if (isFirst) onBack();
    else setIndex((i) => i - 1);
  };

  const handleNext = () => {
    if (isLast) onComplete(answers);
    else setIndex((i) => i + 1);
  };

  return (
    <div className="qs-screen">
      <style>{`
        .qs-screen { display: flex; flex-direction: column; border: 1px solid #e5e5e5; border-radius: 12px; overflow: hidden; background: #fff; max-width: 680px; margin: 2rem auto; }
        .qs-topbar { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #e5e5e5; }
        .qs-back { background: none; border: 1px solid #e5e5e5; border-radius: 8px; padding: 6px 12px; cursor: pointer; font-size: 13px; color: #555; flex-shrink: 0; }
        .qs-back:hover { background: #f5f5f5; }
        .qs-title { flex: 1; font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .qs-progress { font-size: 12px; color: #888; font-variant-numeric: tabular-nums; flex-shrink: 0; }
        .qs-body { padding: 32px 28px; display: flex; flex-direction: column; gap: 20px; }
        .qs-question h2 { font-size: 19px; font-weight: 600; margin: 0 0 14px; line-height: 1.35; }
        .qs-question p { margin: 0 0 8px; font-size: 14px; color: #555; }
        .qs-options { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
        .qs-option { width: 100%; text-align: left; background: #fafafa; border: 1px solid #e5e5e5; border-radius: 10px; padding: 12px 14px; font-size: 14px; font-family: inherit; color: #1a1a1a; cursor: pointer; transition: border-color 0.15s, background 0.15s; }
        .qs-option:hover { border-color: #aaa; background: #fff; }
        .qs-option.selected { border-color: #1a1a1a; background: #fff; font-weight: 500; }
        .qs-options.ranking .qs-option { display: flex; align-items: center; gap: 10px; }
        .qs-rank-badge { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 22px; height: 22px; border-radius: 999px; border: 1px solid #d0d0d0; background: #f0f0f0; color: #999; font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
        .qs-option.selected .qs-rank-badge { border-color: #1a1a1a; background: #1a1a1a; color: #fff; }
        .qs-body textarea { width: 100%; box-sizing: border-box; resize: vertical; min-height: 110px; border-radius: 10px; padding: 12px 14px; font-size: 14px; font-family: inherit; border: 1px solid #e5e5e5; color: #1a1a1a; background: #fafafa; line-height: 1.6; }
        .qs-body textarea:focus { outline: none; border-color: #aaa; background: #fff; }
        .qs-body textarea::placeholder { color: #aaa; }
        .qs-next { align-self: flex-end; background: #1a1a1a; color: #fff; border: none; border-radius: 8px; padding: 10px 20px; cursor: pointer; font-size: 14px; font-weight: 500; }
        .qs-next:hover { background: #333; }
        .qs-next:disabled { opacity: 0.4; cursor: not-allowed; }
      `}</style>

      <div className="qs-topbar">
        <button className="qs-back" onClick={handleBack} aria-label="Back">← Back</button>
        <span className="qs-title">{title}</span>
        <span className="qs-progress">{index + 1} of {questions.length}</span>
      </div>

      <div className="qs-body">
        <div className="qs-question">{question.question}</div>

        {question.ranking ? (
          <ul className="qs-options ranking">
            {question.ranking.map((item) => {
              const rank = rankingSelection.indexOf(item);
              const selected = rank !== -1;
              return (
                <li key={item}>
                  <button type="button" className={`qs-option${selected ? " selected" : ""}`} onClick={() => handleRankClick(item)}>
                    <span className="qs-rank-badge">{selected ? rank + 1 : ""}</span>
                    {item}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : question.options ? (
          <ul className="qs-options">
            {question.options.map((opt) => (
              <li key={opt}>
                <button type="button" className={`qs-option${answers[question.id] === opt ? " selected" : ""}`} onClick={() => setAnswer(opt)}>
                  {opt}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <textarea value={answers[question.id] ?? ""} onChange={(e) => setAnswer(e.target.value)} placeholder={question.placeholder} />
        )}

        <button className="qs-next" onClick={handleNext} disabled={!isAnswered()}>
          {isLast ? "Finish" : "Next"}
        </button>
      </div>
    </div>
  );
}