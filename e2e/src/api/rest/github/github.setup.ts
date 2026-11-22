import type { APIRequestContext } from '@playwright/test';
import { expectJson } from '@api/core/assertions';
import type { AdminClient } from '@api/rest/admin/admin.client';
import type { Integration } from '@api/rest/admin/admin.schemas';
import { GithubClient } from '@api/rest/github/github.client';
import { CreatedGithubIntegrationSchema } from '@api/rest/github/github.schemas';
import { uniqueId } from '@utils/unique';

/** A GitHub integration created for one test, with its webhook secret. */
export interface GithubTarget {
  readonly id: string;
  readonly secret: string;
  /** `/ingest/github/<id>`, relative to BRAIN_TOWN_URL. */
  readonly ingestPath: string;
  readonly integration: Integration;
}

interface SetupDeps {
  apiContextFor: (role: 'admin' | 'anonymous') => Promise<APIRequestContext>;
  adminApi: AdminClient;
  cleanup: { add: (task: () => Promise<unknown>) => void };
}

/**
 * The shared `integration` fixture only knows Bearer-token kinds, so GitHub gets this one-call equivalent:
 * creates the integration through the admin API, registers its deletion, and returns a webhook client.
 */
export async function setupGithub(
  { apiContextFor, adminApi, cleanup }: SetupDeps,
  input: { name?: string; org?: string } = {},
): Promise<{ github: GithubClient; target: GithubTarget }> {
  const created = await expectJson(
    await adminApi.createIntegration({ kind: 'github', name: input.name ?? uniqueId('github'), org: input.org }),
    CreatedGithubIntegrationSchema,
    201,
  );
  cleanup.add(() => adminApi.deleteIntegration(created.integration.id));
  return {
    github: new GithubClient(await apiContextFor('anonymous')),
    target: {
      id: created.integration.id,
      secret: created.token,
      ingestPath: created.ingestPath,
      integration: created.integration,
    },
  };
}
