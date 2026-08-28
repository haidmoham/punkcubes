import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadRepository, parseRepositoryRef } from './github';

describe('parseRepositoryRef', () => {
  it('accepts owner/repo, web URLs, and SSH remotes', () => {
    expect(parseRepositoryRef('haidmoham/fourier-drawing')).toEqual({ owner: 'haidmoham', repo: 'fourier-drawing' });
    expect(parseRepositoryRef('https://github.com/haidmoham/fourier-drawing/')).toEqual({ owner: 'haidmoham', repo: 'fourier-drawing' });
    expect(parseRepositoryRef('git@github.com:haidmoham/fourier-drawing.git')).toEqual({ owner: 'haidmoham', repo: 'fourier-drawing' });
  });

  it('rejects ambiguous references', () => {
    expect(() => parseRepositoryRef('fourier-drawing')).toThrow(/owner\/repo/);
    expect(() => parseRepositoryRef('https://example.com/a/b')).toThrow(/owner\/repo/);
  });
});

describe('loadRepository', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('loads the default branch tree, parses source, and reports progress', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/repos/octo/city')) return Response.json({ default_branch: 'main', description: 'tiny city', stargazers_count: 8 });
      if (url.endsWith('/git/ref/heads/main')) return Response.json({ object: { sha: 'commit-sha' } });
      if (url.includes('/git/trees/commit-sha')) return Response.json({ sha: 'tree-sha', truncated: false, tree: [
        { path: 'src/city.ts', type: 'blob', sha: 'one', size: 40 },
        { path: 'README.md', type: 'blob', sha: 'two', size: 20 },
      ] });
      if (url.endsWith('/octo/city/commit-sha/src/city.ts')) return new Response('export function glow() {}\nconst pigment = 1;');
      if (url.endsWith('/octo/city/commit-sha/README.md')) return new Response('# City');
      return new Response('no', { status: 404 });
    });
    vi.stubGlobal('fetch', fetch);
    const progress: string[] = [];
    const snapshot = await loadRepository({ owner: 'octo', repo: 'city' }, (item) => progress.push(item.phase));
    expect(snapshot).toMatchObject({ owner: 'octo', repo: 'city', defaultBranch: 'main', commitSha: 'commit-sha', stars: 8 });
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/raw\.githubusercontent\.com\/octo\/city\/commit-sha\//));
    expect(snapshot.stats).toMatchObject({ files: 2, functions: 1, variables: 1 });
    expect(progress).toContain('layout');
  });

  it('turns GitHub rate limits into an actionable message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'API rate limit exceeded' }), { status: 403, headers: { 'x-ratelimit-reset': '0' } })));
    await expect(loadRepository({ owner: 'octo', repo: 'city' })).rejects.toThrow(/rate limit/i);
  });
});
