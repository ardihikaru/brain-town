import { uniqueId } from '@utils/unique';

/**
 * GitHub organisation webhook payloads, shaped like GitHub's own (fields the town does not read are kept so the
 * "payload is never stored" claims are tested against realistic bodies). Every call gets a unique org and repo.
 * Contract: docs/integrations/github.md.
 */
export type GithubPayload = Record<string, unknown>;

export interface GithubScope {
  org: string;
  repo: string;
  private: boolean;
}

export interface GithubSender {
  login: string;
  type: 'User' | 'Bot';
}

export interface GithubIssue {
  number: number;
  title: string;
  body: string;
  labels: { name: string; color: string }[];
  stateReason?: 'completed' | 'not_planned';
}

export interface GithubPullRequest {
  number: number;
  title: string;
  body: string;
  draft: boolean;
  merged: boolean;
}

export function buildGithubScope(overrides: Partial<GithubScope> = {}): GithubScope {
  return { org: uniqueId('org'), repo: uniqueId('repo'), private: false, ...overrides };
}

export function buildSender(type: GithubSender['type'] = 'User'): GithubSender {
  const login = uniqueId('dev');
  return { login: type === 'Bot' ? `${login}[bot]` : login, type };
}

function number(): number {
  return Math.floor(Math.random() * 9000) + 100;
}

export function buildIssue(overrides: Partial<GithubIssue> = {}): GithubIssue {
  return {
    number: number(),
    title: uniqueId('issue'),
    body: 'Steps to reproduce are in the description.',
    labels: [{ name: 'bug', color: 'd73a4a' }],
    ...overrides,
  };
}

export function buildPullRequest(overrides: Partial<GithubPullRequest> = {}): GithubPullRequest {
  return {
    number: number(),
    title: uniqueId('pr'),
    body: 'Small fix.',
    draft: false,
    merged: false,
    ...overrides,
  };
}

function context(scope: GithubScope, sender: GithubSender): GithubPayload {
  return {
    repository: {
      id: number(),
      name: scope.repo,
      full_name: `${scope.org}/${scope.repo}`,
      private: scope.private,
      owner: { login: scope.org, type: 'Organization' },
      stargazers_count: 0,
    },
    organization: { login: scope.org },
    sender: { login: sender.login, type: sender.type },
  };
}

function issuePart(issue: GithubIssue, state: 'open' | 'closed'): GithubPayload {
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state,
    state_reason: issue.stateReason ?? null,
    labels: issue.labels,
  };
}

/** `ping` as GitHub sends it when an organisation webhook is saved: `hook.events` lists the ticked events. */
export function buildPing(scope: GithubScope, events: string[] = ['issues', 'pull_request']): GithubPayload {
  return {
    zen: 'Keep it logically awesome.',
    hook_id: number(),
    hook: { type: 'Organization', active: true, events, config: { content_type: 'json' } },
    organization: { login: scope.org },
    sender: buildSender(),
  };
}

/** `issues` with the given action (opened, assigned, closed, deleted…). */
export function buildIssuesEvent(
  scope: GithubScope,
  action: string,
  issue: GithubIssue = buildIssue(),
  sender: GithubSender = buildSender(),
): GithubPayload {
  const open = action !== 'closed';
  return {
    action,
    issue: issuePart(issue, open ? 'open' : 'closed'),
    ...(action === 'assigned' ? { assignee: { login: uniqueId('dev'), type: 'User' } } : {}),
    ...context(scope, sender),
  };
}

/** `issue_comment` created. The comment text is unique so tests can prove it is never stored or pushed. */
export function buildIssueComment(
  scope: GithubScope,
  issue: GithubIssue,
  sender: GithubSender = buildSender(),
  text: string = uniqueId('comment'),
): GithubPayload {
  return {
    action: 'created',
    issue: issuePart(issue, 'open'),
    comment: { id: number(), body: text },
    ...context(scope, sender),
  };
}

/** `star` created; `total` is the repository's stargazers_count after the star. */
export function buildStar(scope: GithubScope, total = 1): GithubPayload {
  const payload = context(scope, buildSender());
  (payload.repository as Record<string, unknown>).stargazers_count = total;
  return { action: 'created', starred_at: new Date().toISOString(), ...payload };
}

/** `pull_request` with the given action; set `merged` for a merged close. */
export function buildPullRequestEvent(
  scope: GithubScope,
  action: string,
  pr: GithubPullRequest = buildPullRequest(),
  sender: GithubSender = buildSender(),
): GithubPayload {
  return {
    action,
    number: pr.number,
    pull_request: {
      number: pr.number,
      title: pr.title,
      body: pr.body,
      draft: pr.draft,
      merged: pr.merged,
      state: action === 'closed' ? 'closed' : 'open',
    },
    ...context(scope, sender),
  };
}
