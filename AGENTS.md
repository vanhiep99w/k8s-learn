# Hướng dẫn đóng góp tài liệu

- Viết nội dung bằng tiếng Việt; giữ nguyên tên kỹ thuật tiếng Anh.
- Tài liệu nằm trong `content/docs/<category>/`.
- Mỗi file phải có frontmatter gồm `title` và `description`.
- Khi thêm hoặc đổi tên file, phải cập nhật `meta.json` tương ứng.
- Internal link phải dùng URL có trailing slash.
- Chạy `npm run build` trước khi hoàn tất thay đổi.

## Harness Wiki

This repository has documentation under `wiki/`.

Before modifying repository files:

1. Read `wiki/quickstart.md`.
2. Follow its “Rule loading” instructions.
3. Read `wiki/_rules.md`.
4. Read every section `_rules.md` applicable to the target files.
5. Re-read applicable rules when the task scope changes.

Do not modify `wiki/**/_rules.md` outside the approved Harness proposal and apply workflow.
