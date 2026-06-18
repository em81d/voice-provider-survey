// backend/src/resultsStore.ts
//
// Persists completed trials to disk as JSONL (one JSON object per line) —
// simple to append to, simple to inspect by eye, and trivial to load into
// pandas/Excel later. Swap this for a real DB only if the study grows
// past "one researcher, one machine."

import { appendFile, mkdir } from "fs/promises";
import path from "path";
import type { ResultRecord } from "./types";

// Resolves relative to this file's location rather than process.cwd(), so
// the path is correct no matter where `npm run` is invoked from.
const RESULTS_DIR = path.join(__dirname, "..", "results");
const RESULTS_FILE = path.join(RESULTS_DIR, "results.jsonl");

async function ensureResultsDir(): Promise<void> {
  await mkdir(RESULTS_DIR, { recursive: true });
}

// Appends one completed trial. Throws on failure — the caller (the
// /api/session/result route) should catch this and return a 500 rather
// than silently telling the participant their data was saved when it
// wasn't.
export async function saveResult(record: ResultRecord): Promise<void> {
  await ensureResultsDir();
  const line = JSON.stringify(record) + "\n";
  await appendFile(RESULTS_FILE, line, "utf-8");
}