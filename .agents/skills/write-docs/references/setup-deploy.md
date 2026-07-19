# Setup và deploy website tài liệu

Dùng reference này khi nhiệm vụ bao gồm tạo hoặc thay đổi runtime Next.js + Fumadocs + Cloudflare. Với repository hiện có, ưu tiên đọc `package.json`, `source.config.ts`, page renderer, `next.config.*` và `wrangler.toml`; không thay dependency/config chỉ để khớp ví dụ bên dưới.

## Mục lục

- [Khảo sát repository](#khảo-sát-repository)
- [Cấu trúc tối thiểu](#cấu-trúc-tối-thiểu)
- [Navigation](#navigation)
- [Đăng ký MDX components](#đăng-ký-mdx-components)
- [Mermaid support](#mermaid-support)
- [Cloudflare Pages](#cloudflare-pages)
- [Validation](#validation)
- [Troubleshooting](#troubleshooting)

## Khảo sát repository

Trước khi setup hoặc nâng cấp:

1. Kiểm tra package manager từ lockfile.
2. Đọc version hiện tại trong `package.json`.
3. Đọc official documentation tương ứng với version trước khi thay API/config.
4. Xác định output mode và output directory từ `next.config.*` cùng `wrangler.toml`.
5. Kiểm tra MDX components và remark plugins đã đăng ký.
6. Giữ thay đổi nhỏ nhất đáp ứng yêu cầu; không copy nguyên config từ project khác.

## Cấu trúc tối thiểu

```text
repo/
├── content/docs/
│   ├── meta.json
│   └── <category>/
│       ├── meta.json
│       └── <page>.md
├── src/app/[[...slug]]/page.tsx
├── src/lib/source.ts
├── source.config.ts
├── next.config.mjs
├── package.json
└── wrangler.toml
```

Mỗi page có `title` và `description`. Category/file ordering nằm trong `meta.json` nếu project dùng Fumadocs navigation metadata.

## Navigation

Root `content/docs/meta.json`:

```json
{
  "pages": ["gioi-thieu", "kien-truc", "networking"]
}
```

Category `content/docs/networking/meta.json`:

```json
{
  "title": "Networking",
  "pages": ["service", "dns", "ingress", "network-policy"]
}
```

Thứ tự `pages` là thứ tự học tập/sidebar. Khi thêm hoặc đổi tên file, cập nhật metadata trong cùng thay đổi.

## Đăng ký MDX components

Page renderer thường truyền components vào body:

```tsx
<MDX
  components={{
    ...defaultMdxComponents,
    MermaidDiagram,
    Callout,
    Card,
    Cards,
    Step,
    Steps,
    Tab,
    Tabs,
    Accordion,
    Accordions,
    TypeTable,
  }}
/>
```

Import component từ package/path phù hợp với version đang cài. Không giả định API của latest version tương thích với repository.

## Mermaid support

Một cách triển khai phổ biến là biến fenced code `mermaid` thành client component qua remark plugin:

```ts
function remarkMermaid() {
  return (tree: import('mdast').Root) => {
    visit(tree, 'code', (node, index, parent) => {
      if (node.lang !== 'mermaid' || index === undefined || !parent) return;

      (parent.children as unknown[])[index] = {
        type: 'mdxJsxFlowElement',
        name: 'MermaidDiagram',
        attributes: [
          { type: 'mdxJsxAttribute', name: 'chart', value: node.value },
        ],
        children: [],
      };
    });
  };
}
```

Đăng ký plugin trong `source.config.ts` theo API của `fumadocs-mdx` đang dùng. Client component phải:

- Import Mermaid ở client side nếu static rendering không có DOM.
- Tạo ID an toàn và riêng cho mỗi diagram.
- Tránh cập nhật DOM sau khi component unmount.
- Hiển thị lỗi hữu ích hoặc ít nhất không làm hỏng cả page khi diagram sai.

Kiểm tra implementation hiện có trước khi thay thế.

## Cloudflare Pages

Cấu hình tối thiểu thường chỉ định output directory:

```toml
name = "docs-site"
pages_build_output_dir = "./dist"
```

Directory phải khớp output thực tế của Next.js build. Với static export, kiểm tra `output: 'export'`, `distDir` và trailing slash trong `next.config.*`.

Không chạy deploy chỉ để validate vì deploy có thể publish production. Dùng build và local preview.

## Validation

Dùng command của repository. Với npm project điển hình:

```bash
npm ci
npm run build
npm run preview
```

Không chạy `npm ci` nếu dependencies đã cài và nhiệm vụ không cần reinstall. Build là gate bắt buộc sau thay đổi content/runtime trong repository yêu cầu điều đó.

Kiểm tra thủ công:

- Root redirect và page route.
- Sidebar order.
- Internal link có trailing slash.
- Search index nếu có.
- Mermaid và MDX component.
- Static assets trên base/output path.
- 404 page và metadata.

## Troubleshooting

| Triệu chứng | Kiểm tra đầu tiên |
|---|---|
| Page không hiện sidebar | Category/root `meta.json` và slug |
| Build lỗi MDX | Dòng được báo, JSX props, fence và component registration |
| Mermaid không render | Remark plugin, client component và diagram syntax |
| Link redirect hoặc 404 | Site route, trailing slash và static output path |
| Cloudflare không thấy asset | Build output directory và `wrangler.toml` |
| Route conflict | App Router files trùng với catch-all route |
| Component undefined | Import và `components` map trong page renderer |

Chẩn đoán từ build error và source hiện tại; không áp dụng workaround theo version khác mà chưa kiểm chứng.
