---
title: "Development and operations"
description: "Workflows for authoring curriculum content, changing the Fumadocs runtime, validating static output, and deploying safely."
---

# Development and operations

## Change types

Most work belongs to one of three change classes:

| Change class | Primary files | Required context |
|---|---|---|
| Curriculum content | `content/docs/**/*.md`, category `meta.json`, sometimes root `content/docs/meta.json` | `AGENTS.md`, target metadata and adjacent lessons, `.agents/skills/write-docs/SKILL.md` |
| Site/runtime behavior | `src/`, `source.config.ts`, `next.config.mjs`, `tsconfig.json` | [Site architecture](architecture.md) and representative content pages |
| Build/deployment | `package.json`, `next.config.mjs`, `wrangler.toml`, `.gitignore` | Static export contract, output directory, Cloudflare environment outside the repository |

Before modifying files, start at [Repository quickstart](quickstart.md) and follow its **Rule loading** section. The only reviewed Wiki rule file currently present is `wiki/_rules.md`, but future section rules may add narrower requirements.

## Local setup

The repository commits `package-lock.json` but does not declare a Node.js version in `package.json`. Use a Node/npm combination compatible with Next.js 15 and the lockfile in the development environment; do not document a precise version unless the repository begins pinning one.

Install reproducibly and start the development server:

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`. The root should redirect to `/gioi-thieu/container-fundamentals/`.

For a production-shaped local check:

```bash
npm run build
npm run preview
```

`npm run build` generates `.source/`, Next.js intermediates, and the static `dist/` output. `npm run preview` serves `dist/` with Wrangler Pages development mode. These generated directories are ignored and should not be committed.

## Pre-change inspection

Use a narrow preflight rather than assuming the working tree matches the Wiki:

```bash
git status --short
git diff --stat
git log -5 --oneline
```

For a content task, also inspect:

```text
content/docs/meta.json
content/docs/<category>/meta.json
content/docs/<category>/<target>.md
adjacent pages named before and after the target in meta.json
```

For a runtime task, use the dependency pairs in [Site architecture](architecture.md). In particular:

- read `source.config.ts` with the component registrations in `src/app/[[...slug]]/page.tsx`;
- read the catch-all route with `src/lib/source.ts` and `next.config.mjs`;
- read the search route with the hosting-size rationale before expanding indexed data.

Do not inspect `.env` files, credentials, tokens, private keys, deployment auth, or payload logs. None are needed to understand this repository's committed architecture.

## Authoring or completing a lesson

### 1. Locate the existing curriculum slot

Read [Curriculum and content map](content-map.md), then the target category's `meta.json`. Most planned topics already have a placeholder and stable slug. Prefer completing that page over creating a near-duplicate.

Choose the canonical owner for the concept. Use cross-links when a lab, troubleshooting guide, or production page needs theory owned by another category.

### 2. Read repository-specific writing guidance

Load `.agents/skills/write-docs/SKILL.md` and the references relevant to the page. The checked-in guidance requires Vietnamese content and preserves English technical terms, code, command names, and identifiers.

Use completed pages as stronger style evidence than placeholders:

- concept foundation: `content/docs/gioi-thieu/container-fundamentals.md`;
- end-to-end lab: `content/docs/gioi-thieu/first-application.md`;
- distributed-system overview: `content/docs/kien-truc/tong-quan-cluster.md`;
- deep conceptual model: `content/docs/kien-truc/declarative-reconciliation.md`.

### 3. Preserve the page contract

A curriculum page needs frontmatter:

```yaml
---
title: "Tên trang"
description: "Mô tả ngắn gọn nội dung và giá trị của trang."
---
```

Content requirements from `AGENTS.md` and the writing skill:

- keep explanatory prose in Vietnamese;
- use a single H1 and consistent H2/H3/H4 hierarchy;
- add a language to every fenced code block;
- keep blank lines around MDX components and tables;
- use URLs such as `/networking/service/`, with a trailing slash;
- provide verification, failure modes, and cleanup for hands-on instructions when applicable;
- do not present a generic placeholder objective as completed guidance.

Supported custom content includes Callout, Cards, Steps, Tabs, Accordion, TypeTable, and fenced Mermaid diagrams. Their actual renderer contract lives in `source.config.ts` and `src/app/[[...slug]]/page.tsx`.

### 4. Update navigation atomically

When adding or renaming a page, update `content/docs/<category>/meta.json` in the same change. Place the basename by learning sequence, not alphabetical order.

When creating a category, also register the category in `content/docs/meta.json`. When deleting or moving a page, search for inbound links and check whether the root redirect or another canonical entrypoint references it.

A useful targeted search is:

```bash
rg '/<category>/<old-slug>/' content/docs README.md
```

Do not add `.md` to public internal URLs.

### 5. Build and inspect

Run:

```bash
npm run build
```

Then inspect at least:

- the changed page;
- its sidebar location;
- headings/table of contents;
- internal links;
- code, table, callout, and Mermaid rendering used by the page; and
- the generated search result by title or heading.

If the page contains a lab, independently check that commands are internally consistent, expected resources have verification steps, and destructive resources have cleanup instructions. The repository has no executable lab fixtures or cluster test harness, so do not claim a Kubernetes exercise was run unless it actually was.

## Changing the site runtime

### Routing and metadata

Read:

- `src/app/[[...slug]]/page.tsx`;
- `src/app/[[...slug]]/layout.tsx`;
- `src/lib/source.ts`;
- `next.config.mjs`.

Preserve these behaviors unless the change explicitly replaces them:

- `/` redirects to a valid first lesson;
- unknown slugs use `notFound()`;
- all content pages appear in `generateStaticParams()`;
- per-page title and description come from frontmatter;
- URLs and exported paths remain consistent with `trailingSlash: true`.

A route change can invalidate every internal link and static artifact path. Search the curriculum before renaming public slugs; the repository has no committed redirect map.

### Markdown transforms and MDX components

Read `source.config.ts` and the `components` map in the catch-all page as one unit.

For a new syntax or component:

1. identify the input Markdown/MDX node shape;
2. transform it in the Fumadocs source configuration if necessary;
3. register the output component in the page renderer;
4. respect Next.js client/server component boundaries;
5. add or update a representative curriculum page; and
6. build the full repository.

Do not move remark configuration back into `next.config.mjs` without understanding the centralization introduced by commit `f94a2e1`.

### Mermaid

Mermaid diagrams compile to a custom MDX element but render SVG in the browser through a dynamic import. Validation therefore has two levels:

- `npm run build` checks the content/MDX integration;
- browser inspection checks Mermaid parse errors, client execution, and horizontal layout.

Test more than one diagram if changing initialization because the component generates per-instance IDs.

### Search

The search endpoint intentionally indexes metadata and headings while omitting body contents. This keeps the static asset under the Cloudflare Pages size limit cited in source comments.

After a search change:

1. build the site;
2. inspect the generated artifact size;
3. serve `dist/` with `npm run preview`;
4. query a title, description term, and heading; and
5. confirm links use the canonical trailing-slash URL.

Do not describe the current implementation as full-text search.

### Global UI and CSS

`src/app/globals.css` affects the entire curriculum. Test a matrix rather than a single page:

| Page type | Suggested source |
|---|---|
| Long prose | `content/docs/gioi-thieu/container-fundamentals.md` |
| Lab with YAML and shell | `content/docs/gioi-thieu/first-application.md` |
| Mermaid-heavy architecture | `content/docs/kien-truc/tong-quan-cluster.md` |
| Short placeholder | `content/docs/workloads/deployment.md` |

The CSS imports Google Fonts at runtime. A font change may affect browser network behavior as well as layout, even though the static build succeeds.

## Validation matrix

`package.json` defines no `test`, `lint`, or standalone type-check script, and no `*.test.*` or `*.spec.*` files were found. Do not report “tests passed” when only a build ran.

### Required repository checks

```bash
npm run build
git diff --check
git status --short
```

Interpret them accurately:

- **Build passed:** Fumadocs content generation, TypeScript/Next compilation, static route generation, and export completed.
- **`git diff --check` passed:** tracked diff has no whitespace errors; it does not validate content accuracy or untracked file formatting.
- **Manual preview passed:** only claim the specific routes and browser behaviors inspected.

### Targeted browser checks

For content changes:

- root redirect;
- changed page and adjacent sidebar entries;
- unknown slug behavior;
- relevant MDX components;
- title/heading search.

For runtime changes, also inspect:

- one completed introduction page;
- one completed architecture page;
- one placeholder page;
- output under `dist/`; and
- console errors during Mermaid or search interaction.

## Deployment

The deployment script is:

```bash
npm run deploy
```

It expands to a production build followed by `npx wrangler pages deploy dist`. `wrangler.toml` supplies only the project name and output directory. Cloudflare account selection, credentials, environment policy, approvals, and production ownership are not documented in this repository.

Operational rules:

- use `npm run build` and `npm run preview` for validation;
- run `npm run deploy` only with explicit intent and authorized Cloudflare context;
- inspect `git status` before deploying so local content is understood;
- do not add credentials to the repository or Wiki.

## Rollback

There is no repository-specific rollback script or Cloudflare runbook. Available evidence supports two general recovery paths:

1. use Cloudflare Pages deployment history to select a previous known-good deployment, if the operator's environment supports that workflow; or
2. revert or restore the responsible repository change, run `npm run build`, inspect the local static output, and deploy the known-good source again.

For URL changes, restoring code alone may not preserve external links. Prefer stable slugs; if a rename is necessary, define an explicit redirect strategy before removing the old route.

## Common failure modes

| Symptom | Likely area | First check |
|---|---|---|
| Page exists but is absent from sidebar | Category metadata | Basename and order in `content/docs/<category>/meta.json` |
| Build cannot resolve a page or generated source | Content/compiler | Frontmatter, metadata entry, `source.config.ts`, generated `.source/` |
| Admonition displays as plain text or fails | Remark pipeline | Input syntax and callout transform in `source.config.ts` |
| MDX element is undefined | Renderer contract | Component import and registration in catch-all `page.tsx` |
| Mermaid area remains empty | Client renderer | Browser console, chart syntax, dynamic import, generated ID |
| Search cannot find body text | Expected design | Current index omits `structuredData.contents` |
| Root redirects to 404 | Entry lesson changed | Redirect target and `gioi-thieu/meta.json` |
| Internal link redirects twice or fails in export | URL shape | Missing trailing slash or stale slug |
| Deploy points at missing output | Build/deploy contract | Successful build and `dist/` matching `wrangler.toml` |
