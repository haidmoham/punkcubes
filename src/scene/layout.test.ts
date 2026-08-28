import { describe, expect, it } from 'vitest';
import type { CodeNode } from '../data/types';
import { buildRepositoryLayout } from './layout';
import type { LayoutCube } from './types';

const node = (
  id: string,
  kind: CodeNode['kind'],
  lines: number,
  children: CodeNode[] = [],
): CodeNode => ({
  id,
  name: id,
  path: id,
  kind,
  language: 'typescript',
  lines,
  bytes: lines * 20,
  children,
});

const sampleRoot = (): CodeNode =>
  node('repo', 'directory', 0, [
    node('src', 'directory', 0, [
      node('src/a.ts', 'file', 30, [
        node('src/a.ts#small', 'function', 4, [node('src/a.ts#v', 'variable', 1)]),
        node('src/a.ts#big', 'function', 220, [
          node('src/a.ts#one', 'variable', 1),
          node('src/a.ts#two', 'variable', 1),
          node('src/a.ts#three', 'variable', 1),
        ]),
      ]),
      node('src/b.ts', 'file', 1),
      node('src/c.ts', 'file', 900),
    ]),
    node('docs', 'directory', 0, [node('docs/readme.md', 'file', 70)]),
    node('package.json', 'file', 8),
  ]);

const reverseTreeChildren = (current: CodeNode): void => {
  current.children.reverse();
  current.children.forEach(reverseTreeChildren);
};

const intervalOverlaps = (a: LayoutCube, b: LayoutCube, axis: 'x' | 'y' | 'z'): boolean =>
  Math.abs(a.center[axis] - b.center[axis]) < (a.size + b.size) / 2 - 1e-9;

const overlaps = (a: LayoutCube, b: LayoutCube): boolean =>
  intervalOverlaps(a, b, 'x') && intervalOverlaps(a, b, 'y') && intervalOverlaps(a, b, 'z');

describe('buildRepositoryLayout', () => {
  it('is deterministic even when input children arrive in a different order', () => {
    const first = buildRepositoryLayout(sampleRoot());
    const reversed = sampleRoot();
    reverseTreeChildren(reversed);
    const second = buildRepositoryLayout(reversed);

    expect(second).toEqual(first);
  });

  it('keeps siblings and independent files physically separate', () => {
    const layout = buildRepositoryLayout(sampleRoot());
    for (let index = 0; index < layout.cubes.length; index += 1) {
      for (let other = index + 1; other < layout.cubes.length; other += 1) {
        const a = layout.cubes[index]!;
        const b = layout.cubes[other]!;
        if (a.parentId === b.parentId || (a.depth === 0 && b.depth === 0)) {
          expect(overlaps(a, b), `${a.node.id} overlapped ${b.node.id}`).toBe(false);
        }
      }
    }
  });

  it('places every child entirely within its cube parent', () => {
    const layout = buildRepositoryLayout(sampleRoot());
    const byId = new Map(layout.cubes.map((cube) => [cube.node.id, cube]));
    for (const child of layout.cubes.filter((cube) => cube.parentId !== null)) {
      const parent = byId.get(child.parentId!);
      expect(parent).toBeDefined();
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(Math.abs(child.center[axis] - parent!.center[axis]) + child.size / 2).toBeLessThanOrEqual(
          parent!.size / 2 + 1e-9,
        );
      }
    }
  });

  it('makes files visibly larger than nested methods and variables where structure allows', () => {
    const layout = buildRepositoryLayout(sampleRoot());
    const file = layout.cubes.find((cube) => cube.node.id === 'src/a.ts')!;
    const method = layout.cubes.find((cube) => cube.node.id === 'src/a.ts#big')!;
    const variable = layout.cubes.find((cube) => cube.node.id === 'src/a.ts#one')!;
    expect(file.size).toBeGreaterThan(method.size);
    expect(method.size).toBeGreaterThan(variable.size);
    expect(layout.districts.map((district) => district.name)).toEqual(['docs', 'root', 'src']);
    expect(layout.radius).toBeGreaterThan(0);
  });
});
