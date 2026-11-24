---
title: "Sử dụng HashiCorp Vault trong Kubernetes"
description: "Hiểu trọn vẹn cách Kubernetes làm việc với HashiCorp Vault: từ bài toán Secret Zero, Kubernetes Auth (TokenReview), Vault Agent Injector, Dynamic Postgres Secrets và bài toán reload ứng dụng, đến so sánh Sidecar, VSO, CSI, ESO và troubleshooting production."
---

Hình dung bạn đang vận hành một `payment-service` trên Kubernetes. Mỗi khi khách hàng thanh toán, Pod phải ghi giao dịch xuống PostgreSQL, nghĩa là nó cần username và password để mở kết nối. Bạn có thể nhét cặp credential đó vào một Kubernetes `Secret`, nhưng càng nhiều service và càng nhiều cluster, cách này càng nhanh chóng bộc lộ giới hạn về xoay vòng mật khẩu (rotation), audit log và phân quyền tập trung.

HashiCorp Vault sinh ra để gom toàn bộ bí mật về một trung tâm duy nhất, thậm chí tạo mật khẩu cơ sở dữ liệu tạm thời theo yêu cầu. Nhưng ngay khi định nối Kubernetes với Vault, một câu hỏi hóc búa xuất hiện: **ứng dụng cần mật khẩu để vào Postgres, vậy giờ nó có cần thêm một mật khẩu khác để vào Vault không?**

Bài viết này đi xuyên suốt kịch bản `payment-service` + PostgreSQL để giải đáp câu hỏi đó từ gốc đến ngọn: cách Pod tự chứng minh danh tính không cần mật khẩu tĩnh, cách Vault Agent giao secret mà không bắt bạn sửa code ứng dụng, cách xử lý cạm bẫy khi mật khẩu tạm thời hết hạn, và cách chọn đúng mô hình tích hợp khi scale lên hàng trăm service.

<Callout type="info" title="Phạm vi và kiến thức nền">
  Bài viết giả định bạn đã nắm cơ bản về Pod, Namespace, ServiceAccount và [Kubernetes Secret](/cau-hinh/secret/). Các lệnh CLI, HTTP transcript và manifest trong bài dùng giá trị minh họa an toàn (không chứa credential thật) để bạn dễ đọc và áp dụng lại trong cluster của mình.
</Callout>

## Mục lục

- [1. Tại sao Kubernetes Secret chưa đủ và bài toán Secret Zero](#1-tại-sao-kubernetes-secret-chưa-đủ-và-bài-toán-secret-zero)
  - [1.1 Công bằng với Kubernetes Secret](#11-công-bằng-với-kubernetes-secret)
  - [1.2 Bài toán Secret Zero và câu trả lời từ Workload Identity](#12-bài-toán-secret-zero-và-câu-trả-lời-từ-workload-identity)
- [2. Toàn cảnh luồng xác thực giữa Kubernetes và Vault](#2-toàn-cảnh-luồng-xác-thực-giữa-kubernetes-và-vault)
  - [2.1 Theo dõi đường đi của một Payment Pod](#21-theo-dõi-đường-đi-của-một-payment-pod)
  - [2.2 Hai loại token rất dễ nhầm lẫn](#22-hai-loại-token-rất-dễ-nhầm-lẫn)
  - [2.3 Nhìn sát hơn vào HTTP request giữa Agent và Vault](#23-nhìn-sát-hơn-vào-http-request-giữa-agent-và-vault)
  - [2.4 Chiều ngược lại: Vault lấy quyền gì để hỏi Kubernetes API](#24-chiều-ngược-lại-vault-lấy-quyền-gì-để-hỏi-kubernetes-api)
- [3. Vault Agent Injector hoạt động thế nào bên trong Pod](#3-vault-agent-injector-hoạt-động-thế-nào-bên-trong-pod)
  - [3.1 Cấu trúc một Pod sau khi bị Inject](#31-cấu-trúc-một-pod-sau-khi-bị-inject)
  - [3.2 Đọc từng dòng annotation trong Deployment](#32-đọc-từng-dòng-annotation-trong-deployment)
- [4. Từ Static Secret đến Dynamic Postgres Secrets](#4-từ-static-secret-đến-dynamic-postgres-secrets)
  - [4.1 Vòng đời một Dynamic Credential và cơ chế Lease](#41-vòng-đời-một-dynamic-credential-và-cơ-chế-lease)
  - [4.2 Cạm bẫy kinh điển: secret đã xoay nhưng app không biết](#42-cạm-bẫy-kinh-điển-secret-đã-xoay-nhưng-app-không-biết)
- [5. Chọn mô hình tích hợp nào cho Production](#5-chọn-mô-hình-tích-hợp-nào-cho-production)
  - [5.1 So sánh kiến trúc các mô hình giao secret](#51-so-sánh-kiến-trúc-các-mô-hình-giao-secret)
  - [5.2 Nên chọn mô hình nào và khi nào không nên dùng Vault](#52-nên-chọn-mô-hình-nào-và-khi-nào-không-nên-dùng-vault)
- [6. Triển khai từng bước từ Vault đến Payment Pod](#6-triển-khai-từng-bước-từ-vault-đến-payment-pod)
  - [6.1 So sánh manifest trước và sau khi chuyển sang Vault](#61-so-sánh-manifest-trước-và-sau-khi-chuyển-sang-vault)
- [7. Cạm bẫy Production và Troubleshooting nhanh](#7-cạm-bẫy-production-và-troubleshooting-nhanh)
  - [7.1 Sáu lỗi vận hành hay gặp nhất](#71-sáu-lỗi-vận-hành-hay-gặp-nhất)
  - [7.2 Bảng tra cứu nhanh theo triệu chứng](#72-bảng-tra-cứu-nhanh-theo-triệu-chứng)
  - [7.3 Câu hỏi thường gặp](#73-câu-hỏi-thường-gặp)
- [Tài liệu tham khảo và bài liên quan](#tài-liệu-tham-khảo-và-bài-liên-quan)

---

## 1. Tại sao Kubernetes Secret chưa đủ và bài toán Secret Zero

### 1.1 Công bằng với Kubernetes Secret

Khi nói về Vault, nhiều tài liệu thường mở đầu bằng câu quen thuộc: *"Kubernetes Secret chỉ mã hóa Base64, ai đọc được là giải mã ra ngay"*. Câu này đúng về mặt kỹ thuật, nhưng nếu dừng ở đó thì hơi bất công với Kubernetes.

Thực tế, Kubernetes hoàn toàn cho phép bật **Encryption at Rest** (mã hóa dữ liệu trước khi ghi xuống `etcd` thông qua KMS provider) và dùng **RBAC** (Role-Based Access Control — kiểm soát quyền theo vai trò) để khóa chặt quyền `get/list/watch secrets`. Nếu kẻ tấn công đã có quyền `kubectl exec` vào Pod để đọc file mật khẩu trên RAM, thì kể cả dùng Vault, bí mật đó vẫn lộ như thường.

Điểm yếu thật sự khiến các hệ thống production phải tìm đến HashiCorp Vault nằm ở **vòng đời và quy mô quản lý bí mật**, không chỉ ở Base64:

- **Không có Dynamic Secrets (bí mật động):** Kubernetes Secret là dữ liệu tĩnh. Nếu 20 replica của `payment-service` dùng chung một password Postgres và password đó bị rò rỉ trong log, bạn không biết replica nào làm lộ và phải xoay mật khẩu thủ công rồi khởi động lại hàng loạt.
- **Thiếu audit log chuyên biệt cho secret:** Biết chính xác *Pod nào*, *ở cluster nào*, *đọc bí mật nào*, *vào giây nào* và *được cấp với thời hạn bao lâu* là thứ Kubernetes Audit Log không thiết kế riêng để tổng hợp xuyên cluster.
- **Phân mảnh đa cluster và ngoài Kubernetes:** Một công ty hiếm khi chỉ có một cluster. Khi cả staging, production, VM truyền thống lẫn CI/CD cùng cần lấy API key hoặc DB credential, sao chép Kubernetes Secret đi khắp nơi rất dễ lệch phiên bản.
- **Ma sát với GitOps:** Bạn không thể commit file `Secret` thô lên Git. Nếu chỉ dùng Kubernetes Secret thuần, bạn buộc phải thêm lớp mã hóa trung gian như Sealed Secrets hoặc SOPS cho từng cluster.

Nói ngắn gọn: Kubernetes Secret giải quyết tốt việc **truyền dữ liệu nhạy cảm vào container**, còn Vault giải quyết việc **tạo, cấp phát, theo dõi và thu hồi bí mật tập trung**.

### 1.2 Bài toán Secret Zero và câu trả lời từ Workload Identity

Khi bạn chuyển mật khẩu Postgres vào Vault, một câu hỏi nảy ra ngay: để `payment-service` hỏi Vault lấy mật khẩu Postgres, chẳng phải nó lại cần một mật khẩu (hay API key) để đăng nhập vào Vault sao? Nếu nhét Vault token tĩnh vào Kubernetes Secret, ta chỉ vừa dời vấn đề từ chỗ này sang chỗ khác.

Đây chính là **bài toán Secret Zero** — làm sao cấp bí mật đầu tiên một cách an toàn mà không phải hard-code thêm một bí mật nào khác.

Câu trả lời của Kubernetes và Vault rất gọn: **mượn danh tính mà hạ tầng đã cấp sẵn cho Pod** (gọi là **Workload Identity**).

Hãy hình dung như việc bạn vào tòa nhà văn phòng để mượn chìa khóa phòng server. Bạn không cần thuộc một mã PIN viết trên giấy dán ở bàn lễ tân. Thay vào đó, bạn đưa **thẻ nhân viên có gắn chip** do công ty cấp cho bảo vệ; bảo vệ quẹt thẻ lên hệ thống nhân sự để xác nhận bạn đúng là kỹ sư thuộc đội thanh toán, rồi mới phát cho bạn chiếc chìa khóa phòng server có hiệu lực trong 1 giờ.

Ánh xạ vào Kubernetes + Vault:
- **Thẻ nhân viên:** là **ServiceAccount Token** (một chuỗi JWT — JSON Web Token — có thời hạn ngắn, mặc định khoảng 1 giờ trên Kubernetes 1.21+ thông qua Projected Volume) mà kubelet tự gắn vào mỗi Pod tại `/var/run/secrets/kubernetes.io/serviceaccount/token`.
- **Hệ thống nhân sự:** là **Kubernetes API Server** với endpoint `TokenReview`.
- **Bảo vệ & tủ chìa khóa:** là **HashiCorp Vault**.
- **Chìa khóa tạm thời 1 giờ:** là **Vault Token ngắn hạn** và **Dynamic Postgres Credential**.

Điểm mà phép ẩn dụ này dừng lại: thẻ nhân viên thật do bạn tự mang theo, còn trong Kubernetes, **bản thân ứng dụng `payment-service` thậm chí không cần biết cách cầm thẻ đi nói chuyện với Vault**. Một container phụ tên là **Vault Agent** chạy ngay trong cùng Pod sẽ làm toàn bộ việc xác thực và đặt mật khẩu đã lấy được vào một thư mục dùng chung trên RAM.

---

## 2. Toàn cảnh luồng xác thực giữa Kubernetes và Vault

### 2.1 Theo dõi đường đi của một Payment Pod

Giả sử bạn chạy `payment-service` trong namespace `payments`, gắn với ServiceAccount tên `payment-sa`. Bên trong Vault, bạn đã cấu hình trước một **Vault Role** tên `payment-role` chỉ cho phép đúng cặp `(namespace: payments, serviceAccount: payment-sa)` đăng nhập, và gán cho role đó một **Vault Policy** chỉ được đọc credential Postgres của đội thanh toán.

Sơ đồ tương tác dưới đây mô tả đúng hai tình huống trên cùng một kiến trúc: khi Pod hợp lệ đi qua đủ vòng xác thực để lấy mật khẩu tạm thời, và khi một Pod khác (ví dụ chạy ở namespace `staging`) cố dùng `payment-role` để lấy trộm bí mật. Bạn có thể chuyển đổi qua lại giữa hai scenario hoặc bấm từng bước để xem chính xác thành phần nào được chạm tới.

```d2 mode=flow layout=dagre interval=1700 title="Luồng xác thực Kubernetes Auth và cấp Dynamic Postgres Secret"
# @flow
# scenarios:
#   - id: success
#     label: Xác thực hợp lệ & cấp Dynamic Secret
#     steps:
#       - edge: "(sa_token -> agent)[0]"
#         description: 'Pod khởi động, kubelet mount Projected SA Token (JWT ngắn hạn). Vault Agent đọc JWT này từ filesystem của Pod.'
#       - edge: "(agent -> vault)[0]"
#         description: 'Vault Agent gửi JWT kèm tên role "payment-role" tới POST /v1/auth/kubernetes/login của Vault.'
#       - edge: "(vault -> k8s_api)[0]"
#         description: 'Vault không tự tin JWT nhận được. Nó gửi JWT lên Kubernetes API Server qua TokenReview API để nhờ xác minh chữ ký và hạn dùng.'
#       - edge: "(k8s_api -> vault)[0]"
#         description: 'Kubernetes API Server xác nhận token hợp lệ và trả về danh tính thật: ServiceAccount "payment-sa" trong namespace "payments".'
#       - edge: "(vault -> agent)[0]"
#         description: 'Danh tính khớp với Vault Role "payment-role". Vault gắn Policy đọc DB và phát một Vault Token ngắn hạn cho Agent.'
#       - edge: "(agent -> vault)[0]"
#         description: 'Vault Agent dùng Vault Token mới (không phải K8s JWT) gọi GET /v1/database/creds/payment-role để xin credential Postgres.'
#       - edge: "(vault -> postgres)[0]"
#         description: 'Vault kiểm tra Policy hợp lệ rồi kết nối tới PostgreSQL, chạy CREATE ROLE tạo một user/password tạm thời có hạn dùng (TTL).'
#       - edge: "(postgres -> vault)[0]"
#         description: 'PostgreSQL xác nhận đã tạo xong tài khoản tạm thời.'
#       - edge: "(vault -> agent)[0]"
#         description: 'Vault trả username, password tạm thời kèm lease_id về cho Vault Agent.'
#       - edge: "(agent -> tmpfs)[0]"
#         description: 'Vault Agent render credential thành file /vault/secrets/db-creds.env nằm trong emptyDir (RAM/tmpfs).'
#       - edge: "(tmpfs -> app)[0]"
#         description: 'Container payment-service đọc file credential từ thư mục dùng chung mà không cần chứa bất kỳ dòng code Vault SDK nào.'
#       - edge: "(app -> postgres)[0]"
#         description: 'payment-service dùng username/password tạm thời để mở kết nối trực tiếp tới PostgreSQL.'
#   - id: denied
#     label: Sai Namespace / giả mạo Role (bị từ chối)
#     steps:
#       - edge: "(sa_token -> agent)[0]"
#         description: 'Một Pod chạy ở namespace "staging" (hoặc dùng SA khác) khởi động và đọc Projected SA Token của chính nó.'
#       - edge: "(agent -> vault)[0]"
#         description: 'Agent trong Pod đó cố gửi JWT kèm tên role "payment-role" để xin quyền truy cập DB thanh toán.'
#       - edge: "(vault -> k8s_api)[0]"
#         description: 'Vault chuyển JWT cho Kubernetes API Server kiểm tra qua TokenReview API.'
#       - edge: "(k8s_api -> vault)[0]"
#         description: 'Kubernetes API Server xác thực chữ ký hợp lệ nhưng báo danh tính thật thuộc namespace "staging" — Pod không thể tự sửa nội dung JWT.'
#       - edge: "(vault -> agent)[0]"
#         description: 'Namespace "staging" không khớp bound_service_account_namespaces=["payments"]. Vault trả lỗi 400/403, không cấp Vault Token và không chạm tới PostgreSQL.'
# @endflow
direction: down

sa_token: "Projected SA Token\n(JWT trong Pod)"
agent: "Vault Agent\n(Init / Sidecar)"
tmpfs: "emptyDir (RAM)\n/vault/secrets"
app: "payment-service\n(App trong Pod)"

vault: "HashiCorp Vault"
k8s_api: "Kubernetes API" {
  icon: https://icons.d2lang.com/azure/_Companies/Kubernetes.svg
}
postgres: "PostgreSQL" {
  icon: https://icons.d2lang.com/dev/postgresql.svg
}

sa_token -> agent: "1. Đọc JWT"
agent -> vault: "2. Login / 6a. Xin creds"
vault -> k8s_api: "3. TokenReview"
k8s_api -> vault: "4. SA + NS"
vault -> agent: "5. Vault Token / 6d. Temp creds"
vault -> postgres: "6b. CREATE ROLE"
postgres -> vault: "6c. OK"
agent -> tmpfs: "7. Ghi file"
tmpfs -> app: "8. Đọc file"
app -> postgres: "9. Kết nối DB"
```

Nhìn vào kịch bản thứ hai (khi Pod ở `staging` thử dùng `payment-role`), bạn sẽ thấy điểm then chốt: toàn bộ nhánh PostgreSQL và thư mục `/vault/secrets` đều bị vô hiệu hóa ngay từ cửa. Bởi vì Vault không tin lời khai của Pod; nó hỏi ngược lại chính Kubernetes API Server để biết chữ ký JWT đó thuộc về ServiceAccount và Namespace nào.

### 2.2 Hai loại token rất dễ nhầm lẫn

Khi đọc log lỗi hoặc giải thích luồng này cho đồng đội, rất nhiều người gộp hai loại token làm một. Thực tế chúng có hai vai trò tách biệt hoàn toàn:

| Đặc điểm | Kubernetes ServiceAccount Token (JWT) | HashiCorp Vault Token |
|---|---|---|
| **Bên cấp phát** | Kubernetes Control Plane (kubelet mount qua Projected Volume) | HashiCorp Vault sau khi xác thực xong |
| **Mục đích** | **Authentication** — chứng minh *"Tôi là `payment-sa` ở namespace `payments`"* | **Authorization** — xác định *"Tôi được phép đọc đường dẫn nào trong Vault"* |
| **Nơi sử dụng** | Chỉ dùng 1 lần lúc gọi `/v1/auth/kubernetes/login` (hoặc khi cần re-auth) | Đính vào header `X-Vault-Token` cho mọi request đọc secret / gia hạn lease |
| **Phạm vi gắn kèm** | Danh tính Workload (ServiceAccount, Namespace, Pod UID) | Danh sách Vault Policy (ví dụ `payment-db-read`) và thời hạn (TTL) |

Nhớ quy tắc một dòng này sẽ giúp bạn debug cực nhanh: **lỗi ở bước đổi K8s JWT → Vault Token là lỗi xác thực (Auth Role / TokenReview); lỗi khi cầm Vault Token đi đọc secret là lỗi phân quyền (Vault Policy / Secret Path).**

### 2.3 Nhìn sát hơn vào HTTP request giữa Agent và Vault

Đằng sau hậu trường, Vault Agent chỉ giao tiếp với Vault qua REST API thuần túy. Phần transcript tĩnh dưới đây minh họa cấu trúc HTTP request và response ở hai thời điểm quyết định: đăng nhập bằng Kubernetes JWT (thành công và thất bại) và dùng Vault Token xin mật khẩu Postgres tạm thời. Đây là ví dụ minh họa với token giả lập, không phải request thật gửi ra mạng.

```protocol-exchange
title: Trao đổi HTTP giữa Vault Agent và HashiCorp Vault
variants:
  - id: login-ok
    title: 1. Login thành công (đổi K8s JWT lấy Vault Token)
    request:
      method: POST
      url: /v1/auth/kubernetes/login
      headers:
        - id: ct-1
          name: Content-Type
          value: application/json
      body:
        kind: json
        json: '{"role":"payment-role","jwt":"eyJhbGciOiJSUzI1NiIsImtpZCI6ImRlbW8ifQ.demo-payload.demo-sig"}'
    response:
      status: 200
      statusText: OK
      headers:
        - id: ct-2
          name: Content-Type
          value: application/json
      body:
        kind: json
        json: '{"auth":{"client_token":"hvs.demo-short-lived-vault-token","policies":["default","payment-db-read"],"metadata":{"role":"payment-role","service_account_name":"payment-sa","service_account_namespace":"payments"},"lease_duration":3600,"renewable":true}}'
  - id: login-denied
    title: 2. Login bị từ chối (sai ServiceAccount hoặc Namespace)
    request:
      method: POST
      url: /v1/auth/kubernetes/login
      headers:
        - id: ct-3
          name: Content-Type
          value: application/json
      body:
        kind: json
        json: '{"role":"payment-role","jwt":"eyJhbGciOiJSUzI1NiIsImtpZCI6ImRlbW8ifQ.staging-payload.demo-sig"}'
    response:
      status: 400
      statusText: Bad Request
      headers:
        - id: ct-4
          name: Content-Type
          value: application/json
      body:
        kind: json
        json: '{"errors":["namespace not authorized"]}'
  - id: get-db-creds
    title: 3. Dùng Vault Token xin Dynamic Postgres Credentials
    request:
      method: GET
      url: /v1/database/creds/payment-role
      headers:
        - id: token-1
          name: X-Vault-Token
          value: hvs.demo-short-lived-vault-token
    response:
      status: 200
      statusText: OK
      headers:
        - id: ct-5
          name: Content-Type
          value: application/json
      body:
        kind: json
        json: '{"request_id":"demo-req-01","lease_id":"database/creds/payment-role/demoLease99","lease_duration":3600,"renewable":true,"data":{"username":"v-k8s-payment-role-a1b2c3","password":"demo-temp-password-not-real"}}'
```

Hãy để ý hai chi tiết nhỏ nhưng rất quan trọng trong response thứ ba:
1. `username` không phải là `payment_user` cố định, mà có dạng `v-k8s-payment-role-<random>` — mỗi Pod nhận một định danh riêng trên PostgreSQL.
2. `lease_id` và `lease_duration: 3600` (1 giờ) cho Vault Agent biết phải tự động gọi gia hạn (renew) trước khi đồng hồ đếm ngược về 0.

### 2.4 Chiều ngược lại: Vault lấy quyền gì để hỏi Kubernetes API

Một câu hỏi cực kỳ đáng giá mà các bài giới thiệu nhanh thường bỏ qua: **tại sao Kubernetes API Server lại chịu trả lời `TokenReview` cho Vault?** Không phải ai gửi một chuỗi JWT lên API Server cũng được phép kiểm tra xem JWT đó của ai.

Để gọi được `POST /apis/authentication.k8s.io/v1/tokenreviews`, chính Vault cũng cần quyền RBAC là ClusterRole **`system:auth-delegator`** trong Kubernetes. Cách cấp quyền này phụ thuộc vào nơi Vault đang chạy:

- **Trường hợp 1: Vault chạy ngay bên trong Kubernetes cluster (phổ biến nhất).** Khi cài Vault qua Helm chart chính thức, chart tạo sẵn một ServiceAccount cho Vault (`vault`) và gắn ClusterRoleBinding `system:auth-delegator`. Khi cấu hình `auth/kubernetes/config`, bạn **không nên** nhét cứng `token_reviewer_jwt`; thay vào đó để trống để Vault tự đọc Projected ServiceAccount Token ngắn hạn của chính Pod Vault đang chạy (được kubelet tự xoay vòng).
- **Trường hợp 2: Vault chạy ngoài cluster (ví dụ một cụm Vault trung tâm phục vụ 10 cluster K8s).** Lúc này Vault không có Pod trong từng cluster mục tiêu. Bạn cần tạo một ServiceAccount riêng (ví dụ `vault-auth`) gắn `system:auth-delegator` trên mỗi cluster, hoặc thiết lập **delegated authentication** (dùng chính JWT của Pod gửi lên làm `token_reviewer_jwt` bằng cách đặt `disable_local_ca_jwt=true` — lưu ý cách này yêu cầu chính SA của app cũng có quyền gọi `TokenReview`, thường ít được khuyến nghị bằng việc dùng SA riêng hoặc OIDC/JWKS).

<Callout type="warn" title="Lưu ý về Kubernetes 1.24+">
  Từ Kubernetes 1.24 trở đi, tạo một `ServiceAccount` không còn tự sinh ra một `Secret` chứa token vĩnh viễn nữa. Nếu Vault chạy ngoài cluster và bạn cần tạo token reviewer dài hạn (khi chưa dùng OIDC/JWT Auth), bạn phải chủ động tạo một `Secret` loại `kubernetes.io/service-account-token` hoặc ưu tiên dùng **Vault JWT Auth Method** trỏ trực tiếp tới OIDC Discovery URL / JWKS của Kubernetes API Server để bỏ hẳn token reviewer tĩnh.
</Callout>

---

## 3. Vault Agent Injector hoạt động thế nào bên trong Pod

Đến đây bạn đã hiểu cách Vault Agent nói chuyện với Vault. Nhưng khoan đã: **trong file `deployment.yaml` của `payment-service`, bạn đâu có tự khai báo container `vault-agent` hay `emptyDir`?** Ai là người đã nhét chúng vào Pod?

Câu trả lời là **Vault Agent Injector** — một **Mutating Admission Webhook** (thành phần chặn và chỉnh sửa manifest Pod ngay tại Kubernetes API Server trước khi Pod được lưu vào `etcd` và lập lịch xuống Node).

Mỗi khi bạn chạy `kubectl apply` một Deployment có annotation `vault.hashicorp.com/agent-inject: "true"`, API Server sẽ gửi Pod spec sang cho `vault-agent-injector`. Webhook này đọc các annotation `vault.hashicorp.com/*`, tự động tiêm thêm 2 container và 1 volume vào Pod rồi trả Pod spec hoàn chỉnh về cho API Server.

### 3.1 Cấu trúc một Pod sau khi bị Inject

Sơ đồ dưới đây cho thấy hình hài thật sự của một `payment-service` Pod sau khi đi qua Mutating Admission Webhook:

```d2 layout=dagre title="Bên trong một Pod sau khi Vault Agent Injector can thiệp"
direction: down

webhook: "Vault Agent Injector (Mutating Webhook)" {
  style.stroke-dash: 3
}

pod: "payment-service Pod (sau khi bị mutate)" {
  sa_vol: "Projected Volume\n/var/run/secrets/.../token"
  init: "Init Container\nvault-agent-init\n(Lấy secret đầu tiên)"
  sidecar: "Sidecar Container\nvault-agent\n(Renew token & lease)"
  mem_vol: "emptyDir (Memory / tmpfs)\n/vault/secrets/"
  app: "App Container\npayment-service"

  sa_vol -> init: "Đọc JWT"
  sa_vol -> sidecar: "Đọc JWT"
  init -> mem_vol: "Render lần đầu"
  sidecar -> mem_vol: "Cập nhật khi rotate"
  mem_vol -> app: "Đọc file secret"
}

vault: "HashiCorp Vault"

webhook -> pod: "Patch Pod spec lúc admission" {style.stroke-dash: 4}
pod.init -> vault: "Login & lấy secret đầu"
pod.sidecar -> vault: "Renew lease & re-fetch"
```

Ba chi tiết kiến trúc ở đây cực kỳ đáng nhớ:

1. **Tại sao phải có cả `vault-agent-init` lẫn `vault-agent` sidecar?**
   Init container chạy tuần tự **trước khi** `payment-service` khởi động. Nó đảm bảo rằng tại thời điểm dòng code đầu tiên của `payment-service` mở file `/vault/secrets/db-creds.env`, file đó **chắc chắn đã tồn tại**. Nếu chỉ dùng sidecar chạy song song, ứng dụng rất dễ khởi động nhanh hơn Agent 200 ms và crash vì lỗi `file not found`. Sau khi `vault-agent-init` xong việc và thoát, sidecar `vault-agent` tiếp quản việc giữ lease còn hạn và ghi lại file khi bí mật thay đổi.
2. **Tại sao dùng `emptyDir` với `medium: Memory`?**
   Volume này được mount dưới dạng `tmpfs` (RAM của Node), nên bí mật không bị ghi thành file vật lý lên ổ đĩa Node và sẽ biến mất ngay khi Pod bị xóa.
3. **Ứng dụng hoàn toàn "mù" về Vault:**
   `payment-service` chỉ thấy một file cấu hình bình thường tại `/vault/secrets/db-creds.env`. Điều này cực tiện khi bạn muốn gom hàng chục service viết bằng Go, Java, Node.js, Python vào Vault mà không cần cài Vault SDK vào từng repo.

### 3.2 Đọc từng dòng annotation trong Deployment

Thay vì viết hàng trăm dòng cấu hình sidecar thủ công, bạn chỉ cần thêm các annotation `vault.hashicorp.com/*` vào `spec.template.metadata.annotations` của Deployment. Hãy đi qua từng cụm dòng trong manifest dưới đây để hiểu rõ tác dụng của từng annotation:

```code-walkthrough
title: Giải mã các annotation Vault Agent Injector trong Deployment
language: yaml
snapshots:
  - id: deploy
    title: payment-deployment.yaml
    code: |-
      apiVersion: apps/v1
      kind: Deployment
      metadata:
        name: payment-service
        namespace: payments
      spec:
        replicas: 2
        selector:
          matchLabels:
            app: payment-service
        template:
          metadata:
            labels:
              app: payment-service
            annotations:
              vault.hashicorp.com/agent-inject: "true"
              vault.hashicorp.com/role: "payment-role"
              vault.hashicorp.com/agent-inject-secret-db-creds.env: "database/creds/payment-role"
              vault.hashicorp.com/agent-inject-template-db-creds.env: |
                {{- with secret "database/creds/payment-role" -}}
                export DB_USER="{{ .Data.username }}"
                export DB_PASS="{{ .Data.password }}"
                {{- end }}
          spec:
            serviceAccountName: payment-sa
            containers:
              - name: payment-service
                image: ghcr.io/example/payment-service:1.4.0
                command: ["/bin/sh", "-c"]
                args:
                  - "source /vault/secrets/db-creds.env && exec /app/payment-service"
steps:
  - id: enable-inject
    snapshot: deploy
    title: Bật Mutating Webhook và chọn Vault Role
    description: agent-inject="true" báo cho Vault Agent Injector tự chèn init + sidecar container. Annotation role="payment-role" cho Agent biết phải đăng nhập vào Vault Role nào.
    ranges: [[16, 17]]
  - id: secret-path
    snapshot: deploy
    title: Chỉ định đường dẫn secret và tên file đầu ra
    description: Hậu tố sau agent-inject-secret- chính là tên file sẽ được tạo trong /vault/secrets/ (ở đây là /vault/secrets/db-creds.env). Giá trị là đường dẫn trong Vault cần đọc.
    ranges: [[18, 18]]
  - id: template
    snapshot: deploy
    title: Định dạng nội dung file bằng Go Template
    description: Mặc định Vault Agent ghi raw map ra file rất khó đọc. Annotation agent-inject-template-* dùng Consul Template (Go template) để xuất đúng định dạng .env, JSON, YAML hay application.properties mà app cần.
    ranges: [[19, 23]]
  - id: service-account
    snapshot: deploy
    title: Gắn đúng ServiceAccount đã bind với Vault Role
    description: Nếu quên dòng này, Pod sẽ dùng ServiceAccount "default" của namespace payments và bị Vault từ chối ngay khi gọi login.
    ranges: [[25, 25]]
  - id: consume
    snapshot: deploy
    title: Cách app tiêu thụ file secret
    description: 'Ví dụ này dùng shell source file .env trước khi exec tiến trình app (đơn giản cho static secret). Lưu ý quan trọng ở mục 4.2: cách source 1 lần lúc startup sẽ không nhận được password mới khi Dynamic Secret xoay vòng!'
    ranges: [[29, 31]]
```

<Callout type="warn" title="Chú ý cách tiêu thụ ở dòng 29–31">
  Mẹo `source /vault/secrets/db-creds.env && exec ...` xuất hiện trong rất nhiều bài hướng dẫn nhanh trên mạng vì nhìn gọn. Tuy nhiên, nó **đóng băng** mật khẩu vào biến môi trường của tiến trình ngay lúc khởi động. Nếu bạn dùng **Dynamic Secrets** (hết hạn sau vài giờ), cách này sẽ khiến app mất kết nối DB ngay khi mật khẩu đầu tiên bị thu hồi. Ta sẽ xử lý triệt để vấn đề này ở mục 4 ngay sau đây.
</Callout>

---

## 4. Từ Static Secret đến Dynamic Postgres Secrets

Nếu bạn chỉ dùng Vault để cất một mật khẩu Postgres cố định trong **KV Secrets Engine** (Key-Value store — kho lưu cặp khóa/giá trị tĩnh), bạn mới khai thác khoảng 30% sức mạnh của Vault. Điểm thực sự khiến Vault khác biệt nằm ở **Dynamic Secrets** (bí mật động).

### 4.1 Vòng đời một Dynamic Credential và cơ chế Lease

Với **Database Secrets Engine**, bạn không tạo sẵn một tài khoản `payment_user` rồi chia sẻ cho cả 20 Pod nữa. Thay vào đó:

1. Bạn cấp cho Vault một tài khoản quản trị Postgres (chỉ có quyền tạo/xóa user con, và chính tài khoản này cũng được Vault tự đổi mật khẩu qua lệnh `rotate-root` để không ai giữ bản sao).
2. Bạn định nghĩa một Database Role trong Vault (ví dụ `payment-role`) kèm câu lệnh SQL tạo user, phân quyền tối thiểu (`SELECT, INSERT, UPDATE` trên bảng `payments`) và hai mốc thời gian:
   - **`default_ttl` (ví dụ `1h`):** thời hạn sống mỗi lần cấp hoặc gia hạn.
   - **`max_ttl` (ví dụ `24h`):** trần tối đa một tài khoản được phép tồn tại.
3. Khi Pod A khởi động, Vault chạy SQL tạo user `v-k8s-payment-role-a1b2c3` với mật khẩu ngẫu nhiên và gắn một **Lease** (hợp đồng cho thuê bí mật). Pod B khởi động cùng lúc sẽ nhận một user khác hoàn toàn, ví dụ `v-k8s-payment-role-x9y8z7`.
4. Trong lúc Pod A đang chạy, Vault Agent sidecar tự gọi API gia hạn lease trước khi hết `1h`.
5. Khi đạt ngưỡng `max_ttl` (`24h`), Vault **từ chối gia hạn tiếp**, thu hồi (`DROP ROLE` / `REVOKE`) user cũ trên Postgres và cấp một cặp user/password hoàn toàn mới cho Vault Agent. Tương tự, nếu Pod A bị xóa hoặc crash không còn gia hạn nữa, user cũ sẽ tự động bị dọn sạch khỏi database sau khi hết TTL.

Lợi ích bảo mật rất rõ ràng: nếu một mật khẩu vô tình lọt ra ngoài qua log hay một container bị chiếm quyền, bạn biết **chính xác nó xuất phát từ Pod nào** và có thể thu hồi ngay lập tức một lease duy nhất mà không làm gián đoạn 19 Pod còn lại.

### 4.2 Cạm bẫy kinh điển: secret đã xoay nhưng app không biết

Đây là tình huống khiến rất nhiều đội triển khai Vault lần đầu gặp sự cố production: mọi thứ chạy trơn tru cả ngày đầu tiên, rồi **đúng 24 tiếng sau (chạm `max_ttl`), toàn bộ `payment-service` đồng loạt báo lỗi `password authentication failed for user "v-k8s-..."`.**

Nguyên nhân cực kỳ đơn giản:
- Vault Agent sidecar làm đúng nhiệm vụ của nó: xin cặp `username/password` mới và ghi đè vào `/vault/secrets/db-creds.env`.
- Nhưng **tiến trình `payment-service` chỉ đọc file (hoặc biến môi trường) đúng một lần duy nhất lúc khởi động**, sau đó giữ nguyên cấu hình connection pool với cặp credential cũ. Khi Vault thu hồi user cũ, mọi kết nối mới từ connection pool đều gãy.

Nói ngắn gọn: **Vault Agent chỉ chịu trách nhiệm cập nhật file, không tự động cập nhật bộ nhớ của ứng dụng.** Để dùng Dynamic Secrets an toàn trong production, bạn phải chọn một trong ba chiến lược reload sau:

1. **Ứng dụng tự watch file và làm mới connection pool (Khuyên dùng cho Dynamic Secrets):**
   Ứng dụng theo dõi sự thay đổi của `/vault/secrets/db-creds.json` (bằng file watcher như `fsnotify`, Spring Cloud Config reload, hoặc đọc lại file định kỳ) và khởi tạo lại DB connection pool theo kiểu graceful (đóng kết nối cũ sau khi xong query đang chạy, mở kết nối mới bằng credential mới). Cách này đạt **zero-downtime** thật sự.
2. **Dùng annotation `agent-inject-command-*` để báo hiệu cho app reload:**
   Mỗi khi Vault Agent render lại file secret, nó chạy thêm một lệnh tùy chọn. Nếu ứng dụng hỗ trợ reload cấu hình khi nhận tín hiệu `SIGHUP` hoặc một endpoint nội bộ (như `POST http://127.0.0.1:8080/-/reload`), bạn khai báo:
   ```yaml
   vault.hashicorp.com/agent-inject-command-db-creds.env: "wget -qO- --post-data='' http://127.0.0.1:8080/-/reload"
   ```
   *(Lưu ý: nếu muốn dùng `kill -HUP` tiến trình app từ container `vault-agent`, bạn bắt buộc phải bật `shareProcessNamespace: true` trên Pod spec — điều này mở rộng bề mặt chia sẻ tiến trình giữa các container, nên gọi reload endpoint cục bộ thường sạch hơn.)*
3. **Rolling restart Deployment qua Vault Secrets Operator (`rolloutRestartTargets`):**
   Nếu ứng dụng là phần mềm legacy hoặc bên thứ ba hoàn toàn không hỗ trợ đọc lại credential khi đang chạy, hãy cân nhắc chuyển sang **Vault Secrets Operator (VSO)** thay vì Sidecar. VSO đồng bộ secret mới ra Kubernetes Secret rồi tự kích hoạt rolling restart có kiểm soát cho Deployment (tôn trọng `maxUnavailable` và PodDisruptionBudget), giúp không sập dịch vụ hàng loạt.

<Callout type="idea" title="Nguyên tắc chọn nhanh cho bài toán reload">
  Nếu team kiểm soát được source code app và dùng Dynamic Secrets → viết cơ chế đọc lại file & refresh connection pool. Nếu app không thể reload nóng → dùng VSO với `rolloutRestartTargets` hoặc bắt đầu bằng Static Secret xoay vòng theo lịch bảo trì trước khi nhảy thẳng sang Dynamic Secret.
</Callout>

---

## 5. Chọn mô hình tích hợp nào cho Production

Trong ví dụ đầu bài, ta mới chỉ có một `payment-service`. Giờ hãy tưởng tượng hệ thống phình lên **100 microservices với 1.500 Pod**. Nếu Pod nào cũng gắn thêm một `vault-agent` sidecar tiêu tốn khoảng 50–100 MiB RAM và một phần CPU, bạn sẽ mất thêm hàng trăm GB RAM chỉ để chạy các tiến trình agent, chưa kể sidecar gây phiền phức lớn cho các `Job` và `CronJob` (vì main container chạy xong mà sidecar không chịu tắt).

Đó là lý do hệ sinh thái Kubernetes + Vault ngày nay không chỉ có mỗi Vault Agent Injector. Có **4 mô hình tích hợp chính** bạn cần biết để chọn đúng cho quy mô của mình.

### 5.1 So sánh kiến trúc các mô hình giao secret

Sơ đồ dưới đây đặt 3 hướng tiếp cận kiến trúc chính cạnh nhau (trong đó VSO và ESO cùng dùng chung cơ chế Operator đồng bộ ra Kubernetes Secret):

```d2 title="So sánh 3 mô hình kiến trúc đưa secret từ Vault vào Pod"
direction: right

vault: "HashiCorp Vault"

m1: "1. Vault Agent Injector (Sidecar)" {
  pod1: "Mỗi App Pod" {
    agent: "vault-agent\n(Init + Sidecar)"
    tmpfs: "emptyDir (RAM)"
    app1: "App Container"
    agent -> tmpfs: "Ghi file"
    tmpfs -> app1: "Đọc file"
  }
}

m2: "2. Operator Sync (VSO / ESO)" {
  op: "Operator Deployment\n(1 cụm dùng chung)"
  k8s_secret: "Kubernetes Secret\n(lưu trong etcd)"
  pod2: "App Pod\n(Không có sidecar)"
  op -> k8s_secret: "Sync định kỳ"
  k8s_secret -> pod2: "Mount volume / env"
}

m3: "3. Vault CSI Provider" {
  csi: "Secrets Store CSI Driver\n(DaemonSet trên mỗi Node)"
  pod3: "App Pod\n(Không có sidecar)"
  csi -> pod3: "Mount trực tiếp\nqua CSI tmpfs volume"
}

vault -> m1.pod1.agent: "Mỗi Pod tự login\n& renew lease"
vault -> m2.op: "Operator login &\nđồng bộ tập trung"
vault -> m3.csi: "CSI trên Node dùng\nSA token của Pod"
```

Bảng dưới đây đối chiếu thẳng các đánh đổi thực tế giữa cả 4 công cụ:

| Tiêu chí | Vault Agent Injector (Sidecar) | Vault Secrets Operator (VSO) | Vault CSI Provider | External Secrets Operator (ESO) |
|---|---|---|---|---|
| **Chi phí tài nguyên ở quy mô lớn** | Cao — mỗi Pod thêm 1 container | Thấp — chỉ 1 Operator cho cả cluster | Trung bình — 1 DaemonSet trên mỗi Node | Thấp — chỉ 1 Operator cho cả cluster |
| **Secret có lưu vào `etcd` (K8s Secret) không?** | **Không** (chỉ ở `tmpfs` trong Pod) | **Có** (cần bật Encryption at Rest + siết RBAC) | **Không** (trừ khi bạn tự bật `secretObjects` sync) | **Có** (cần bật Encryption at Rest + siết RBAC) |
| **Dynamic Secrets & Auto-renew Lease** | Rất tốt (hỗ trợ gốc đầy đủ) | Tốt (qua CRD `VaultDynamicSecret`) | Hạn chế (chủ yếu lấy lúc mount, không renew lease linh hoạt bằng Agent) | Hạn chế hơn VSO (hỗ trợ Vault dynamic ở mức cơ bản, không chuyên sâu lease bằng VSO) |
| **Hỗ trợ `Job` / `CronJob`** | Dễ kẹt Pod nếu không cấu hình `pre-populate-only` hoặc Native Sidecar | Rất mượt (chỉ đọc K8s Secret chuẩn) | Mượt (mount lúc start, unmount lúc stop) | Rất mượt (chỉ đọc K8s Secret chuẩn) |
| **Tự động rolling restart khi secret đổi** | Không (tự xử lý reload trong app) | **Có sẵn** (`rolloutRestartTargets`) | Không (cần tool ngoài) | Cần kết hợp tool như Stakater Reloader |
| **Đa nguồn secret (AWS, GCP, Vault...)** | Chỉ Vault | Chỉ Vault | Nhiều provider qua CSI chuẩn | **Rất mạnh** (Vault, AWS, GCP, Azure...) |

### 5.2 Nên chọn mô hình nào và khi nào không nên dùng Vault

Thay vì liệt kê rồi để bạn tự đoán, đây là khuyến nghị thực tế bạn có thể dùng làm điểm xuất phát:

- **Mặc định cho team dùng thuần HashiCorp Vault ở quy mô vừa và lớn → Chọn Vault Secrets Operator (VSO).**
  VSO loại bỏ hoàn toàn gánh nặng sidecar trên hàng trăm Pod, tích hợp cực sạch với GitOps (bạn chỉ commit CRD như `VaultStaticSecret` hoặc `VaultDynamicSecret` lên Git, không có giá trị secret nào lọt vào Git), và có sẵn `rolloutRestartTargets` giải quyết bài toán app không reload nóng. Điều kiện đi kèm là cluster của bạn **phải bật Encryption at Rest cho `etcd`** và khóa RBAC đọc `Secret` chặt theo từng Namespace.
- **Khi có yêu cầu bảo mật cực khắt khe (tuyệt đối không cho secret chạm `etcd`) hoặc cần Dynamic Secret riêng biệt cho từng replica Pod → Chọn Vault Agent Injector (Sidecar).**
  Trong kịch bản mỗi replica phải có một user Postgres riêng để truy vết audit tới tận từng Pod, Sidecar vẫn là lựa chọn tự nhiên nhất (lưu ý bật Native Sidecar trên Kubernetes 1.29+ nếu dùng cho `Job`).
- **Khi hạ tầng đa cloud (vừa dùng AWS Secrets Manager, vừa dùng GCP Secret Manager, vừa dùng Vault) → Chọn External Secrets Operator (ESO).**
  ESO giúp toàn bộ developer dùng chung một bộ CRD (`ExternalSecret`, `SecretStore`) mà không bị khóa chặt vào riêng Vault.
- **Khi nào KHÔNG nên dựng HashiCorp Vault?**
  Nếu team bạn nhỏ (dưới 10–15 người), chạy toàn bộ workload trên một cloud duy nhất (ví dụ chỉ EKS trên AWS hoặc GKE trên GCP) và không có nhu cầu Dynamic Database Credentials hay PKI nội bộ, **đừng vội tự dựng cụm Vault**. Vận hành Vault production đồng nghĩa với việc bạn phải tự lo High Availability (Raft Integrated Storage), Auto-Unseal (KMS), backup/restore snapshot định kỳ, giám sát trạng thái seal và nâng cấp không downtime. Trong trường hợp đó, kết hợp **Cloud Secret Manager (AWS/GCP/Azure) + External Secrets Operator** rẻ hơn rất nhiều về công sức vận hành.

---

## 6. Triển khai từng bước từ Vault đến Payment Pod

Phần này tổng hợp quy trình cấu hình trọn vẹn để nối `payment-service` (namespace `payments`) với HashiCorp Vault và PostgreSQL Dynamic Secrets. Các bước giả định bạn đã cài sẵn Vault (kèm Agent Injector qua Helm chart `hashicorp/vault`) trong namespace `vault` và đã có một instance PostgreSQL đang chạy trong cluster.

<Steps>
<Step>

### Chuẩn bị Namespace và ServiceAccount cho ứng dụng

Đừng bao giờ dùng `default` ServiceAccount cho workload production. Hãy tạo một `ServiceAccount` riêng cho `payment-service` để phạm vi quyền trong Vault chỉ bó hẹp vào đúng ứng dụng này:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: payments
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: payment-sa
  namespace: payments
```

</Step>
<Step>

### Bật Kubernetes Auth, Database Engine và tạo Policy trong Vault

Ở bước này ta cấu hình bên trong Vault (minh họa chạy CLI từ container `vault-0` trong namespace `vault`, sau đó xác minh từ máy local). Đây là transcript hướng dẫn tĩnh, không thực thi lệnh thật trên cluster của bạn.

```terminal-session
title: Cấu hình Kubernetes Auth và Dynamic Postgres Role trong Vault
description: Các bước 1–5 chạy trong pod vault-0 (đã login với quyền admin cấu hình). Bước 6–7 chạy trên máy local để kiểm tra Pod sau khi apply Deployment.
context:
  kind: pod
  label: vault-0 (namespace vault)
steps:
  - id: enable-k8s-auth
    title: Bật và trỏ Kubernetes Auth tới API Server nội bộ
    command: |-
      vault auth enable kubernetes
      vault write auth/kubernetes/config \
        kubernetes_host="https://$KUBERNETES_PORT_443_TCP_ADDR:443"
    outputs:
      - stream: stdout
        text: |-
          Success! Enabled kubernetes auth method at: kubernetes/
          Success! Data written to: auth/kubernetes/config
    expected: Vault tự dùng CA cert và Projected SA Token của chính pod vault-0 để gọi TokenReview API.
    exitCode: 0
  - id: enable-db-engine
    title: Bật Database Secrets Engine và kết nối tới PostgreSQL
    command: |-
      vault secrets enable database
      vault write database/config/payments-pg \
        plugin_name=postgresql-database-plugin \
        allowed_roles="payment-role" \
        connection_url="postgresql://{{username}}:{{password}}@postgres.database.svc.cluster.local:5432/payments?sslmode=require" \
        username="vault_admin" \
        password="demo-initial-bootstrap-password"
      vault write -f database/rotate-root/payments-pg
    outputs:
      - stream: stdout
        text: |-
          Success! Enabled the database secrets engine at: database/
          Success! Data written to: database/config/payments-pg
          Success! Data written to: database/rotate-root/payments-pg
    expected: Lệnh rotate-root đổi ngay mật khẩu vault_admin để chỉ riêng Vault nắm giữ mật khẩu quản trị.
    exitCode: 0
  - id: create-db-role
    title: Tạo Database Role sinh user Postgres tạm thời (TTL 1h, max 24h)
    command: |-
      vault write database/roles/payment-role \
        db_name=payments-pg \
        creation_statements="CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}'; GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO \"{{name}}\";" \
        default_ttl="1h" \
        max_ttl="24h"
    outputs:
      - stream: stdout
        text: "Success! Data written to: database/roles/payment-role"
    expected: Mỗi yêu cầu tới database/creds/payment-role sẽ sinh 1 user Postgres mới có quyền đọc/ghi tối thiểu.
    exitCode: 0
  - id: create-policy
    title: Tạo Vault Policy theo nguyên tắc tối thiểu quyền (Least Privilege)
    command: |-
      vault policy write payment-db-read - <<EOF
      path "database/creds/payment-role" {
        capabilities = ["read"]
      }
      EOF
    outputs:
      - stream: stdout
        text: "Success! Uploaded policy: payment-db-read"
    expected: Policy chỉ cho phép đọc đúng path database/creds/payment-role, không thấy secret của service khác.
    exitCode: 0
  - id: bind-k8s-role
    title: Bind ServiceAccount payment-sa (namespace payments) vào Vault Role
    command: |-
      vault write auth/kubernetes/role/payment-role \
        bound_service_account_names=payment-sa \
        bound_service_account_namespaces=payments \
        policies=payment-db-read \
        ttl=1h
    outputs:
      - stream: stdout
        text: "Success! Data written to: auth/kubernetes/role/payment-role"
    expected: Chỉ Pod dùng SA payment-sa trong namespace payments mới đăng nhập được vào role này.
    exitCode: 0
  - id: verify-pod
    title: Xác minh Pod đã được inject sidecar và nhận file secret
    context:
      kind: local
      label: kubectl context demo-cluster
    command: kubectl get pods -n payments -l app=payment-service
    outputs:
      - stream: stdout
        text: |-
          NAME                               READY   STATUS    RESTARTS   AGE
          payment-service-7c9d4b6f8d-2k4lm   2/2     Running   0          42s
          payment-service-7c9d4b6f8d-9p7qx   2/2     Running   0          42s
    expected: Cột READY hiện 2/2 (container payment-service + container vault-agent).
    exitCode: 0
  - id: check-file
    title: Kiểm tra sự tồn tại của file secret trên RAM (tránh in mật khẩu ra terminal production)
    context:
      kind: local
      label: kubectl context demo-cluster
    command: kubectl exec -n payments deploy/payment-service -c payment-service -- ls -la /vault/secrets/
    outputs:
      - stream: stdout
        text: |-
          total 4
          drwxrwxrwt 2 root root   60 Apr 19 08:10 .
          drwxr-xr-x 3 root root 4096 Apr 19 08:10 ..
          -rw-r--r-- 1 100  1000  118 Apr 19 08:10 db-creds.env
    expected: File db-creds.env đã có sẵn trong mount point /vault/secrets/ và được cập nhật tự động bởi Vault Agent.
    exitCode: 0
```

</Step>
<Step>

### Kiểm chứng cơ chế cô lập quyền (Negative test)

Đừng chỉ kiểm tra trường hợp thành công. Một thói quen rất tốt sau khi cấu hình Vault là chạy thử một Pod ở namespace khác (hoặc dùng `default` ServiceAccount) gắn annotation `vault.hashicorp.com/role: "payment-role"`.

Kết quả mong đợi: container `vault-agent-init` sẽ dừng với lỗi `permission denied` / `service account name not authorized` hoặc `namespace not authorized`. Khi thấy lỗi từ chối đó, bạn mới thực sự chắc chắn hàng rào phân quyền đang hoạt động đúng.

</Step>
</Steps>

### 6.1 So sánh manifest trước và sau khi chuyển sang Vault

Nếu bạn đang có sẵn một Deployment dùng Kubernetes Secret tĩnh qua `envFrom` và muốn di chuyển sang Vault Agent Injector, phần thay đổi trên manifest thực tế rất nhỏ gọn. Bản diff dưới đây đối chiếu trực tiếp hai phiên bản:

```code-diff
title: Di chuyển Deployment từ Kubernetes Secret tĩnh sang Vault Agent Injector
language: yaml
view: split
before:
  label: Trước (Kubernetes Secret tĩnh)
  code: |-
    spec:
      template:
        metadata:
          labels:
            app: payment-service
        spec:
          containers:
            - name: payment-service
              image: ghcr.io/example/payment-service:1.4.0
              envFrom:
                - secretRef:
                    name: payment-postgres-secret
after:
  label: Sau (Vault Agent Injector + đọc file động)
  code: |-
    spec:
      template:
        metadata:
          labels:
            app: payment-service
          annotations:
            vault.hashicorp.com/agent-inject: "true"
            vault.hashicorp.com/role: "payment-role"
            vault.hashicorp.com/agent-inject-secret-db-creds.json: "database/creds/payment-role"
            vault.hashicorp.com/agent-inject-template-db-creds.json: |
              {{- with secret "database/creds/payment-role" -}}
              {"username":"{{ .Data.username }}","password":"{{ .Data.password }}"}
              {{- end }}
        spec:
          serviceAccountName: payment-sa
          containers:
            - name: payment-service
              image: ghcr.io/example/payment-service:1.4.0
              env:
                - name: DB_CREDS_FILE
                  value: /vault/secrets/db-creds.json
```

Thay vì truyền thẳng mật khẩu qua `secretRef`, phiên bản sau truyền **đường dẫn file** (`DB_CREDS_FILE`) để ứng dụng đọc lại được mỗi khi Vault Agent ghi đè mật khẩu mới, đồng thời tách riêng danh tính qua `serviceAccountName: payment-sa`.

---

## 7. Cạm bẫy Production và Troubleshooting nhanh

Đưa Vault lên production hiếm khi chết ở bước đọc tài liệu; nó thường vấp ở những chi tiết vận hành rất đời thường. Dưới đây là 6 cái bẫy xuất hiện lặp đi lặp lại nhất và cách khoanh vùng nhanh khi gặp sự cố.

### 7.1 Sáu lỗi vận hành hay gặp nhất

1. **Pod kẹt mãi ở `Init:0/1` hoặc `Init:CrashLoopBackOff`:**
   Đây là dấu hiệu `vault-agent-init` không lấy được secret đầu tiên, nên Kubernetes không cho app container khởi chạy. Nguyên nhân phổ biến nhất là: quên gắn `serviceAccountName`, gõ sai `bound_service_account_namespaces`, Vault đang ở trạng thái **sealed** (bị khóa), hoặc **NetworkPolicy** trong namespace `payments` đang chặn egress tới port `8200` của Vault.
2. **Pod chạy bình thường 24 giờ rồi đột ngột mất kết nối DB:**
   Đúng như phân tích ở mục 4.2: lease của Dynamic Secret đã chạm `max_ttl`, Vault thu hồi user Postgres cũ và ghi user mới vào `/vault/secrets/`, nhưng ứng dụng không đọc lại file và vẫn bám vào connection pool cũ.
3. **`Job` hoặc `CronJob` chạy xong code nhưng không bao giờ chuyển sang trạng thái `Completed`:**
   Bởi vì container `vault-agent` sidecar vẫn chạy vô thời hạn để chờ renew lease! Với `Job`/`CronJob` ngắn hạn, hãy thêm annotation `vault.hashicorp.com/agent-pre-populate-only: "true"` (chỉ chạy `vault-agent-init`, không chèn sidecar). Với `Job` chạy lâu hơn TTL cần renew, hãy nâng lên **Native Sidecar** của Kubernetes 1.29+ (khai báo initContainer với `restartPolicy: Always`, được Vault Agent Injector bản mới hỗ trợ) để kubelet tự dừng sidecar khi main container thoát.
4. **Vault bị `Sealed` sau khi Pod Vault restart → Toàn bộ Pod mới trong cluster không thể khởi động:**
   Mỗi khi một node Vault khởi động lại, nó luôn ở trạng thái **sealed** (không giải mã được dữ liệu) cho tới khi được unseal. Nếu bạn dùng Shamir unseal thủ công (nhập 3/5 key bằng tay), chỉ cần một đợt nâng cấp Node vào 2 giờ sáng là toàn bộ autoscaling của cluster tê liệt. **Bắt buộc bật Auto-Unseal** (dùng AWS KMS, GCP Cloud KMS, Azure Key Vault hoặc Vault Transit) và chạy Vault chế độ **HA (High Availability) tối thiểu 3 node với Integrated Storage Raft** cho môi trường production.
5. **Lỗi `403 permission denied` từ Kubernetes TokenReview trên cụm Kubernetes 1.21+:**
   Thường xảy ra khi bạn chạy Vault ngoài cluster và cấu hình cứng một JWT cũ đã hết hạn vào `token_reviewer_jwt`, hoặc khi Vault trong cluster vô tình cấu hình `token_reviewer_jwt` tĩnh thay vì để Vault tự đọc Projected SA Token hiện tại. Hãy bỏ `token_reviewer_jwt` tĩnh nếu Vault chạy trong cluster, hoặc chuyển sang JWT/OIDC Auth cho Vault chạy ngoài cluster.
6. **Chủ quan với RBAC vì nghĩ "đã có Vault rồi":**
   Vault chỉ đảm bảo bí mật không nằm lộ thiên trong Git hay `etcd` (với Sidecar/CSI). Nhưng bất kỳ ai có quyền `kubectl exec` vào `payment-service` đều có thể `cat /vault/secrets/db-creds.json` trong một giây. Hãy coi quyền `pods/exec` và quyền tạo Pod dùng `serviceAccountName: payment-sa` nhạy cảm ngang bằng quyền đọc trực tiếp mật khẩu database.

### 7.2 Bảng tra cứu nhanh theo triệu chứng

| Triệu chứng quan sát được | Nhóm nguyên nhân khả nghi | Lệnh kiểm tra đầu tiên |
|---|---|---|
| Pod chỉ có `1/1` container, không thấy `/vault/secrets/` | Thiếu annotation `agent-inject: "true"`, namespace bị loại khỏi webhook selector, hoặc `vault-agent-injector` bị lỗi | `kubectl get mutatingwebhookconfigurations` và `kubectl logs -n vault -l app.kubernetes.io/name=vault-agent-injector` |
| Pod kẹt `Init:0/1` hoặc `Init:Error` | Sai SA/Namespace, sai Policy path, Vault bị sealed, hoặc lỗi TLS/NetworkPolicy tới port `8200` | `kubectl logs <pod> -n payments -c vault-agent-init` |
| Log init báo `error authenticating: permission denied` | Sai `bound_service_account_names`/`namespaces`, hoặc Vault mất quyền gọi `TokenReview` | `vault read auth/kubernetes/role/payment-role` và kiểm tra ClusterRoleBinding `system:auth-delegator` |
| Log init báo `Vault is sealed` | Node Vault vừa restart mà chưa có Auto-Unseal hoặc KMS bị mất kết nối | `kubectl exec -n vault vault-0 -- vault status` |
| App báo `permission denied` khi đọc secret path | Login thành công (đã có Vault Token) nhưng Policy thiếu quyền `read` trên đúng path (chú ý KV v2 phải có `/data/` trong path policy!) | `vault policy read payment-db-read` |
| App chạy ổn rồi chết DB sau đúng `max_ttl` | App không reload file secret khi Vault Agent xoay vòng Dynamic Credential | `kubectl logs <pod> -n payments -c vault-agent` (xem mốc renew/re-fetch) và kiểm tra logic reload của app |

<Callout type="warn" title="Lỗi rất hay mắc với KV Secrets Engine v2">
  Nếu bạn đọc static secret từ KV v2 mount tại `secret/`, lệnh CLI là `vault kv get secret/payments/api`, nhưng **đường dẫn thực tế trong Vault Policy phải có thêm phân đoạn `/data/`**: `path "secret/data/payments/api" { capabilities = ["read"] }`. Quên chữ `data/` là lý do hàng đầu khiến login thành công nhưng vẫn bị `403 permission denied`.
</Callout>

### 7.3 Câu hỏi thường gặp

<Accordions type="single">
  <Accordion title="Nếu cụm Vault bị downtime tạm thời thì các Pod đang chạy có chết ngay không?">
    **Không chết ngay, nhưng có đồng hồ đếm ngược.** Các Pod đang chạy vẫn giữ credential hiện tại trong bộ nhớ / `/vault/secrets/` và tiếp tục hoạt động bình thường cho tới khi lease của Dynamic Secret (hoặc Vault Token) hết hạn. Tuy nhiên, **các Pod mới khởi động** (ví dụ do autoscaling hoặc node restart) sẽ kẹt ở `vault-agent-init` vì không kết nối được tới Vault. Đó là lý do Vault trên production bắt buộc phải chạy High Availability (tối thiểu 3 node) kèm Auto-Unseal và cấu hình TTL hợp lý để đủ thời gian ứng cứu.
  </Accordion>
  <Accordion title="Có nên đưa secret từ Vault vào biến môi trường (env var) thay vì đọc file không?">
    **Chỉ nên dùng env var cho static secret nếu bạn chấp nhận phải restart Pod mỗi lần xoay mật khẩu.** Biến môi trường của một tiến trình Linux không thể thay đổi từ bên ngoài sau khi tiến trình đã khởi chạy, và dễ bị lộ vô tình qua crash dump, debug endpoint hoặc lệnh `env`. Đọc trực tiếp từ file trên `tmpfs` (như `/vault/secrets/db-creds.json`) an toàn hơn và là điều kiện bắt buộc nếu bạn muốn xoay Dynamic Secrets không cần restart Pod.
  </Accordion>
  <Accordion title="Làm sao kết hợp HashiCorp Vault với GitOps (Argo CD / Flux)?">
    Bạn tuyệt đối không commit giá trị secret lên Git. Với **Vault Agent Injector**, bạn chỉ commit các annotation `vault.hashicorp.com/*` trong Deployment (chỉ chứa tên role và đường dẫn path, không có mật khẩu). Với **Vault Secrets Operator (VSO)** hoặc **External Secrets Operator (ESO)**, bạn commit các CRD tham chiếu như `VaultStaticSecret` hoặc `ExternalSecret` lên Git; Argo CD/Flux đồng bộ CRD đó vào cluster, rồi Operator mới tự kéo giá trị thật từ Vault về.
  </Accordion>
</Accordions>

---

## Tài liệu tham khảo và bài liên quan

- [HashiCorp Vault — Kubernetes Auth Method](https://developer.hashicorp.com/vault/docs/auth/kubernetes)
- [HashiCorp Vault — Agent Sidecar Injector](https://developer.hashicorp.com/vault/docs/platform/k8s/injector)
- [HashiCorp Vault — Vault Secrets Operator (VSO)](https://developer.hashicorp.com/vault/docs/platform/k8s/vso)
- [HashiCorp Vault — Database Secrets Engine (PostgreSQL)](https://developer.hashicorp.com/vault/docs/secrets/databases/postgresql)

<Cards>
  <Card
    title="Kubernetes Secret"
    href="/cau-hinh/secret/"
    description="Data model, threat model, giới hạn của Kubernetes Secret và cách mount an toàn."
  />
  <Card
    title="ServiceAccounts"
    href="/security/service-accounts/"
    description="Cơ chế Workload Identity và Projected ServiceAccount Token trong Kubernetes."
  />
  <Card
    title="RBAC"
    href="/security/rbac/"
    description="Kiểm soát quyền truy cập API Server, Secrets và pods/exec theo nguyên tắc tối thiểu quyền."
  />
  <Card
    title="External Secrets Management"
    href="/ecosystem/external-secrets/"
    description="Tổng quan hệ sinh thái quản lý bí mật ngoài cluster trong Kubernetes."
  />
</Cards>
