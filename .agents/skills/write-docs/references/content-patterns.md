# Cấu trúc theo loại tài liệu

## Mục lục

- [Cách chọn pattern](#cách-chọn-pattern)
- [Concept hoặc fundamentals](#concept-hoặc-fundamentals)
- [Tutorial hoặc lab](#tutorial-hoặc-lab)
- [Task guide](#task-guide)
- [API hoặc configuration reference](#api-hoặc-configuration-reference)
- [Architecture hoặc mechanism deep-dive](#architecture-hoặc-mechanism-deep-dive)
- [Troubleshooting guide](#troubleshooting-guide)
- [Production guide](#production-guide)
- [Case study hoặc end-to-end design](#case-study-hoặc-end-to-end-design)
- [Kết hợp nhiều pattern](#kết-hợp-nhiều-pattern)

## Cách chọn pattern

Chọn theo việc người đọc cần làm, không theo tên công nghệ:

| Mục tiêu chính | Pattern |
|---|---|
| Hiểu một khái niệm | Concept/fundamentals |
| Học bằng cách xây từ đầu | Tutorial/lab |
| Hoàn thành một thao tác cụ thể | Task guide |
| Tra cứu field, option hoặc behavior | Reference |
| Hiểu component và flow bên trong | Architecture/mechanism deep-dive |
| Chẩn đoán một nhóm triệu chứng | Troubleshooting |
| Thiết kế và vận hành an toàn | Production guide |
| Đánh giá quyết định trong một hệ thống hoàn chỉnh | Case study |

Các section bên dưới là coverage gợi ý, không phải template bắt buộc. Thêm, bỏ hoặc đổi thứ tự theo chủ đề. Không giới hạn số section hay độ dài.

## Concept hoặc fundamentals

Mục tiêu: xây mental model chính xác trước khi người đọc thao tác.

Cân nhắc:

1. Vấn đề mà concept giải quyết.
2. Định nghĩa ngắn và ranh giới với concept gần giống.
3. Thành phần và quan hệ.
4. Lifecycle hoặc flow đơn giản.
5. Ví dụ cụ thể.
6. Những hiểu lầm phổ biến.
7. Giới hạn và bước học tiếp theo.

Không biến overview thành reference đầy đủ nếu trang sau đã đảm nhiệm phần đó. Tuy nhiên, đừng lược bỏ cơ chế cốt lõi chỉ để giữ overview ngắn.

## Tutorial hoặc lab

Mục tiêu: dẫn người đọc từ trạng thái ban đầu đến kết quả quan sát được.

Cân nhắc:

1. Kết quả cuối cùng và sơ đồ trạng thái đích.
2. Prerequisites, version, quyền và tài nguyên cần có.
3. File tree hoặc starting state.
4. Các bước tuần tự; mỗi bước gồm mục đích, thao tác và verification.
5. Expected output tại milestone.
6. Thử nghiệm làm thay đổi behavior để củng cố mental model.
7. Troubleshooting cho lỗi có xác suất cao.
8. Cleanup và chi phí/tác động còn lại.
9. Tổng kết điều vừa chứng minh.

Không đưa một block code rất lớn rồi yêu cầu người đọc tự suy ra từng bước.

## Task guide

Mục tiêu: giúp người đã có kiến thức nền hoàn thành một tác vụ nhanh và an toàn.

Cân nhắc:

1. Khi nào dùng guide.
2. Prerequisites ngắn gọn.
3. Procedure trực tiếp.
4. Verification.
5. Rollback hoặc cleanup.
6. Lỗi phổ biến và nhánh theo môi trường.

Giữ phần giải thích tập trung vào quyết định ảnh hưởng tới task; link sang concept page cho nền tảng dài.

## API hoặc configuration reference

Mục tiêu: cho phép tra cứu chính xác.

Cân nhắc:

1. Scope, version và stability.
2. Object/endpoint/config hierarchy.
3. Field table: type, required/default, valid values, semantics.
4. Invariant và quan hệ giữa field.
5. Ví dụ tối thiểu và ví dụ đầy đủ.
6. Validation behavior và error cases.
7. Compatibility/deprecation.
8. Security và performance implication.

Không chỉ chép schema. Giải thích field tương tác ra sao và default dẫn tới behavior nào.

## Architecture hoặc mechanism deep-dive

Mục tiêu: giải thích hệ thống hoạt động end-to-end.

Cân nhắc:

1. Problem statement và scope.
2. Architecture diagram.
3. Trách nhiệm từng component.
4. Request/data/control flow theo thứ tự.
5. State, consistency và failure handling.
6. Scaling, performance và bottleneck.
7. Security/trust boundaries.
8. Observability.
9. Implementation variations.
10. Trade-off và decision guidance.
11. Ví dụ hoặc trace cụ thể.

Phân biệt behavior do specification đảm bảo với behavior phụ thuộc implementation.

## Troubleshooting guide

Mục tiêu: đi từ triệu chứng đến nguyên nhân bằng bằng chứng.

Cân nhắc:

1. Phạm vi triệu chứng và impact.
2. Triage an toàn: dữ liệu cần thu thập trước khi thay đổi hệ thống.
3. Decision tree theo layer hoặc request path.
4. Với mỗi nhánh:
   - Giả thuyết.
   - Command/query kiểm tra.
   - Expected signal.
   - Cách diễn giải.
   - Fix.
   - Verification sau fix.
5. Escalation criteria.
6. Rollback và post-incident follow-up.

Không viết troubleshooting dưới dạng danh sách “thử command này” thiếu logic chẩn đoán. Không khuyên restart hoặc delete trước khi thu thập evidence nếu thao tác làm mất trạng thái cần điều tra.

## Production guide

Mục tiêu: chuyển từ cấu hình chạy được sang thiết kế vận hành được.

Cân nhắc:

1. Assumption và target SLO/scale.
2. High availability và failure domains.
3. Capacity, quota và scaling.
4. Security, access control và secret handling.
5. Data protection, backup và restore test.
6. Observability: metric, log, trace, alert.
7. Upgrade, rollback và compatibility.
8. Cost drivers.
9. Runbook cho failure mode quan trọng.
10. Checklist rollout và verification.

Mọi recommendation lớn cần lý do, điều kiện áp dụng và trade-off.

## Case study hoặc end-to-end design

Mục tiêu: cho thấy cách nhiều quyết định liên kết trong một scenario cụ thể.

Cân nhắc:

1. Context, constraints và số liệu workload.
2. Functional và non-functional requirements.
3. Kiến trúc tổng thể và request/data flow.
4. Phân rã trách nhiệm.
5. Alternatives cho quyết định lớn.
6. Decision matrix hoặc ADR khi trade-off phức tạp.
7. Failure scenarios, security threats và operational model.
8. Migration/rollout theo phase.
9. Validation qua load test, failure test hoặc acceptance criteria.
10. Những điều thiết kế cố ý không giải quyết.

Dùng số liệu có nguồn hoặc ghi rõ assumption. Không tạo con số “thực tế” nhưng không giải thích nguồn hay mục đích.

## Kết hợp nhiều pattern

Một trang có thể kết hợp concept + tutorial hoặc architecture + troubleshooting khi chúng phục vụ cùng một câu hỏi trung tâm. Tách thành nhiều trang khi:

- Hai nhóm người đọc có mục tiêu khác nhau rõ rệt.
- Reference làm gián đoạn tutorial.
- Một phần có lifecycle và navigation độc lập.
- Người đọc thường cần tra cứu một phần mà không đọc phần còn lại.

Không tách chỉ vì trang dài. Không gộp chỉ để giảm số file.
