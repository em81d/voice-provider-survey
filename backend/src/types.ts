// backend/src/types.ts
//
// Shared type definitions for the backend. Nothing in here that flows to the
// client (ServerToClientMessage) is allowed to carry a provider or voice
// name — that's the whole point of the blind test. Keeping that boundary
// enforced by the type system means a future "just log the voiceId to the
// client for debugging" slip gets caught at compile time, not in a demo.

// ─── Providers & voices ────────────────────────────────────────────────────

export type ProviderType = "google" | "elevenlabs" | "hume";

export interface VoiceOption {
  id: string;     // provider-specific voice id (e.g. "Puck", an ElevenLabs voice id, a Hume voice id)
  name: string;
  desc: string;
}

export type VoiceRegistry = Record<ProviderType, VoiceOption[]>;

// ─── Session assignment ─────────────────────────────────────────────────────
// What the server picks randomly and keeps hidden from the client behind a
// token. Lives in an in-memory Map in assignment.ts.

export type SessionStatus = "pending" | "active" | "completed";

export interface SessionAssignment {
  token: string;
  provider: ProviderType;
  voiceId: string;
  status: SessionStatus;
  startedAt: string; // ISO timestamp, set when /api/session/start is called
}

// ─── Results storage ─────────────────────────────────────────────────────────
// One record per completed trial, written by resultsStore.ts once the post
// survey is submitted. This is the only place provider/voiceId and the
// user's answers are joined together.

export interface ResultRecord {
  token: string;
  provider: ProviderType;
  voiceId: string;
  answers: Record<string, string>;
  startedAt: string;
  completedAt: string;
}

// ─── WebSocket protocol ────────────────────────────────────────────────────
// Binary frames (raw PCM audio, both directions) aren't represented here —
// only the JSON control/text frames. Audio stays as ArrayBuffer/Buffer on
// the wire and is handled separately in the provider modules.

export type ServerToClientMessage =
  | { type: "session_config"; sampleRate: number }
  | { type: "text"; payload: string }
  | { type: "user_transcript"; payload: string }
  | { type: "interrupted" }
  | { type: "error"; message: string };

export type ClientToServerMessage = { type: "text_input"; payload: string };