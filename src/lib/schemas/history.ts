import { z } from "zod";

// A seat id for the history read: a positive integer that fits Postgres `integer`.
export const seatIdSchema = z.number().int().positive().max(2_147_483_647);
