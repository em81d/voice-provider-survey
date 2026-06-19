// backend/src/resultsStore.ts
import { Result } from "./models/Result";

export async function saveResult(record: any): Promise<void> {
  // Instead of fs.appendFile, we just tell Mongoose to save it
  const newResult = new Result(record);
  await newResult.save();
}