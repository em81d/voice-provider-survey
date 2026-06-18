interface LandingProps {
  onStart: () => void;
}

export function Landing({ onStart }: LandingProps) {
  return (
    <div style={{ maxWidth: 560, margin: "4rem auto", textAlign: "center", padding: "0 1.5rem" }}>
      <h1 style={{ fontSize: 28, fontWeight: 600, marginBottom: 12 }}>Voice Conversation Study</h1>
      <p style={{ fontSize: 14, color: "#666", lineHeight: 1.6, margin: 28 }}>
        You'll have a short voice conversation, then answer a few questions about what it was like.
      </p>
      <p style={{ fontSize: 14, color: "#666", lineHeight: 1.6, margin: 20 }}>If you get a chance, see how the voice does with being interrupted, and handling a variety of emotions.</p>
      <button onClick={onStart} style={{ background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 8, padding: "12px 28px", fontSize: 14, fontWeight: 500, cursor: "pointer", marginTop: "20px"}} onMouseEnter={ (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.backgroundColor = '#444'} } onMouseLeave={ (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.backgroundColor = 'black';}}>
        Start
      </button>
    </div>
  );
}