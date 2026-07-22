---
title: "Secret"
description: "Hiểu Kubernetes Secret từ data model, cách mount/inject, update và rotation đến encryption at rest, RBAC, external secret store và threat model production."
---

# Secret

## Mục lục

- [Tổng quan](#tổng-quan)
- [1. Threat model: Secret bảo vệ điều gì?](#1-threat-model-secret-bảo-vệ-điều-gì)
- [2. Data model, encoding và giới hạn](#2-data-model-encoding-và-giới-hạn)
- [3. Các Secret type](#3-các-secret-type)
- [4. Tạo Secret an toàn](#4-tạo-secret-an-toàn)
- [5. Cung cấp Secret cho Pod](#5-cung-cấp-secret-cho-pod)
- [6. Update và rotation](#6-update-và-rotation)
- [7. imagePullSecrets và ServiceAccount token](#7-imagepullsecrets-và-serviceaccount-token)
- [8. Bảo vệ Secret trong production](#8-bảo-vệ-secret-trong-production)
- [9. External secret management](#9-external-secret-management)
- [10. Thực hành](#10-thực-hành)
- [11. Troubleshooting và incident response](#11-troubleshooting-và-incident-response)
- [12. Best practices](#12-best-practices)
- [Tài liệu tham khảo](#tài-liệu-tham-khảo)

---

## Tổng quan

Secret là namespaced API object chứa lượng nhỏ dữ liệu nhạy cảm như password, token, private key hoặc certificate. Secret tách credential khỏi image và Pod template, cho phép quản lý lifecycle độc lập.

```mermaid
flowchart LR
    V[Vault / secret source] --> O[Operator hoặc pipeline]
    O --> S[Kubernetes Secret]
    S --> K[kubelet trên Node chạy Pod]
    K --> P[Volume hoặc environment]
    P --> A[Application]
```

Secret giống ConfigMap về cách consume nhưng có semantics và integration dành cho dữ liệu nhạy cảm.

> [!CAUTION]
> Base64 chỉ là encoding, không phải encryption. Theo mặc định, Secret có thể được lưu không mã hóa trong etcd nếu cluster chưa bật encryption at rest. Ai có quyền đọc Secret hoặc quyền tạo Pod trong Namespace thường có đường để lấy credential.

## 1. Threat model: Secret bảo vệ điều gì?

Dùng Secret thay vì hard-code giúp tránh:

- Credential nằm trong source code và Git history.
- Credential bị đóng gói vào image layer/registry/cache.
- Credential hiển thị trực tiếp trong Pod spec thông thường.
- Phải build image mới chỉ để rotate password.

Secret **không tự bảo vệ** khỏi:

- User có RBAC `get/list/watch secrets`.
- User có quyền tạo/patch workload để mount Secret trong cùng Namespace.
- Process bị compromise trong container đã được cấp Secret.
- Cluster administrator hoặc người đọc được etcd backup không mã hóa.
- Log, crash dump, shell history hoặc debug endpoint làm lộ giá trị.
- Node/root access trong lúc Secret được dùng.

Mental model:

```text
Secret giảm phạm vi và chuẩn hóa delivery
≠
Secret biến credential thành không thể đọc
```

Security phải bao gồm source, transport, storage, authorization, delivery, runtime exposure, rotation và revocation.

## 2. Data model, encoding và giới hạn

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: database-credentials
  namespace: production
type: Opaque
stringData:
  username: app_user
  password: replace-me-through-secure-pipeline
```

Hai field dữ liệu:

- `data`: mỗi value phải base64-encoded.
- `stringData`: nhận plain string; API server merge vào `data` khi ghi.

Nếu cùng key xuất hiện ở cả hai, `stringData` thắng. `stringData` tiện để author nhưng không hoạt động tốt với một số workflow server-side apply; công cụ secret management nên kiểm soát field ownership rõ.

### 2.1 Base64

```bash
printf %s 'p@ssw0rd' | base64
printf %s 'cEBzc3cwcmQ=' | base64 --decode
```

Tránh `echo` không kiểm soát vì có thể thêm newline. Newline vô tình trong password là lỗi rất phổ biến.

### 2.2 Ràng buộc

- Tên Secret là DNS subdomain hợp lệ.
- Key gồm chữ/số, `-`, `_`, `.`.
- Một Secret tối đa 1 MiB.
- Secret và Pod reference trực tiếp phải cùng Namespace.
- Có thể đặt `immutable: true`.

Secret không phải nơi lưu file artifact lớn. Nhiều Secret nhỏ cũng tạo tải lên API server, etcd và kubelet; có thể dùng quota `count/secrets`.

## 3. Các Secret type

Field `type` trả lời câu hỏi: **Secret này chứa loại credential nào và consumer nên mong đợi những key nào?** Hãy hình dung Secret như một phong bì:

```text
metadata.name    = tên để tìm phong bì
type             = nhãn bên ngoài, ví dụ "TLS certificate"
data/stringData  = nội dung thật bên trong
```

`type` chủ yếu tạo ra một **format contract** giữa người tạo Secret và thành phần đọc nó. Với một số built-in type, API server kiểm tra key hoặc định dạng tối thiểu. Controller cũng có thể chỉ chấp nhận đúng type mà nó hỗ trợ.

> [!IMPORTANT]
> `type` không làm dữ liệu được mã hóa mạnh hơn, không tự cấp quyền RBAC và không tự đưa Secret vào Pod. Sau khi tạo Secret, workload hoặc controller vẫn phải tham chiếu nó một cách tường minh.

Ví dụ, hai Secret sau đều có thể chứa username và password:

```yaml
# Secret riêng của application: key do đội phát triển tự quy ước
apiVersion: v1
kind: Secret
metadata:
  name: database-credentials
type: Opaque
stringData:
  db-user: app_user
  db-password: replace-me
---
# Secret theo convention Basic authentication
apiVersion: v1
kind: Secret
metadata:
  name: upstream-basic-auth
type: kubernetes.io/basic-auth
stringData:
  username: api_client
  password: replace-me
```

Điểm khác biệt không phải mức độ bảo mật. `Opaque` cho phép application tự đặt key `db-user` và `db-password`; `kubernetes.io/basic-auth` nói với người đọc và tooling rằng Secret tuân theo convention `username`/`password`.

### 3.1 Chọn type nào?

Dùng câu hỏi sau thay vì cố ghi nhớ toàn bộ danh sách:

1. **Một resource, controller hoặc công cụ có yêu cầu type cụ thể không?** Nếu có, dùng chính xác type và key mà tài liệu của consumer yêu cầu. Ví dụ, `imagePullSecrets` thường dùng `kubernetes.io/dockerconfigjson`.
2. **Dữ liệu có khớp một built-in convention không?** Dùng type tương ứng như `kubernetes.io/tls` để cấu trúc dễ nhận biết và được kiểm tra tối thiểu.
3. **Đây chỉ là credential riêng của application?** Dùng `Opaque`. Đây là lựa chọn mặc định và phổ biến nhất.
4. **Bạn đang xây controller riêng cần một public contract?** Có thể tạo custom type dạng có domain prefix, ví dụ `secrets.example.com/api-credentials`.

Bảng sau nhóm các type theo **thành phần sử dụng**, vì đó là khác biệt quan trọng nhất:

| Type | Ai thường sử dụng? | Key/format chính | Khi nào chọn? |
|---|---|---|---|
| `Opaque` | Application hoặc controller tùy chỉnh | Key do bạn tự định nghĩa | Credential thông thường không cần convention đặc biệt |
| `kubernetes.io/basic-auth` | Application/tooling dùng Basic authentication | `username`, `password` | Muốn công khai contract username/password |
| `kubernetes.io/ssh-auth` | Git client, deploy tool hoặc ứng dụng SSH | `ssh-privatekey` | Consumer cần SSH private key |
| `kubernetes.io/tls` | Ingress controller hoặc ứng dụng TLS | `tls.crt`, `tls.key` | Consumer yêu cầu certificate và private key theo convention TLS |
| `kubernetes.io/dockerconfigjson` | Kubelet khi pull private image | `.dockerconfigjson` chứa Docker config JSON | Pod cần `imagePullSecrets` cho private registry |
| `kubernetes.io/dockercfg` | Kubelet/tooling cũ | `.dockercfg` | Chỉ dùng khi phải tương thích định dạng Docker legacy |
| `kubernetes.io/service-account-token` | ServiceAccount token controller | Annotation ServiceAccount; controller điền `token` | Chỉ dùng cho long-lived token legacy khi TokenRequest không đáp ứng |
| `bootstrap.kubernetes.io/token` | Control plane và công cụ bootstrap Node | `token-id`, `token-secret` cùng các key bootstrap | Quy trình quản trị cluster, thường do `kubeadm` quản lý |

Có thể chia bảng thành ba nhóm để dễ nhớ:

```text
Credential của application
├── Opaque
├── basic-auth
├── ssh-auth
└── tls

Credential để Kubernetes thực hiện việc thay Pod
└── dockerconfigjson / dockercfg → kubelet pull image

Credential phục vụ chính Kubernetes
├── service-account-token → workload identity kiểu legacy
└── bootstrap token       → Node tham gia cluster
```

### 3.2 `Opaque`: lựa chọn mặc định cho application

`Opaque` phù hợp khi key-value là contract riêng giữa application và đội vận hành. Kubernetes không gán ý nghĩa cho tên key, không parse giá trị và không biết credential có đăng nhập được hay không.

Ví dụ một worker cần ba giá trị để kết nối message broker:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: broker-credentials
  namespace: production
type: Opaque
stringData:
  endpoint: amqps://broker.example.com:5671
  username: order_worker
  password: EXAMPLE_ONLY_REPLACE_SECURELY
```

Trong Secret này:

- `endpoint`, `username` và `password` do application định nghĩa.
- Kubernetes chỉ lưu và cung cấp ba byte string; nó không thử kết nối broker.
- Pod phải tham chiếu đúng tên Secret và đúng key. Nếu code mong đợi `BROKER_PASSWORD` nhưng manifest lại đọc key `pass`, contract bị lệch dù Secret vẫn tạo thành công.

Nếu bỏ field `type`, API server cũng xem Secret là `Opaque`. Lệnh `kubectl create secret generic` tạo cùng loại:

```bash
kubectl create secret generic broker-credentials \
  --from-file=username=./username.txt \
  --from-file=password=./password.txt \
  --dry-run=client -o yaml
```

Lệnh trên chỉ render manifest vì có `--dry-run=client`; YAML output vẫn chứa dữ liệu base64 có thể decode. Không lưu output vào Git hay log CI.

Chọn `Opaque` khi:

- Application tự quy định tên key.
- Không có controller hay API integration yêu cầu built-in type.
- Secret chứa nhiều field có quan hệ với nhau, ví dụ endpoint, client ID và client secret.

Không nên tạo một Secret `Opaque` rất lớn chứa credential của nhiều application. Pod được cấp Secret thường có thể đọc mọi key trong object đó, nên tách theo consumer và lifecycle rotation.

### 3.3 `kubernetes.io/basic-auth`: username và password theo convention

Type này biểu diễn credential cho Basic authentication hoặc một cơ chế có cùng cặp username/password:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: reports-api-basic-auth
  namespace: production
type: kubernetes.io/basic-auth
stringData:
  username: reports_client
  password: EXAMPLE_ONLY_REPLACE_SECURELY
```

Convention của consumer là:

```text
username → danh tính client
password → password hoặc token đi kèm
```

Secret không tự thêm HTTP header `Authorization`, không biết URL của server và không kiểm tra server có chấp nhận credential hay không. Application, sidecar hoặc controller đọc hai key rồi tự thực hiện authentication.

API validation cho type này khá nông: Secret bị từ chối nếu **cả hai** key `username` và `password` đều vắng mặt. Vì vậy, một object chỉ có một key vẫn có thể qua API validation nhưng thường không đủ cho consumer. Trong manifest thực tế, nên cung cấp cả hai và validate theo yêu cầu của application.

Dùng `kubernetes.io/basic-auth` thay vì `Opaque` khi tên key chuẩn giúp nhiều tool hoặc nhiều đội dùng chung contract. Nếu application yêu cầu key khác như `client_id`/`client_secret`, dùng `Opaque` sẽ rõ hơn là ép dữ liệu vào type này.

### 3.4 `kubernetes.io/ssh-auth`: private key để SSH client xác thực

Type này quy ước một key bắt buộc là `ssh-privatekey`:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: git-deploy-key
  namespace: production
type: kubernetes.io/ssh-auth
stringData:
  ssh-privatekey: |
    -----BEGIN OPENSSH PRIVATE KEY-----
    EXAMPLE_ONLY_REPLACE_WITH_REAL_KEY
    -----END OPENSSH PRIVATE KEY-----
```

Ví dụ chỉ minh họa cấu trúc, không phải private key hợp lệ. Khi tạo từ file thật, có thể render manifest bằng:

```bash
kubectl create secret generic git-deploy-key \
  --namespace=production \
  --type=kubernetes.io/ssh-auth \
  --from-file=ssh-privatekey=./id_ed25519 \
  --dry-run=client -o yaml
```

API server chỉ kiểm tra `ssh-privatekey` tồn tại và không rỗng; nó không xác minh nội dung có parse được, key có passphrase hay public key tương ứng có được cài trên server hay không. Consumer vẫn có thể lỗi sau khi Secret đã được tạo.

SSH còn có hai hướng xác thực độc lập:

```text
Client chứng minh danh tính với server → private key trong Secret
Client xác minh đúng server            → known_hosts từ nguồn tin cậy
```

Chỉ có private key chưa ngăn được man-in-the-middle. Cung cấp `known_hosts` qua ConfigMap, image hoặc cơ chế quản lý host key đáng tin cậy; không chạy `ssh-keyscan` rồi tin ngay kết quả trên cùng đường mạng đang cần bảo vệ.

Ngoài ra, kiểm tra file mode sau khi mount. OpenSSH thường từ chối private key mà user khác có thể đọc; section [5.3 Mount thành files](#53-mount-thành-files) trình bày `defaultMode` và runtime identity.

### 3.5 `kubernetes.io/tls`: certificate và private key theo cặp

TLS Secret có hai key chuẩn:

| Key | Nội dung | Có nhạy cảm không? |
|---|---|---|
| `tls.crt` | Certificate PEM, có thể kèm certificate chain | Thường là public, nhưng vẫn cần quản lý tính toàn vẹn |
| `tls.key` | Private key PEM tương ứng | Có; lộ key cho phép giả mạo endpoint trong phạm vi certificate |

Tạo Secret từ file PEM có sẵn:

```bash
kubectl create secret tls web-tls -n production \
  --cert=./tls.crt \
  --key=./tls.key \
  --dry-run=client -o yaml
```

Manifest sinh ra có dạng:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: web-tls
  namespace: production
type: kubernetes.io/tls
data:
  tls.crt: BASE64_CERTIFICATE
  tls.key: BASE64_PRIVATE_KEY
```

Khai báo type này **không tự bật HTTPS**. Một consumer phải tham chiếu Secret, ví dụ Ingress controller đọc `tls.crt`/`tls.key`, hoặc Pod mount hai key thành file:

```text
TLS Secret được tạo
        ↓
Ingress/Pod tham chiếu Secret
        ↓
consumer nạp certificate + private key
        ↓
consumer mở TLS listener
```

API server yêu cầu hai key tồn tại nhưng không thay thế quy trình certificate validation của consumer. Cần kiểm tra tối thiểu:

- Certificate và private key có khớp nhau không.
- Certificate có đúng SAN/hostname không.
- Issuer và certificate chain có được client tin cậy không.
- `notBefore`/`notAfter` có hợp lệ không.
- Application có reload sau rotation không.

Có thể xem metadata của **public certificate** mà không in private key:

```bash
kubectl get secret web-tls -n production \
  -o jsonpath='{.data.tls\.crt}' \
  | base64 --decode \
  | openssl x509 -noout -subject -issuer -dates -ext subjectAltName
```

Command này vẫn yêu cầu quyền đọc Secret. Không dùng nó trong CI log nếu certificate metadata cũng cần hạn chế. Với production, cert-manager hoặc certificate controller phù hợp hơn thao tác thủ công vì có thể cấp mới, theo dõi expiry và rotation.

### 3.6 `kubernetes.io/dockerconfigjson`: credential để kubelet pull image

Đây là type dễ nhầm nhất vì application container thường **không đọc Secret**. Consumer thực sự là kubelet trên Node:

```text
Pod.imagePullSecrets
        ↓
kubelet lấy Secret cùng Namespace
        ↓
đọc key .dockerconfigjson
        ↓
authenticate với registry và pull image
        ↓
container mới có thể start
```

Secret chứa một key tên chính xác là `.dockerconfigjson`; value sau khi decode có cấu trúc tương tự `$HOME/.docker/config.json`:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: registry-credentials
  namespace: production
type: kubernetes.io/dockerconfigjson
stringData:
  .dockerconfigjson: |
    {
      "auths": {
        "registry.example.com": {
          "username": "image-puller",
          "password": "EXAMPLE_ONLY_REPLACE_SECURELY"
        }
      }
    }
```

Ví dụ trên giải thích format; không commit credential thật. API server kiểm tra key `.dockerconfigjson` tồn tại và value parse được thành JSON, nhưng không đăng nhập thử registry, không xác minh hostname và không biết account có quyền pull repository mong muốn hay không.

Pod tham chiếu Secret ở cấp `spec`, không phải trong `containers[].env`:

```yaml
spec:
  imagePullSecrets:
    - name: registry-credentials
  containers:
    - name: api
      image: registry.example.com/team/api:1.0
```

Secret và Pod phải cùng Namespace. Nếu tên Secret sai, registry hostname không khớp, credential hết hạn hoặc account thiếu quyền, Pod thường vào `ErrImagePull` rồi `ImagePullBackOff`. Đọc Events thay vì in nội dung `.dockerconfigjson`:

```bash
kubectl describe pod POD_NAME -n production
kubectl get events -n production --sort-by=.metadata.creationTimestamp
```

`kubernetes.io/dockercfg` dùng key `.dockercfg` theo format Docker cũ. Không chọn type legacy này cho workload mới trừ khi tooling hiện có bắt buộc. Cách tạo và quản lý `imagePullSecrets` được mở rộng tại [phần 7.1](#71-private-registry).

### 3.7 `kubernetes.io/service-account-token`: long-lived token kiểu legacy

Type này không phải chỗ lưu API token tùy ý của application. Nó yêu cầu annotation trỏ tới một ServiceAccount; sau đó ServiceAccount token controller điền token vào Secret:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: legacy-client
  namespace: production
---
apiVersion: v1
kind: Secret
metadata:
  name: legacy-client-token
  namespace: production
  annotations:
    kubernetes.io/service-account.name: legacy-client
type: kubernetes.io/service-account-token
```

Lifecycle khác Secret thông thường:

```text
Tạo ServiceAccount
        ↓
Tạo Secret có annotation trỏ tới ServiceAccount
        ↓
controller xác minh ServiceAccount
        ↓
controller điền annotation UID, token và CA data
```

API server chỉ yêu cầu annotation `kubernetes.io/service-account.name`; token chưa cần tồn tại lúc tạo vì controller sẽ bổ sung sau. Nếu ServiceAccount sai tên hoặc controller không hoạt động, Secret có thể tồn tại nhưng không có token dùng được.

Đây là credential bearer dài hạn nằm trong API object, nên blast radius lớn hơn projected token có thời hạn ngắn. Với workload hiện đại, ưu tiên:

- `kubectl create token SERVICE_ACCOUNT_NAME` cho yêu cầu token tạm thời.
- TokenRequest API cho application/controller.
- Projected ServiceAccount token volume để token tự rotation và gắn `audience`.

Ví dụ yêu cầu token có thời hạn mong muốn 10 phút:

```bash
kubectl create token legacy-client -n production --duration=10m
```

Command in token ra terminal; không chạy trong shell được ghi log và không paste output vào ticket. API server có thể cấp thời hạn khác theo policy. Projected token được trình bày tại [phần 7.2](#72-serviceaccount-token).

### 3.8 `bootstrap.kubernetes.io/token`: đưa Node mới vào cluster

Bootstrap token dùng trong quy trình Node bootstrap, thường cùng `kubeadm`. Nó không phải token đăng nhập cho người dùng hay API key của application.

Một bootstrap token có dạng logic:

```text
abcdef.0123456789abcdef
└─id─┘ └────secret────┘
```

Secret tương ứng thường:

- Nằm trong Namespace `kube-system`.
- Có tên `bootstrap-token-<token-id>`.
- Chứa `token-id` và `token-secret`.
- Có thể chứa `expiration`, `usage-bootstrap-authentication`, `usage-bootstrap-signing` và `auth-extra-groups`.

Luồng sử dụng điển hình:

```text
Cluster admin tạo bootstrap token có TTL ngắn
        ↓
Node mới dùng token để bắt đầu xác thực
        ↓
Node xác minh cluster identity và gửi CSR
        ↓
CSR được approve theo policy
        ↓
Node nhận credential dài hạn riêng
        ↓
bootstrap token hết hạn hoặc bị thu hồi
```

Bootstrap token chỉ là credential khởi đầu; an toàn của quy trình còn phụ thuộc CA pinning/discovery, CSR approval và việc thu hồi token. Không đưa token vào image hoặc manifest dùng lại lâu dài. Ưu tiên để cluster lifecycle tooling tạo token với TTL và audit phù hợp thay vì tự author Secret.

### 3.9 Custom Secret type: contract cho controller riêng

Kubernetes cho phép đặt một string khác làm `type`. Nếu type được dùng như public contract, đặt domain prefix để tránh trùng tên:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: payment-provider-credentials
  namespace: production
type: secrets.example.com/payment-api
stringData:
  merchant-id: merchant-123
  api-key: EXAMPLE_ONLY_REPLACE_SECURELY
  signing-key-version: v3
```

API server không biết schema của custom type, nên controller sở hữu contract phải tự kiểm tra:

- Key bắt buộc và key không được phép.
- Encoding/format của từng value.
- Quan hệ giữa các field.
- Credential có thuộc đúng tenant/environment không.
- Cách báo lỗi mà không ghi Secret vào log hoặc Event.

Custom type hữu ích khi nhiều producer/consumer cần cùng schema. Nếu chỉ một Deployment đọc vài key nội bộ, `Opaque` thường đơn giản hơn và không tạo thêm public contract phải duy trì.

### 3.10 API server thực sự kiểm tra đến đâu?

Bảng này phân biệt **schema validation** với **credential validation**:

| Type | Kiểm tra type-specific khi tạo Secret | Điều Kubernetes không chứng minh |
|---|---|---|
| `Opaque` hoặc custom type | Không có built-in schema validation | Key có đúng với application; credential có hoạt động |
| `basic-auth` | Ít nhất một trong `username`/`password` hiện diện | Cặp credential đầy đủ hoặc đăng nhập thành công |
| `ssh-auth` | `ssh-privatekey` hiện diện và không rỗng | Private key parse được; server tin public key; host identity đúng |
| `tls` | `tls.crt` và `tls.key` hiện diện | Chain, SAN, expiry và mọi yêu cầu của consumer |
| `dockerconfigjson` | Có `.dockerconfigjson` và parse được JSON | Registry tồn tại; credential có quyền pull |
| `dockercfg` | Có `.dockercfg` và parse được JSON | Credential có hợp lệ hay không |
| `service-account-token` | Có annotation tên ServiceAccount | Controller đã phát token hoặc token có scope phù hợp |
| `bootstrap token` | Dựa chủ yếu vào convention của bootstrap consumer | Toàn bộ bootstrap/discovery/CSR flow an toàn |

Field `type` là immutable sau khi Secret được tạo. Nếu chọn sai type, tạo Secret mới với type đúng rồi cập nhật consumer; không thiết kế quy trình dựa trên việc patch `type` tại chỗ.

Kiểm tra type và danh sách key mà không in value:

```bash
kubectl get secret SECRET_NAME -n NAMESPACE \
  -o jsonpath='name={.metadata.name}{"\n"}type={.type}{"\n"}'
kubectl get secret SECRET_NAME -n NAMESPACE \
  -o go-template='{{range $key, $_ := .data}}{{$key}}{{"\n"}}{{end}}'
```

`kubectl describe secret` cũng chỉ hiện tên key và kích thước value, nhưng có thể hiện metadata/annotation khác; vẫn cần cân nhắc trước khi đưa output vào log.

Như vậy, trong phần lớn manifest ứng dụng, quyết định cuối cùng vẫn là:

```text
Không có consumer yêu cầu format riêng → Opaque
Consumer yêu cầu format cụ thể         → dùng đúng built-in/custom type đó
```

## 4. Tạo Secret an toàn

### 4.1 Tránh literal trên command line production

Lệnh sau tiện cho lab nhưng có thể đi vào shell history/process audit:

```bash
kubectl create secret generic app-secret \
  --from-literal=password='plaintext'
```

Tốt hơn là lấy từ file tạm có permission chặt, stdin/tooling phù hợp hoặc secret operator. Ví dụ local lab:

```bash
umask 077
printf %s 'lab-password' > password.txt
kubectl create secret generic app-secret \
  --from-file=password=./password.txt \
  --dry-run=client -o yaml
rm -f password.txt
```

Ngay cả YAML output cũng chứa base64 có thể decode; không commit output đó.

### 4.2 GitOps

Không commit plain Secret manifest. Các lựa chọn:

- SOPS encryption với KMS/age và decryption trong trusted controller/pipeline.
- Sealed Secrets: commit encrypted custom resource bound với cluster/key.
- External Secrets Operator: sync từ Vault/cloud secret manager.
- Secrets Store CSI Driver: mount từ external provider, tùy cấu hình có thể sync Kubernetes Secret.

Đánh giá blast radius của decryption key, audit log, rotation, disaster recovery và khả năng bootstrap.

## 5. Cung cấp Secret cho Pod

### 5.1 Chọn một key làm environment variable

```yaml
env:
  - name: DATABASE_PASSWORD
    valueFrom:
      secretKeyRef:
        name: database-credentials
        key: password
```

Ưu điểm là application đơn giản. Nhược điểm: không hot-update và environment dễ bị dump trong diagnostics.

### 5.2 Import toàn Secret

```yaml
envFrom:
  - secretRef:
      name: database-credentials
```

Chỉ dùng khi mọi key đều cần thiết và tên key là contract environment hợp lệ. Least privilege trong một Pod tốt hơn khi chọn từng key.

### 5.3 Mount thành files

```yaml
volumes:
  - name: credentials
    secret:
      secretName: database-credentials
      defaultMode: 0400
      items:
        - key: username
          path: username
        - key: password
          path: password
containers:
  - name: api
    image: example.com/api:1.0
    volumeMounts:
      - name: credentials
        mountPath: /var/run/secrets/app
        readOnly: true
```

Mỗi key trở thành file. Application đọc `/var/run/secrets/app/password`.

File mode được áp dụng trong volume nhưng runtime user/group và `fsGroup` cũng ảnh hưởng access. Test bằng cùng `runAsUser` production.

### 5.4 Chỉ expose cho container cần dùng

Volume được khai báo cấp Pod nhưng chỉ container có `volumeMount` mới thấy path đó:

```text
Pod
├── frontend: không mount signing-key
└── signer: mount signing-key read-only
```

Việc tách container giảm exposure nếu frontend bị path traversal/RCE, nhưng hai container vẫn chia sẻ network và một số Pod boundaries; cần hardening bổ sung.

### 5.5 Optional Secret

```yaml
secret:
  secretName: optional-overrides
  optional: true
```

Mặc định Secret là bắt buộc. Nếu object hoặc key bắt buộc thiếu, container không start và kubelet retry. Đây là fail-fast tốt cho credential quan trọng.

### 5.6 `subPath`

Secret volume update theo eventual consistency, nhưng mount qua `subPath` không nhận automated update. Với rotation động, mount cả directory.

## 6. Update và rotation

### 6.1 Behavior theo cách consume

| Cách consume | Secret đổi | Cần làm gì? |
|---|---|---|
| Environment | Process giữ giá trị cũ | Restart/rollout |
| Secret volume | File được cập nhật dần | Application phải reopen/reload |
| `subPath` | Không update tự động | Restart Pod |
| API client | Tùy code watch/cache | Implement reconnect và validation |

Projected volume có độ trễ kubelet sync + cache/watch propagation. Không dùng cho rotation cần atomic cutover giữa nhiều hệ thống mà không có protocol.

### 6.2 Rotation không chỉ là “đổi Secret”

Database password rotation an toàn thường là:

```mermaid
sequenceDiagram
    participant DB as Database
    participant SM as Secret manager
    participant K as Kubernetes
    participant A as Application
    DB->>DB: Tạo credential mới song song
    SM->>K: Publish version mới
    K->>A: Rollout/reload
    A->>DB: Xác minh dùng credential mới
    DB->>DB: Thu hồi credential cũ
```

Cần overlap window hoặc dual credentials. Nếu revoke cũ trước khi tất cả Pods reload, request sẽ lỗi. Theo dõi rollout, authentication failure và version adoption.

### 6.3 Immutable Secret

```yaml
immutable: true
```

Dùng tên có version/hash, tạo Secret mới rồi đổi Pod template. Lợi ích là tránh mutation ngoài ý muốn và giảm watch load. Không thể unset immutability; phải delete/recreate.

## 7. imagePullSecrets và ServiceAccount token

### 7.1 Private registry

```yaml
spec:
  imagePullSecrets:
    - name: registry-credentials
  containers:
    - name: api
      image: registry.example.com/team/api:1.0
```

Secret phải có type/format registry phù hợp và nằm cùng Namespace. Có thể gắn `imagePullSecrets` vào ServiceAccount để Pods dùng mặc định, nhưng điều này mở rộng phạm vi credential đến mọi Pod dùng ServiceAccount đó.

### 7.2 ServiceAccount token

Ưu tiên short-lived, rotating token qua TokenRequest/projected volume thay cho legacy long-lived `kubernetes.io/service-account-token` Secret.

```yaml
projected:
  sources:
    - serviceAccountToken:
        path: token
        audience: https://internal-api.example
        expirationSeconds: 3600
```

Giới hạn `audience`, thời hạn và RBAC. Nếu workload không gọi Kubernetes API, cân nhắc:

```yaml
automountServiceAccountToken: false
```

## 8. Bảo vệ Secret trong production

### 8.1 Encryption at rest

Bật API server encryption configuration cho Secrets và dùng KMS provider nếu phù hợp. Sau khi bật, dữ liệu cũ trong etcd không tự động được rewrite nếu không thực hiện migration/re-encryption. Bảo vệ cả etcd snapshots và backup keys.

### 8.2 RBAC least privilege

Phân biệt `get` và `list/watch`: list/watch có thể expose hàng loạt Secret. Tránh wildcard:

```yaml
apiGroups: [""]
resources: ["secrets"]
resourceNames: ["database-credentials"]
verbs: ["get"]
```

Lưu ý `resourceNames` có giới hạn theo verb/request pattern, và quyền tạo Pod vẫn có thể là quyền đọc Secret gián tiếp trong Namespace.

### 8.3 Namespace boundary

Namespace là boundary quản trị quan trọng nhưng không phải hard multi-tenant security boundary một mình. Kết hợp RBAC, admission policy, Pod Security, network policy, node isolation và runtime hardening.

### 8.4 Audit và log redaction

- Audit metadata về ai truy cập Secret, tránh log body chứa data.
- Không ghi Secret vào annotation, Event hoặc command arguments.
- Redact application log.
- Hạn chế `kubectl exec`, ephemeral container và debug access.
- Theo dõi access bất thường và rotation failures.

### 8.5 Backup và recovery

Encrypted backup vẫn cần quản lý key độc lập. Test restore Secret controller/external store, không chỉ restore etcd. Recovery runbook phải giải quyết bootstrap credentials.

## 9. External secret management

| Pattern | Secret có tồn tại trong Kubernetes API? | Điểm mạnh | Trade-off |
|---|---:|---|---|
| External Secrets sync | Có | App dùng native Secret | Bản sao nằm trong etcd |
| CSI mount trực tiếp | Có thể không | Giảm API exposure | App đọc file; phụ thuộc node/provider |
| App gọi Vault trực tiếp | Không cần | Dynamic credential mạnh | App phức tạp, cần auth/retry |
| Sidecar/agent | Có thể không | App ít phụ thuộc SDK | Thêm process/lifecycle |

Không có lựa chọn tốt tuyệt đối. Chọn theo latency, offline behavior, rotation, audit, multi-cluster DR và đội ngũ vận hành.

## 10. Thực hành

```bash
kubectl create namespace secret-lab
kubectl create secret generic demo-credentials -n secret-lab \
  --from-literal=username=demo \
  --from-literal=password='lab-only-password'
```

Tạo Pod đọc Secret qua env và file nhưng không in giá trị:

```bash
cat <<'EOF' > secret-demo.yaml
apiVersion: v1
kind: Pod
metadata:
  name: secret-demo
  namespace: secret-lab
spec:
  restartPolicy: Never
  automountServiceAccountToken: false
  containers:
    - name: demo
      image: busybox:1.36
      env:
        - name: PASSWORD
          valueFrom:
            secretKeyRef:
              name: demo-credentials
              key: password
      command: ["/bin/sh", "-c"]
      args:
        - |
          test -s /run/credentials/password
          test -n "$PASSWORD"
          echo "credential sources are present"
      volumeMounts:
        - name: credentials
          mountPath: /run/credentials
          readOnly: true
  volumes:
    - name: credentials
      secret:
        secretName: demo-credentials
        defaultMode: 0400
EOF
kubectl apply -f secret-demo.yaml
kubectl logs secret-demo -n secret-lab
kubectl get pod secret-demo -n secret-lab \
  -o jsonpath='{.status.containerStatuses[0].state.terminated.exitCode}{"\n"}'
```

Kiểm tra type và tên key mà không in data:

```bash
kubectl get secret demo-credentials -n secret-lab \
  -o jsonpath='name={.metadata.name}{"\n"}type={.type}{"\n"}'
kubectl get secret demo-credentials -n secret-lab \
  -o go-template='{{range $key, $_ := .data}}{{$key}}{{"\n"}}{{end}}'
```

Cleanup:

```bash
kubectl delete namespace secret-lab
rm -f secret-demo.yaml
```

## 11. Troubleshooting và incident response

### 11.1 `CreateContainerConfigError`

```bash
kubectl describe pod POD_NAME -n NAMESPACE
kubectl get events -n NAMESPACE --sort-by=.metadata.creationTimestamp
```

Tìm Secret/key thiếu, sai Namespace hoặc type/format không đúng.

### 11.2 `ImagePullBackOff`

Kiểm tra `imagePullSecrets`, registry hostname, credential expiry và quyền repository. Không paste `.dockerconfigjson` vào ticket/log.

### 11.3 File permission denied

Kiểm tra `defaultMode`, `runAsUser`, `runAsGroup`, `fsGroup`, mount path và policy. JSON biểu diễn file mode bằng decimal; YAML octal như `0400` rõ hơn.

### 11.4 Đã rotate nhưng application vẫn auth lỗi

Xác định:

- Pod đang dùng env hay volume.
- Pod creation/restart time.
- Secret `resourceVersion` và version label.
- Application có reopen file/connection pool không.
- Credential cũ đã bị revoke quá sớm không.

### 11.5 Nghi Secret bị lộ

Không chỉ xóa Kubernetes Secret. Runbook:

1. Khoanh vùng credential và hệ thống chấp nhận nó.
2. Tạo/rotate credential mới.
3. Rollout consumers và xác minh adoption.
4. Revoke credential cũ tại source system.
5. Thu thập audit evidence, xác định đường lộ.
6. Xóa khỏi Git history/log/artifact nếu có và rotate key liên quan.
7. Sửa RBAC/pipeline/policy để ngăn tái diễn.

## 12. Best practices

- Bật encryption at rest và bảo vệ etcd backup/KMS keys.
- Áp dụng RBAC least privilege; coi quyền tạo Pod là quyền nhạy cảm.
- Không commit plain/base64 Secret vào Git.
- Không truyền Secret trong command arguments hoặc log.
- Chỉ mount key vào container cần dùng; đặt read-only và file mode phù hợp.
- Dùng short-lived credentials và ServiceAccount projected token.
- Version hóa rotation, hỗ trợ overlap và revoke credential cũ sau xác minh.
- Dùng immutable Secret khi release model phù hợp.
- Đặt quota số lượng Secret để bảo vệ control plane.
- Test rotation và disaster recovery định kỳ.

Tiếp tục với [Resource Requests và Limits](/cau-hinh/resource-requests-limits/) để kiểm soát capacity và isolation của workload.

---

## Tài liệu tham khảo

- [Secrets](https://kubernetes.io/docs/concepts/configuration/secret/)
- [Good practices for Kubernetes Secrets](https://kubernetes.io/docs/concepts/security/secrets-good-practices/)
- [Encrypting Confidential Data at Rest](https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/)
- [Service Accounts](https://kubernetes.io/docs/concepts/security/service-accounts/)
