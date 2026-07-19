---
name: write-docs
description: >
  Hướng dẫn tạo mới, mở rộng và review tài liệu kỹ thuật tiếng Việt có độ chi tiết cao, mạch đọc tự nhiên, cấu trúc dễ theo dõi và ví dụ có thể kiểm chứng. Dùng khi viết hoặc cải thiện Markdown/MDX trong content/docs, tổ chức navigation Fumadocs, sử dụng Callout/Cards/Steps/Tabs/Accordion/TypeTable/Mermaid, hoặc kiểm tra chất lượng và build website tài liệu Next.js + Fumadocs + Cloudflare. Mỗi tài liệu được quyết định phạm vi và độ dài độc lập; không áp giới hạn độ dài và không rút gọn để giống tài liệu khác.
---

# write-docs

## Nguyên tắc ưu tiên

1. Tuân thủ `AGENTS.md`, `CLAUDE.md`, Wiki rules và convention của repository trước hướng dẫn chung trong skill này.
2. Viết đủ chi tiết để người đọc hiểu, áp dụng, kiểm chứng và tự xử lý lỗi mà không phải đoán các bước quan trọng.
3. Không đặt mục tiêu số từ, số heading hoặc độ dài tối đa. Quyết định độ dài riêng cho từng tài liệu theo độ phức tạp của chủ đề.
4. Không ép tài liệu mới có độ dài hoặc cấu trúc giống tài liệu liền kề. Dùng tài liệu liền kề để học convention, không dùng làm quota.
5. Tối đa hóa thông tin hữu ích, không tối đa hóa số chữ. Loại bỏ lặp ý, câu mở đầu sáo rỗng và chi tiết không giúp đạt mục tiêu học tập.
6. Viết tiếng Việt tự nhiên; giữ nguyên technical term, code, command, API field, resource name và identifier bằng English khi cách đó chính xác hơn.
7. Không bịa behavior, version, default value, command output hoặc production recommendation. Kiểm chứng bằng source code, cấu hình repository và official documentation khi cần.

Đọc [`references/writing-quality.md`](references/writing-quality.md) trước khi viết mới hoặc mở rộng đáng kể một tài liệu.

## Nạp context trước khi viết

1. Đọc rule files áp dụng cho đường dẫn sẽ sửa.
2. Đọc root `meta.json`, category `meta.json`, tài liệu trước/sau trang mục tiêu và source code cấu hình Markdown/MDX.
3. Xác định:
   - Đối tượng đọc và kiến thức tiên quyết.
   - Kết quả người đọc phải đạt được.
   - Phạm vi bắt buộc và nội dung chủ động loại trừ.
   - Version, platform và môi trường mà ví dụ áp dụng.
   - Component, syntax và link convention mà repository thực sự hỗ trợ.
4. Nếu yêu cầu còn mơ hồ đến mức ảnh hưởng lớn tới phạm vi, hỏi ngắn gọn trước khi viết. Nếu có thể suy luận chắc chắn từ curriculum và file lân cận, ghi nhận giả định rồi tiếp tục.

## Thiết kế nội dung

### Xác định câu hỏi trung tâm

Viết một câu mô tả điều người đọc phải làm được sau trang này. Dùng câu đó để quyết định section nào cần giữ.

### Lập coverage map

Trước khi soạn prose, liệt kê các phần cần có. Với một chủ đề kỹ thuật phức tạp, cân nhắc:

- Bối cảnh và vấn đề cần giải quyết.
- Mental model và thuật ngữ nền tảng.
- Thành phần, trạng thái và quan hệ giữa chúng.
- Luồng xử lý end-to-end.
- Cách cấu hình hoặc triển khai từng bước.
- Cách xác minh kết quả và đọc output.
- Failure modes, giới hạn và troubleshooting.
- Security, performance, reliability và operational trade-offs.
- Best practices kèm lý do và điều kiện áp dụng.
- Ví dụ thực tế, bài thực hành hoặc scenario.
- Liên kết sang kiến thức tiên quyết và bước học tiếp theo.

Không biến danh sách này thành template cứng. Chỉ giữ phần phục vụ chủ đề. Xem [`references/content-patterns.md`](references/content-patterns.md) để chọn cấu trúc theo loại tài liệu.

### Sắp xếp mạch đọc

Ưu tiên flow sau khi phù hợp:

1. Nêu vấn đề và giá trị thực tế.
2. Xây mental model trước khi đưa nhiều chi tiết.
3. Giải thích cơ chế trước command hoặc manifest.
4. Chuyển từ ví dụ tối thiểu sang cấu hình thực tế.
5. Sau mỗi thao tác quan trọng, chỉ cách kiểm tra kết quả.
6. Đặt lỗi thường gặp gần phần có thể gây lỗi; giữ section troubleshooting tổng hợp cho chẩn đoán end-to-end.
7. Kết thúc bằng decision guidance, best practices và hướng học tiếp theo nếu chúng có ích.

Dùng câu chuyển ý để giải thích vì sao section tiếp theo xuất hiện. Không ghép các section độc lập chỉ vì một template yêu cầu.

## Viết tiếng Việt tự nhiên

- Dùng câu chủ động, chủ ngữ rõ và động từ cụ thể.
- Mỗi đoạn tập trung vào một ý; mở đầu bằng kết luận hoặc bối cảnh chính rồi mới giải thích.
- Giải thích technical term ở lần đầu xuất hiện nếu người đọc mục tiêu có thể chưa biết.
- Ưu tiên cách diễn đạt tự nhiên như “Pod không nhận traffic cho đến khi readiness probe thành công” thay vì dịch word-by-word từ English.
- Dùng “bạn” có chừng mực trong tutorial; dùng câu mô tả trực tiếp trong concept/reference.
- Tránh các câu sáo rỗng như “Trong thế giới công nghệ hiện đại”, “đóng vai trò vô cùng quan trọng”, “không chỉ... mà còn...” khi chúng không thêm thông tin.
- Không lạm dụng fragment, dấu gạch ngang, ngoặc đơn hoặc chuỗi bullet ngắn khiến nội dung giống ghi chú rời rạc.
- Giữ đoạn văn ngắn vừa đủ để đọc trên web, nhưng không cắt một lập luận thành nhiều dòng vụn.

Xem tiêu chí và ví dụ chi tiết trong [`references/writing-quality.md`](references/writing-quality.md).

## Dùng ví dụ, bảng và diagram

- Tạo ví dụ nhỏ nhất vẫn thể hiện đúng cơ chế; sau đó bổ sung biến thể production nếu cần.
- Giải thích mục đích trước code, chú thích field không hiển nhiên, rồi cung cấp lệnh xác minh và expected result.
- Dùng placeholder nhất quán và nói rõ giá trị nào phải thay.
- Dùng table khi người đọc cần so sánh cùng một tập tiêu chí; không dùng table cho prose dài hoặc quy trình tuần tự.
- Dùng Mermaid cho flow, sequence, state và quan hệ; dùng code block cho config/command; dùng Steps cho quy trình có thứ tự.
- Mỗi diagram phải có đoạn dẫn nhập và phần diễn giải điểm cần quan sát. Không dùng diagram chỉ để trang trí.
- Nêu trade-off và điều kiện áp dụng; tránh biến recommendation có điều kiện thành quy tắc tuyệt đối.

Đọc [`references/fumadocs-components.md`](references/fumadocs-components.md) khi cần MDX component hoặc Mermaid.

## Workflow tạo tài liệu mới

1. Nạp context và xác định vị trí trong curriculum.
2. Xác định câu hỏi trung tâm, đối tượng đọc và prerequisites.
3. Tạo coverage map đủ sâu; không chốt độ dài trước.
4. Chọn cấu trúc phù hợp từ [`references/content-patterns.md`](references/content-patterns.md).
5. Tạo file với frontmatter bắt buộc:

```yaml
---
title: "Tên chủ đề"
description: "Mô tả cụ thể nội dung và giá trị của trang"
---
```

6. Viết outline theo logic học tập. Chỉ đánh số heading khi việc đánh số giúp theo dõi một chuỗi dài.
7. Viết từng section theo vòng lặp: giải thích → ví dụ → xác minh → giới hạn/lỗi liên quan.
8. Đọc lại toàn trang để bổ sung cầu nối giữa các section và loại bỏ lặp ý.
9. Cập nhật category `meta.json` ngay khi thêm file; cập nhật root `meta.json` nếu thêm category. Đặt trang theo thứ tự học tập, không append tùy tiện.
10. Kiểm tra internal link có trailing slash và code block có language.
11. Chạy checklist trong [`references/review-checklist.md`](references/review-checklist.md).
12. Chạy command validation/build mà repository yêu cầu.

Dùng [`references/doc-template.md`](references/doc-template.md) như skeleton linh hoạt, không copy mọi section một cách máy móc.

## Workflow cải thiện tài liệu hiện có

1. Giữ lại thông tin đúng và hữu ích; không rewrite chỉ để đổi văn phong.
2. Kiểm tra lỗ hổng theo coverage map: thiếu mental model, request flow, verification, failure mode, security hoặc trade-off nào không.
3. Kiểm tra flow: người đọc có gặp command trước khi hiểu object không; section có chuyển chủ đề đột ngột không; prerequisites có bị ẩn không.
4. Mở rộng đến khi chủ đề hoàn chỉnh, bất kể trang sau khi sửa dài hơn các trang khác bao nhiêu.
5. Thay câu dịch cứng, câu mơ hồ và đoạn liệt kê rời rạc bằng tiếng Việt tự nhiên.
6. Kiểm chứng lại command, manifest, field, version-sensitive statement và link.
7. Không làm mất anchor hoặc đổi slug nếu không cần. Nếu đổi file/slug, cập nhật toàn bộ internal link và `meta.json` liên quan.
8. Chạy review checklist và build.

## Quy tắc Markdown/Fumadocs

- Mỗi file phải có `title` và `description` trong frontmatter.
- Chỉ có một H1 nếu convention của repository dùng H1 trong body; không bỏ cấp heading H2 → H3 → H4.
- Dùng manual “Mục lục” cho trang dài nếu repository đang dùng pattern này; bảo đảm anchor khớp heading.
- Ghi language cho mọi fenced code block.
- Giữ dòng trống quanh table, code block và JSX block.
- Viết internal URL theo dạng site route có trailing slash, ví dụ `/networking/ingress/`.
- Chỉ dùng component đã được đăng ký trong page renderer.

Đọc [`references/md-syntax.md`](references/md-syntax.md) khi sửa Markdown/MDX.

## Điều kiện hoàn thành

Chỉ hoàn tất khi:

- Nội dung trả lời đầy đủ câu hỏi trung tâm và không còn bước quan trọng phải đoán.
- Độ dài phát sinh từ phạm vi chủ đề, không từ quota hoặc việc bắt chước trang khác.
- Mạch đọc liên tục, từ ngữ tự nhiên và không có đoạn filler.
- Ví dụ có context, giải thích, cách chạy/áp dụng và cách xác minh khi phù hợp.
- Claim kỹ thuật quan trọng đã được kiểm chứng.
- Frontmatter, heading, link, navigation metadata và MDX syntax hợp lệ.
- `npm run build` hoặc command build tương ứng đã thành công.

## Tài liệu tham chiếu

- Chất lượng, độ sâu, flow và ngôn ngữ: [`references/writing-quality.md`](references/writing-quality.md)
- Cấu trúc theo loại nội dung: [`references/content-patterns.md`](references/content-patterns.md)
- Skeleton linh hoạt: [`references/doc-template.md`](references/doc-template.md)
- Review trước khi hoàn tất: [`references/review-checklist.md`](references/review-checklist.md)
- Markdown/MDX conventions: [`references/md-syntax.md`](references/md-syntax.md)
- Fumadocs components: [`references/fumadocs-components.md`](references/fumadocs-components.md)
- Setup/deploy website tài liệu: [`references/setup-deploy.md`](references/setup-deploy.md)
