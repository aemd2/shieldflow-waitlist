import { z } from "zod";

export const COMPANY_SIZES = ["1-10", "11-50", "51-200", "200+"] as const;

export const waitlistSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  companyName: z.string().trim().max(120).optional().or(z.literal("")),
  companySize: z.enum(COMPANY_SIZES).optional(),
  painPoint: z.string().trim().max(1000).optional().or(z.literal("")),
  source: z.string().trim().max(120).optional().or(z.literal("")),
  // Honeypot — must be empty.
  website: z.string().max(0).optional(),
});

export type WaitlistPayload = z.infer<typeof waitlistSchema>;
