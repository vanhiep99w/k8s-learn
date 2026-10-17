---
title: "Service"
description: "Giải thích Kubernetes Service từ mental model đến request flow: selector, ClusterIP, DNS, port mapping, EndpointSlice, readiness, load balancing, thực hành và troubleshooting từng lớp."
---

# Service

## Mục lục

- [Bạn sẽ hiểu gì sau bài này?](#bạn-sẽ-hiểu-gì-sau-bài-này)
- [Vấn đề Service giải quyết](#vấn-đề-service-giải-quyết)
- [Mental model: một địa chỉ ổn định đứng trước nhiều Pod](#mental-model-một-địa-chỉ-ổn-định-đứng-trước-nhiều-pod)
- [Ví dụ đầu tiên: Deployment và Service](#ví-dụ-đầu-tiên-deployment-và-service)
- [Đọc manifest Service từng phần](#đọc-manifest-service-từng-phần)
- [Request đi qua Service như thế nào?](#request-đi-qua-service-như-thế-nào)
- [Phân biệt port, targetPort và containerPort](#phân-biệt-port-targetport-và-containerport)
- [Selector và EndpointSlice](#selector-và-endpointslice)
- [Readiness quyết định Pod có nhận traffic hay không](#readiness-quyết-định-pod-có-nhận-traffic-hay-không)
- [Service discovery bằng DNS](#service-discovery-bằng-dns)
- [ClusterIP là virtual IP, không phải một server](#clusterip-là-virtual-ip-không-phải-một-server)
- [Service phân phối traffic ở mức connection](#service-phân-phối-traffic-ở-mức-connection)
- [Các kiểu Service và hai biến thể quan trọng](#các-kiểu-service-và-hai-biến-thể-quan-trọng)
- [Các tùy chọn nâng cao](#các-tùy-chọn-nâng-cao)
- [Thực hành end-to-end](#thực-hành-end-to-end)
- [Troubleshooting theo từng lớp](#troubleshooting-theo-từng-lớp)
- [Thiết kế Service cho production](#thiết-kế-service-cho-production)
- [Tóm tắt mental model](#tóm-tắt-mental-model)
- [Tài liệu tham khảo](#tài-liệu-tham-khảo)

---

## Bạn sẽ hiểu gì sau bài này?

Sau bài này, bạn có thể:

- Giải thích vì sao không nên để application gọi trực tiếp Pod IP.
- Đọc được quan hệ giữa `selector`, `port`, `targetPort`, Pod label và container port.
- Mô tả đường đi từ Service DNS đến một Pod backend.
- Kiểm tra Service có chọn đúng Pod và có endpoint sẵn sàng hay chưa.
- Phân biệt lỗi DNS, lỗi Service, lỗi selector, lỗi port và lỗi application.
- Biết khi nào dùng Service thông thường, headless Service hoặc Service không có selector.

Bài này tập trung vào cơ chế cốt lõi của Service. Các cách expose ra ngoài cluster như `NodePort` và `LoadBalancer` được giới thiệu ngắn, sau đó trình bày chi tiết trong [ClusterIP, NodePort và LoadBalancer](/networking/service-types/).

## Vấn đề Service giải quyết

Một Pod có IP riêng, nhưng Pod không phải một server tồn tại vĩnh viễn. Deployment có thể xóa và tạo Pod mới khi:

- Bạn rollout phiên bản application mới.
- Pod bị lỗi và controller tạo Pod thay thế.
- Bạn tăng hoặc giảm số replica.
- Node gặp sự cố và Pod được tạo lại ở Node khác.

Mỗi Pod mới có thể nhận một IP mới. Ví dụ, backend `api` thay đổi như sau:

```text
10:00  api-7f6d9-abcde   10.244.1.10   Ready
10:05  rollout tạo Pod mới
10:06  api-84c78-fghij   10.244.2.21   Ready
10:07  Pod 10.244.1.10 bị xóa
```

Nếu frontend hard-code `10.244.1.10`, frontend sẽ mất kết nối sau rollout. Frontend cũng không nên tự theo dõi mọi Pod được tạo hoặc bị xóa.

Service giải quyết vấn đề này bằng cách cung cấp **một địa chỉ ổn định** cho một **tập backend có thể thay đổi**:

```text
Frontend chỉ biết: api.production.svc.cluster.local:80

Kubernetes có thể thay backend ở phía sau:
- 10.244.1.10:8080
- 10.244.2.21:8080
- 10.244.3.15:8080
```

Điểm cần nhớ là client phụ thuộc vào contract ổn định của Service, không phụ thuộc vào tên hoặc IP của từng Pod.

## Mental model: một địa chỉ ổn định đứng trước nhiều Pod

Hãy hình dung Service là một **điểm truy cập logic** có bốn phần:

1. **Tên ổn định**: DNS name, ví dụ `api.production.svc.cluster.local`.
2. **Địa chỉ ổn định**: thường là ClusterIP, ví dụ `10.96.30.40`.
3. **Danh sách backend động**: các endpoint như `10.244.1.10:8080`.
4. **Quy tắc chọn backend**: data plane trên Node chuyển connection tới một endpoint phù hợp.

```d2 title="Mental model: một địa chỉ ổn định đứng trước nhiều Pod"
direction: right
C: "Client Pod"
DNS: "CoreDNS"
VIP: "Service ClusterIP 10.96.30.40:80"
P1: "Pod A 10.244.1.10:8080"
P2: "Pod B 10.244.2.21:8080"
P3: "Pod C 10.244.3.15:8080"
C -> DNS: "api.production:80"
DNS -> VIP: "10.96.30.40"
VIP -> P1: "chọn một endpoint"
VIP -> P2: "chọn một endpoint"
VIP -> P3: "chọn một endpoint"
```

Sơ đồ có thể khiến Service trông giống một proxy server riêng, nhưng đó không phải cách triển khai thông thường. Service là API object lưu **ý định**. kube-proxy hoặc một data plane thay thế, chẳng hạn implementation dựa trên eBPF, watch Service và EndpointSlice rồi program rule trên các Node.

### Service làm gì?

- Cung cấp tên và địa chỉ ổn định cho client.
- Xác định tập Pod backend thông qua label selector.
- Cho phép ánh xạ Service port sang backend port.
- Giúp data plane phân phối connection mới tới các endpoint sẵn sàng.
- Tách lifecycle của client khỏi lifecycle của Pod backend.

### Service không làm gì?

- Không tạo hoặc scale Pod; Deployment, StatefulSet hay controller khác làm việc đó.
- Không đảm bảo application trong Pod đang listen đúng port.
- Không tự gửi HTTP health check; Service dựa vào Pod readiness và EndpointSlice.
- Không route theo URL path, HTTP host hoặc header.
- Không tự terminate TLS, retry request hay cung cấp circuit breaker.
- Không thay thế NetworkPolicy, authentication hoặc authorization.

Muốn routing HTTP theo host/path hoặc quản lý TLS ở entry point, dùng [Gateway API](/networking/gateway-api/) hoặc [Ingress](/networking/ingress/).

## Ví dụ đầu tiên: Deployment và Service

Ví dụ dưới đây chạy ba Pod NGINX và đặt một Service tên `web` ở phía trước. Cả hai resource nằm trong Namespace `service-demo`.

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: service-demo
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: service-demo
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: nginx
          image: nginx:1.27-alpine
          ports:
            - name: http
              containerPort: 80
          readinessProbe:
            httpGet:
              path: /
              port: http
            initialDelaySeconds: 2
            periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: web
  namespace: service-demo
spec:
  type: ClusterIP
  selector:
    app: web
  ports:
    - name: http
      protocol: TCP
      port: 80
      targetPort: http
```

Quan hệ quan trọng nhất trong manifest là:

```d2 title="Ví dụ đầu tiên: Deployment và Service"
direction: right
selector: "Service selector\napp=web"
pod: "Pod label\napp=web"
port: "Pod port\nhttp = 80"
selector -> pod: match
pod -> port: endpoint port lấy từ named port http
```

Deployment và Service không được nối với nhau bằng tên `web`. Chúng tình cờ có cùng tên để dễ đọc, nhưng Service thực sự tìm Pod bằng label. Nếu Service tên `frontend-entry` vẫn có selector `app: web`, nó vẫn chọn cùng tập Pod.

## Đọc manifest Service từng phần

Phần Service của ví dụ:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: web
  namespace: service-demo
spec:
  type: ClusterIP
  selector:
    app: web
  ports:
    - name: http
      protocol: TCP
      port: 80
      targetPort: http
```

### `metadata.name` và `metadata.namespace`

Hai field này tạo danh tính của Service. Service trên có tên đầy đủ trong DNS mặc định là:

```text
web.service-demo.svc.cluster.local
```

Service chỉ chọn Pod trong **cùng Namespace**. Selector của `service-demo/web` không thể trực tiếp chọn Pod ở Namespace khác.

### `spec.type`

`ClusterIP` là type mặc định. Nếu bỏ `type`, Kubernetes vẫn tạo ClusterIP Service. Type này phù hợp cho traffic nội bộ cluster và làm backend cho Gateway hoặc Ingress.

### `spec.selector`

Selector là map label. Tất cả cặp key-value phải match Pod:

```yaml
selector:
  app: web
  track: stable
```

Selector trên chỉ chọn Pod có **cả** `app=web` và `track=stable`. Service không quan tâm Pod do Deployment nào tạo. Một debug Pod vô tình mang đủ label cũng có thể trở thành backend.

### `spec.ports[].port`

Đây là port mà client gọi trên Service. Với `port: 80`, client gọi:

```text
web.service-demo.svc.cluster.local:80
```

### `spec.ports[].targetPort`

Đây là port đích trên endpoint. Nó có thể là số, ví dụ `8080`, hoặc tên, ví dụ `http`.

Dùng named port thường dễ bảo trì hơn. Service giữ `targetPort: http`, còn phiên bản Pod mới có thể đổi số port phía sau miễn vẫn đặt tên port là `http`.

### `spec.ports[].name`

Tên port giúp nhận diện port và là bắt buộc khi một Service khai báo nhiều port. Tên phải duy nhất trong Service.

Ví dụ Service có port application và metrics:

```yaml
ports:
  - name: http
    port: 80
    targetPort: http
  - name: metrics
    port: 9090
    targetPort: metrics
```

### `spec.ports[].protocol`

`TCP` là mặc định. Kubernetes Service cũng hỗ trợ `UDP`; `SCTP` phụ thuộc vào support của cluster và network implementation. `protocol` của Service phải phù hợp với protocol mà application thực sự dùng.

## Request đi qua Service như thế nào?

Giả sử client ở Namespace `frontend` chạy:

```bash
curl http://web.service-demo/
```

Đường đi logic gồm các bước sau:

```d2 title="Request đi qua Service như thế nào?"
shape: sequence_diagram
C: "Client Pod"
D: "CoreDNS"
V: "Service VIP"
P: "Service data plane"
B: "Backend Pod"
C -> D: "Resolve web.service-demo"
D -> C: "10.96.30.40" {style.stroke-dash: 4}
C -> V: "TCP connection tới 10.96.30.40:80"
P -> P: "Chọn ready endpoint"
P -> B: "Chuyển đích tới 10.244.2.21:80"
B -> C: "Trả response qua network path" {style.stroke-dash: 4}
```

Cách đọc flow này:

1. **DNS lookup**: CoreDNS trả ClusterIP của Service, ví dụ `10.96.30.40`.
2. **Client mở connection**: packet có destination `10.96.30.40:80`.
3. **Service data plane bắt packet**: kube-proxy hoặc implementation thay thế đã program rule cho ClusterIP này.
4. **Data plane chọn endpoint**: ví dụ `10.244.2.21:80` từ EndpointSlice.
5. **Packet được chuyển tiếp**: destination được rewrite hoặc xử lý theo data plane của cluster.
6. **Application trả response**: client tiếp tục nhìn thấy mình đang giao tiếp với Service, không cần biết Pod cụ thể.

Đây là flow logic chung. Chi tiết packet processing có thể dùng `iptables`, `nftables`, Windows kernelspace hoặc eBPF tùy cluster. Vì vậy không nên mặc định mọi cluster đều có cùng loại rule.

## Phân biệt port, targetPort và containerPort

Đây là phần dễ nhầm nhất khi học Service.

Giả sử application listen cổng `8080` trong Pod nhưng client muốn gọi cổng `80`:

```yaml
# Service
ports:
  - name: http
    port: 80
    targetPort: http

# Pod container
ports:
  - name: http
    containerPort: 8080
```

Đường đi là:

```d2 title="Phân biệt port, targetPort và containerPort"
direction: right
client: Client
vip: gọi ServiceIP:80
endpoint: Service chọn PodIP:8080
process: process phải listen :8080
client -> vip: port
vip -> endpoint: targetPort resolve từ tên http
endpoint -> process: behavior thật của application
```

| Khái niệm | Thuộc object | Ý nghĩa |
|---|---|---|
| `port` | Service | Port ổn định mà client dùng |
| `targetPort` | Service | Port trên endpoint mà traffic được chuyển tới |
| `containerPort` | Pod container | Metadata mô tả port của container; cũng có thể đặt tên để `targetPort` tham chiếu |
| Port process listen | Application | Port thực tế mà process bind; đây mới là điều quyết định connection có được nhận hay không |

> [!IMPORTANT]
> Khai báo `containerPort: 8080` không làm application tự mở cổng `8080`. Process bên trong container vẫn phải bind và listen cổng đó.

Nếu không khai báo `targetPort`, Kubernetes dùng cùng giá trị với `port`. Ví dụ `port: 80` không có `targetPort` nghĩa là chuyển tới port `80` trên backend.

### Ví dụ lỗi port thường gặp

Manifest có:

```yaml
ports:
  - port: 80
    targetPort: 8080
```

nhưng NGINX vẫn listen cổng `80`. Service có thể có endpoint đúng, DNS cũng resolve đúng, nhưng request tới Pod port `8080` sẽ bị `connection refused` hoặc timeout tùy network path.

Cách kiểm tra là gọi trực tiếp cả port đúng và port nghi ngờ từ một debug Pod:

```bash
kubectl get pod -n service-demo -l app=web -o wide
kubectl exec -n service-demo client -- curl -v http://POD_IP:80/
kubectl exec -n service-demo client -- curl -v http://POD_IP:8080/
```

Thay `POD_IP` bằng IP thật lấy từ lệnh đầu tiên.

## Selector và EndpointSlice

Selector mô tả **Pod nào đủ điều kiện làm backend**. Data plane lại cần danh sách cụ thể dạng `IP:port`. Kubernetes lưu danh sách đó bằng EndpointSlice.

```d2 title="Selector và EndpointSlice"
direction: right
S: "Service selector app=web"
C: "EndpointSlice controller"
P: "Pod labels, IP, readiness"
E: "EndpointSlice"
A: "10.244.1.10:80 ready"
B: "10.244.2.21:80 ready"
D: "10.244.3.15:80 not ready"
K: "kube-proxy hoặc data plane khác"
S -> C
P -> C
C -> E
E -> A
E -> B
E -> D
E -> K
```

Khi Service có selector, control plane liên tục reconcile EndpointSlice:

1. Tìm Pod trong cùng Namespace có label match selector.
2. Đọc Pod IP và port tương ứng với `targetPort`.
3. Đọc readiness và trạng thái termination.
4. Tạo hoặc cập nhật EndpointSlice.
5. Các consumer như kube-proxy watch EndpointSlice và cập nhật data plane.

Kiểm tra ba lớp liên quan:

```bash
# Service đang dùng selector và port nào?
kubectl get service web -n service-demo -o yaml

# Pod nào match selector, IP và readiness ra sao?
kubectl get pod -n service-demo -l app=web -o wide --show-labels

# Endpoint cụ thể được publish là gì?
kubectl get endpointslice -n service-demo \
  -l kubernetes.io/service-name=web -o yaml
```

Label `kubernetes.io/service-name=web` liên kết EndpointSlice với Service `web`.

### Selector match tất cả label

Với selector:

```yaml
selector:
  app.kubernetes.io/name: api
  app.kubernetes.io/instance: production
```

Pod chỉ có label đầu tiên sẽ không được chọn. Một lỗi chính tả như `app.kuberentes.io/name` vẫn có thể làm Service được tạo thành công, nhưng EndpointSlice sẽ không có backend mong muốn.

### Đổi selector có thể chuyển traffic ngay

Sửa selector trên Service đang chạy có thể thay toàn bộ tập backend sau khi controller và data plane hội tụ. Không dùng việc edit selector tùy hứng như một cơ chế rollout production. Deployment rollout, Service riêng cho canary hoặc công cụ traffic management phù hợp sẽ dễ kiểm soát và rollback hơn.

### Service không có endpoint vẫn có thể có DNS

Đối với Service thông thường, DNS record trỏ đến ClusterIP vẫn có thể tồn tại dù Service chưa có endpoint sẵn sàng. Vì vậy:

```text
DNS resolve thành công
≠ Service có backend
≠ application đang hoạt động
```

Nếu DNS trả IP nhưng connection thất bại, bước tiếp theo là kiểm tra EndpointSlice, không phải tiếp tục sửa DNS ngay.

## Readiness quyết định Pod có nhận traffic hay không

Pod có phase `Running` chưa chắc đã sẵn sàng phục vụ request. `Running` chỉ cho biết container đã được khởi động ở mức lifecycle; application có thể vẫn đang load cache, chạy migration cục bộ hoặc chưa kết nối được dependency bắt buộc.

Readiness probe cung cấp tín hiệu để Kubernetes biết Pod có nên nhận traffic mới từ Service hay không:

```yaml
readinessProbe:
  httpGet:
    path: /ready
    port: http
  initialDelaySeconds: 3
  periodSeconds: 5
```

Flow bình thường:

```d2 title="Readiness quyết định Pod có nhận traffic hay không"
direction: down
n1: "Pod được tạo"
n2: "Container chạy nhưng readiness chưa pass"
n3: "Endpoint chưa ready, Service không gửi\ntraffic thông thường"
n4: "Readiness pass"
n5: "Endpoint ready, Pod bắt đầu nhận\nconnection mới"
n1 -> n2
n2 -> n3
n3 -> n4
n4 -> n5
```

Khi readiness fail trong lúc Pod đang chạy, endpoint thường chuyển sang `ready: false`. Process không nhất thiết bị restart; liveness probe mới liên quan đến quyết định restart container.

EndpointSlice có ba condition quan trọng:

| Condition | Ý nghĩa thực tế |
|---|---|
| `serving` | Endpoint hiện có khả năng phục vụ |
| `terminating` | Pod đã bắt đầu quá trình termination |
| `ready` | Thông thường tương đương `serving` và không `terminating` |

### Điều gì xảy ra khi rollout?

Trong rolling update:

1. Pod mới được tạo nhưng chưa nhận traffic cho tới khi ready.
2. Khi Pod mới ready, EndpointSlice thêm hoặc đánh dấu endpoint mới sẵn sàng.
3. Pod cũ bắt đầu termination và không còn là lựa chọn bình thường cho connection mới.
4. Data plane trên các Node cần thời gian ngắn để nhận update và hội tụ.
5. Connection đã tồn tại không nhất thiết bị Service chuyển sang Pod khác.

Để shutdown êm, application cần phối hợp readiness, signal handling, `preStop` khi cần và `terminationGracePeriodSeconds`. Service chỉ loại endpoint cho connection mới; nó không tự drain logic ở tầng application.

### `publishNotReadyAddresses`

Một số hệ phân tán cần discover peer trước khi các peer chuyển sang Ready:

```yaml
spec:
  publishNotReadyAddresses: true
```

Field này làm endpoint chưa ready vẫn được publish cho discovery. Nó phù hợp với một số StatefulSet hoặc peer bootstrap protocol, nhưng không nên bật cho web application chỉ để che readiness probe bị lỗi. Khi bật, client phải tự xử lý endpoint chưa phục vụ được.

## Service discovery bằng DNS

Trong cluster có CoreDNS, Service `web` ở Namespace `service-demo` có tên đầy đủ:

```text
web.service-demo.svc.cluster.local
```

`cluster.local` là cluster domain phổ biến, nhưng cluster admin có thể cấu hình giá trị khác.

Cách gọi phụ thuộc Namespace của client:

| Vị trí client | Tên có thể dùng | Diễn giải |
|---|---|---|
| Cùng Namespace `service-demo` | `web` | DNS search path tự bổ sung phần còn lại |
| Namespace khác | `web.service-demo` | Chỉ rõ Service và Namespace |
| Muốn dùng FQDN | `web.service-demo.svc.cluster.local` | Tên đầy đủ với cluster domain mặc định |

Ví dụ:

```bash
# Client cùng Namespace
curl http://web/

# Client ở Namespace khác
curl http://web.service-demo/
```

Dùng DNS name thay vì hard-code ClusterIP. DNS name biểu đạt dependency rõ hơn và cho phép platform thay đổi IP khi Service được tạo lại theo quy trình phù hợp.

### Kiểm tra DNS từ bên trong Pod

```bash
kubectl exec -n service-demo client -- nslookup web
kubectl exec -n service-demo client -- nslookup web.service-demo.svc.cluster.local
```

Nếu image không có `nslookup`, có thể kiểm tra bằng `getent hosts`, `dig` hoặc tạo debug Pod có tool phù hợp.

### Service environment variables

Kubelet cũng có thể inject biến như `WEB_SERVICE_HOST` và `WEB_SERVICE_PORT` vào Pod được tạo **sau khi** Service tồn tại. Cơ chế này có các hạn chế:

- Có dependency theo thứ tự tạo resource.
- Biến không tự cập nhật trong Pod đang chạy.
- Nhiều Service có thể làm environment lớn và khó kiểm tra.

DNS là cơ chế discovery mặc định nên ưu tiên. Có thể đặt `spec.enableServiceLinks: false` trên Pod nếu application không dùng legacy Service environment variables. Xem thêm [Environment Variables](/cau-hinh/environment-variables/#6-service-environment-variables-tự-động).

## ClusterIP là virtual IP, không phải một server

Service `type: ClusterIP` được cấp một IP từ Service CIDR:

```bash
kubectl get service web -n service-demo \
  -o jsonpath='{.spec.clusterIP}{":"}{.spec.ports[0].port}{"\n"}'
```

Ví dụ output minh họa:

```text
10.96.30.40:80
```

IP này thường không được bind như một địa chỉ host thông thường trên network interface. kube-proxy hoặc data plane thay thế cấu hình packet-processing rule để bắt traffic tới `ClusterIP:port`.

```text
Packet ban đầu:
  destination = 10.96.30.40:80

Sau khi Service data plane chọn endpoint:
  destination = 10.244.2.21:80
```

Hai hệ quả quan trọng:

- `ping 10.96.30.40` thất bại không chứng minh Service hỏng. Service định nghĩa TCP, UDP hoặc SCTP port; ICMP echo không phải bài test phù hợp.
- Không tìm thấy ClusterIP bằng `ip addr` trên Node cũng không chứng minh Service hỏng.

Hãy test đúng protocol và port từ một Pod:

```bash
kubectl exec -n service-demo client -- curl -v http://10.96.30.40:80/
```

Thay IP bằng ClusterIP thực tế của Service.

## Service phân phối traffic ở mức connection

Một hiểu lầm phổ biến là ba Pod thì ba HTTP request liên tiếp chắc chắn đi lần lượt qua ba Pod. Service data plane thường chọn backend theo **connection hoặc flow**, không theo từng HTTP request.

Ví dụ:

```d2 title="Service phân phối traffic ở mức connection"
direction: right
connection: "Một TCP connection\nHTTP keep-alive" {
  r1: HTTP request 1
  r2: HTTP request 2
  r3: HTTP request 3
  r100: HTTP request 100
}
pod: cùng một Pod
connection -> pod: Có thể dùng lại connection
```

Điều này đặc biệt rõ với:

- HTTP keep-alive.
- HTTP/2 multiplexing.
- gRPC connection tồn tại lâu.
- Database connection pool có ít connection.
- WebSocket.

Vì vậy, traffic không chia đều theo số request chưa chắc là lỗi Service. Hãy kiểm tra số connection, connection lifetime và behavior của client trước.

Service cũng không đảm bảo mọi endpoint nhận tải bằng nhau trong mọi thời điểm. Thuật toán và behavior chi tiết phụ thuộc service proxy, session affinity, traffic policy, topology và connection pattern.

## Các kiểu Service và hai biến thể quan trọng

### Bốn Service type

| Type | Client thường truy cập từ đâu? | Điểm truy cập chính |
|---|---|---|
| `ClusterIP` | Bên trong cluster | DNS hoặc virtual IP nội bộ |
| `NodePort` | Ngoài cluster có route tới Node | `NodeIP:nodePort` |
| `LoadBalancer` | VPC hoặc Internet, tùy cấu hình | Địa chỉ do load balancer implementation cấp |
| `ExternalName` | Bên trong cluster qua DNS | CNAME tới hostname bên ngoài |

Bài [ClusterIP, NodePort và LoadBalancer](/networking/service-types/) giải thích packet flow, source IP, cloud/bare-metal trade-off và cách chọn type.

### Headless Service

Headless Service đặt:

```yaml
spec:
  clusterIP: None
```

Ví dụ:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: database
  namespace: production
spec:
  clusterIP: None
  selector:
    app: database
  ports:
    - name: postgres
      port: 5432
      targetPort: postgres
```

Headless Service không có Service VIP và không dùng platform proxy để load-balance qua ClusterIP. DNS trả trực tiếp địa chỉ endpoint. Client phải tự chọn địa chỉ và xử lý endpoint thay đổi.

Use case phù hợp:

- StatefulSet cần stable network identity cho từng replica.
- Database driver tự thực hiện discovery hoặc load balancing.
- Peer-to-peer protocol cần thấy từng thành viên.

Với StatefulSet, bạn có thể gặp DNS name dạng:

```text
db-0.database.production.svc.cluster.local
```

Không dùng headless Service như mặc định cho stateless web application nếu client chỉ cần một địa chỉ cân bằng tải đơn giản.

### Service không có selector

Service không có selector dùng để đặt một Service name ổn định trước backend do bạn hoặc controller khác quản lý, kể cả backend ngoài cluster.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: legacy-api
  namespace: production
spec:
  ports:
    - name: https
      port: 443
      targetPort: 8443
```

Vì Service không có selector, Kubernetes không tự tạo EndpointSlice. Bạn phải cung cấp EndpointSlice:

```yaml
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: legacy-api-1
  namespace: production
  labels:
    kubernetes.io/service-name: legacy-api
    endpointslice.kubernetes.io/managed-by: platform.example/manual
addressType: IPv4
ports:
  - name: https
    protocol: TCP
    port: 8443
endpoints:
  - addresses: ["192.0.2.10"]
    conditions:
      ready: true
  - addresses: ["192.0.2.11"]
    conditions:
      ready: true
```

Bạn chịu trách nhiệm health check, cập nhật readiness và xóa endpoint cũ. Kubernetes không tự probe các IP khai báo thủ công.

> [!WARNING]
> Không dùng legacy `Endpoints` cho thiết kế mới. API `Endpoints` đã deprecated từ Kubernetes v1.33; hãy dùng EndpointSlice.

Một giới hạn bảo mật quan trọng: `kubectl port-forward service/...` không forward qua API server tới endpoint không map với Pod. Điều này ngăn API server trở thành proxy tới địa chỉ mà người dùng có thể không được phép truy cập.

Xem [Endpoints và EndpointSlices](/networking/endpoints-endpointslices/) để hiểu đầy đủ ownership, endpoint conditions, scale và selectorless Service.

## Các tùy chọn nâng cao

Bạn không cần các field trong phần này để hiểu Service cơ bản. Chỉ thêm chúng khi có yêu cầu cụ thể và đã kiểm tra support của Kubernetes version cùng data plane đang dùng.

### Session affinity

Mặc định `sessionAffinity` là `None`. Có thể yêu cầu affinity theo source IP:

```yaml
spec:
  sessionAffinity: ClientIP
  sessionAffinityConfig:
    clientIP:
      timeoutSeconds: 10800
```

`ClientIP` cố gắng đưa connection mới từ cùng source IP tới cùng endpoint trong khoảng timeout. Nó không phải sticky session theo user hoặc cookie:

- Nhiều user sau NAT có thể cùng source IP.
- Proxy hoặc service mesh có thể làm source IP trở thành IP của proxy.
- Endpoint bị xóa vẫn làm affinity mất hiệu lực.
- Session lưu trong memory của một Pod vẫn có nguy cơ mất khi Pod restart.

Ưu tiên application stateless hoặc shared session store nếu có thể.

### Internal traffic policy

```yaml
spec:
  internalTrafficPolicy: Local
```

- `Cluster`: internal traffic có thể tới ready endpoint trên toàn cluster.
- `Local`: chỉ dùng ready endpoint trên cùng Node với client; nếu Node không có local endpoint, traffic bị drop.

`Local` có thể giảm cross-node hop nhưng dễ tạo black hole hoặc load imbalance. Chỉ dùng khi workload được phân bố đủ đều và bạn hiểu behavior khi Node không có endpoint.

### External traffic policy

```yaml
spec:
  externalTrafficPolicy: Local
```

Field này áp dụng cho external traffic của NodePort/LoadBalancer:

- `Cluster`: có thể forward sang endpoint trên Node khác; source IP có thể thay đổi tùy implementation.
- `Local`: chỉ chọn local endpoint, thường giúp giữ client source IP và giảm hop, nhưng phụ thuộc load balancer health check cùng việc phân bố Pod.

Chi tiết được trình bày trong [ClusterIP, NodePort và LoadBalancer](/networking/service-types/).

### Traffic distribution

`trafficDistribution` biểu đạt **ưu tiên**, không phải ràng buộc chặt như traffic policy. Trên Kubernetes version hỗ trợ, có thể ưu tiên endpoint cùng zone hoặc cùng Node:

```yaml
spec:
  trafficDistribution: PreferSameZone
```

Locality có thể giảm latency và cross-zone cost, nhưng endpoint trong một zone có thể quá tải nếu Pod hoặc traffic phân bố không đều. Kết hợp với topology spread, autoscaling và quan sát tải thật. Các giá trị được hỗ trợ phụ thuộc Kubernetes version cùng service proxy; hãy kiểm tra tài liệu của version cluster trước khi áp dụng.

### Dual-stack

Service trong cluster dual-stack có thể có cả IPv4 và IPv6:

```yaml
spec:
  ipFamilyPolicy: PreferDualStack
  ipFamilies:
    - IPv4
    - IPv6
```

Kiểm tra:

```bash
kubectl get service web -n service-demo \
  -o jsonpath='{.spec.clusterIPs}{"\n"}{.spec.ipFamilies}{"\n"}'
```

Dual-stack chỉ hoạt động end-to-end khi client, CoreDNS, CNI, Service data plane, NetworkPolicy và backend đều hỗ trợ address family tương ứng.

## Thực hành end-to-end

Lab này tạo ba backend, một ClusterIP Service và một client Pod. Bạn sẽ kiểm tra DNS, endpoint, Service VIP rồi cố ý làm selector sai để quan sát failure mode.

### Bước 1: tạo manifest

Lưu nội dung sau vào `service-lab.yaml`:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: service-lab
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: echo
  namespace: service-lab
spec:
  replicas: 3
  selector:
    matchLabels:
      app: echo
  template:
    metadata:
      labels:
        app: echo
    spec:
      containers:
        - name: echo
          image: registry.k8s.io/e2e-test-images/agnhost:2.53
          args:
            - netexec
            - --http-port=8080
          ports:
            - name: http
              containerPort: 8080
          readinessProbe:
            httpGet:
              path: /readyz
              port: http
            periodSeconds: 3
---
apiVersion: v1
kind: Service
metadata:
  name: echo
  namespace: service-lab
spec:
  selector:
    app: echo
  ports:
    - name: http
      port: 80
      targetPort: http
---
apiVersion: v1
kind: Pod
metadata:
  name: client
  namespace: service-lab
spec:
  containers:
    - name: client
      image: curlimages/curl:8.12.1
      command: ["sleep", "3600"]
```

Nếu môi trường không kéo được các image trên, thay bằng image tương đương mà registry policy của cluster cho phép.

### Bước 2: apply và đợi resource sẵn sàng

```bash
kubectl apply -f service-lab.yaml
kubectl rollout status deployment/echo -n service-lab --timeout=120s
kubectl wait pod/client -n service-lab \
  --for=condition=Ready --timeout=120s
```

Nếu command timeout, chưa tiếp tục test Service. Kiểm tra Pod và Events trước:

```bash
kubectl get pod -n service-lab -o wide
kubectl get events -n service-lab --sort-by=.lastTimestamp
```

### Bước 3: kiểm tra chuỗi ánh xạ

```bash
kubectl get service echo -n service-lab -o wide
kubectl get pod -n service-lab -l app=echo -o wide --show-labels
kubectl get endpointslice -n service-lab \
  -l kubernetes.io/service-name=echo -o wide
```

Bạn cần thấy:

- Service có một `CLUSTER-IP` và port `80/TCP`.
- Ba Pod backend có label `app=echo`, có Pod IP và trạng thái Ready.
- EndpointSlice chứa địa chỉ backend cùng port `8080`.

Số EndpointSlice có thể khác nhau tùy trạng thái và implementation; điều quan trọng là các endpoint mong muốn xuất hiện với condition phù hợp.

### Bước 4: kiểm tra DNS và gọi Service

Image client có `curl` nhưng không nhất thiết có `nslookup`. Dùng verbose output của `curl` để kiểm tra cả bước resolve tên và kết nối:

```bash
kubectl exec -n service-lab client -- curl -v http://echo/hostname
```

Trong output, tìm dòng cho biết hostname `echo` đã được resolve thành ClusterIP, tiếp theo là kết nối tới port `80`. Response body trả hostname của một backend Pod. Chi tiết câu chữ trong verbose output có thể khác theo phiên bản `curl`.

Gọi nhiều lần bằng connection riêng:

```bash
kubectl exec -n service-lab client -- sh -c '
  for i in 1 2 3 4 5 6; do
    curl -sS http://echo/hostname
    echo
  done
'
```

Bạn có thể thấy nhiều hostname, nhưng không có bảo đảm sáu lần gọi sẽ chia đều tuyệt đối cho ba Pod.

### Bước 5: gọi trực tiếp ClusterIP

Lấy ClusterIP:

```bash
kubectl get service echo -n service-lab \
  -o jsonpath='{.spec.clusterIP}{"\n"}'
```

Sau đó thay `SERVICE_IP` trong lệnh:

```bash
kubectl exec -n service-lab client -- \
  curl -sS http://SERVICE_IP:80/hostname
```

Nếu DNS name lỗi nhưng ClusterIP hoạt động, tập trung điều tra DNS. Nếu cả hai lỗi, kiểm tra endpoint, port và data plane.

### Bước 6: làm selector sai có chủ đích

```bash
kubectl patch service echo -n service-lab --type=merge \
  -p '{"spec":{"selector":{"app":"does-not-exist"}}}'
```

Quan sát:

```bash
kubectl get endpointslice -n service-lab \
  -l kubernetes.io/service-name=echo -w
```

Ở terminal khác, thử:

```bash
kubectl exec -n service-lab client -- \
  curl --connect-timeout 3 -v http://echo/hostname
```

Verbose output vẫn cho thấy tên `echo` resolve được trước khi bước kết nối thất bại.

Kết quả cần hiểu:

- DNS vẫn có thể resolve vì Service vẫn tồn tại.
- Service không còn backend vì không Pod nào match selector.
- Request mới thất bại dù ba Pod vẫn Running và Ready.

Khôi phục selector:

```bash
kubectl patch service echo -n service-lab --type=merge \
  -p '{"spec":{"selector":{"app":"echo"}}}'
```

Đợi endpoint xuất hiện lại rồi test:

```bash
kubectl get endpointslice -n service-lab \
  -l kubernetes.io/service-name=echo
kubectl exec -n service-lab client -- curl -sS http://echo/hostname
```

### Bước 7: cleanup

```bash
kubectl delete namespace service-lab
```

Xóa Namespace sẽ xóa toàn bộ resource trong lab. Kiểm tra đúng context trước khi chạy lệnh cleanup.

## Troubleshooting theo từng lớp

Đừng bắt đầu bằng cách restart ngẫu nhiên CoreDNS, kube-proxy hoặc application. Hãy xác định request hỏng ở lớp nào theo thứ tự:

```d2 title="Troubleshooting theo từng lớp"
direction: down
n1: "Tên Service"
n2: "DNS"
n3: "Service object và port"
n4: "Selector"
n5: "EndpointSlice và readiness"
n6: "Pod IP và targetPort"
n7: "Process trong container"
n8: "Service data plane / CNI / NetworkPolicy"
n1 -> n2
n2 -> n3
n3 -> n4
n4 -> n5
n5 -> n6
n6 -> n7
n7 -> n8
```

### Bộ lệnh thu thập ban đầu

Thay `NS`, `SERVICE` và label selector bằng giá trị thực:

```bash
kubectl get service SERVICE -n NS -o yaml
kubectl describe service SERVICE -n NS
kubectl get pod -n NS -o wide --show-labels
kubectl get endpointslice -n NS \
  -l kubernetes.io/service-name=SERVICE -o yaml
kubectl get events -n NS --sort-by=.lastTimestamp
```

Sau đó chạy test từ **chính môi trường client bị lỗi** nếu có thể. Test từ laptop không thay thế test từ Pod vì route, DNS và NetworkPolicy khác nhau.

### Trường hợp 1: tên ngắn không resolve

Triệu chứng:

```text
Could not resolve host
```

Kiểm tra client và Service có cùng Namespace không:

```bash
kubectl get pod client -n CLIENT_NS \
  -o jsonpath='{.metadata.namespace}{"\n"}'
kubectl get service SERVICE -n SERVICE_NS
```

Nếu khác Namespace, dùng:

```text
SERVICE.SERVICE_NS
```

Sau đó kiểm tra DNS config trong Pod:

```bash
kubectl exec -n CLIENT_NS client -- cat /etc/resolv.conf
kubectl exec -n CLIENT_NS client -- nslookup kubernetes.default
kubectl exec -n CLIENT_NS client -- nslookup SERVICE.SERVICE_NS
```

Nếu `kubernetes.default` cũng không resolve, điều tra CoreDNS, kube-dns Service và NetworkPolicy egress TCP/UDP port 53 trong [DNS và CoreDNS](/networking/dns-coredns/).

### Trường hợp 2: DNS resolve nhưng Service không có endpoint

Dấu hiệu:

- `nslookup` trả ClusterIP.
- EndpointSlice rỗng hoặc không có endpoint ready.
- Request timeout hoặc thất bại ngay.

So sánh selector với label:

```bash
kubectl get service SERVICE -n NS \
  -o jsonpath='{.spec.selector}{"\n"}'
kubectl get pod -n NS --show-labels
```

Kiểm tra thêm:

- Pod có nằm cùng Namespace với Service không?
- Tất cả selector label có match không?
- Pod đã Ready chưa?
- Named `targetPort` có tồn tại trong Pod spec không?
- Pod có đang terminate không?

### Trường hợp 3: Endpoint có nhưng gọi Pod IP thất bại

Lấy IP backend:

```bash
kubectl get pod -n NS -l app=YOUR_LABEL -o wide
```

Từ client Pod, gọi đúng port đích:

```bash
kubectl exec -n CLIENT_NS client -- \
  curl --connect-timeout 3 -v http://POD_IP:TARGET_PORT/
```

Nếu gọi Pod IP thất bại, Service VIP chưa phải nghi phạm chính. Kiểm tra:

- Application có listen `0.0.0.0` hoặc Pod IP, thay vì chỉ `127.0.0.1`, hay không.
- Process listen đúng `targetPort` không.
- Pod log có lỗi startup không.
- NetworkPolicy có chặn client-to-Pod không.
- Pod-to-Pod networking có hoạt động cross-node không.

Nếu image có tool:

```bash
kubectl exec -n NS POD_NAME -- ss -lntp
```

Nếu không có `ss`, dùng application log, health endpoint hoặc ephemeral debug container phù hợp với policy của cluster.

### Trường hợp 4: Pod IP hoạt động nhưng ClusterIP không hoạt động

Nếu cùng client gọi `PodIP:targetPort` được nhưng `ClusterIP:port` không được, tập trung vào lớp Service data plane:

- Service `port`, `targetPort` và `protocol` có đúng không?
- EndpointSlice có endpoint vừa test không?
- kube-proxy hoặc service proxy replacement có healthy trên Node của client không?
- Rule đã sync chưa?
- Cluster có mixed IPv4/IPv6 hoặc address-family mismatch không?

Không mặc định cluster dùng iptables. Trước tiên xác định data plane:

```bash
kubectl get daemonset -n kube-system
kubectl get pod -n kube-system -o wide
```

Sau đó dùng runbook của distribution hoặc CNI. Xem [kube-proxy](/networking/kube-proxy/) để chẩn đoán đúng proxy mode.

### Trường hợp 5: chỉ một phần request lỗi

Nếu một số request thành công và một số thất bại:

1. Liệt kê từng endpoint trong EndpointSlice.
2. Gọi trực tiếp từng `PodIP:targetPort` từ cùng client.
3. Nhóm Pod lỗi theo Node, zone, version và readiness.
4. So sánh log và config của Pod tốt với Pod lỗi.

Một Pod có readiness probe quá nông có thể Ready nhưng vẫn không xử lý được request thật. Ví dụ `/ready` luôn trả `200` trong khi dependency bắt buộc đã mất kết nối.

### Trường hợp 6: traffic không chia đều

Kiểm tra:

- Client có dùng HTTP keep-alive, HTTP/2, gRPC hay WebSocket không?
- Connection pool có quá ít connection không?
- Service có `sessionAffinity: ClientIP` không?
- `internalTrafficPolicy` hoặc `externalTrafficPolicy` có là `Local` không?
- `trafficDistribution` có ưu tiên locality không?
- Nhiều client có cùng source IP sau NAT hoặc proxy không?

Đo phân phối theo connection và tải thực tế, không chỉ dựa vào vài HTTP request liên tiếp.

### Bảng chẩn đoán nhanh

| Quan sát | Nghi phạm ưu tiên |
|---|---|
| DNS không resolve | Tên/Namespace, CoreDNS, Pod DNS config, NetworkPolicy port 53 |
| DNS resolve, EndpointSlice rỗng | Selector, Namespace, readiness, named targetPort |
| Endpoint có, Pod IP lỗi | Application listen port, NetworkPolicy, Pod networking |
| Pod IP được, ClusterIP lỗi | Service port/protocol, kube-proxy hoặc replacement |
| Chỉ một endpoint lỗi | Pod/Node/version cụ thể, readiness quá nông |
| Sau rollout còn connection tới Pod cũ | Long-lived connection, termination và data-plane convergence |
| Request không chia đều | Connection reuse, affinity, locality, traffic policy |

Runbook tổng hợp nhiều lớp nằm tại [Network Troubleshooting](/networking/network-troubleshooting/).

## Thiết kế Service cho production

### Dùng selector thể hiện ownership rõ

Tránh selector quá rộng như:

```yaml
selector:
  app: api
```

nếu Namespace còn có canary, migration job hoặc debug Pod cùng label. Có thể dùng tập label rõ hơn:

```yaml
selector:
  app.kubernetes.io/name: api
  app.kubernetes.io/instance: production
  app.kubernetes.io/component: backend
```

Mục tiêu không phải thêm thật nhiều label, mà là ngăn Pod ngoài ý muốn trở thành backend.

### Giữ contract phía client ổn định

Các thành phần client phụ thuộc nên được quản lý như public contract nội bộ:

- Service name và Namespace.
- Service port và protocol.
- Port name nếu Gateway, monitor hoặc policy tham chiếu.
- TLS expectation và application protocol.

Named `targetPort` cho phép backend đổi số port mà không buộc client đổi Service port.

### Thiết kế readiness theo khả năng nhận traffic

Readiness cần trả lời câu hỏi: “Pod này có nhận connection mới và xử lý request hữu ích ngay bây giờ không?”. Probe quá nông đưa backend hỏng vào Service; probe quá nhạy làm endpoint flapping và gây churn cho control plane lẫn data plane.

Không đưa mọi dependency phụ vào readiness. Nếu một dependency không bắt buộc cho request chính, loại Pod khỏi Service có thể làm sự cố nhỏ thành outage toàn bộ.

### Không nhầm địa chỉ ổn định với high availability

Service có VIP ổn định nhưng không tự tạo HA. Service vẫn mất khả năng phục vụ nếu:

- Chỉ có một Pod và Pod đó lỗi.
- Mọi replica nằm trên cùng Node hoặc zone gặp sự cố.
- Readiness của tất cả Pod fail.
- Service selector không còn match Pod.
- CNI hoặc Service data plane lỗi diện rộng.

Availability cần kết hợp replica, topology spread hoặc anti-affinity, readiness phù hợp, PodDisruptionBudget khi cần và capacity đủ cho rollout/failure.

### Tách Service theo audience và policy

Không nhất thiết gộp mọi port vào một Service. Nếu security boundary khác nhau, có thể tách:

```text
api-public    → backend cho Gateway
api-internal  → client nội bộ
api-metrics   → monitoring system
api-admin     → đường quản trị hạn chế
```

Việc tách giúp NetworkPolicy, exposure, TLS và ownership rõ hơn. Đổi lại, số resource và contract cần quản lý tăng lên.

### Không hard-code Pod IP hoặc ClusterIP

- Pod IP thay đổi theo lifecycle.
- ClusterIP ổn định khi Service còn tồn tại, nhưng có thể đổi nếu Service bị xóa và tạo lại.
- DNS name là contract dễ đọc và dễ quản lý hơn.

Nếu external system thật sự cần IP cố định, thiết kế allocation và lifecycle riêng; không chọn ClusterIP thủ công chỉ vì tiện ngắn hạn.

### Quan sát cả control plane và data plane

Theo dõi ít nhất:

- Số ready endpoint của Service.
- Readiness flapping.
- Service proxy sync error và sync latency.
- Connection error, timeout và latency phía client.
- Tải theo Pod, Node và zone.
- DNS error rate nếu application phụ thuộc mạnh vào discovery.

Service object tồn tại không chứng minh request end-to-end hoạt động. Monitoring cần test đúng đường đi mà client thật sử dụng.

## Tóm tắt mental model

Giữ chuỗi sau trong đầu khi đọc hoặc debug Service:

```d2 title="Tóm tắt mental model"
direction: down
n1: "Client gọi DNS name"
n2: "DNS trả ClusterIP của Service"
n3: "Client kết nối Service port"
n4: "Service data plane đọc tập backend từ\nEndpointSlice"
n5: "Chọn một endpoint ready"
n6: "Chuyển traffic tới Pod IP và targetPort"
n7: "Process trong Pod phải thật sự listen và\nxử lý request"
n1 -> n2
n2 -> n3
n3 -> n4
n4 -> n5
n5 -> n6
n6 -> n7
```

Năm câu hỏi thường tìm ra phần lớn lỗi Service:

1. Client có dùng đúng Service name và Namespace không?
2. Service selector có match đúng Pod không?
3. EndpointSlice có endpoint ready không?
4. `port` và `targetPort` có đúng với process đang listen không?
5. Gọi Pod IP trực tiếp được nhưng ClusterIP không được, hay cả hai đều lỗi?

Tiếp tục với [ClusterIP, NodePort và LoadBalancer](/networking/service-types/) để chọn cách expose Service, rồi đọc [Endpoints và EndpointSlices](/networking/endpoints-endpointslices/) để hiểu sâu nguồn dữ liệu backend.

---

## Tài liệu tham khảo

- [Service](https://kubernetes.io/docs/concepts/services-networking/service/)
- [Virtual IPs and Service Proxies](https://kubernetes.io/docs/reference/networking/virtual-ips/)
- [EndpointSlices](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/)
- [DNS for Services and Pods](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/)
