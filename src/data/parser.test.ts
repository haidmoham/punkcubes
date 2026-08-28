import { describe, expect, it } from 'vitest';

import { assembleDirectoryTree, makeFileNode, parseSymbols, summarizeTree } from './parser';

describe('parser', () => {
  it('finds TypeScript declarations, class methods, and arrow functions', () => {
    const source = [
      'export const palette = ["pink"];',
      'export const orbit = () => 42;',
      'class City {',
      '  population = 9;',
      '  walk() { return this.population; }',
      '}',
      'export function build() { return new City(); }',
    ].join('\n');
    const symbols = parseSymbols('src/city.ts', source);
    const flatten = (nodes: typeof symbols): typeof symbols => nodes.flatMap((node) => [node, ...flatten(node.children)]);
    expect(flatten(symbols).map((symbol) => [symbol.kind, symbol.name])).toEqual([
      ['variable', 'palette'], ['function', 'orbit'], ['variable', 'City.population'],
      ['function', 'City.walk'], ['function', 'build'],
    ]);
    expect(flatten(symbols).find((symbol) => symbol.name === 'build')).toMatchObject({ exported: true, startLine: 7 });
  });

  it('uses useful fallbacks for Python, CSS, and HTML', () => {
    expect(parseSymbols('tools/plot.py', 'def draw(x):\n  return x\ncolor = "acid"').map((item) => item.name)).toEqual(['draw', 'color']);
    expect(parseSymbols('style.css', ':root { --punk: #f0f; }\n.card { color: var(--punk); }').map((item) => item.name)).toEqual(['punk', '.card']);
    expect(parseSymbols('index.html', '<main id="archive" data-view="city"></main>').map((item) => item.name)).toEqual(['archive', 'city']);
  });

  it('assembles a sorted directory hierarchy and rolls metrics into stats', () => {
    const files = [makeFileNode('src/a.ts', 'const spark = 1;'), makeFileNode('README.md', '# Archive')];
    const root = assembleDirectoryTree(files, 'punkcubes');
    expect(root.children.map((child) => child.name)).toEqual(['src', 'README.md']);
    expect(root.lines).toBe(2);
    expect(summarizeTree(root)).toMatchObject({ directories: 1, files: 2, variables: 1, functions: 0, lines: 2 });
  });
});
