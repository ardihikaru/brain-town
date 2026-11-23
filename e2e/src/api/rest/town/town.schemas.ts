import { z } from 'zod';

/** GET /api/town (public, masked): contract in docs/api.md. Names are already the public names. */
export const TownRepoSchema = z.object({
  name: z.string(),
  hidden: z.boolean(),
  lastEventAt: z.iso.datetime().optional(),
});

export const TownOwnerSchema = z.object({
  name: z.string(),
  type: z.enum(['', 'user', 'organization']),
  hidden: z.boolean(),
  lastEventAt: z.iso.datetime().optional(),
  repos: z.array(TownRepoSchema),
});

export const TownSnapshotSchema = z.object({
  owners: z.array(TownOwnerSchema),
  unowned: z.array(TownRepoSchema),
});

export type TownOwner = z.infer<typeof TownOwnerSchema>;
export type TownSnapshot = z.infer<typeof TownSnapshotSchema>;
