import { z } from "zod";

/** Request schemas shared by the sequence API routes. */
export const StepSchema = z.object({
  id: z.string().max(64).optional(),
  day: z.number().int().min(0).max(90),
  channel: z.enum(["email", "linkedin", "inmail", "call", "gift"]),
  title: z.string().trim().min(1).max(80),
  templateId: z.string().max(64).nullable().optional(),
  note: z.string().max(300).nullable().optional(),
});

export const AppliesTo = z.object({ industries: z.array(z.string()).max(30).default([]), sizeBands: z.array(z.string()).max(10).default([]), signalKeys: z.array(z.string()).max(30).default([]) });
