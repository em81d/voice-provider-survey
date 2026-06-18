// backend/src/assignment.ts
//
// In-memory session assignment. Picks a random provider+voice per session
// and keeps it behind an opaque token. Good enough for a single-process
// study of this size — if you ever need multiple server instances or
// restart-survival, swap the Map for sqlite/redis without changing the
// exported function signatures.

import { randomUUID } from "crypto";
import { allVoiceOptions } from "./voiceRegistry";
import type { SessionAssignment } from "./types";

const sessions = new Map<string, SessionAssignment>();

// Creates a new session with a randomly assigned provider+voice, returns
// the token. The assignment itself is never returned to the caller —
// callers that need provider/voiceId must go through getSession(token).
export function createSession(): string {
  const options = allVoiceOptions();
  const pick = options[Math.floor(Math.random() * options.length)];

  const token = randomUUID();
  sessions.set(token, {
    token,
    provider: pick.provider,
    voiceId: pick.voice.id,
    status: "pending",
    startedAt: new Date().toISOString(),
  });

  return token;
}

export function getSession(token: string): SessionAssignment | undefined {
  return sessions.get(token);
}

// Called when the WebSocket connection actually opens, so a token can only
// be used to start one live call. Returns false if the token doesn't exist
// or was already used/completed, so the caller can reject the connection.
export function markActive(token: string): boolean {
  const session = sessions.get(token);
  if (!session || session.status !== "pending") return false;
  session.status = "active";
  return true;
}

export function markCompleted(token: string): boolean {
  const session = sessions.get(token);
  if (!session) return false;
  session.status = "completed";
  return true;
}