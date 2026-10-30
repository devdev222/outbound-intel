import { z } from "zod";
import { requireApiRole } from "@/lib/auth";
import { json, readJson } from "@/lib/api";
import { answerQuestion } from "@/lib/engine/ask";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const auth = await requireApiRole(["exec", "admin"]);
  if ("response" in auth) return auth.response;
  const body = await readJson(req, z.object({ question: z.string().min(3).max(500) }));
  if (!body.ok) return body.response;
  return json(await answerQuestion(getStore(), body.data.question));
}
