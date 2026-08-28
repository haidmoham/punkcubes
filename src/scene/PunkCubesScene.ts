import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { CodeNodeKind } from '../data/types';
import type { LayoutCube, RepositoryLayout } from './types';

const PALETTE = [0xb6ff4a, 0x68dfff, 0xff6b35, 0xff55c8, 0xffd166, 0x9f8cff];
const BASE_COLORS: Record<CodeNodeKind, number> = {
  directory: 0x3b4149,
  file: 0x8a96a4,
  function: 0xb2bdc8,
  variable: 0xe4edf5,
};

interface SceneCallbacks {
  onHover: (cube: LayoutCube | null, point: { x: number; y: number } | null) => void;
  onSelect: (cube: LayoutCube | null) => void;
}

interface CubeVisual {
  cube: LayoutCube;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  edges: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial> | null;
  aura: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null;
  palette: THREE.Color;
}

interface CameraTween {
  startedAt: number;
  duration: number;
  fromPosition: THREE.Vector3;
  toPosition: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
}

function seededUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4_294_967_295;
}

function easeOutQuint(value: number): number {
  return 1 - (1 - value) ** 5;
}

export class PunkCubesScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.05, 800);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly controls: OrbitControls;
  private readonly world = new THREE.Group();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2(20, 20);
  private readonly visuals = new Map<string, CubeVisual>();
  private readonly pickables: THREE.Object3D[] = [];
  private readonly callbacks: SceneCallbacks;
  private readonly resizeObserver: ResizeObserver;
  private frame = 0;
  private layout: RepositoryLayout | null = null;
  private beauty = 0.72;
  private hoveredId: string | null = null;
  private selectedId: string | null = null;
  private cameraTween: CameraTween | null = null;
  private particles: THREE.Points | null = null;
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private pointerDown = { x: 0, y: 0 };

  constructor(canvas: HTMLCanvasElement, callbacks: SceneCallbacks) {
    this.callbacks = callbacks;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene.background = new THREE.Color(0x08090b);
    this.scene.fog = new THREE.FogExp2(0x08090b, 0.008);
    this.scene.add(this.world);

    this.camera.position.set(18, 16, 22);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 240;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.target.set(0, 1.5, 0);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.46, 0.55, 0.83);
    this.composer.addPass(this.bloom);

    this.addLights();
    this.addGround();

    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    motionQuery.addEventListener('change', this.onMotionPreference);

    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.resize();
    this.frame = requestAnimationFrame(this.animate);
  }

  setLayout(layout: RepositoryLayout): void {
    this.clearLayout();
    this.layout = layout;

    for (const district of layout.districts) {
      const color = new THREE.Color(PALETTE[district.colorIndex % PALETTE.length]);
      const geometry = new THREE.BoxGeometry(district.width, 0.04, district.depth);
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.045 + this.beauty * 0.055,
        depthWrite: false,
      });
      const plot = new THREE.Mesh(geometry, material);
      plot.position.set(district.center.x, -0.09, district.center.z);
      plot.userData.decorative = true;
      this.world.add(plot);

      const border = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.17 }),
      );
      border.position.copy(plot.position);
      border.userData.decorative = true;
      this.world.add(border);

      const label = this.makeDistrictLabel(district.name, color);
      label.position.set(
        district.center.x - district.width * 0.34,
        0.24,
        district.center.z + district.depth * 0.46,
      );
      this.world.add(label);
    }

    const orderedCubes = [...layout.cubes].sort((a, b) => a.depth - b.depth);
    for (const cube of orderedCubes) this.addCube(cube);
    this.addParticles(layout.radius);
    this.applyBeauty();
    this.focusHome(false);
  }

  setBeauty(value: number): void {
    this.beauty = THREE.MathUtils.clamp(value, 0, 1);
    this.applyBeauty();
  }

  focusHome(animated = true): void {
    const radius = Math.max(this.layout?.radius ?? 12, 8);
    const target = new THREE.Vector3(0, Math.min(radius * 0.08, 3.5), 0);
    const direction = new THREE.Vector3(0.86, 0.62, 1).normalize();
    const position = target.clone().add(direction.multiplyScalar(radius * 1.34));
    this.tweenCamera(position, target, animated ? 820 : 0);
    this.selectedId = null;
    this.callbacks.onSelect(null);
    this.updateActiveBranch();
  }

  focusCube(cube: LayoutCube): void {
    const target = new THREE.Vector3(cube.center.x, cube.center.y, cube.center.z);
    const currentDirection = this.camera.position.clone().sub(this.controls.target).normalize();
    const fallbackDirection = new THREE.Vector3(0.8, 0.65, 1).normalize();
    const direction = currentDirection.lengthSq() > 0.5 ? currentDirection : fallbackDirection;
    let enclosingSize = cube.size;
    let parentId = cube.parentId;
    while (parentId) {
      const parent = this.visuals.get(parentId)?.cube;
      if (!parent) break;
      enclosingSize = Math.max(enclosingSize, parent.size);
      parentId = parent.parentId;
    }
    const distance = Math.max(
      cube.size * (cube.node.kind === 'file' ? 3.4 : 4.8),
      enclosingSize * 1.42,
      3.2,
    );
    this.tweenCamera(target.clone().add(direction.multiplyScalar(distance)), target, 680);
    this.selectedId = cube.node.id;
    this.callbacks.onSelect(cube);
    this.updateActiveBranch();
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    window.matchMedia('(prefers-reduced-motion: reduce)').removeEventListener('change', this.onMotionPreference);
    this.clearLayout();
    this.controls.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }

  private addLights(): void {
    const hemisphere = new THREE.HemisphereLight(0xcde7ff, 0x15100d, 1.5);
    this.scene.add(hemisphere);

    const key = new THREE.DirectionalLight(0xffffff, 4.6);
    key.position.set(18, 30, 14);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 120;
    key.shadow.camera.left = -45;
    key.shadow.camera.right = 45;
    key.shadow.camera.top = 45;
    key.shadow.camera.bottom = -45;
    this.scene.add(key);

    const acid = new THREE.PointLight(PALETTE[0], 32, 70, 1.6);
    acid.position.set(-14, 8, -10);
    acid.userData.beautyLight = true;
    this.scene.add(acid);

    const cyan = new THREE.PointLight(PALETTE[1], 26, 60, 1.8);
    cyan.position.set(16, 6, 14);
    cyan.userData.beautyLight = true;
    this.scene.add(cyan);
  }

  private addGround(): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(500, 500),
      new THREE.MeshStandardMaterial({ color: 0x101319, roughness: 0.94, metalness: 0.06 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.13;
    ground.receiveShadow = true;
    ground.userData.decorative = true;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(500, 250, 0x25303a, 0x151a20);
    grid.position.y = -0.1;
    const material = grid.material as THREE.LineBasicMaterial;
    material.transparent = true;
    material.opacity = 0.22;
    grid.userData.decorative = true;
    this.scene.add(grid);
  }

  private addCube(cube: LayoutCube): void {
    const segments = cube.node.kind === 'variable' ? 1 : 3;
    const radius = cube.node.kind === 'variable' ? cube.size * 0.08 : Math.min(cube.size * 0.055, 0.18);
    const geometry = new RoundedBoxGeometry(cube.size, cube.size, cube.size, segments, radius);
    const paletteIndex = Math.floor(seededUnit(cube.district) * PALETTE.length) % PALETTE.length;
    const palette = new THREE.Color(PALETTE[paletteIndex]);
    const base = new THREE.Color(BASE_COLORS[cube.node.kind]).lerp(palette, cube.node.kind === 'variable' ? 0.46 : 0.1);
    const isVariable = cube.node.kind === 'variable';
    const material = new THREE.MeshPhysicalMaterial({
      color: base,
      roughness: isVariable ? 0.28 : 0.58,
      metalness: isVariable ? 0.25 : 0.14,
      transparent: !isVariable,
      opacity: cube.node.kind === 'file' ? 0.17 : cube.node.kind === 'function' ? 0.36 : 1,
      depthWrite: isVariable,
      side: THREE.DoubleSide,
      clearcoat: isVariable ? 0.8 : 0.36,
      clearcoatRoughness: 0.24,
      emissive: palette,
      emissiveIntensity: isVariable ? 0.38 : cube.node.kind === 'function' ? 0.055 : 0.025,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(cube.center.x, cube.center.y, cube.center.z);
    mesh.castShadow = isVariable || cube.node.kind === 'function';
    mesh.receiveShadow = cube.node.kind === 'file';
    mesh.userData.cubeId = cube.node.id;
    this.world.add(mesh);
    this.pickables.push(mesh);

    let edges: CubeVisual['edges'] = null;
    if (!isVariable) {
      const edgeMaterial = new THREE.LineBasicMaterial({
        color: new THREE.Color(0x9ca9b8).lerp(palette, 0.3),
        transparent: true,
        opacity: cube.node.kind === 'file' ? 0.62 : 0.48,
      });
      edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgeMaterial);
      edges.position.copy(mesh.position);
      edges.userData.decorative = true;
      this.world.add(edges);
    }

    let aura: CubeVisual['aura'] = null;
    if (cube.node.kind !== 'variable') {
      aura = new THREE.Mesh(
        geometry.clone(),
        new THREE.MeshBasicMaterial({
          color: palette,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          side: THREE.BackSide,
          depthWrite: false,
        }),
      );
      aura.position.copy(mesh.position);
      aura.scale.setScalar(1.035);
      aura.userData.decorative = true;
      this.world.add(aura);
    }

    this.visuals.set(cube.node.id, { cube, mesh, edges, aura, palette });
  }

  private addParticles(radius: number): void {
    const count = Math.min(Math.round(90 + radius * 5), 420);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const randomA = seededUnit(`a:${index}:${radius}`);
      const randomB = seededUnit(`b:${index}:${radius}`);
      const randomC = seededUnit(`c:${index}:${radius}`);
      const distance = radius * (0.65 + randomA * 1.4);
      const angle = randomB * Math.PI * 2;
      positions[index * 3] = Math.cos(angle) * distance;
      positions[index * 3 + 1] = 1 + randomC * Math.max(radius * 0.75, 10);
      positions[index * 3 + 2] = Math.sin(angle) * distance;
      const color = new THREE.Color(PALETTE[index % PALETTE.length]);
      colors.set([color.r, color.g, color.b], index * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: 0.055,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.35,
      vertexColors: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.particles = new THREE.Points(geometry, material);
    this.particles.userData.decorative = true;
    this.world.add(this.particles);
  }

  private applyBeauty(): void {
    this.bloom.strength = 0.04 + this.beauty * 0.56;
    this.bloom.radius = 0.2 + this.beauty * 0.42;
    this.bloom.threshold = 0.96 - this.beauty * 0.16;
    this.renderer.toneMappingExposure = 1.02 + this.beauty * 0.3;

    const fog = this.scene.fog;
    if (fog instanceof THREE.FogExp2) fog.density = 0.004 + this.beauty * 0.005;
    this.scene.traverse((object) => {
      if (object instanceof THREE.PointLight && object.userData.beautyLight === true) {
        object.intensity = (object.color.getHex() === PALETTE[0] ? 32 : 26) * (0.18 + this.beauty * 0.82);
      }
    });
    if (this.particles) {
      const material = this.particles.material as THREE.PointsMaterial;
      material.opacity = this.beauty * 0.42;
      material.size = 0.025 + this.beauty * 0.05;
    }
    this.updateActiveBranch();
  }

  private updateActiveBranch(): void {
    const activeId = this.hoveredId ?? this.selectedId;
    const activeIds = new Set<string>();
    if (activeId) {
      let current: CubeVisual | undefined = this.visuals.get(activeId);
      while (current) {
        activeIds.add(current.cube.node.id);
        current = current.cube.parentId ? this.visuals.get(current.cube.parentId) : undefined;
      }
      for (const visual of this.visuals.values()) {
        let parentId = visual.cube.parentId;
        while (parentId) {
          if (parentId === activeId) {
            activeIds.add(visual.cube.node.id);
            break;
          }
          parentId = this.visuals.get(parentId)?.cube.parentId ?? null;
        }
      }
    }

    for (const visual of this.visuals.values()) {
      const isActive = activeIds.has(visual.cube.node.id);
      const isDirect = visual.cube.node.id === activeId;
      const kind = visual.cube.node.kind;
      const base = new THREE.Color(BASE_COLORS[kind]).lerp(visual.palette, kind === 'variable' ? 0.46 : 0.1);
      visual.mesh.material.color.copy(isActive ? base.clone().lerp(visual.palette, 0.5 + this.beauty * 0.35) : base);
      visual.mesh.material.emissiveIntensity = isDirect
        ? 0.25 + this.beauty * 1.35
        : isActive
          ? 0.08 + this.beauty * 0.38
          : kind === 'variable'
            ? 0.12 + this.beauty * 0.1
            : kind === 'function'
              ? 0.045
              : 0.022;
      const isAncestor = isActive && !isDirect && this.isAncestorOf(visual.cube.node.id, activeId);
      if (kind === 'file') visual.mesh.material.opacity = isAncestor ? 0.045 : 0.14 + this.beauty * 0.07;
      if (kind === 'function') visual.mesh.material.opacity = isAncestor ? 0.11 : 0.3 + this.beauty * 0.11;
      if (visual.edges) visual.edges.material.opacity = isDirect ? 0.95 : kind === 'file' ? 0.58 + this.beauty * 0.1 : 0.44 + this.beauty * 0.08;
      if (visual.aura) visual.aura.material.opacity = isDirect ? 0.015 + this.beauty * 0.1 : 0;
    }
  }

  private clearLayout(): void {
    for (const object of [...this.world.children]) {
      this.world.remove(object);
      if (object instanceof THREE.Sprite) {
        object.material.map?.dispose();
        object.material.dispose();
      } else if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Points) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.dispose();
      }
    }
    this.visuals.clear();
    this.pickables.length = 0;
    this.particles = null;
    this.hoveredId = null;
    this.selectedId = null;
  }

  private isAncestorOf(candidateId: string, nodeId: string | null): boolean {
    let parentId = nodeId ? this.visuals.get(nodeId)?.cube.parentId ?? null : null;
    while (parentId) {
      if (parentId === candidateId) return true;
      parentId = this.visuals.get(parentId)?.cube.parentId ?? null;
    }
    return false;
  }

  private makeDistrictLabel(name: string, color: THREE.Color): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 96;
    const context = canvas.getContext('2d');
    if (context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.font = '500 30px "DM Mono", monospace';
      context.letterSpacing = '4px';
      context.fillStyle = `#${color.getHexString()}`;
      context.globalAlpha = 0.88;
      context.fillText(name.toUpperCase(), 16, 58);
      context.fillStyle = 'rgba(255,255,255,0.3)';
      context.fillRect(16, 74, 122, 2);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 0.72 });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(5.2, 0.98, 1);
    sprite.userData.decorative = true;
    return sprite;
  }

  private tweenCamera(position: THREE.Vector3, target: THREE.Vector3, duration: number): void {
    if (duration === 0 || this.reducedMotion) {
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      this.controls.update();
      this.cameraTween = null;
      return;
    }
    this.cameraTween = {
      startedAt: performance.now(),
      duration,
      fromPosition: this.camera.position.clone(),
      toPosition: position,
      fromTarget: this.controls.target.clone(),
      toTarget: target,
    };
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    // Transparent parent shells are hit before the symbols they contain. Pick
    // the deepest intersected cube so the hierarchy remains directly usable.
    const hit = this.raycaster
      .intersectObjects(this.pickables, false)
      .sort((left, right) => {
        const leftDepth = this.visuals.get(String(left.object.userData.cubeId))?.cube.depth ?? 0;
        const rightDepth = this.visuals.get(String(right.object.userData.cubeId))?.cube.depth ?? 0;
        return rightDepth - leftDepth || left.distance - right.distance;
      })[0];
    const cubeId = typeof hit?.object.userData.cubeId === 'string' ? hit.object.userData.cubeId : null;
    if (cubeId === this.hoveredId) {
      if (cubeId) this.callbacks.onHover(this.visuals.get(cubeId)?.cube ?? null, { x: event.clientX, y: event.clientY });
      return;
    }
    this.hoveredId = cubeId;
    this.renderer.domElement.style.cursor = cubeId ? 'pointer' : 'grab';
    this.callbacks.onHover(cubeId ? this.visuals.get(cubeId)?.cube ?? null : null, cubeId ? { x: event.clientX, y: event.clientY } : null);
    this.updateActiveBranch();
  };

  private readonly onPointerLeave = (): void => {
    this.hoveredId = null;
    this.callbacks.onHover(null, null);
    this.updateActiveBranch();
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.pointerDown = { x: event.clientX, y: event.clientY };
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const moved = Math.hypot(event.clientX - this.pointerDown.x, event.clientY - this.pointerDown.y);
    if (moved > 5) return;
    const cube = this.hoveredId ? this.visuals.get(this.hoveredId)?.cube : null;
    if (cube) this.focusCube(cube);
  };

  private readonly onMotionPreference = (event: MediaQueryListEvent): void => {
    this.reducedMotion = event.matches;
  };

  private readonly resize = (): void => {
    const canvas = this.renderer.domElement;
    const width = Math.max(canvas.parentElement?.clientWidth ?? canvas.clientWidth, 1);
    const height = Math.max(canvas.parentElement?.clientHeight ?? canvas.clientHeight, 1);
    const pixelRatio = Math.min(window.devicePixelRatio, 1.75);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };

  private readonly animate = (): void => {
    this.frame = requestAnimationFrame(this.animate);
    const elapsed = performance.now() * 0.001;

    if (this.cameraTween) {
      const progress = THREE.MathUtils.clamp((performance.now() - this.cameraTween.startedAt) / this.cameraTween.duration, 0, 1);
      const eased = easeOutQuint(progress);
      this.camera.position.lerpVectors(this.cameraTween.fromPosition, this.cameraTween.toPosition, eased);
      this.controls.target.lerpVectors(this.cameraTween.fromTarget, this.cameraTween.toTarget, eased);
      if (progress >= 1) this.cameraTween = null;
    }

    if (!this.reducedMotion && this.particles) {
      this.particles.rotation.y = elapsed * (0.002 + this.beauty * 0.006);
      const material = this.particles.material as THREE.PointsMaterial;
      material.opacity = this.beauty * (0.34 + Math.sin(elapsed * 0.45) * 0.06);
    }
    const activeId = this.hoveredId ?? this.selectedId;
    if (!this.reducedMotion && activeId) {
      const aura = this.visuals.get(activeId)?.aura;
      if (aura) aura.scale.setScalar(1.035 + Math.sin(elapsed * 2.1) * 0.008 * this.beauty);
    }

    this.controls.update();
    this.composer.render();
  };
}
