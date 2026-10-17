---
title: "Site architecture"
description: "How Markdown content becomes a static Fumadocs site with routing, search, build-time D2 diagrams, interactive examples, and Cloudflare Pages output."
---

# Site architecture

## System boundary

The application is a content compiler and static documentation frontend. Source Markdown and metadata are read during the build; the resulting HTML and static endpoint assets are written to `dist/` for Cloudflare Pages. There is no database or runtime content service.

```text
content/docs/**/*.md ─┐
content/docs/**/meta.json
                      ▼
              source.config.ts
        Fumadocs MDX compilation
                      ▼
             generated .source/
                      ▼
              src/lib/source.ts
               Fumadocs loader
                 ┌────┴─────────┐
                 ▼              ▼
src/app/[[...slug]]/page.tsx   src/app/api/search/route.ts
         page HTML                 static search data
                 └────┬─────────┘
                      ▼
          Next.js static export
                      ▼
                    dist/
                      ▼
              Cloudflare Pages
```

The important architectural consequence is that a content or renderer error can fail the build across the entire curriculum. A normal documentation page is not fetched from storage on demand; it must be accepted by the Fumadocs source compiler and included in static generation.

## Content source and generated source

`source.config.ts` declares `content/docs` through `defineDocs({ dir: 'content/docs' })` and configures the Markdown transforms. Fumadocs generates typed source under `.source/`; `tsconfig.json` maps `@/.source` to `.source/index.ts`.

`src/lib/source.ts` wraps that generated module with the Fumadocs `loader`:

- `baseUrl` is `/`.
- `source.pageTree` supplies sidebar navigation.
- `source.getPage(slug)` resolves a page.
- `source.generateParams()` supplies static route parameters.

Do not hand-edit `.source/`. It is generated, ignored by Git, and rebuilt from the Markdown and metadata inputs.

### Navigation contract

Fumadocs uses `content/docs/meta.json` for root order and each `content/docs/<category>/meta.json` for page order. A Markdown file can exist and compile while still being absent from the intended sidebar if its basename is not registered. Conversely, a `pages` entry with no file is a broken navigation declaration.

For the domain model and current registration inventory, see [Curriculum and content map](content-map.md).

## Request and page rendering

The catch-all route is split across two files:

- `src/app/[[...slug]]/layout.tsx` creates `DocsLayout`, supplies `source.pageTree`, labels the navigation `Kubernetes Learning`, and disables sidebar tabs.
- `src/app/[[...slug]]/page.tsx` resolves and renders the page.

The page path behaves as follows:

1. Next.js provides an optional slug array.
2. An empty slug redirects to `/gioi-thieu/container-fundamentals/`.
3. `source.getPage(slug)` resolves the content; an unknown slug calls `notFound()`.
4. The route renders `title`, `description`, body, and generated table of contents through Fumadocs UI components.
5. `generateStaticParams()` returns the empty root path plus every source page.
6. `generateMetadata()` uses repository-level metadata for the root and page frontmatter for content routes.

The root redirect formerly targeted `gioi-thieu/lo-trinh-hoc`. Commit `f94a2e1` removed that page from the curriculum and changed the redirect to the current container fundamentals entrypoint. When changing the first lesson, update the category metadata and route together; do not leave the redirect pointing at a removed slug.

`src/app/layout.tsx` provides the global shell:

- `<html lang="vi">` identifies the public curriculum language.
- `RootProvider` enables Fumadocs static search in the client.
- Global title, description, and favicon are defined here.

## Markdown and MDX pipeline

`source.config.ts` registers these remark stages in this order:

1. `remark-github-admonitions-to-directives` parses GitHub-style admonitions such as `> [!NOTE]`.
2. `remarkCalloutDirectives` replaces recognized directives with Fumadocs `Callout` MDX nodes. It maps `note`, `tip`, and `info` to `info`; `warning` to `warn`; and `danger` to `error`, with Vietnamese display titles.
3. `remarkD2` from `@vanhiep99w/docs-kit/d2` compiles `d2` fences into light/dark SVG at build time. Interactive viewing is enabled by default; the viewer chunk loads only after Explore. The compiler/WASM stays in Node.js.
4. `remarkTerminalSession`, `remarkCodeWalkthrough`, `remarkCodeDiff`, and `remarkProtocolExchange` validate their YAML fences and prepare component props. Shiki/diff preparation stays at build time.

This configuration was centralized in `source.config.ts` in commit `f94a2e1`. `next.config.mjs` now calls `createMDX()` without a second remark configuration. Preserve this single ownership point to avoid transforms running inconsistently or twice.

### Registered content components

`src/app/[[...slug]]/page.tsx` merges the default Fumadocs MDX components with:

- `Callout`
- `Card` and `Cards`
- `Step` and `Steps`
- `Tab` and `Tabs`
- `Accordion` and `Accordions`
- `TypeTable`
- `D2Diagram` and `D2InteractiveDiagram`
- `TerminalSession`, `CodeWalkthrough`, `CodeDiff`, and `ProtocolExchange`

A transform that emits a custom MDX element and the component registration that renders it are one contract. If either side changes, build a representative page that uses the syntax.

### D2 and docs-kit runtime

The Mermaid renderer and dependency have been removed. D2 source lives directly in curriculum fences, not in an automatic Mermaid/ASCII conversion layer. Keep logs, command output, formulas, positional syntax, and file trees as text.

D2 uses ELK, non-sketch rendering at scale 1, light/dark themes, one shared worker, and a cache under `.next/cache/docs-kit/d2`. That path is ignored and can be restored with a compatible CI build cache; the package does not enable Cloudflare dashboard settings. Syntax/descriptor errors fail the build with the source location. Build requires Node.js 22+.

All diagram SVGs and example data are statically exported. Interactive D2 supports fit/zoom/pan, native-dialog expansion, source/copy, SVG download, and optional scenario/step/layer navigation. Browser validation still matters for hydration, keyboard controls, theme, and mobile overflow. Remote D2 Icons URLs require network access while reading; labels remain meaningful without icons.

The other registered fences are `terminal-session`, `code-walkthrough`, `code-diff`, and `protocol-exchange`. They only present author-provided data: no shell execution, cluster connection, HTTP requests, or benchmark verification. Treat all snapshots/scenarios as public. Only compile trusted repository content; generated SVG is embedded directly, not sanitized for arbitrary public input.

Representative pages:
- `gioi-thieu/yaml-manifest.md`: Code Walkthrough.
- `gioi-thieu/first-application.md`: Terminal Session and Code Diff.
- `kien-truc/kube-apiserver.md`: Protocol Exchange.
- `cau-hinh/pod-disruption-budget.md`: mutually exclusive D2 scenario tabs.

Source Explorer and Span Waterfall are not registered: add them only when a lesson has suitable source artifacts or trace data.

## Static search

`src/app/api/search/route.ts` uses `createFromSource(source, mapper)` and exports its `staticGET` handler as `GET`. `dynamic = 'force-static'` makes the route compatible with static export.

Each search record contains the page title, description, URL, ID, and headings. The mapper deliberately sets `structuredData.contents` to an empty array. The source comment and original commit history identify the reason: keep the exported search asset below Cloudflare Pages' 25 MiB asset limit.

This means search is optimized for discovery by title, description, and heading, not full body text. Reintroducing body contents is not a harmless relevance improvement; it changes artifact size and must be measured against the hosting constraint.

## Static export and hosting

`next.config.mjs` establishes the deployment shape:

| Setting | Effect |
|---|---|
| `output: 'export'` | Build a static site rather than a Node.js server deployment. |
| `distDir: 'dist'` | Write generated output to `dist/`. |
| `trailingSlash: true` | Export directory-style routes and require canonical internal URLs with a final slash. |
| `images.unoptimized: true` | Avoid depending on Next.js server-side image optimization. |

`wrangler.toml` names the Pages project `k8s-learn` and points `pages_build_output_dir` at `./dist`. `npm run deploy` performs a fresh build and then runs `wrangler pages deploy dist`.

Do not infer credentials, account selection, preview environments, or rollback automation from `wrangler.toml`; none are committed here.

## Global presentation

`src/app/globals.css` imports the Fumadocs stylesheet and Google-hosted Inter and JetBrains Mono fonts. It widens article content and tunes Vietnamese prose, headings, code, and table sizing. Because the selectors are global, visual changes should be checked against:

- a long prose page, such as `content/docs/gioi-thieu/container-fundamentals.md`;
- a lesson with commands and manifests, such as `content/docs/gioi-thieu/first-application.md`;
- a diagram-heavy architecture page, such as `content/docs/kien-truc/tong-quan-cluster.md`;
- interactive example pages listed above; and
- a short placeholder page, such as `content/docs/workloads/deployment.md`.

## Change impact guide

| Change | Read together | Main risks | Minimum validation |
|---|---|---|---|
| Add or move a lesson | Target `.md`, category `meta.json`, root `meta.json` if adding a category | Missing sidebar entry, broken link, stale root redirect | `npm run build`; inspect sidebar and URL |
| Change Markdown syntax | `source.config.ts`, renderer component registration, representative pages | AST mismatch, compile failure across all pages | Build all pages; browser-check one example |
| Add an MDX component | Component source and `src/app/[[...slug]]/page.tsx` | Element not registered, client/server boundary errors | Build and render a sample page |
| Change routing | Catch-all page/layout, `src/lib/source.ts`, `next.config.mjs` | Missing static params, broken redirect, URL churn | Build; test root, valid slug, invalid slug |
| Change search | Search route and representative frontmatter/headings | Larger artifact, weak results, static export failure | Build; inspect asset size; query local preview |
| Change deployment output | `package.json`, `next.config.mjs`, `wrangler.toml`, `.gitignore` | Deploying wrong directory or committing generated files | Build; confirm `dist/`; use preview before deploy |

The repository has no backend integration tests to absorb these risks. The production build and focused browser checks are the effective architecture-level test strategy; see [Development and operations](development.md).
