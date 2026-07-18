# Hướng dẫn đóng góp tài liệu

- Viết nội dung bằng tiếng Việt; giữ nguyên tên kỹ thuật tiếng Anh.
- Tài liệu nằm trong `content/docs/<category>/`.
- Mỗi file phải có frontmatter gồm `title` và `description`.
- Khi thêm hoặc đổi tên file, phải cập nhật `meta.json` tương ứng.
- Internal link phải dùng URL có trailing slash.
- Chạy `npm run build` trước khi hoàn tất thay đổi.

## Harness Wiki

This repository has documentation under `wiki/`.

For project orientation and repository knowledge, start with `wiki/quickstart.md`.

Before modifying repository files, follow the `wiki/quickstart.md` “Rule loading” section, including `wiki/_rules.md` and any applicable section `_rules.md` files.

Do not modify `wiki/**/_rules.md` outside the approved Harness proposal and apply workflow.
