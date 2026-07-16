---
title: "Hướng dẫn phát triển"
description: "Workflow thay đổi nội dung và code của site k8s-learn, từ local preview đến build và deploy."
---

# Hướng dẫn phát triển

## Nguyên tắc thay đổi

Đây là docs site; thay đổi thường rơi vào một trong hai loại:

1. **Content change:** Markdown/frontmatter/`meta.json` trong `content/docs/`.
2. **Site behavior change:** route, MDX compiler, component, CSS, search hoặc build config trong `src/`, `source.config.ts`, `next.config.mjs` và `wrangler.toml`.

Trước khi sửa, đọc `AGENTS.md`, `wiki/quickstart.md`, `wiki/_rules.md` và `_rules.md` của section Wiki áp dụng. Hướng dẫn content chi tiết nằm trong `.agents/skills/write-docs/SKILL.md`. Không đọc `.env` hoặc file có secret; không đưa credential vào Markdown, command hay example.

## Local workflow

```bash
npm install
npm run dev
```

`npm run dev` chạy Next development server. Mở `http://localhost:3000`; root sẽ redirect đến trang Nền tảng Container. Khi sửa page, kiểm tra cả frontmatter, heading, internal links, code block và vị trí trong sidebar.

Build production-like static output:

```bash
npm run build
```

Build dùng Next static export, ghi output vào `dist/`. Kiểm tra tiếp bằng:

```bash
npm run preview
```

Lệnh này chạy `wrangler pages dev dist`. `npm run deploy` thực hiện build rồi deploy `dist/` lên Cloudflare Pages; chỉ chạy khi đã có quyền và cấu hình deploy phù hợp.

## Checklist khi thêm hoặc hoàn thiện content

- [ ] Đã chọn đúng category hiện có.
- [ ] Đã đọc `meta.json` của category và các page liên quan.
- [ ] Page có `title` và `description` trong frontmatter.
- [ ] Nội dung bằng tiếng Việt, giữ technical names/code bằng English.
- [ ] Internal links dùng URL trailing slash.
- [ ] Basename đã được thêm vào đúng vị trí trong `content/docs/<category>/meta.json`.
- [ ] Không để link tới slug không tồn tại.
- [ ] Manifest/command có cách verify, cleanup và failure mode khi phù hợp.
- [ ] Đã chạy `npm run build`.
- [ ] Đã kiểm tra `git diff` và `git status --short` để chắc rằng chỉ thay đổi dự kiến.

Không cần sửa route để một page Markdown bình thường xuất hiện; Fumadocs route dùng generated source. Ngược lại, file không có trong `pages` có thể không xuất hiện trên sidebar dù tồn tại trong filesystem.

## Checklist khi sửa site runtime

### Route hoặc static behavior

Đọc cùng nhau `next.config.mjs`, `src/app/[[...slug]]/page.tsx` và `src/lib/source.ts`. Kiểm tra:

- Root redirect vẫn đi tới page hợp lệ.
- Slug không hợp lệ vẫn trả `notFound()`.
- `generateStaticParams()` bao phủ page mới.
- URL trailing slash và static artifact vẫn đúng.
- Metadata lấy từ page data không bị mất.

### Markdown/MDX compiler

Đọc `source.config.ts` và `src/app/[[...slug]]/page.tsx` cùng nhau. Nếu thêm syntax:

1. Xác định Markdown AST node đầu vào.
2. Viết hoặc điều chỉnh remark transform.
3. Đảm bảo component output được import và truyền vào `MDX components`.
4. Tạo/điều chỉnh một page mẫu trong content nếu thay đổi có user-facing behavior.
5. Chạy build để bắt lỗi compile tại tất cả page.

Đặc biệt, `source.config.ts` hiện chuyển admonition thành `Callout` và code block `mermaid` thành `MermaidDiagram`; không thay đổi một phía rồi giả định phía còn lại tự hoạt động.

### Search

Search được build tĩnh từ `src/app/api/search/route.ts`; payload cố ý bỏ `contents` và chỉ giữ headings để giới hạn kích thước index. Sau khi sửa title, description, heading hoặc search mapping, kiểm tra artifact build và thao tác search trên local preview.

### UI/CSS

`src/app/layout.tsx` cấu hình `RootProvider`, locale và metadata; `src/app/globals.css` cấu hình font, line-height, bảng và code block. Thay đổi CSS có thể ảnh hưởng toàn bộ 183 page, nên ưu tiên kiểm tra một page dài, một page có bảng/code và một page có Mermaid/Callout.

## Git và thay đổi đang có

Luôn xem trạng thái trước khi bắt đầu:

```bash
git status --short
git diff -- next.config.mjs source.config.ts
```

Tại thời điểm Wiki này được tạo:

- `HEAD` là commit `3c4424083867bd577cae44c2baf74f9e767d5e2d`, với commit gần nhất là “Write Kubernetes introduction documentation”.
- `next.config.mjs` đang bỏ plugin admonition khỏi `createMDX()` và `source.config.ts` đang nhận trách nhiệm đăng ký `remarkGithubAdmonitions`, callout transform và Mermaid transform.
- `wiki/` chưa có tài liệu hữu ích trước run này; `wiki/_rules.md` là file rule đã tồn tại và không được sửa.

Các thay đổi trên là working-tree evidence, chưa phải baseline đã commit. Khi review hoặc debug, không vô tình reset chúng. Dùng `git diff --check` để tìm whitespace error và `git diff --stat` để kiểm tra phạm vi.

## Kiểm tra trước khi hoàn tất

```bash
npm run build
git diff --check
git status --short
```

Build là kiểm tra bắt buộc theo `AGENTS.md`, kể cả khi thay đổi chủ yếu là tài liệu. Repository hiện không có test script riêng trong `package.json`; vì vậy không nên báo “tests passed” nếu chỉ chạy build. Nếu build lỗi, đọc log theo thứ tự content compiler → MDX page → Next route → static export.

Sau khi build, kiểm tra nhanh:

- Page bắt đầu và một page placeholder đều resolve.
- Một page có `> [!NOTE]` render Callout.
- Một page có Mermaid không làm build fail và render ở browser.
- Search trả kết quả theo title/heading.
- `dist/` được tạo đúng nhưng không được commit nếu repository ignore artifact đó.

## Deploy và rollback thực tế

`wrangler.toml` chỉ khai báo tên Pages project `k8s-learn` và thư mục output; thông tin credential/deploy không được ghi trong Wiki. Xác nhận Cloudflare account/project context theo môi trường vận hành trước khi deploy.

Rollback nên dùng cơ chế deployment/version của Cloudflare Pages hoặc khôi phục commit content/config đã biết tốt, sau đó chạy lại `npm run build`. Repository không chứa runbook Cloudflare chi tiết hay script rollback riêng, nên không tự suy ra command rollback ngoài những gì `package.json` cung cấp.
