# Checklist review tài liệu

Không dùng checklist để ép mọi trang có cùng cấu trúc. Đánh dấu “không áp dụng” khi một mục nằm ngoài mục tiêu trang.

## Phạm vi và độ sâu

- [ ] Câu hỏi trung tâm và đối tượng đọc rõ ràng.
- [ ] Prerequisite cần thiết đã được nêu hoặc link.
- [ ] Nội dung đủ để hiểu, áp dụng và xác minh mà không phải đoán bước quan trọng.
- [ ] Mental model, mechanism và flow được giải thích ở mức phù hợp.
- [ ] Failure mode, giới hạn và trade-off quan trọng không bị lược bỏ.
- [ ] Không rút gọn chỉ để giống độ dài tài liệu khác.
- [ ] Không có quota số từ/section chi phối cấu trúc.
- [ ] Không có lặp ý, filler hoặc chi tiết ngoài phạm vi.

## Mạch đọc và ngôn ngữ

- [ ] Section xuất hiện theo thứ tự nhận thức hợp lý.
- [ ] Có cầu nối khi chuyển từ concept sang thao tác hoặc từ layer này sang layer khác.
- [ ] Mỗi paragraph tập trung vào một ý.
- [ ] Câu chủ động, rõ chủ thể và hệ quả.
- [ ] Technical term được giữ/giải thích nhất quán.
- [ ] Không có bản dịch word-by-word khó đọc.
- [ ] Không có câu sáo rỗng, marketing language hoặc kết luận mơ hồ.
- [ ] Bullet, table và heading được dùng đúng chức năng.

## Ví dụ và tính chính xác

- [ ] Mỗi ví dụ quan trọng có mục tiêu và context.
- [ ] Command/code/manifest hợp lệ với version và môi trường đã nêu.
- [ ] Placeholder được chỉ rõ.
- [ ] Field hoặc dòng không hiển nhiên được giải thích.
- [ ] Có verification và expected state/output khi phù hợp.
- [ ] Output rút gọn hoặc minh họa được ghi rõ.
- [ ] Claim quan trọng đã kiểm chứng bằng source/config/official docs.
- [ ] Behavior chung và behavior implementation-specific được phân biệt.
- [ ] Recommendation có lý do, điều kiện và trade-off.

## Markdown/MDX và navigation

- [ ] Frontmatter có `title` và `description`.
- [ ] Chỉ dùng heading hierarchy hợp lệ.
- [ ] Manual TOC, nếu có, khớp heading và anchor.
- [ ] Code fence có language.
- [ ] Table, code block và JSX có dòng trống xung quanh.
- [ ] Internal link dùng site route và trailing slash.
- [ ] Chỉ dùng MDX component đã đăng ký.
- [ ] File mới/đổi tên đã cập nhật category `meta.json`.
- [ ] Category mới đã cập nhật root `meta.json`.
- [ ] Thứ tự `pages` theo curriculum, không append tùy tiện.

## Validation

- [ ] Link và anchor quan trọng đã kiểm tra.
- [ ] Mermaid/MDX syntax hợp lệ.
- [ ] Không còn placeholder, TODO hoặc câu chưa hoàn tất ngoài chủ đích.
- [ ] Diff không chứa thay đổi ngoài phạm vi.
- [ ] `npm run build` hoặc build command của repository thành công.
