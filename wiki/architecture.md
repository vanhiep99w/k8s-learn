---
title: "Kiến trúc site"
description: "Cách k8s-learn biến Markdown/MDX thành website Kubernetes tĩnh với Next.js và Fumadocs."
---

# Kiến trúc site

## Mô hình tổng thể

Repository có một pipeline nội dung đơn giản: Markdown là dữ liệu chính, Fumadocs tạo source được typed, Next.js render page và static export tạo artifact để Cloudflare Pages phục vụ.

```mermaid
flowchart LR
    MD[content/docs/*.md] --> CFG[source.config.ts]
    META[meta.json] --> CFG
    CFG --> SRC[Fumadocs docs source]
    SRC --> ROUTE[src/app/[[...slug]]/page.tsx]
    ROUTE --> HTML[Next static export]
    HTML --> DIST[dist/]
    DIST --> CF[Cloudflare Pages]
    SRC --> SEARCH[src/app/api/search/route.ts]
    SEARCH --> INDEX[Static search index]
```

### Các lớp chính

| Lớp | File/thư mục | Trách nhiệm |
|---|---|---|
| Nội dung | `content/docs/` | Các page `.md`, frontmatter và `meta.json` cho sidebar. |
| Content compiler | `source.config.ts` | Khai báo docs directory và biến admonition/Mermaid trong Markdown thành MDX component. |
| Loader | `src/lib/source.ts` | Chuyển docs source thành nguồn mà Fumadocs route/search sử dụng; base URL là `/`. |
| Page route | `src/app/[[...slug]]/page.tsx` | Resolve slug, redirect root, render title/description/body, tạo static params và metadata. |
| UI runtime | `src/app/layout.tsx`, `src/app/globals.css` | RootProvider, locale `vi`, metadata, typography và style của Fumadocs. |
| MDX components | `src/app/[[...slug]]/page.tsx`, `src/components/mermaid.tsx` | Đăng ký Callout, Cards, Steps, Tabs, Accordion, TypeTable và Mermaid. |
| Search | `src/app/api/search/route.ts` | Tạo static GET từ source; index chỉ lấy title, description và headings. |
| Hosting | `next.config.mjs`, `wrangler.toml` | Static export trong `dist/`, trailing slash và Cloudflare Pages output. |

## Luồng render một page

1. `source.config.ts` gọi `defineDocs({ dir: 'content/docs' })`.
2. Fumadocs đọc frontmatter, Markdown và `meta.json`; source generated được import qua alias `@/.source` trong `src/lib/source.ts`.
3. Dynamic route nhận `slug` dưới dạng `Promise<{ slug?: string[] }>`.
4. Không có slug thì redirect tới trang Nền tảng Container; slug không tồn tại thì `notFound()`.
5. Page lấy `page.data.body`, render trong `DocsPage`, đồng thời dùng `page.data.title`, `description` và `toc`.
6. `generateStaticParams()` đưa toàn bộ page vào static export; `generateMetadata()` tạo metadata theo từng page.

Điều này nghĩa là thêm một Markdown page không tự tạo route động lúc runtime theo kiểu server database; page phải được source compiler nhận diện trong quá trình build.

## MDX và plugin

`source.config.ts` đăng ký ba remark plugin theo thứ tự:

- `remarkGithubAdmonitions`: nhận cú pháp GitHub admonition như `> [!NOTE]`.
- `remarkCalloutDirectives`: chuyển directive thành `Callout`, map `note`/`tip`/`info` sang `info`, `warning` sang `warn`, `danger` sang `error`, đồng thời đặt title tiếng Việt.
- `remarkMermaid`: thay code block có language `mermaid` bằng `MermaidDiagram`.

`page.tsx` phải cung cấp đúng component cho các node MDX mà content sử dụng. Các component Fumadocs hiện được đăng ký gồm `Callout`, `Card`, `Cards`, `Step`, `Steps`, `Tab`, `Tabs`, `Accordion`, `Accordions` và `TypeTable`.

`MermaidDiagram` là client component. Nó lazy-load package `mermaid` trong `useEffect`, render SVG vào `div` và hủy kết quả nếu component unmount trước khi render xong. Vì vậy Mermaid không được xử lý như HTML tĩnh trực tiếp trong Markdown.

## Static export và deploy

`next.config.mjs` đặt:

- `output: 'export'`: build thành site tĩnh.
- `distDir: 'dist'`: artifact nằm trong `dist/`.
- `trailingSlash: true`: route tài liệu có URL kết thúc bằng `/`.
- `images.unoptimized: true`: phù hợp với static export, không dùng Next image optimization server.

`wrangler.toml` khai báo `pages_build_output_dir = "./dist"`. `npm run deploy` trong `package.json` chạy `npm run build` trước rồi gọi `wrangler pages deploy dist`.

## Search

`src/app/api/search/route.ts` dùng `createFromSource(source, ...)` và export `dynamic = 'force-static'` để tương thích static export. Search item lấy `title`, `description`, `url`, `id`; `structuredData` chỉ giữ `headings` và bỏ `contents`. Comment trong source giải thích đây là quyết định để static search index nằm dưới giới hạn asset 25 MiB của Cloudflare Pages.

Khi đổi cấu trúc heading hoặc title/description, search index có thể thay đổi sau build. Khi sửa search route, phải kiểm tra cả build static và hành vi tìm kiếm ở site, không chỉ type-check.

## Điểm mở rộng có kiểm soát

- **Thêm nội dung:** sửa `content/docs/` và `meta.json`, không cần sửa route.
- **Đổi cú pháp Markdown:** sửa plugin trong `source.config.ts`, sau đó kiểm tra các page đang dùng cú pháp đó.
- **Thêm MDX component:** import và đăng ký component trong `page.tsx`, rồi thêm page mẫu để build kiểm chứng.
- **Đổi URL/static behavior:** xem đồng thời `next.config.mjs`, `src/lib/source.ts`, route dynamic và internal links.
- **Đổi search payload:** sửa `src/app/api/search/route.ts`, cân nhắc kích thước artifact Cloudflare.

Không có bằng chứng trong repository về database, authentication của site, server-side API nghiệp vụ hay background job; không nên thêm các giả định này vào thiết kế thay đổi.
