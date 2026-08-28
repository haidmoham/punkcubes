import './styles.css';
import { loadRepository, parseRepositoryRef } from './data/github';
import type { CodeNode, RepositorySnapshot } from './data/types';
import { buildRepositoryLayout } from './scene/layout';
import { PunkCubesScene } from './scene/PunkCubesScene';
import type { LayoutCube } from './scene/types';

const DEFAULT_REPO = 'haidmoham/fourier-drawing';
const DEFAULT_BEAUTY = 72;

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app mount point.');

app.innerHTML = `
  <main class="app-shell">
    <header class="topbar">
      <a class="brand" href="/" aria-label="Punkcubes home">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <span>
          <strong>PUNKCUBES</strong>
          <small>code, stacked properly</small>
        </span>
      </a>

      <form class="repo-form" id="repo-form">
        <label for="repo-input">github repo</label>
        <div class="repo-field">
          <span aria-hidden="true">↗</span>
          <input id="repo-input" name="repo" value="${DEFAULT_REPO}" autocomplete="off" spellcheck="false" aria-describedby="repo-hint" />
          <button type="submit">pack it <span aria-hidden="true">→</span></button>
        </div>
        <span id="repo-hint" class="sr-only">Enter an owner and repository, or a GitHub repository URL.</span>
      </form>

      <div class="beauty-control">
        <div class="beauty-label">
          <label for="beauty">beauty</label>
          <output id="beauty-value">${DEFAULT_BEAUTY}</output>
        </div>
        <input id="beauty" type="range" min="0" max="100" value="${DEFAULT_BEAUTY}" />
        <span class="beauty-scale"><i>strict</i><i>extra</i></span>
      </div>
    </header>

    <section class="viewport" aria-label="Interactive codebase visualization">
      <canvas id="scene" tabindex="0" aria-label="3D repository hierarchy. Drag to orbit, scroll to zoom, and select cubes to inspect them."></canvas>

      <div class="scene-meta" aria-live="polite">
        <span class="live-dot"></span>
        <span id="scene-status">warming the lights</span>
      </div>

      <div class="repo-summary" id="repo-summary" hidden>
        <div class="summary-title">
          <span id="summary-owner">repository</span>
          <strong id="summary-name">loading</strong>
        </div>
        <div class="summary-stats" id="summary-stats"></div>
      </div>

      <div class="loading-card" id="loading-card">
        <div class="loading-cube" aria-hidden="true"><i></i><i></i><i></i></div>
        <p class="eyebrow">NOW PACKING</p>
        <h1 id="loading-title">fourier-drawing</h1>
        <p id="loading-detail">asking GitHub what lives where</p>
        <div class="progress-track"><i id="progress-bar"></i></div>
        <small id="progress-count">0 / 0</small>
      </div>

      <div class="error-card" id="error-card" hidden>
        <span class="error-glyph" aria-hidden="true">!</span>
        <p class="eyebrow">THE CUBES OBJECT</p>
        <h2 id="error-title">Could not pack that repo.</h2>
        <p id="error-detail"></p>
        <button id="retry-button" type="button">try again</button>
      </div>

      <aside class="inspector" id="inspector" aria-live="polite">
        <div class="inspector-empty">
          <span class="tiny-cube" aria-hidden="true"></span>
          <p>pick a cube</p>
          <small>files hold methods.<br />methods hold variables.</small>
        </div>
      </aside>

      <div class="hover-label" id="hover-label" hidden></div>

      <div class="scene-tools">
        <button type="button" id="home-button" title="Reset camera (H)">
          <span aria-hidden="true">⌂</span><span>whole repo</span>
        </button>
        <a id="github-link" href="https://github.com/${DEFAULT_REPO}" target="_blank" rel="noreferrer">
          <span>open source</span><span aria-hidden="true">↗</span>
        </a>
      </div>

      <div class="legend" aria-label="Cube hierarchy legend">
        <span><i class="legend-cube file"></i> file</span>
        <span><i class="legend-cube method"></i> method</span>
        <span><i class="legend-cube variable"></i> variable</span>
      </div>
    </section>

    <footer class="footer-note">
      <span>drag to orbit · scroll to zoom · click to inspect</span>
      <span>non-overlap is not negotiable</span>
    </footer>
  </main>
`;

const elements = {
  canvas: required<HTMLCanvasElement>('#scene'),
  form: required<HTMLFormElement>('#repo-form'),
  input: required<HTMLInputElement>('#repo-input'),
  beauty: required<HTMLInputElement>('#beauty'),
  beautyValue: required<HTMLOutputElement>('#beauty-value'),
  status: required<HTMLElement>('#scene-status'),
  loading: required<HTMLElement>('#loading-card'),
  loadingTitle: required<HTMLElement>('#loading-title'),
  loadingDetail: required<HTMLElement>('#loading-detail'),
  progressBar: required<HTMLElement>('#progress-bar'),
  progressCount: required<HTMLElement>('#progress-count'),
  error: required<HTMLElement>('#error-card'),
  errorTitle: required<HTMLElement>('#error-title'),
  errorDetail: required<HTMLElement>('#error-detail'),
  retry: required<HTMLButtonElement>('#retry-button'),
  summary: required<HTMLElement>('#repo-summary'),
  summaryOwner: required<HTMLElement>('#summary-owner'),
  summaryName: required<HTMLElement>('#summary-name'),
  summaryStats: required<HTMLElement>('#summary-stats'),
  inspector: required<HTMLElement>('#inspector'),
  hover: required<HTMLElement>('#hover-label'),
  home: required<HTMLButtonElement>('#home-button'),
  github: required<HTMLAnchorElement>('#github-link'),
};

let currentSnapshot: RepositorySnapshot | null = null;
let loadingRequest = 0;

const scene = new PunkCubesScene(elements.canvas, {
  onHover: renderHover,
  onSelect: renderInspector,
});

elements.form.addEventListener('submit', (event) => {
  event.preventDefault();
  void visualize(elements.input.value);
});

elements.beauty.addEventListener('input', () => {
  const value = Number(elements.beauty.value);
  elements.beautyValue.value = String(value);
  scene.setBeauty(value / 100);
  document.documentElement.style.setProperty('--beauty', String(value / 100));
  updateUrl();
});

elements.home.addEventListener('click', () => scene.focusHome());
elements.retry.addEventListener('click', () => void visualize(elements.input.value));

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' || (event.key.toLowerCase() === 'h' && document.activeElement?.tagName !== 'INPUT')) {
    scene.focusHome();
  }
  if (event.key === '/' && document.activeElement !== elements.input) {
    event.preventDefault();
    elements.input.focus();
    elements.input.select();
  }
});

const url = new URL(window.location.href);
const initialRepo = url.searchParams.get('repo') ?? DEFAULT_REPO;
const initialBeauty = clampNumber(Number(url.searchParams.get('beauty') ?? DEFAULT_BEAUTY), 0, 100);
elements.input.value = initialRepo;
elements.beauty.value = String(initialBeauty);
elements.beautyValue.value = String(initialBeauty);
scene.setBeauty(initialBeauty / 100);
document.documentElement.style.setProperty('--beauty', String(initialBeauty / 100));
void visualize(initialRepo);

async function visualize(input: string): Promise<void> {
  const request = ++loadingRequest;
  let repoRef;
  try {
    repoRef = parseRepositoryRef(input);
  } catch (error) {
    showError('That does not look like a repository.', getErrorMessage(error));
    return;
  }

  elements.input.value = `${repoRef.owner}/${repoRef.repo}`;
  elements.loading.hidden = false;
  elements.error.hidden = true;
  elements.loadingTitle.textContent = repoRef.repo;
  elements.loadingDetail.textContent = 'asking GitHub what lives where';
  elements.progressBar.style.width = '4%';
  elements.progressCount.textContent = 'finding the front door';
  elements.status.textContent = 'repo incoming';
  elements.canvas.setAttribute('aria-busy', 'true');

  try {
    const snapshot = await loadRepository(repoRef, (progress) => {
      if (request !== loadingRequest) return;
      const fraction = progress.total > 0 ? progress.completed / progress.total : 0.08;
      const phaseOffset = { repo: 0, tree: 0.08, source: 0.18, parse: 0.82, layout: 0.94 }[progress.phase];
      const phaseWeight = { repo: 0.08, tree: 0.1, source: 0.64, parse: 0.12, layout: 0.06 }[progress.phase];
      elements.progressBar.style.width = `${Math.min(98, (phaseOffset + fraction * phaseWeight) * 100)}%`;
      elements.progressCount.textContent = progress.total > 0 ? `${progress.completed} / ${progress.total}` : progress.phase;
      elements.loadingDetail.textContent = progress.detail;
    });
    if (request !== loadingRequest) return;

    elements.loadingDetail.textContent = 'giving every symbol some personal space';
    elements.progressBar.style.width = '96%';
    await nextPaint();
    const layout = buildRepositoryLayout(snapshot.root);
    scene.setLayout(layout);
    currentSnapshot = snapshot;
    renderSummary(snapshot);
    renderInspector(null);
    elements.github.href = `https://github.com/${snapshot.owner}/${snapshot.repo}`;
    elements.status.textContent = snapshot.truncated ? 'packed · source limit reached' : 'packed · zero overlaps';
    elements.progressBar.style.width = '100%';
    elements.canvas.removeAttribute('aria-busy');
    updateUrl();
    window.setTimeout(() => {
      if (request === loadingRequest) elements.loading.hidden = true;
    }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 360);
  } catch (error) {
    if (request !== loadingRequest) return;
    showError('Could not pack that repo.', getErrorMessage(error));
  }
}

function renderSummary(snapshot: RepositorySnapshot): void {
  elements.summary.hidden = false;
  elements.summaryOwner.textContent = snapshot.owner;
  elements.summaryName.textContent = snapshot.repo;
  const stats = [
    [snapshot.stats.files, 'files'],
    [snapshot.stats.functions, 'methods'],
    [snapshot.stats.variables, 'variables'],
    [formatNumber(snapshot.stats.lines), 'lines'],
  ] as const;
  elements.summaryStats.innerHTML = stats
    .map(([value, label]) => `<span><strong>${value}</strong><small>${label}</small></span>`)
    .join('');
}

function renderHover(cube: LayoutCube | null, point: { x: number; y: number } | null): void {
  if (!cube || !point) {
    elements.hover.hidden = true;
    return;
  }
  elements.hover.hidden = false;
  elements.hover.innerHTML = `<strong>${escapeHtml(cube.node.name)}</strong><span>${cube.node.kind} · ${cube.node.lines} lines</span>`;
  const padding = 16;
  const width = elements.hover.offsetWidth;
  const height = elements.hover.offsetHeight;
  elements.hover.style.left = `${Math.min(point.x + 18, window.innerWidth - width - padding)}px`;
  elements.hover.style.top = `${Math.min(point.y + 18, window.innerHeight - height - padding)}px`;
}

function renderInspector(cube: LayoutCube | null): void {
  if (!cube) {
    elements.inspector.innerHTML = `
      <div class="inspector-empty">
        <span class="tiny-cube" aria-hidden="true"></span>
        <p>pick a cube</p>
        <small>files hold methods.<br />methods hold variables.</small>
      </div>`;
    return;
  }
  const node = cube.node;
  const pathSegments = node.path.split('/');
  const parentPath = pathSegments.slice(0, -1).join('/') || 'root';
  const githubUrl = currentSnapshot
    ? `https://github.com/${currentSnapshot.owner}/${currentSnapshot.repo}/blob/${currentSnapshot.defaultBranch}/${node.path}${node.startLine ? `#L${node.startLine}` : ''}`
    : '#';
  const childStats = countDescendants(node);
  elements.inspector.innerHTML = `
    <div class="inspector-head">
      <span class="kind-chip ${node.kind}">${node.kind}</span>
      <button type="button" class="close-inspector" aria-label="Close inspector">×</button>
    </div>
    <p class="path-kicker">${escapeHtml(parentPath)}</p>
    <h2>${escapeHtml(node.name)}</h2>
    <div class="node-metrics">
      <span><strong>${node.lines}</strong><small>lines</small></span>
      <span><strong>${node.bytes ? formatBytes(node.bytes) : '—'}</strong><small>weight</small></span>
      <span><strong>${childStats}</strong><small>inside</small></span>
    </div>
    <div class="node-facts">
      <span><i>language</i><b>${node.language}</b></span>
      <span><i>district</i><b>${escapeHtml(cube.district)}</b></span>
      ${node.startLine ? `<span><i>starts</i><b>line ${node.startLine}</b></span>` : ''}
      ${node.exported !== undefined ? `<span><i>exported</i><b>${node.exported ? 'yes' : 'no'}</b></span>` : ''}
    </div>
    <a class="inspect-source" href="${githubUrl}" target="_blank" rel="noreferrer">see the source <span>↗</span></a>
  `;
  elements.inspector.querySelector<HTMLButtonElement>('.close-inspector')?.addEventListener('click', () => scene.focusHome());
}

function showError(title: string, detail: string): void {
  elements.loading.hidden = true;
  elements.error.hidden = false;
  elements.errorTitle.textContent = title;
  elements.errorDetail.textContent = detail;
  elements.status.textContent = 'packing interrupted';
  elements.canvas.removeAttribute('aria-busy');
}

function updateUrl(): void {
  const next = new URL(window.location.href);
  next.searchParams.set('repo', elements.input.value.trim() || DEFAULT_REPO);
  next.searchParams.set('beauty', elements.beauty.value);
  window.history.replaceState(null, '', next);
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BEAUTY;
  return Math.min(max, Math.max(min, value));
}

function countDescendants(node: CodeNode): number {
  return node.children.reduce((count, child) => count + 1 + countDescendants(child), 0);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { notation: value > 9999 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
}

function formatBytes(value: number): string {
  if (value < 1000) return `${value} B`;
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)} KB`;
  return `${(value / 1_000_000).toFixed(1)} MB`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#039;',
    '"': '&quot;',
  })[character] ?? character);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unknown packing error occurred.';
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
