import { z } from 'zod';

/**
 * Error envelope shared by every Brain Town endpoint: { error: "<message>" }.
 * Ingest adds `field` on 422 (and on 409, where it is "id") to name the rejected field.
 */
export const ApiErrorSchema = z.object({
  error: z.string().min(1),
  field: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
