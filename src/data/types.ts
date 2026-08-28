export type CodeNodeKind = 'directory' | 'file' | 'function' | 'variable';

export type CodeLanguage =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'css'
  | 'html'
  | 'json'
  | 'markdown'
  | 'other';

export interface CodeNode {
  id: string;
  name: string;
  path: string;
  kind: CodeNodeKind;
  language: CodeLanguage;
  lines: number;
  bytes: number;
  startLine?: number;
  endLine?: number;
  exported?: boolean;
  children: CodeNode[];
}

export interface RepositoryStats {
  directories: number;
  files: number;
  functions: number;
  variables: number;
  lines: number;
}

export interface RepositorySnapshot {
  owner: string;
  repo: string;
  defaultBranch: string;
  commitSha: string;
  description: string | null;
  stars: number;
  root: CodeNode;
  stats: RepositoryStats;
  truncated: boolean;
  fetchedAt: string;
}

export interface RepositoryRef {
  owner: string;
  repo: string;
}

export interface LoadingProgress {
  phase: 'repo' | 'tree' | 'source' | 'parse' | 'layout';
  completed: number;
  total: number;
  detail: string;
}

export type ProgressReporter = (progress: LoadingProgress) => void;
