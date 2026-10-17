# Fumadocs components trong Markdown/MDX

Chỉ dùng component nếu repository đã đăng ký nó trong MDX renderer, thường tại `src/app/[[...slug]]/page.tsx`. Kiểm tra source trước khi viết; component và props có thể khác theo version.

## Mục lục

- [Nguyên tắc chọn component](#nguyên-tắc-chọn-component)
- [Callout](#callout)
- [Cards](#cards)
- [Steps](#steps)
- [Tabs](#tabs)
- [Accordion](#accordion)
- [TypeTable](#typetable)
- [D2 và docs-kit](#d2-và-docs-kit)

## Nguyên tắc chọn component

| Nhu cầu | Component |
|---|---|
| Highlight warning/invariant | `Callout` |
| Điều hướng tới trang liên quan | `Cards` + `Card` |
| Quy trình tuần tự | `Steps` + `Step` |
| Biến thể tương đương theo platform/tool | `Tabs` + `Tab` |
| Nội dung phụ hoặc FAQ | `Accordions` + `Accordion` |
| Mô tả config/type | `TypeTable` |
| Flow, sequence, state, architecture | `d2` code block |
| Đọc manifest theo vùng/dòng | `code-walkthrough` |
| Quy trình command với context và expected result | `terminal-session` |
| So sánh hai phiên bản config | `code-diff` |
| Minh họa HTTP request/response | `protocol-exchange` |

Không dùng component để trang trông “phong phú”. Dùng khi nó giúp người đọc hiểu cấu trúc hoặc thao tác nhanh hơn.

## Callout

```mdx
<Callout type="warn" title="Kiểm tra context">
  Command tiếp theo thay đổi resource trong cluster hiện tại.
</Callout>
```

Type khả dụng phụ thuộc version/component registration. Repository hiện tại thường dùng `info`, `warn`, `error`, `success`; kiểm tra type signature nếu build lỗi.

Dùng Callout cho thông tin cần được chú ý ngay. Giữ phần giải thích chính trong prose thay vì đặt nhiều paragraph dài vào Callout.

## Cards

```mdx
<Cards>
  <Card href="/networking/service/" title="Service">
    Hiểu cách Service chọn backend và route traffic.
  </Card>
  <Card href="/networking/ingress/" title="Ingress">
    Tiếp tục với HTTP/HTTPS routing từ bên ngoài cluster.
  </Card>
</Cards>
```

Internal `href` phải có trailing slash. Mỗi Card cần title cụ thể và description cho biết người đọc nhận được gì sau khi mở trang.

## Steps

```mdx
<Steps>
  <Step>
    ### Tạo namespace

    ```bash
    kubectl create namespace policy-demo
    ```

    Xác minh namespace ở trạng thái `Active`.
  </Step>

  <Step>
    ### Áp dụng manifest

    ```bash
    kubectl apply -f network-policy.yaml
    ```
  </Step>
</Steps>
```

Mỗi Step nên có một mục tiêu quan sát được. Nêu prerequisite trước Steps; thêm verification trong hoặc ngay sau step tương ứng.

Nếu Markdown lồng trong component gây lỗi compile ở version hiện tại, dùng numbered headings thông thường thay vì cố giữ component.

## Tabs

```mdx
<Tabs items={['kubectl', 'Helm']}>
  <Tab value="kubectl">
    ```bash
    kubectl apply -f manifests/
    ```
  </Tab>
  <Tab value="Helm">
    ```bash
    helm upgrade --install demo ./chart
    ```
  </Tab>
</Tabs>
```

Chỉ dùng Tabs cho các nhánh tương đương. Nếu mỗi nhánh có prerequisite, behavior hoặc trade-off khác đáng kể, dùng subsection để người đọc có thể so sánh toàn bộ nội dung.

Giữ `items` và `value` khớp chính xác. Dùng `groupId`/`persist` chỉ sau khi xác nhận version hỗ trợ.

## Accordion

```mdx
<Accordions type="single">
  <Accordion title="Vì sao policy chưa có hiệu lực?">
    Kiểm tra CNI plugin có hỗ trợ NetworkPolicy và selector có chọn đúng Pod hay không.
  </Accordion>
</Accordions>
```

Không giấu prerequisite, warning hoặc bước bắt buộc trong Accordion. Dùng cho FAQ hoặc chi tiết tùy chọn mà người đọc có thể bỏ qua.

## TypeTable

```mdx
<TypeTable
  type={{
    timeoutSeconds: {
      description: 'Thời gian chờ trước khi probe thất bại',
      type: 'number',
      default: 1,
    },
    failureThreshold: {
      description: 'Số lần thất bại liên tiếp trước khi đổi trạng thái',
      type: 'number',
      default: 3,
    },
  }}
/>
```

Dùng cho tập field có schema ổn định. Với behavior phức tạp, thêm prose giải thích quan hệ giữa các field; TypeTable không thay thế phần mô tả semantics.

Xác minh default và type theo version. Không copy default từ trí nhớ.

## D2 và docs-kit

Website dùng `@vanhiep99w/docs-kit` để compile D2 thành SVG light/dark lúc build. Không cài D2 CLI hoặc đưa compiler/WASM vào client. Mermaid không còn được đăng ký.

````mdx
```d2 title="Luồng request"
direction: right
client: Client
service: Service
pod: Ready Pod
client -> service: Request
service -> pod: Forward
```
````

- Luôn đặt `title` mô tả diagram; dùng ID ngắn, ổn định, không dùng reserved keyword như `class`.
- Dùng `shape: sequence_diagram` cho tương tác theo thời gian; khai báo actor trước message. Response có thể dùng `{style.stroke-dash: 4}`.
- Dùng container cho boundary, `shape: diamond` cho quyết định, `shape: cylinder` cho storage. Không biến quan hệ ownership thành đường đi traffic.
- Viewer tương tác đã bật mặc định: Explore, zoom/pan, fit, mở rộng, xem/copy D2 và tải SVG. Có thể dùng `interactive=false` cho diagram rất nhỏ.
- Dùng `mode=steps` với `steps` cho diễn tiến kế thừa, `mode=tabs` với `scenarios` cho các trường hợp độc lập, `mode=explorer` với `layers` cho drill-down. Không biểu diễn hai nhánh loại trừ nhau như hai thao tác tuần tự.
- Icon có thể lấy từ [D2 Icons](https://icons.d2lang.com/), ví dụ `icon: https://icons.d2lang.com/essentials/112-server.svg`. Xác minh URL; không suy đoán đường dẫn icon. Icon remote vẫn cần mạng khi đọc.
- Giữ cây thư mục, command output, log, công thức và cú pháp dựa vào vị trí dưới dạng text. Không chuyển một phép ánh xạ field đơn giản thành diagram chỉ để trang trí.
- Tách luồng dài khi cần; nhãn ngắn, dùng `\n` trong chuỗi D2 để ngắt dòng. SVG có thể cuộn ngang trên mobile mà không gây tràn toàn trang.

### Chọn component bổ sung

Các fence sau đã có plugin trong `source.config.ts`, component trong page renderer và CSS global. Descriptor là YAML được validate lúc build, không phải code được thực thi.

| Fence | Dữ liệu chính | Trang mẫu |
|---|---|---|
| `code-walkthrough` | `title`, `language`, `snapshots[{id,title,code}]`, `steps[{id,snapshot,title,description,ranges}]` | `gioi-thieu/yaml-manifest.md` |
| `terminal-session` | `title`, `context{kind,label?,cwd?}`, `steps[{id,command,expected?,warning?,outputs?}]` | `gioi-thieu/first-application.md` |
| `code-diff` | `title`, `language`, `before{code}`, `after{code}`, `wordDiff?` | `gioi-thieu/first-application.md` |
| `protocol-exchange` | `title`, `variants[{id,title,request,response}]` | `kien-truc/kube-apiserver.md` |

Ranges tính từ 1, inclusive, theo snapshot gốc. Copy giữ code/command gốc; không thêm prompt hoặc số dòng. Nêu rõ output/transcript minh họa; không gán exit code hay số đo giả như kết quả kiểm chứng thật. Viết cảnh báo và bối cảnh quan trọng ở prose bên ngoài viewer; không giấu prerequisite trong disclosure.

Chỉ compile nội dung tin cậy trong repository; mọi snapshot, output và scenario đều được publish công khai. Không đưa secrets vào descriptor. Chưa đăng ký Source Explorer hoặc Span Waterfall: chỉ tích hợp khi có source project hoặc trace dữ liệu phù hợp, không thêm để trang trông phong phú.

API đầy đủ: [docs-kit](https://www.npmjs.com/package/@vanhiep99w/docs-kit) và [tài liệu D2](https://github.com/vanhiep99w/docs-kit/blob/main/docs/d2.md). Chạy build để kiểm tra cả cú pháp D2 và descriptor; kiểm tra browser cho tương tác, theme và mobile.
