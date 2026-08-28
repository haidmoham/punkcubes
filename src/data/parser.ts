import ts from 'typescript';

import type { CodeLanguage, CodeNode, RepositoryStats } from './types';

const LANGUAGE_BY_EXTENSION: Record<string, CodeLanguage> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', css: 'css', scss: 'css', sass: 'css', html: 'html', htm: 'html',
  json: 'json', md: 'markdown', mdx: 'markdown',
};

export function languageForPath(path: string): CodeLanguage {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  return LANGUAGE_BY_EXTENSION[extension] ?? 'other';
}

export function lineCount(source: string): number {
  return source.length === 0 ? 0 : source.split(/\r\n|\r|\n/).length;
}

function nodeId(kind: CodeNode['kind'], path: string, name: string, startLine?: number): string {
  return `${kind}:${path}:${startLine ?? 0}:${name}`;
}

function rangeLines(source: ts.SourceFile, node: ts.Node): Pick<CodeNode, 'startLine' | 'endLine' | 'lines'> {
  const startLine = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const endLine = source.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
  return { startLine, endLine, lines: Math.max(1, endLine - startLine + 1) };
}

function hasExport(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function nameFromProperty(name: ts.PropertyName | undefined): string | null {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return name.getText();
}

function makeSymbol(
  kind: 'function' | 'variable', path: string, language: CodeLanguage, name: string,
  source: ts.SourceFile, declaration: ts.Node, exported = false,
): CodeNode {
  const range = rangeLines(source, declaration);
  return {
    id: nodeId(kind, path, name, range.startLine), name, path, kind, language,
    bytes: declaration.getWidth(source), exported, children: [], ...range,
  };
}

function parseTypeScript(path: string, content: string, language: CodeLanguage): CodeNode[] {
  const scriptKind = path.endsWith('.tsx') || path.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.JS;
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, scriptKind);
  const symbols: CodeNode[] = [];
  const append = (symbol: CodeNode, scope?: CodeNode) => (scope ? scope.children.push(symbol) : symbols.push(symbol));
  const visit = (node: ts.Node, className?: string, scope?: CodeNode) => {
    let nextScope = scope;
    if (ts.isFunctionDeclaration(node) && node.name) {
      nextScope = makeSymbol('function', path, language, node.name.text, source, node, hasExport(node));
      append(nextScope, scope);
    } else if ((ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) && node.name) {
      const name = nameFromProperty(node.name);
      if (name) {
        nextScope = makeSymbol('function', path, language, className ? `${className}.${name}` : name, source, node, hasExport(node));
        append(nextScope, scope);
      }
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const parent = node.parent;
      const statement = parent.parent;
      const initializer = node.initializer;
      const isFunction = !!initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer));
      const exported = ts.isVariableStatement(statement) && hasExport(statement);
      const symbol = makeSymbol(isFunction ? 'function' : 'variable', path, language, node.name.text, source, node, exported);
      append(symbol, scope);
      if (isFunction) nextScope = symbol;
    } else if (ts.isPropertyDeclaration(node) && node.name) {
      const name = nameFromProperty(node.name);
      if (name) append(makeSymbol('variable', path, language, className ? `${className}.${name}` : name, source, node, hasExport(node)), scope);
    }
    const nextClass = ts.isClassDeclaration(node) && node.name ? node.name.text : className;
    ts.forEachChild(node, (child) => visit(child, nextClass, nextScope));
  };
  visit(source);
  return symbols;
}

function regexSymbols(path: string, content: string, language: CodeLanguage): CodeNode[] {
  const output: CodeNode[] = [];
  const add = (kind: 'function' | 'variable', name: string, index: number, width: number, exported = false) => {
    const startLine = content.slice(0, index).split(/\r\n|\r|\n/).length;
    const endLine = startLine + Math.max(0, content.slice(index, index + width).split(/\r\n|\r|\n/).length - 1);
    output.push({ id: nodeId(kind, path, name, startLine), name, path, kind, language, bytes: width,
      lines: Math.max(1, endLine - startLine + 1), startLine, endLine, exported, children: [] });
  };
  const collect = (pattern: RegExp, kind: 'function' | 'variable', group = 1) => {
    for (const match of content.matchAll(pattern)) {
      const name = match[group];
      if (name) add(kind, name, match.index ?? 0, match[0].length, /^export\s/.test(match[0]));
    }
  };
  if (language === 'python') {
    collect(/^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\([^\n]*\)\s*:/gm, 'function');
    collect(/^([A-Za-z_]\w*)\s*(?::[^=\n]+)?=(?!=)/gm, 'variable');
  } else if (language === 'css') {
    collect(/--([\w-]+)\s*:/g, 'variable');
    collect(/(?:^|\n)\s*([.#][\w-]+(?:\s*[>+~]\s*[.#]?[\w-]+)*)\s*\{/g, 'variable');
  } else if (language === 'html') {
    collect(/\b(?:id|data-[\w-]+)\s*=\s*["']([^"']+)["']/gi, 'variable');
  }
  return output;
}

export function parseSymbols(path: string, content: string): CodeNode[] {
  const language = languageForPath(path);
  if (language === 'typescript' || language === 'javascript') return parseTypeScript(path, content, language);
  return regexSymbols(path, content, language);
}

export function makeFileNode(path: string, content: string): CodeNode {
  const name = path.split('/').pop() || path;
  return {
    id: nodeId('file', path, name), name, path, kind: 'file', language: languageForPath(path),
    lines: lineCount(content), bytes: new TextEncoder().encode(content).byteLength,
    children: parseSymbols(path, content),
  };
}

/** Assemble slash-delimited file nodes into directories while rolling size metrics upward. */
export function assembleDirectoryTree(files: CodeNode[], rootName = 'repository'): CodeNode {
  const root: CodeNode = { id: 'directory:', name: rootName, path: '', kind: 'directory', language: 'other', lines: 0, bytes: 0, children: [] };
  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    let cursor = root;
    let partial = '';
    for (const part of parts.slice(0, -1)) {
      partial = partial ? `${partial}/${part}` : part;
      let directory = cursor.children.find((child) => child.kind === 'directory' && child.name === part);
      if (!directory) {
        directory = { id: nodeId('directory', partial, part), name: part, path: partial, kind: 'directory', language: 'other', lines: 0, bytes: 0, children: [] };
        cursor.children.push(directory);
      }
      cursor = directory;
    }
    cursor.children.push(file);
  }
  const rollup = (node: CodeNode): void => {
    node.children.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : (a.kind === 'directory' ? -1 : 1));
    for (const child of node.children) rollup(child);
    if (node.kind === 'directory') {
      node.lines = node.children.reduce((total, child) => total + child.lines, 0);
      node.bytes = node.children.reduce((total, child) => total + child.bytes, 0);
    }
  };
  rollup(root);
  return root;
}

export function summarizeTree(root: CodeNode): RepositoryStats {
  const stats: RepositoryStats = { directories: 0, files: 0, functions: 0, variables: 0, lines: 0 };
  const walk = (node: CodeNode) => {
    if (node.kind === 'directory') stats.directories += 1;
    if (node.kind === 'file') { stats.files += 1; stats.lines += node.lines; }
    if (node.kind === 'function') stats.functions += 1;
    if (node.kind === 'variable') stats.variables += 1;
    node.children.forEach(walk);
  };
  walk(root);
  // The synthetic root is useful visually but should not inflate repo counts.
  stats.directories = Math.max(0, stats.directories - 1);
  return stats;
}
