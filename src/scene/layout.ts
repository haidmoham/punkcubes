import type { CodeNode } from '../data/types';
import type { DistrictBounds, LayoutCube, RepositoryLayout, Vec3Like } from './types';

const CHILD_GAP = 0.22;
const CHILD_PADDING = 0.52;
const FILE_GAP = 1.15;
const DISTRICT_GAP = 6;

interface CubePlan {
  node: CodeNode;
  size: number;
  children: CubePlan[];
}

interface DistrictPlan {
  name: string;
  files: CubePlan[];
  width: number;
  depth: number;
}

const compareNodes = (left: CodeNode, right: CodeNode): number =>
  left.path.localeCompare(right.path) ||
  left.kind.localeCompare(right.kind) ||
  left.name.localeCompare(right.name) ||
  left.id.localeCompare(right.id);

const sorted = (nodes: readonly CodeNode[]): CodeNode[] => [...nodes].sort(compareNodes);

/** Keep emitted node data deterministic too, rather than only stabilizing positions. */
function normalizeNode(node: CodeNode): CodeNode {
  return { ...node, children: sorted(node.children).map(normalizeNode) };
}

function intrinsicSize(node: CodeNode): number {
  const scale = Math.cbrt(Math.max(1, node.lines));

  switch (node.kind) {
    case 'file':
      return Math.max(4.4, 2.7 + scale * 1.12);
    case 'function':
      return Math.max(1.18, 0.68 + scale * 0.48);
    case 'variable':
      return Math.max(0.34, 0.26 + Math.min(scale, 4) * 0.11);
    case 'directory':
      return 0;
  }
}

function nonDirectoryDescendants(node: CodeNode): CodeNode[] {
  return sorted(node.children.filter((child) => child.kind !== 'directory'));
}

function planCube(node: CodeNode): CubePlan {
  const children = nonDirectoryDescendants(node).map(planCube);
  if (children.length === 0) {
    return { node, size: intrinsicSize(node), children };
  }

  const largestChild = Math.max(...children.map((child) => child.size));
  const cellsPerAxis = Math.ceil(Math.cbrt(children.length));
  const packedSize =
    cellsPerAxis * largestChild +
    (cellsPerAxis - 1) * CHILD_GAP +
    CHILD_PADDING * 2;

  return {
    node,
    size: Math.max(intrinsicSize(node), packedSize),
    children,
  };
}

function collectFiles(node: CodeNode): CodeNode[] {
  if (node.kind === 'file') return [node];
  return sorted(node.children).flatMap(collectFiles);
}

function planDistrict(name: string, files: CodeNode[]): DistrictPlan {
  const plannedFiles = sorted(files).map(planCube);
  const largest = Math.max(1, ...plannedFiles.map((file) => file.size));
  const cellsPerAxis = Math.max(1, Math.ceil(Math.sqrt(plannedFiles.length)));
  const side =
    cellsPerAxis * largest + (cellsPerAxis - 1) * FILE_GAP + CHILD_PADDING * 2;

  return { name, files: plannedFiles, width: side, depth: side };
}

function addCubeTree(
  plan: CubePlan,
  center: Vec3Like,
  depth: number,
  parentId: string | null,
  district: string,
  cubes: LayoutCube[],
): void {
  cubes.push({ node: plan.node, center, size: plan.size, depth, parentId, district });

  if (plan.children.length === 0) return;

  const cellsPerAxis = Math.ceil(Math.cbrt(plan.children.length));
  const largestChild = Math.max(...plan.children.map((child) => child.size));
  const step = largestChild + CHILD_GAP;
  const start = -((cellsPerAxis - 1) * step) / 2;

  plan.children.forEach((child, index) => {
    const x = index % cellsPerAxis;
    const y = Math.floor(index / cellsPerAxis) % cellsPerAxis;
    const z = Math.floor(index / (cellsPerAxis * cellsPerAxis));
    addCubeTree(
      child,
      { x: center.x + start + x * step, y: center.y + start + y * step, z: center.z + start + z * step },
      depth + 1,
      plan.node.id,
      district,
      cubes,
    );
  });
}

/**
 * Produces a stable, inspectable spatial hierarchy. Directory nodes become named
 * districts; every file and syntax child is represented by one cube.
 */
export function buildRepositoryLayout(root: CodeNode): RepositoryLayout {
  const normalizedRoot = normalizeNode(root);
  const groups = new Map<string, CodeNode[]>();
  const addFiles = (name: string, node: CodeNode): void => {
    const files = collectFiles(node);
    if (files.length > 0) groups.set(name, [...(groups.get(name) ?? []), ...files]);
  };

  for (const child of sorted(normalizedRoot.children)) {
    addFiles(child.kind === 'directory' ? child.name : 'root', child);
  }
  if (normalizedRoot.kind === 'file') addFiles('root', normalizedRoot);

  const plans = [...groups.entries()]
    .map(([name, files]) => planDistrict(name, files))
    .sort((left, right) => left.name.localeCompare(right.name));
  const grid = Math.max(1, Math.ceil(Math.sqrt(plans.length)));
  const districtStep = Math.max(1, ...plans.map((plan) => Math.max(plan.width, plan.depth))) + DISTRICT_GAP;
  const gridStart = -((grid - 1) * districtStep) / 2;
  const cubes: LayoutCube[] = [];
  const districts: DistrictBounds[] = [];

  plans.forEach((plan, index) => {
    const col = index % grid;
    const row = Math.floor(index / grid);
    const center = { x: gridStart + col * districtStep, y: 0, z: gridStart + row * districtStep };
    districts.push({ name: plan.name, center, width: plan.width, depth: plan.depth, colorIndex: index });

    const cellsPerAxis = Math.max(1, Math.ceil(Math.sqrt(plan.files.length)));
    const largest = Math.max(1, ...plan.files.map((file) => file.size));
    const step = largest + FILE_GAP;
    const start = -((cellsPerAxis - 1) * step) / 2;
    plan.files.forEach((file, fileIndex) => {
      addCubeTree(
        file,
        {
          x: center.x + start + (fileIndex % cellsPerAxis) * step,
          y: file.size / 2,
          z: center.z + start + Math.floor(fileIndex / cellsPerAxis) * step,
        },
        0,
        null,
        plan.name,
        cubes,
      );
    });
  });

  // A partially filled final district row is not centered by a square grid.
  // Recenter the actual occupied bounds so the home camera frames the archive,
  // not the empty grid cell.
  if (cubes.length > 0) {
    const minX = Math.min(...cubes.map((cube) => cube.center.x - cube.size / 2));
    const maxX = Math.max(...cubes.map((cube) => cube.center.x + cube.size / 2));
    const minZ = Math.min(...cubes.map((cube) => cube.center.z - cube.size / 2));
    const maxZ = Math.max(...cubes.map((cube) => cube.center.z + cube.size / 2));
    const offsetX = (minX + maxX) / 2;
    const offsetZ = (minZ + maxZ) / 2;
    for (const cube of cubes) {
      cube.center.x -= offsetX;
      cube.center.z -= offsetZ;
    }
    for (const district of districts) {
      district.center.x -= offsetX;
      district.center.z -= offsetZ;
    }
  }

  const radius = cubes.reduce((furthest, cube) => {
    const half = cube.size / 2;
    return Math.max(furthest, Math.hypot(cube.center.x, cube.center.y, cube.center.z) + Math.sqrt(3) * half);
  }, 1);

  return { cubes, districts, radius };
}
