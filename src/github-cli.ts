/**
 * GitHub CLI Abstraction Layer
 *
 * Provides a type-safe wrapper around gh CLI commands to replace Octokit API calls.
 * Uses @actions/exec to execute gh commands and parse responses.
 */

import * as core from "@actions/core";
import * as exec from "@actions/exec";

/**
 * Type definitions matching Octokit response structures
 */
export interface Label {
  name: string;
  description?: string;
  color?: string;
}

export interface Issue {
  number: number;
  title: string;
  body?: string;
  state?: string;
  node_id?: string;
}

export interface PullRequest {
  number: number;
  title: string;
  user: { login: string };
  created_at: string;
  head: {
    ref: string;
    sha: string;
    repo: { owner: { login: string } } | null;
  };
  draft: boolean;
  mergeable_state: string;
}

export interface PRNode {
  createdAt: string;
  title: string;
  number: number;
  isDraft: boolean;
  headRefName: string;
  headRefOid: string;
  reviewDecision: string | null;
  mergeable: string;
}

export interface FileContent {
  content: string;
  encoding: string;
  sha: string;
}

/**
 * Error type for exec errors
 */
interface ExecError extends Error {
  exitCode?: number;
  stderr?: string;
}

/**
 * Helper: Check if error is from exec
 */
function isExecError(error: unknown): error is ExecError {
  return error instanceof Error && ('exitCode' in error || 'stderr' in error);
}

/**
 * Helper: Parse HTTP status code from gh CLI error output
 */
function parseHttpStatus(error: ExecError): number | null {
  const message = error.message || error.stderr || '';

  // Common patterns in gh CLI errors
  if (message.includes('404') || message.includes('Not Found')) return 404;
  if (message.includes('409') || message.includes('Conflict')) return 409;
  if (message.includes('422') || message.includes('Unprocessable')) return 422;
  if (message.includes('403') || message.includes('Forbidden')) return 403;
  if (message.includes('401') || message.includes('Unauthorized')) return 401;

  return null;
}

/**
 * Helper: Execute gh command and return stdout
 */
async function execGh(args: string[]): Promise<string> {
  const output = await exec.getExecOutput('gh', args, {
    silent: true,
    ignoreReturnCode: false,
  });
  return output.stdout.trim();
}

/**
 * Helper: Execute gh command without expecting output
 */
async function execGhVoid(args: string[]): Promise<void> {
  await exec.exec('gh', args, {
    silent: true,
    ignoreReturnCode: false,
  });
}

/**
 * Helper: Execute gh API call
 */
async function execGhApi(endpoint: string, options: {
  method?: string;
  fields?: Record<string, string>;
  flags?: Record<string, string | boolean>;
  jq?: string;
} = {}): Promise<string> {
  const args = ['api', endpoint];

  if (options.method && options.method !== 'GET') {
    args.push('-X', options.method);
  }

  if (options.fields) {
    for (const [key, value] of Object.entries(options.fields)) {
      args.push('-f', `${key}=${value}`);
    }
  }

  if (options.flags) {
    for (const [key, value] of Object.entries(options.flags)) {
      if (typeof value === 'boolean' && value) {
        args.push('-F', `${key}=${value}`);
      } else if (typeof value === 'string') {
        args.push('-F', `${key}=${value}`);
      }
    }
  }

  if (options.jq) {
    args.push('--jq', options.jq);
  }

  return execGh(args);
}

// ============================================================================
// LABEL OPERATIONS
// ============================================================================

/**
 * List labels in a repository
 */
export async function listLabels(owner: string, repo: string): Promise<Label[]> {
  try {
    const output = await execGh([
      'label', 'list',
      '--repo', `${owner}/${repo}`,
      '--limit', '100',
      '--json', 'name,description,color',
    ]);
    return JSON.parse(output);
  } catch (e) {
    core.warning(`Failed to list labels: ${e}`);
    return [];
  }
}

/**
 * Create a label
 */
export async function createLabel(
  owner: string,
  repo: string,
  name: string,
  description: string,
  color: string,
): Promise<void> {
  await execGhVoid([
    'label', 'create', name,
    '--repo', `${owner}/${repo}`,
    '--description', description,
    '--color', color,
  ]);
}

// ============================================================================
// ISSUE OPERATIONS
// ============================================================================

/**
 * List issues in a repository
 */
export async function listIssues(
  owner: string,
  repo: string,
  state: 'open' | 'closed' | 'all',
  limit: number,
): Promise<Issue[]> {
  const output = await execGh([
    'issue', 'list',
    '--repo', `${owner}/${repo}`,
    '--state', state,
    '--limit', limit.toString(),
    '--json', 'number,title,state',
  ]);
  return JSON.parse(output);
}

/**
 * Create an issue
 */
export async function createIssue(
  owner: string,
  repo: string,
  title: string,
  body: string,
  labels?: string[],
): Promise<number> {
  const args = [
    'issue', 'create',
    '--repo', `${owner}/${repo}`,
    '--title', title,
    '--body', body,
  ];

  if (labels && labels.length > 0) {
    args.push('--label', labels.join(','));
  }

  const output = await execGh(args);

  // Extract issue number from URL (e.g., "https://github.com/owner/repo/issues/123")
  const match = output.match(/\/issues\/(\d+)/);
  if (!match) {
    throw new Error(`Failed to parse issue number from: ${output}`);
  }

  return parseInt(match[1], 10);
}

/**
 * Update an issue
 */
export async function updateIssue(
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
): Promise<void> {
  await execGhVoid([
    'issue', 'edit', issueNumber.toString(),
    '--repo', `${owner}/${repo}`,
    '--body', body,
  ]);
}

/**
 * Lock an issue
 */
export async function lockIssue(
  owner: string,
  repo: string,
  issueNumber: number,
  reason: 'resolved' | 'off-topic' | 'too heated' | 'spam',
): Promise<void> {
  await execGhVoid([
    'issue', 'lock', issueNumber.toString(),
    '--repo', `${owner}/${repo}`,
    '--reason', reason,
  ]);
}

/**
 * Comment on an issue or PR
 */
export async function commentOnIssue(
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
): Promise<void> {
  await execGhVoid([
    'issue', 'comment', issueNumber.toString(),
    '--repo', `${owner}/${repo}`,
    '--body', body,
  ]);
}

/**
 * Pin an issue
 */
export async function pinIssue(
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<void> {
  await execGhVoid([
    'issue', 'pin', issueNumber.toString(),
    '--repo', `${owner}/${repo}`,
  ]);
}

// ============================================================================
// PULL REQUEST OPERATIONS
// ============================================================================

/**
 * Get pull request details
 */
export async function getPullRequest(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PullRequest> {
  const output = await execGh([
    'pr', 'view', prNumber.toString(),
    '--repo', `${owner}/${repo}`,
    '--json', 'number,title,author,createdAt,headRefName,headRepositoryOwner,draft,mergeStateStatus',
  ]);

  const pr = JSON.parse(output);

  // Transform to match Octokit structure
  return {
    number: pr.number,
    title: pr.title,
    user: { login: pr.author?.login || '' },
    created_at: pr.createdAt,
    head: {
      ref: pr.headRefName,
      sha: '', // Not available in basic PR view, would need separate call
      repo: pr.headRepositoryOwner ? { owner: { login: pr.headRepositoryOwner.login } } : null,
    },
    draft: pr.draft,
    mergeable_state: pr.mergeStateStatus,
  };
}

/**
 * Update PR branch (merge base branch into PR)
 */
export async function updatePullRequestBranch(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<void> {
  await execGhApi(`repos/${owner}/${repo}/pulls/${prNumber}/update-branch`, {
    method: 'POST',
  });
}

/**
 * Merge a pull request
 */
export async function mergePullRequest(
  owner: string,
  repo: string,
  prNumber: number,
  mergeMethod: 'merge' | 'squash' | 'rebase',
): Promise<void> {
  const methodFlag = `--${mergeMethod}`;

  await execGhVoid([
    'pr', 'merge', prNumber.toString(),
    '--repo', `${owner}/${repo}`,
    methodFlag,
  ]);
}

/**
 * Fetch open PRs
 */
export async function fetchOpenPRs(
  owner: string,
  repo: string,
  baseBranch: string,
): Promise<PRNode[]> {
  const output = await execGh([
    'pr', 'list',
    '--repo', `${owner}/${repo}`,
    '--base', baseBranch,
    '--state', 'open',
    '--limit', '100',
    '--json', 'createdAt,title,number,isDraft,headRefName,headRefOid,reviewDecision,mergeable',
  ]);

  return JSON.parse(output);
}

// ============================================================================
// GIT REFERENCE OPERATIONS
// ============================================================================

/**
 * Get branch SHA
 */
export async function getRef(
  owner: string,
  repo: string,
  branch: string,
): Promise<string> {
  const output = await execGhApi(`repos/${owner}/${repo}/git/ref/heads/${branch}`, {
    jq: '.object.sha',
  });
  return output;
}

/**
 * Create a git reference (branch)
 */
export async function createRef(
  owner: string,
  repo: string,
  branch: string,
  sha: string,
): Promise<void> {
  await execGhApi(`repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    fields: {
      ref: `refs/heads/${branch}`,
      sha,
    },
  });
}

/**
 * Update a git reference (force push branch)
 */
export async function updateRef(
  owner: string,
  repo: string,
  branch: string,
  sha: string,
  force: boolean = true,
): Promise<void> {
  await execGhApi(`repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    fields: { sha },
    flags: { force },
  });
}

/**
 * Delete a git reference (branch)
 */
export async function deleteRef(
  owner: string,
  repo: string,
  branch: string,
): Promise<void> {
  try {
    await execGhApi(`repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      method: 'DELETE',
    });
  } catch (e) {
    // Ignore 404 errors (branch doesn't exist)
    if (isExecError(e) && parseHttpStatus(e) === 404) {
      return;
    }
    throw e;
  }
}

// ============================================================================
// REPOSITORY OPERATIONS
// ============================================================================

/**
 * Compare commits between two refs
 */
export async function compareCommits(
  owner: string,
  repo: string,
  base: string,
  head: string,
): Promise<number | null> {
  try {
    const output = await execGhApi(`repos/${owner}/${repo}/compare/${base}...${head}`, {
      jq: '.behind_by // 0',
    });
    return parseInt(output, 10);
  } catch (e) {
    core.warning(`compareCommits failed for ${base}..${head}: ${e}`);
    return null;
  }
}

/**
 * Create a commit status
 */
export async function createCommitStatus(
  owner: string,
  repo: string,
  sha: string,
  state: 'error' | 'failure' | 'pending' | 'success',
  context: string,
  description: string,
): Promise<void> {
  await execGhApi(`repos/${owner}/${repo}/statuses/${sha}`, {
    method: 'POST',
    fields: {
      state,
      context,
      description,
    },
  });
}

/**
 * Merge two branches (repository merge)
 */
export async function mergeBranches(
  owner: string,
  repo: string,
  base: string,
  head: string,
): Promise<{ sha: string | null; conflict: boolean }> {
  try {
    const output = await execGhApi(`repos/${owner}/${repo}/merges`, {
      method: 'POST',
      fields: { base, head },
      jq: '.sha',
    });
    return { sha: output, conflict: false };
  } catch (e) {
    if (isExecError(e) && parseHttpStatus(e) === 409) {
      return { sha: null, conflict: true };
    }
    throw e;
  }
}

// ============================================================================
// CONTENT OPERATIONS
// ============================================================================

/**
 * Get file contents from repository
 */
export async function getFileContents(
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<FileContent> {
  const output = await execGhApi(`repos/${owner}/${repo}/contents/${path}`, {
    fields: { ref },
    jq: '{content, encoding, sha}',
  });

  return JSON.parse(output);
}

/**
 * Create or update file in repository
 */
export async function putFileContents(
  owner: string,
  repo: string,
  path: string,
  branch: string,
  message: string,
  content: string,
  sha?: string,
): Promise<string> {
  const fields: Record<string, string> = {
    message,
    content,
    branch,
  };

  if (sha) {
    fields.sha = sha;
  }

  const output = await execGhApi(`repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    fields,
    jq: '.content.sha',
  });

  return output;
}
