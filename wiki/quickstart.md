---
title: "Repository quickstart"
description: "Orientation for the k8s-learn Vietnamese Kubernetes curriculum and its Next.js/Fumadocs documentation site."
---

# Repository quickstart

## What this repository is

`k8s-learn` is a Vietnamese-language Kubernetes learning site. Its product is the curriculum under `content/docs/`; the small application under `src/` turns that Markdown/MDX content into a statically exported documentation site.

The repository currently has two distinct concerns:

1. **Learning content:** 182 Markdown pages arranged into 16 curriculum categories plus the root landing page. The `gioi-thieu/`, `kien-truc/`, and `workloads/` categories contain substantive lessons; most remaining category pages are curriculum placeholders.
2. **Documentation runtime:** Next.js 15, React 19, Fumadocs, custom remark transforms, Mermaid rendering, static search, and Cloudflare Pages deployment.

This is not a Kubernetes controller, cluster configuration repository, or backend service. No database, authentication subsystem, business API, test suite, or site-deployment Kubernetes manifests are present in the inspected source.

## Start here by task

| Task | First source to inspect | Wiki guide |
|---|---|---|
| Understand how the site builds and serves pages | `source.config.ts`, `src/lib/source.ts`, `src/app/[[...slug]]/page.tsx` | [Site architecture](architecture.md) |
| Add or complete a Kubernetes lesson | `content/docs/meta.json`, the target category's `meta.json`, adjacent lessons | [Curriculum and content map](content-map.md) |
| Change local development, build, search, styling, or deployment | `package.json`, `next.config.mjs`, `src/`, `wrangler.toml` | [Development and operations](development.md) |
| Understand the public learning sequence | `content/docs/meta.json` and category `meta.json` files | [Curriculum and content map](content-map.md) |

## Repository layout

```text
.
├── content/docs/                 # Vietnamese curriculum pages and navigation metadata
│   ├── meta.json                 # Root sidebar/category order
│   └── <category>/
│       ├── meta.json             # Page order within one category
│       └── *.md                  # Learning pages
├── src/
│   ├── app/[[...slug]]/          # Catch-all Fumadocs layout and page renderer
│   ├── app/api/search/route.ts   # Build-time static search endpoint
│   ├── components/mermaid.tsx    # Client-side Mermaid SVG rendering
│   └── lib/source.ts             # Fumadocs source loader
├── source.config.ts              # Content source and remark transforms
├── next.config.mjs               # Static export, dist directory, trailing slashes
├── wrangler.toml                 # Cloudflare Pages output configuration
├── .agents/skills/write-docs/    # Repository-specific content-authoring skill
└── wiki/                         # Repository knowledge for humans and coding agents
```

Generated directories such as `.source/`, `.next/`, `dist/`, and `.wrangler/` are ignored by `.gitignore` and are not source-of-truth inputs.

## Run the site

Use the checked-in lockfile for reproducible setup:

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`. The root route redirects to `/gioi-thieu/container-fundamentals/` in `src/app/[[...slug]]/page.tsx`.

Production-oriented commands are defined in `package.json`:

```bash
npm run build     # Next.js static export to dist/
npm run preview   # Serve dist/ through Wrangler Pages dev
npm run deploy    # Build, then deploy dist/ to Cloudflare Pages
```

Do not run `npm run deploy` merely to validate a change; it requires the appropriate Cloudflare context and publishes the built output. Use `npm run build` as the required repository check.

## Current content maturity

The curriculum currently has three complete learning sections: the eight-page getting-started sequence, the ten-page Kubernetes architecture sequence, and the fourteen-page workloads sequence. Inventory after the workloads authoring pass shows:

- **182** Markdown pages total.
- **32** substantive pages across `content/docs/gioi-thieu/`, `content/docs/kien-truc/`, and `content/docs/workloads/`.
- **149** category pages that still contain the standard placeholder curriculum body.
- The root `content/docs/index.md` also contains a placeholder marker, bringing the repository-wide marker count to **150**.
- Every category page currently has a matching `meta.json` registration, and all 182 Markdown files have `title` and `description` frontmatter.

`README.md` and `content/docs/index.md` still say that all pages are placeholders. That statement is stale relative to the current files in the completed introduction, architecture, and workloads sections. Use the files themselves and [Curriculum and content map](content-map.md) when deciding what remains to be written.

## Non-negotiable content contracts

For changes under `content/docs/`, the repository instructions and authoring skill establish these contracts:

- Write explanatory content in Vietnamese while preserving technical names, code, commands, and identifiers in English.
- Every page must have `title` and `description` frontmatter.
- Add or rename a page only together with the relevant category `meta.json`; add a new category to root `content/docs/meta.json` as well.
- Keep internal site URLs trailing-slash form, for example `/workloads/deployment/`, because `next.config.mjs` enables `trailingSlash: true`.
- Run `npm run build` before finishing.

See [Development and operations](development.md) for the complete change checklist. Harness Wiki pages themselves are intentionally written in English and are not part of the Vietnamese Fumadocs curriculum.

## Rule loading

Before editing repository files, read [the global Wiki rules](_rules.md) and every `_rules.md` in the Wiki section or source domain relevant to the change. Read all applicable rule files when work spans multiple sections, and re-read them if the scope changes. At present, only `wiki/_rules.md` exists.

## Wiki map

- [Site architecture](architecture.md) — content compilation, routing, MDX components, search, static export, and extension points.
- [Curriculum and content map](content-map.md) — learning sequence, category ownership, maturity, navigation metadata, and source-of-truth guidance.
- [Development and operations](development.md) — setup, authoring workflow, runtime changes, validation, deployment, and rollback.

## Backlog

No substantial source area was deferred from this initial repository map. The unfinished curriculum is documented as product work in [Curriculum and content map](content-map.md), rather than split into thin Wiki pages for every placeholder category.
