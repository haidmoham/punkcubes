import type { LoadingProgress, ProgressReporter, RepositoryRef, RepositorySnapshot } from './types';

const API_ROOT = 'https://api.github.com';
const MAX_FILES = 180;
const MAX_FILE_BYTES = 300_000;
const MAX_TOTAL_BYTES = 5_000_000;
const CONCURRENCY = 8;

interface GitHubRepository {
  default_branch: string;
  description: string | null;
  stargazers_count: number;
}

interface GitTreeItem {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
}

interface GitTreeResponse {
  sha: string;
  truncated: boolean;
  tree: GitTreeItem[];
}

interface GitRefResponse {
  object: { sha: string };
}

function apiError(response: Response, body: unknown): Error {
  const message = typeof body === 'object' && body && 'message' in body ? String(body.message) : response.statusText;
  if (response.status === 403 && /rate limit/i.test(message)) {
    const reset = response.headers.get('x-ratelimit-reset');
    const retryAt = reset ? new Date(Number(reset) * 1000).toLocaleTimeString() : 'later';
    return new Error(`GitHub API rate limit reached. Try again after ${retryAt}, or load a smaller public repository.`);
  }
  if (response.status === 404) return new Error('Repository not found. Check that it is public and that the owner/repository name is correct.');
  return new Error(`GitHub request failed (${response.status}): ${message}`);
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!response.ok) {
    let body: unknown;
    try { body = await response.json(); } catch { body = await response.text(); }
    throw apiError(response, body);
  }
  return response.json() as Promise<T>;
}

function report(onProgress: ProgressReporter | undefined, progress: LoadingProgress): void {
  onProgress?.(progress);
}

/** Parse `owner/repo`, a GitHub web URL, or a git remote URL into an unambiguous public reference. */
export function parseRepositoryRef(input: string): RepositoryRef {
  const value = input.trim().replace(/\/$/, '').replace(/\.git$/, '');
  const ssh = value.match(/^(?:git@)?github\.com[:/]([^/\s]+)\/([^/\s]+)$/i);
  const url = (() => { try { return new URL(value); } catch { return null; } })();
  const parts = ssh
    ? [ssh[1], ssh[2]]
    : url && /(^|\.)github\.com$/i.test(url.hostname)
      ? url.pathname.split('/').filter(Boolean).slice(0, 2)
      : value.split('/').filter(Boolean);
  const [owner, repo] = parts;
  if (!owner || !repo || parts.length !== 2 || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
    throw new Error('Enter a public GitHub repository as “owner/repo” (for example, “haidmoham/fourier-drawing”).');
  }
  return { owner, repo };
}

function sourceCandidates(tree: GitTreeItem[]): GitTreeItem[] {
  let bytes = 0;
  const ignored = /(^|\/)(node_modules|dist|build|coverage|\.git|vendor|\.next)(\/|$)/;
  return tree
    .filter((item) => item.type === 'blob' && !!item.path && !ignored.test(item.path) && (item.size ?? 0) <= MAX_FILE_BYTES)
    .sort((a, b) => (a.size ?? 0) - (b.size ?? 0))
    .filter((item) => {
      if (bytes + (item.size ?? 0) > MAX_TOTAL_BYTES || bytes >= MAX_TOTAL_BYTES || bytes === 0 && false) return false;
      bytes += item.size ?? 0;
      return true;
    })
    .slice(0, MAX_FILES);
}

async function fetchRaw(owner: string, repo: string, commitSha: string, path: string): Promise<string> {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${commitSha}/${encodedPath}`);
  if (!response.ok) {
    let body: unknown;
    try { body = await response.json(); } catch { body = await response.text(); }
    throw apiError(response, body);
  }
  return response.text();
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]!, index);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Load enough source to give the city useful structure while guarding the browser from giant repos. */
export async function loadRepository(input: RepositoryRef, onProgress?: ProgressReporter): Promise<RepositorySnapshot> {
  const { owner, repo } = input;
  report(onProgress, { phase: 'repo', completed: 0, total: 1, detail: `Reading ${owner}/${repo}` });
  const repository = await getJson<GitHubRepository>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
  report(onProgress, { phase: 'repo', completed: 1, total: 1, detail: `Found ${owner}/${repo}` });

  report(onProgress, { phase: 'tree', completed: 0, total: 1, detail: `Mapping ${repository.default_branch}` });
  const ref = await getJson<GitRefResponse>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(repository.default_branch)}`);
  const commitSha = ref.object.sha;
  const tree = await getJson<GitTreeResponse>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${commitSha}?recursive=1`);
  const candidates = sourceCandidates(tree.tree);
  if (candidates.length === 0) throw new Error('This repository has no loadable source files within the visualization limits.');
  report(onProgress, { phase: 'tree', completed: 1, total: 1, detail: `${candidates.length} files selected${tree.truncated ? ' (tree truncated by GitHub)' : ''}` });

  let completed = 0;
  // Keeping this dynamic makes the TypeScript compiler a lazy Vite chunk; the landing
  // experience has no need to download it until a repository is actually requested.
  const { assembleDirectoryTree, makeFileNode, summarizeTree } = await import('./parser');
  report(onProgress, { phase: 'source', completed, total: candidates.length, detail: 'Fetching source files' });
  const files = await mapConcurrent(candidates, CONCURRENCY, async (item) => {
    try {
      const content = await fetchRaw(owner, repo, commitSha, item.path);
      const node = makeFileNode(item.path, content);
      completed += 1;
      report(onProgress, { phase: 'source', completed, total: candidates.length, detail: item.path });
      return node;
    } catch (error) {
      // A single unreadable blob should not blank an otherwise usable public repository.
      completed += 1;
      report(onProgress, { phase: 'source', completed, total: candidates.length, detail: `Skipped ${item.path}` });
      return null;
    }
  });
  const loaded = files.filter((file): file is NonNullable<typeof file> => file !== null);
  if (loaded.length === 0) throw new Error('GitHub returned no readable source files for this repository.');

  report(onProgress, { phase: 'parse', completed: loaded.length, total: loaded.length, detail: 'Building code hierarchy' });
  const root = assembleDirectoryTree(loaded, repo);
  const stats = summarizeTree(root);
  report(onProgress, { phase: 'layout', completed: 1, total: 1, detail: 'Ready to lay out cubes' });
  return {
    owner, repo, defaultBranch: repository.default_branch, commitSha,
    description: repository.description, stars: repository.stargazers_count,
    root, stats, truncated: tree.truncated || candidates.length < tree.tree.filter((item) => item.type === 'blob').length,
    fetchedAt: new Date().toISOString(),
  };
}
