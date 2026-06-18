// frontend/src/components/VoiceCall.tsx
//
// The blind-test call screen. No provider/voice picker, no provider name
// anywhere in the UI — the whole point is the participant can't tell which
// backend they're talking to.

import { useEffect, useRef } from "react";
import { useVoiceSocket } from "../hooks/useVoiceSocket";
import { Waveform } from "./Waveform";

interface VoiceCallProps {
  onFinishCall: (token: string | null) => void; // advances App.tsx to the post-call survey
  minDurationSeconds?: number; // optional floor before "end call" is enabled
}

export function VoiceCall({ onFinishCall, minDurationSeconds = 90 }: VoiceCallProps) {
  const { connectionState, waveLevel, messages, errorMessage, toggleConnection, token } = useVoiceSocket();
  const msgEndRef = useRef<HTMLDivElement>(null);
  const connectedAtRef = useRef<number | null>(null);

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (connectionState === "active" && connectedAtRef.current === null) {
      connectedAtRef.current = Date.now();
    }
    if (connectionState === "idle") {
      connectedAtRef.current = null;
    }
  }, [connectionState]);

  const elapsedOk = () => {
    if (!connectedAtRef.current) return false;
    return (Date.now() - connectedAtRef.current) / 1000 >= minDurationSeconds;
  };

  const handleEndCall = () => {
    toggleConnection(); // disconnects if active
    onFinishCall(token);
  };

  return (
    <div className="vc-root" style={{
      background: "#fff",
      borderRadius: 20,
      border: "1px solid #E5E7EB",
      boxShadow: "0 4px 24px rgba(0,0,0,0.07)",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      maxWidth: 600,
      margin: "2rem auto",
      minHeight: 480,
    }}>
      {/* Header — generic, no provider/voice naming */}
      <div style={{
        padding: "18px 20px",
        borderBottom: "1px solid #F3F4F6",
        display: "flex", alignItems: "center", gap: 12,
        background: "#FAFAFA",
      }}>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#111827" }}>
            Voice Conversation
          </p>
          <p style={{ margin: 0, fontSize: 12, color: "#6B7280" }}>
            {connectionState === "active" ? "Connected" : connectionState === "connecting" ? "Connecting…" : "Not connected"}
          </p>
        </div>
      </div>

      {/* Transcript */}
      <div style={{
        flex: 1, overflowY: "auto", padding: "16px 20px",
        display: "flex", flexDirection: "column", gap: 10,
        minHeight: 200, maxHeight: 260,
      }}>
        {messages.length === 0 ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#9CA3AF", fontSize: 13, textAlign: "center" }}>
            Press the button below to start the conversation.
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} style={{
              alignSelf: msg.sender === "user" ? "flex-end" : "flex-start",
              maxWidth: "76%",
              padding: "9px 13px",
              borderRadius: 14,
              fontSize: 14,
              lineHeight: 1.55,
              background: "#F9FAFB",
              border: "1px solid #F3F4F6",
              color: "#111827",
            }}>
              {msg.text}
            </div>
          ))
        )}
        <div ref={msgEndRef} />
      </div>

      {/* Waveform */}
      <div style={{
        padding: "10px 20px",
        borderTop: "1px solid #F3F4F6",
        borderBottom: "1px solid #F3F4F6",
        background: "#FAFAFA",
        height: 50,
        display: "flex", alignItems: "center",
      }}>
        <Waveform level={waveLevel} />
      </div>

      {/* Error */}
      {errorMessage && (
        <div style={{
          margin: "8px 20px 0", padding: "9px 13px", borderRadius: 10,
          background: "#FEF2F2", border: "1px solid #FECACA",
          fontSize: 12, fontWeight: 500, color: "#B91C1C",
        }} role="alert">
          {errorMessage}
        </div>
      )}

      {/* Controls */}
      <div style={{
        padding: "24px 20px", display: "flex", flexDirection: "column",
        alignItems: "center", gap: 12, background: "#FAFAFA", borderTop: "1px solid #F3F4F6",
      }}>
        <button
          onClick={connectionState === "active" ? handleEndCall : toggleConnection}
          disabled={connectionState === "active" && !elapsedOk()}
          aria-label={connectionState === "active" ? "End call and advance to survey" : "Start conversation"}
          style={
            connectionState === "active"
              ? {
                  padding: "14px 28px", borderRadius: 999, border: "none",
                  background: elapsedOk() ? "#EF4444" : "#FCA5A5",
                  color: "#fff", cursor: elapsedOk() ? "pointer" : "not-allowed",
                  fontSize: 14, fontWeight: 600,
                }
              : {
                  width: 64, height: 64, borderRadius: "50%", border: "none",
                  background: connectionState === "connecting" ? "#F59E0B" : "#4B5563",
                  color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600,
                }
          }
        >
          {connectionState === "active"
            ? "End call & advance to survey"
            : connectionState === "connecting"
            ? "…"
            : "Start"}
        </button>
      </div>
    </div>
  );
}