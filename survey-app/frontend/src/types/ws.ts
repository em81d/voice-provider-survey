// frontend/src/types/ws.ts
// Mirrors backend/src/types.ts's WS message shapes. Kept in sync manually
// since frontend/backend are separate npm projects with no shared package.

export type ServerToClientMessage =
  | { type: "session_config"; sampleRate: number }
  | { type: "text"; payload: string }
  | { type: "user_transcript"; payload: string }
  | { type: "interrupted" }
  | { type: "error"; message: string };

export type ConnectionState = "idle" | "connecting" | "active";
export type WaveLevel = "idle" | "loading" | "active";

export interface TranscriptMessage {
  id: string;
  sender: "user" | "ai";
  text: string;
  timestamp: Date;
}