interface LandingProps {
  onStart: () => void;
}

export function Landing({ onStart }: LandingProps) {
  return (
    <div style={{ maxWidth: 560, margin: "4rem auto", textAlign: "center", padding: "0 1.5rem" }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 12 }}>Voice Conversation Study</h1>
      <p style={{ fontSize: 14, color: "#666", lineHeight: 1.6, marginBottom: 28 }}>
        You'll have a short voice conversation, then answer a few questions about what it was like.
        Just chat naturally for a couple of minutes.
      </p>
      <button onClick={onStart} style={{ background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 8, padding: "12px 28px", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
        Start
      </button>
    </div>
  );
}