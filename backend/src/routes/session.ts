// backend/src/routes/session.ts
//
// REST endpoints for the session lifecycle. These are the only HTTP routes
// a participant's browser talks to before/after the WebSocket call itself.
// Neither route ever returns provider or voiceId to the client — that's
// the whole point of the blind test.

import { Router } from "express";
import { createSession, getSession, markCompleted } from "../assignment";
import { saveResult } from "../resultsStore";
import type { ResultRecord } from "../types";

const router = Router();

// POST /api/session/start
// Creates a new randomized assignment and hands back only the token.
router.post("/start", (_req, res) => {
  const token = createSession();
  res.json({ token });
});

// POST /api/session/result
// Body: { token: string, answers: Record<string, string> }
// Looks up the hidden provider/voice for this token, joins it with the
// submitted survey answers, and writes one record. Rejects tokens that
// don't exist or have already been completed, so a retried request can't
// produce a duplicate row.
router.post("/result", async (req, res) => {
  const { token, answers } = req.body as {
    token?: string;
    answers?: Record<string, string>;
  };

  if (!token || !answers || typeof answers !== "object") {
    return res.status(400).json({ error: "Missing token or answers." });
  }

  const session = getSession(token);
  if (!session) {
    return res.status(404).json({ error: "Unknown session token." });
  }
  if (session.status === "completed") {
    return res.status(409).json({ error: "This session was already submitted." });
  }

  const record: ResultRecord = {
    token: session.token,
    provider: session.provider,
    voiceId: session.voiceId,
    answers,
    startedAt: session.startedAt,
    completedAt: new Date().toISOString(),
  };

  try {
    await saveResult(record);
  } catch (err) {
    console.error("Failed to write result record:", err);
    return res.status(500).json({ error: "Failed to save your responses. Please try again." });
  }

  markCompleted(token);
  res.json({ ok: true });
});

export default router;