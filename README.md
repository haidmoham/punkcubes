# Punkcubes

Punkcubes turns a public GitHub repository into a spatial code archive: files
are large cubes, functions and methods are nested cubes, and variables are
tiny voxels. `haidmoham/fourier-drawing` is the default repository.

The hierarchy never moves with the `beauty` control. Beauty scales atmosphere
only—color, aura, depth, and low-amplitude motion—so the tool remains legible at
every setting.

**[Open Punkcubes](https://punkcubes.shin86.dev)**

## Scope

The browser resolves the public repository’s default branch to a commit before fetching files. JavaScript/TypeScript symbols use the TypeScript parser; Python, CSS, and HTML use limited regular-expression extraction. Other formats retain file-level structure. This is a bounded structural view, not whole-program semantic analysis or a complete call graph.

Loading is unauthenticated and subject to GitHub rate limits. It selects at most 180 files, 300,000 bytes per file, and 5,000,000 bytes in total; unreadable files can be skipped. Large repositories are partial views. The current default branch is `codex/punkcubes-one-shot`; use the repository default when cloning.

## Run

```sh
npm install
npm run dev
```

Use `npm run check` for tests, type-checking, and the production build.

Keep a visible lowercase return link to `https://shin86.dev/` in the topbar.
The link returns to the cluster hub. The brand link returns to this app.
Use acid accents and squared edges for control feedback. Keep keyboard focus visible.

## Design lineage

The layout borrows semantic hierarchy from
[CodeCity](https://www.inf.usi.ch/faculty/lanza/PUBS/P/Wett2008a.pdf), public
repository input and spatial inspection from
[City of Code](https://city-of-code.vercel.app/), and a quiet-core / local-color
composition from the private design-vocabulary Lego workflow. Dribbble was used
as source material for scale rhythm, sparse interface framing, and restrained
iridescent materials; no shot or asset is copied.
