import { z } from "zod";

// The one action that takes a leader id: it is the user's *choice* of who to act as, and the
// server still validates it against app.leaders. An empty string means "no leader" (read-only).
// Mutations never take a leader id; they derive the leader from the cookie.
export const setActingLeaderSchema = z.object({
  leaderId: z.union([z.literal(""), z.string().regex(/^[1-9]\d{0,9}$/)]),
});
export type SetActingLeaderInput = z.infer<typeof setActingLeaderSchema>;
