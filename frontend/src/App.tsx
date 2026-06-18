import { useState } from "react";
import { Landing } from "./components/Landing";
import { VoiceCall } from "./components/VoiceCall";
import Survey from "./components/Survey";
import { ThankYou } from "./components/ThankYou";
import { POST_SURVEY_QUESTIONS } from "./data/postSurveyQuestions";

type Screen = "landing" | "call" | "survey" | "thankyou";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:5000";

export default function App() {
  const [screen, setScreen] = useState<Screen>("landing");
  const [token, setToken] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleFinishCall = (sessionToken: string | null) => {
    setToken(sessionToken);
    setScreen("survey");
  };

  const handleSurveyComplete = async (answers: Record<string, string>) => {
    setSubmitError(null);
    if (!token) {
      setSubmitError("We lost track of your session. Please contact the researcher.");
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/session/result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, answers }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to submit your responses.");
      }
      setScreen("thankyou");
    } catch (err: any) {
      setSubmitError(err.message ?? "Something went wrong submitting your responses.");
    }
  };

  return (
    <div style={{ fontFamily: "system-ui, -apple-system, sans-serif", color: "#1a1a1a" }}>
      {screen === "landing" && <Landing onStart={() => setScreen("call")} />}
      {screen === "call" && <VoiceCall onFinishCall={handleFinishCall} minDurationSeconds={90} />}
      {screen === "survey" && (
        <div>
          <Survey
            title="A few questions about that conversation"
            questions={POST_SURVEY_QUESTIONS}
            onComplete={handleSurveyComplete}
            onBack={() => {}}
          />
          {submitError && <p style={{ textAlign: "center", color: "#B91C1C", fontSize: 13 }}>{submitError}</p>}
        </div>
      )}
      {screen === "thankyou" && <ThankYou />}
    </div>
  );
}