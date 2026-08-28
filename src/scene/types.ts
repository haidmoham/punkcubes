import type { CodeNode } from '../data/types';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface LayoutCube {
  node: CodeNode;
  center: Vec3Like;
  size: number;
  depth: number;
  parentId: string | null;
  district: string;
}

export interface DistrictBounds {
  name: string;
  center: Vec3Like;
  width: number;
  depth: number;
  colorIndex: number;
}

export interface RepositoryLayout {
  cubes: LayoutCube[];
  districts: DistrictBounds[];
  radius: number;
}
