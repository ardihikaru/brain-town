import { z } from 'zod';

/** 202 body. */
export const AcceptedSchema = z.object({ status: z.literal('accepted'), message: z.literal('accepted') }).strict();
