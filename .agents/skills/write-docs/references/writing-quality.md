# Chất lượng nội dung, độ sâu và mạch đọc

## Mục lục

- [Định nghĩa “chi tiết nhất có thể”](#định-nghĩa-chi-tiết-nhất-có-thể)
- [Quyết định phạm vi và độ dài](#quyết-định-phạm-vi-và-độ-dài)
- [Xây dựng mạch đọc](#xây-dựng-mạch-đọc)
- [Viết tiếng Việt tự nhiên](#viết-tiếng-việt-tự-nhiên)
- [Giải thích ví dụ kỹ thuật](#giải-thích-ví-dụ-kỹ-thuật)
- [Tránh chi tiết giả](#tránh-chi-tiết-giả)
- [Tự review theo góc nhìn người đọc](#tự-review-theo-góc-nhìn-người-đọc)

## Định nghĩa “chi tiết nhất có thể”

Viết đến khi người đọc mục tiêu có thể:

1. Hiểu vấn đề và lý do công nghệ/cơ chế tồn tại.
2. Hình dung đúng thành phần, quan hệ, state và request/data flow.
3. Thực hiện ví dụ mà không phải tự suy đoán prerequisite hoặc bước trung gian quan trọng.
4. Xác minh kết quả đúng và nhận biết kết quả sai.
5. Chẩn đoán các lỗi phổ biến theo một trình tự có lý do.
6. Hiểu giới hạn, trade-off và biết khi nào không nên áp dụng giải pháp.
7. Biết bước học hoặc tài liệu tiếp theo.

“Chi tiết” không có nghĩa là:

- Lặp cùng một kết luận bằng nhiều cách.
- Liệt kê mọi option không liên quan đến mục tiêu trang.
- Thêm lịch sử, marketing language hoặc trivia không giúp hiểu hay vận hành hệ thống.
- Chèn nhiều code nhưng không giải thích cơ chế và output.
- Kéo dài phần mở đầu thay vì đi vào vấn đề.

## Quyết định phạm vi và độ dài

### Không dùng quota

Không đặt các giới hạn như “3–5 section”, “1.500 từ”, “ngắn bằng trang trước” hoặc “mỗi section hai đoạn”. Một concept nhỏ có thể hoàn chỉnh trong vài section; một chủ đề vận hành có thể cần hàng chục section.

Đánh giá từng trang độc lập theo:

- Số lượng concept cần nối với nhau.
- Số bước trong lifecycle hoặc request flow.
- Mức độ rủi ro nếu người đọc hiểu thiếu.
- Số nhánh cấu hình và failure mode thực sự phổ biến.
- Kiến thức đã được giải thích ở trang prerequisite.
- Mục tiêu của trang: overview, tutorial, reference, troubleshooting hay production guide.

Không cắt nội dung cần thiết để đạt độ dài mong muốn. Nếu trang quá lớn nhưng mọi phần đều cần thiết, giữ nguyên hoặc tách theo ranh giới nhiệm vụ rõ ràng; không tách chỉ để các file có số dòng tương đương.

### Dùng completeness matrix

Với mỗi phần lớn, tự hỏi:

| Khía cạnh | Câu hỏi kiểm tra |
|---|---|
| What | Object/cơ chế này là gì? |
| Why | Nó giải quyết vấn đề nào? |
| How | Thành phần tương tác và thay đổi state ra sao? |
| Apply | Người đọc cấu hình hoặc sử dụng thế nào? |
| Verify | Dùng command, metric, event hoặc output nào để kiểm tra? |
| Fail | Nó thường lỗi ở đâu và triệu chứng là gì? |
| Limit | Giới hạn, trade-off và trường hợp không phù hợp là gì? |
| Operate | Security, performance, reliability và maintenance ảnh hưởng ra sao? |

Không bắt buộc trả lời đủ tám câu cho mọi subsection. Dùng matrix để phát hiện lỗ hổng, sau đó giữ câu hỏi phù hợp với mục tiêu trang.

## Xây dựng mạch đọc

### Đi từ mental model đến thao tác

Một flow dễ theo dõi thường có dạng:

```text
Vấn đề → Mental model → Thành phần → Luồng xử lý
→ Cấu hình tối thiểu → Xác minh → Biến thể thực tế
→ Failure modes → Trade-offs → Best practices
```

Có thể thay đổi thứ tự khi loại tài liệu yêu cầu, nhưng không đưa chi tiết implementation trước khi người đọc có đủ mental model để hiểu nó.

### Tạo cầu nối giữa các section

Kết thúc section bằng hệ quả dẫn sang nội dung tiếp theo, hoặc mở section mới bằng lý do nó xuất hiện.

**Rời rạc:**

> Service chọn Pod qua selector.
>
> ## EndpointSlice
>
> EndpointSlice lưu địa chỉ endpoint.

**Có flow:**

> Selector chỉ mô tả Pod nào phù hợp; kube-proxy và data plane cần danh sách địa chỉ cụ thể để route traffic. Kubernetes biểu diễn danh sách này bằng EndpointSlice.
>
> ## EndpointSlice
>
> Mỗi EndpointSlice chứa một phần các backend address của Service, giúp control plane cập nhật endpoint theo nhóm thay vì ghi lại một object rất lớn.

### Quản lý độ sâu heading

- Dùng H2 cho một câu hỏi hoặc giai đoạn lớn.
- Dùng H3 khi cần phân rã H2 thành các cơ chế có quan hệ.
- Dùng H4 khi H3 thật sự có nhiều nhánh; không dùng H4 chỉ để làm nổi một đoạn.
- Không tạo section chỉ có một câu nếu câu đó có thể nằm tự nhiên trong section cha.
- Không để một heading bao phủ nhiều chủ đề không liên quan.

### Phân bổ thông tin gần nơi sử dụng

- Đặt prerequisite trước bước cần nó.
- Đặt cảnh báo phá hủy dữ liệu ngay trước command nguy hiểm.
- Đặt cách xác minh ngay sau thao tác.
- Đặt lỗi cục bộ gần cấu hình gây lỗi.
- Dùng troubleshooting tổng hợp cho chẩn đoán xuyên nhiều layer.

## Viết tiếng Việt tự nhiên

### Dùng cấu trúc câu trực tiếp

Ưu tiên chủ ngữ + hành động + hệ quả.

**Cứng và mơ hồ:**

> Việc thực hiện cấu hình readiness probe sẽ giúp cho việc traffic được đảm bảo chỉ gửi đến các Pod sẵn sàng.

**Tự nhiên:**

> Readiness probe ngăn Service gửi traffic đến Pod chưa sẵn sàng.

### Giữ technical term có chủ đích

- Giữ tên API, resource, field, command, metric và chuẩn kỹ thuật bằng English.
- Giải thích term ở lần đầu: “backpressure, tức cơ chế làm chậm producer khi consumer không theo kịp”.
- Sau khi đã định nghĩa, dùng một thuật ngữ nhất quán. Không đổi qua lại giữa nhiều bản dịch.
- Không dịch identifier trong code hoặc output.

### Viết đoạn văn có nhịp

- Dùng câu đầu để nêu ý chính.
- Dùng các câu sau giải thích cơ chế, bằng chứng hoặc hệ quả.
- Tách đoạn khi chuyển câu hỏi, không tách sau mỗi câu.
- Xen kẽ prose, table, code và diagram theo nhu cầu nhận thức; không đặt nhiều block liên tục mà thiếu lời giải thích.

### Tránh ngôn ngữ máy móc

Loại bỏ hoặc viết lại:

- Mở đầu phổ quát không có thông tin.
- Tính từ cường điệu như “vô cùng mạnh mẽ”, “cực kỳ quan trọng” mà không có tiêu chí.
- Câu kết kiểu “Tóm lại, X là một công nghệ quan trọng” nếu không nêu decision guidance.
- Chuỗi câu cùng cấu trúc “X giúp... X cung cấp... X cho phép...”.
- Bản dịch sát English làm sai trật tự tự nhiên của tiếng Việt.

### Dùng bullet đúng mục đích

Dùng bullet cho tập hợp song song, checklist hoặc lựa chọn. Dùng paragraph cho quan hệ nguyên nhân–kết quả và lập luận cần nối tiếp. Nếu mỗi bullet dài nhiều đoạn hoặc cần thứ tự, chuyển thành subsection hay numbered steps.

## Giải thích ví dụ kỹ thuật

Mỗi ví dụ quan trọng nên có bốn lớp:

1. **Mục tiêu:** Nói rõ ví dụ chứng minh điều gì.
2. **Nội dung:** Cung cấp command, code hoặc manifest hợp lệ và tối giản.
3. **Giải thích:** Chỉ ra field/dòng quyết định behavior; không diễn giải lại phần hiển nhiên.
4. **Xác minh:** Cung cấp command kiểm tra, expected state/output và dấu hiệu lỗi.

Ví dụ production cần thêm:

- Điều kiện môi trường.
- Security boundary và secret handling.
- Resource sizing hoặc performance assumption nếu liên quan.
- Rollback/cleanup khi thao tác có side effect.
- Các giá trị placeholder cần thay.

Không đưa output giả như output thật. Nếu output rút gọn, ghi rõ “output minh họa” hoặc dùng `...` ở vị trí lược bỏ.

## Tránh chi tiết giả

Chi tiết chỉ có giá trị khi đúng. Với nội dung version-sensitive:

1. Kiểm tra version trong repository hoặc yêu cầu người dùng.
2. Ưu tiên official documentation và source code.
3. Nêu version/scope ngay cạnh claim khi behavior thay đổi theo version.
4. Phân biệt rõ specification, implementation-specific behavior và recommendation của tác giả.
5. Không biến kinh nghiệm của một implementation thành behavior chung.

Nếu chưa thể kiểm chứng, thu hẹp câu khẳng định hoặc nói rõ giả định thay vì đoán.

## Tự review theo góc nhìn người đọc

Đọc lại theo ba lượt:

### Lượt 1: Người mới trong phạm vi trang

- Term nào xuất hiện trước khi được giải thích?
- Bước nào yêu cầu kiến thức hoặc file chưa được nêu?
- Tại sao phải thực hiện bước này có rõ không?

### Lượt 2: Người đang thực hành

- Có thể copy ví dụ an toàn không?
- Placeholder và namespace/path/context có rõ không?
- Sau mỗi bước có biết cách xác minh không?

### Lượt 3: Người vận hành production

- Failure mode, blast radius và rollback có được nhắc đúng mức không?
- Recommendation có điều kiện và trade-off không?
- Có claim nào quá tuyệt đối hoặc thiếu nguồn kiểm chứng không?
