# Kubernetes Learning

Tài liệu học Kubernetes bằng tiếng Việt, được tổ chức theo lộ trình từ nền tảng đến vận hành production.

## Công nghệ

- Next.js 16
- Fumadocs
- Cloudflare Pages
- `@vanhiep99w/docs-kit` (D2, Code Walkthrough, Terminal Session, Code Diff, Protocol Exchange)

## Chạy local

Yêu cầu Node.js 22 trở lên (renderer của docs-kit chạy lúc build).

```bash
npm ci
npm run dev
```

Mở [http://localhost:3000](http://localhost:3000). Trang chủ tự chuyển đến phần **Bắt đầu**.

## Build và deploy

```bash
npm run build
npm run preview
npm run deploy
```

## Cấu trúc nội dung

Tất cả tài liệu nằm trong `content/docs/`. Mỗi chủ đề có `meta.json` để khai báo đầy đủ thứ tự trang trên sidebar.

Các phần đã hoàn thiện và các trang placeholder cùng dùng cấu trúc sidebar này.

## Diagram và ví dụ tương tác

Viết sơ đồ bằng fence `d2 title="…"`. SVG light/dark được render lúc build; người đọc có thể mở Explore để zoom/pan, fit, mở rộng, xem/copy D2 và tải SVG. Có thể thêm `mode=steps`, `mode=tabs` hoặc `mode=explorer` khi cần nhiều board. Không cần cài D2 CLI.

Dùng `code-walkthrough` để đọc manifest theo bước, `terminal-session` cho command có context/expected result, `code-diff` cho thay đổi config và `protocol-exchange` cho HTTP request/response. Ví dụ thực tế nằm trong `gioi-thieu/yaml-manifest.md`, `gioi-thieu/first-application.md` và `kien-truc/kube-apiserver.md`.

Giữ log, output lệnh, công thức và cây thư mục ở dạng text. Chỉ compile D2/descriptor do tác giả tin cậy quản lý; không đưa secrets vào ví dụ. Icon từ [D2 Icons](https://icons.d2lang.com/) đang dùng URL remote và cần mạng khi đọc; label vẫn mô tả nội dung khi icon không tải được.

Cấu hình plugin nằm trong `source.config.ts`; component được đăng ký ở `src/app/[[...slug]]/page.tsx`; CSS được import một lần trong `src/app/globals.css`. Cache D2 ở `.next/cache/docs-kit/d2` (đã được gitignore). Build lỗi sẽ chỉ ra file/vị trí diagram hoặc descriptor sai.

Skill biên soạn chung nằm ở `../.agents/skills/fumadocs-technical-writer/SKILL.md` trong thư mục tập hợp `my-docs`; không còn bản skill cục bộ. Với schema docs-kit, đối chiếu `../docs-kit/README.md`, phiên bản dependency và cấu hình thực tế của repo. Kiểm tra bằng `npm run build` và xem thử trang trên browser sau khi thay đổi diagram/component.
