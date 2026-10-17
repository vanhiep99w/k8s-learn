---
title: "DaemonSet"
description: "Hiểu Kubernetes DaemonSet từ mental model một Pod trên mỗi Node: cách chọn Node, xử lý taint, rollout, tài nguyên, quyền truy cập host và troubleshooting."
---

# DaemonSet

## Mục lục

- [DaemonSet là gì?](#daemonset-là-gì)
- [DaemonSet khác Deployment như thế nào?](#daemonset-khác-deployment-như-thế-nào)
- [DaemonSet hoạt động ra sao?](#daemonset-hoạt-động-ra-sao)
- [Tạo DaemonSet đầu tiên](#tạo-daemonset-đầu-tiên)
- [Đọc manifest DaemonSet](#đọc-manifest-daemonset)
- [Theo dõi trạng thái](#theo-dõi-trạng-thái)
- [Điều gì xảy ra khi Node hoặc Pod thay đổi?](#điều-gì-xảy-ra-khi-node-hoặc-pod-thay-đổi)
- [Chọn những Node được chạy Pod](#chọn-những-node-được-chạy-pod)
- [Hiểu taint và toleration](#hiểu-taint-và-toleration)
- [Cập nhật và rollback DaemonSet](#cập-nhật-và-rollback-daemonset)
- [Tài nguyên được nhân theo số Node](#tài-nguyên-được-nhân-theo-số-node)
- [Quyền truy cập host và rủi ro bảo mật](#quyền-truy-cập-host-và-rủi-ro-bảo-mật)
- [DaemonSet trong quá trình bảo trì Node](#daemonset-trong-quá-trình-bảo-trì-node)
- [Thực hành hoàn chỉnh](#thực-hành-hoàn-chỉnh)
- [Troubleshooting](#troubleshooting)
- [Best practices](#best-practices)
- [Tóm tắt](#tóm-tắt)
- [Tài liệu tham khảo](#tài-liệu-tham-khảo)

---

## DaemonSet là gì?

`DaemonSet` là Kubernetes controller dùng để chạy **một Pod trên mỗi Node phù hợp**.

Giả sử cluster có ba Node:

```d2 title="DaemonSet là gì?"
direction: right
n1: "Cluster"
n2: "node-a"
n3: "node-agent-abc"
n4: "node-b"
n5: "node-agent-def"
n6: "node-c"
n7: "node-agent-ghi"
n2 -> n3
n1 -> n2
n4 -> n5
n1 -> n4
n6 -> n7
n1 -> n6
```

Mỗi Node có một Pod của DaemonSet. Nếu thêm `node-d`, DaemonSet tự tạo thêm một Pod cho Node mới:

```d2 title="DaemonSet là gì?"
direction: right
n1: "Cluster sau khi thêm Node"
n2: "node-a"
n3: "node-agent-abc"
n4: "node-b"
n5: "node-agent-def"
n6: "node-c"
n7: "node-agent-ghi"
n8: "node-d"
n9: "node-agent-jkl   ← tự được tạo"
n2 -> n3
n1 -> n2
n4 -> n5
n1 -> n4
n6 -> n7
n1 -> n6
n8 -> n9
n1 -> n8
```

DaemonSet phù hợp với chương trình cần hiện diện ở cấp Node, ví dụ:

- log collector đọc log container trên từng Node;
- monitoring agent thu thập CPU, memory, disk và network của từng Node;
- CNI node agent cấu hình networking cho Node;
- CSI node plugin gắn và mount volume trên Node;
- security agent quan sát process hoặc runtime của Node;
- agent quản lý GPU, thiết bị hoặc phần cứng đặc biệt;
- cache hoặc image-preparation agent cần chạy gần workload trên Node.

Điểm quan trọng nhất cần nhớ:

> **DaemonSet không quản lý một số lượng replica cố định. Số Pod của nó phụ thuộc vào số Node đủ điều kiện.**

Bạn không cấu hình:

```yaml
spec:
  replicas: 3
```

Thay vào đó, DaemonSet tự tính:

```text
Số Pod mong muốn = số Node phù hợp với điều kiện của Pod template
```

Nếu cluster tăng từ 10 lên 20 Node phù hợp, DaemonSet cũng tăng từ khoảng 10 lên 20 Pod. CPU, memory và chi phí của agent tăng theo.

## DaemonSet khác Deployment như thế nào?

Cả `Deployment` và `DaemonSet` đều quản lý Pod chạy lâu dài. Khác biệt nằm ở câu hỏi mà mỗi controller trả lời.

```text
Deployment hỏi:
"Toàn cluster cần bao nhiêu replica?"

DaemonSet hỏi:
"Node nào cần có một Pod của agent này?"
```

| Câu hỏi | Deployment | DaemonSet |
|---|---|---|
| Mục tiêu | Chạy tổng cộng một số replica | Chạy một Pod trên mỗi Node phù hợp |
| Cấu hình số Pod | `spec.replicas` | Phụ thuộc số Node phù hợp |
| Pod cần gắn với Node cụ thể? | Thường không | Có, mỗi Pod phục vụ một Node |
| Khi thêm Node | Không tự tăng nếu chưa scale replicas | Tự tạo Pod cho Node mới phù hợp |
| Khi xóa một Pod | Tạo replica thay thế ở Node bất kỳ phù hợp | Tạo Pod thay thế hướng tới chính Node đang thiếu |
| Ví dụ | Web, API, worker stateless | Log agent, node exporter, CSI node plugin |

Ví dụ lựa chọn:

- Cần ba replica API, replica nào cũng thay thế được nhau: dùng `Deployment`.
- Cần đọc file `/var/log/...` trên từng Node: dùng `DaemonSet`.
- Cần tổng cộng mười worker, không quan trọng worker nằm ở Node nào: dùng `Deployment`.
- Cần một worker trên mỗi Node có GPU: dùng `DaemonSet` kết hợp node label.
- Cần task chạy xong rồi dừng: dùng [Job](/workloads/job/), không dùng DaemonSet.

Có thể chọn nhanh:

```d2 title="DaemonSet khác Deployment như thế nào?"
direction: right
n1: "Process chạy liên tục?"
n2: "Không"
n3: "Job hoặc CronJob"
n4: "Có"
n5: "Cần tổng cộng N replica"
n6: "Deployment"
n7: "Cần hiện diện trên từng Node phù hợp"
n8: "DaemonSet"
n2 -> n3
n1 -> n2
n1 -> n4
n5 -> n6
n4 -> n5
n7 -> n8
n4 -> n7
```

## DaemonSet hoạt động ra sao?

DaemonSet controller liên tục so sánh desired state với trạng thái thật trong cluster.

```d2 title="DaemonSet hoạt động ra sao?"
direction: down
A: "DaemonSet spec"
B: "DaemonSet controller đọc danh sách\nNode"
C: "Node có phù hợp?" {shape: diamond}
D: "Không cần Pod trên Node"
E: "Node đã có Pod của DaemonSet?" {shape: diamond}
F: "Giữ và theo dõi Pod"
G: "Tạo Pod hướng tới Node"
H: "Scheduler kiểm tra và bind Pod"
I: "Kubelet chạy container trên Node"
A -> B
B -> C
C -> D: "Không"
C -> E: "Có"
E -> F: "Có"
E -> G: "Chưa"
G -> H
H -> I
F -> B
I -> B
```

Luồng đơn giản khi cluster có Node mới:

```text
1. node-d tham gia cluster.
2. DaemonSet controller kiểm tra node-d có match nodeSelector/affinity không.
3. Nếu phù hợp, controller tạo một Pod hướng tới node-d.
4. Scheduler kiểm tra taint, resource, port, volume và các ràng buộc khác.
5. Nếu mọi điều kiện hợp lệ, Scheduler bind Pod vào node-d.
6. Kubelet trên node-d pull image và chạy container.
7. DaemonSet cập nhật status.
```

Hai bước dễ bị nhầm:

1. **DaemonSet xác định Node nào cần Pod.**
2. **Scheduler xác định Pod có thực sự chạy được trên Node đó không.**

Vì vậy, DaemonSet có thể muốn một Pod trên `node-d`, nhưng Pod vẫn `Pending` do Node thiếu CPU, có taint không được tolerate hoặc không mount được volume.

### Controller nào xử lý trường hợp nào?

```d2 title="Controller nào xử lý trường hợp nào?"
direction: right
n1: "Container trong Pod bị lỗi"
n2: "kubelet restart container trong cùng Pod"
n3: "vì restartPolicy của DaemonSet là Always"
n4: "Cả Pod bị xóa hoặc hỏng"
n5: "DaemonSet controller tạo Pod thay thế\ncho Node đó"
n6: "Node mới xuất hiện"
n7: "DaemonSet controller tạo Pod cho Node\nnếu Node phù hợp"
n8: "Node bị xóa khỏi cluster"
n9: "Pod phụ thuộc trên Node được garbage\ncollect"
n1 -> n2
n4 -> n5
n6 -> n7
n8 -> n9
```

DaemonSet không tự thêm leader election, replication dữ liệu hoặc failover logic cho chương trình bên trong. Nó chỉ đảm bảo placement và lifecycle của Pod.

## Tạo DaemonSet đầu tiên

Ví dụ đầu tiên chạy một agent đơn giản trên mỗi Node. Agent in tên Node và tên Pod mỗi 30 giây. Nó không dùng `hostPath`, `hostNetwork` hoặc quyền đặc biệt nên phù hợp hơn cho lab.

### Điều kiện trước khi bắt đầu

Bạn cần:

- một Kubernetes cluster đang hoạt động;
- `kubectl` đã kết nối tới cluster;
- quyền tạo Namespace và DaemonSet.

Kiểm tra context và danh sách Node:

```bash
kubectl config current-context
kubectl get nodes -o wide
```

> [!WARNING]
> Các lệnh trong bài tạo và xóa Namespace. Không chạy trên cluster dùng chung hoặc production nếu chưa kiểm tra đúng context.

### Tạo manifest

Lưu nội dung sau vào file `daemonset.yaml`:

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: node-agent
  namespace: daemon-lab
spec:
  selector:
    matchLabels:
      app: node-agent
  template:
    metadata:
      labels:
        app: node-agent
    spec:
      tolerations:
        - key: node-role.kubernetes.io/control-plane
          operator: Exists
          effect: NoSchedule
      containers:
        - name: agent
          image: busybox:1.36
          command:
            - sh
            - -c
            - |
              while true; do
                echo "version=$AGENT_VERSION node=$NODE_NAME pod=$HOSTNAME time=$(date -Iseconds)"
                sleep 30
              done
          env:
            - name: AGENT_VERSION
              value: "v1"
            - name: NODE_NAME
              valueFrom:
                fieldRef:
                  fieldPath: spec.nodeName
          resources:
            requests:
              cpu: 10m
              memory: 16Mi
            limits:
              memory: 32Mi
```

Toleration `control-plane` giúp lab có thể chạy trên cluster một Node mà Node đó mang taint control plane. Trong production, chỉ giữ toleration này nếu agent thật sự cần chạy trên control-plane Node.

Tạo Namespace, kiểm tra manifest ở API Server rồi apply:

```bash
kubectl create namespace daemon-lab
kubectl apply --dry-run=server -f daemonset.yaml
kubectl apply -f daemonset.yaml
```

Kết quả:

```text
daemonset.apps/node-agent created
```

Đây mới là xác nhận DaemonSet object đã được tạo. Phần tiếp theo sẽ kiểm tra có đủ Pod trên các Node hay chưa.

## Đọc manifest DaemonSet

Manifest có ba lớp chính:

```d2 title="Đọc manifest DaemonSet"
direction: right
n1: "DaemonSet metadata"
n2: "DaemonSet spec"
n3: "selector              # Pod nào thuộc\nDaemonSet?"
n4: "template              # Pod mới được tạo\nnhư thế nào?"
n5: "labels"
n6: "Pod spec"
n7: "containers"
n8: "tolerations"
n9: "resources"
n1 -> n2
n2 -> n3
n2 -> n4
n4 -> n5
n4 -> n6
n6 -> n7
n6 -> n8
n6 -> n9
```

### `apiVersion`, `kind` và `metadata`

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: node-agent
  namespace: daemon-lab
```

- `apps/v1` là API ổn định của DaemonSet.
- `kind: DaemonSet` xác định loại resource.
- `metadata.name` là tên DaemonSet.
- `metadata.namespace` là Namespace chứa DaemonSet và Pod của nó.

### `selector` phải khớp với label của Pod template

```yaml
spec:
  selector:
    matchLabels:
      app: node-agent
  template:
    metadata:
      labels:
        app: node-agent
```

Hai giá trị `app: node-agent` phải khớp nhau.

Có thể hiểu:

```text
selector: "Pod nào là Pod của tôi?"
template labels: "Pod mới sẽ mang nhãn nào?"
```

Nếu selector và template labels không khớp, API Server từ chối manifest.

`spec.selector` của DaemonSet không thể sửa sau khi object được tạo. Chọn selector cụ thể, ổn định và tránh trùng với workload khác. Nếu cần đổi selector, thường phải tạo DaemonSet mới và lập kế hoạch migration.

### `template` là mẫu Pod

```yaml
spec:
  template:
    metadata:
      labels:
        app: node-agent
    spec:
      containers:
        - name: agent
          image: busybox:1.36
```

DaemonSet không chứa sẵn các Pod đang chạy. `spec.template` là mẫu để controller tạo một Pod cho từng Node phù hợp.

Nội dung bên trong gần giống Pod manifest thông thường, nhưng không có `apiVersion`, `kind` và `metadata.name` riêng. Kubernetes tự đặt tên Pod, ví dụ:

```text
node-agent-k2c7n
```

### DaemonSet dùng `restartPolicy: Always`

Pod của DaemonSet phải dùng:

```yaml
restartPolicy: Always
```

hoặc bỏ field này vì mặc định của Pod là `Always`.

Điều này hợp lý vì agent của DaemonSet thường phải chạy liên tục. Nếu container exit, kubelet restart nó trong cùng Pod. Task cần chạy xong rồi dừng nên dùng Job.

### Downward API đưa tên Node vào container

```yaml
env:
  - name: NODE_NAME
    valueFrom:
      fieldRef:
        fieldPath: spec.nodeName
```

Field này đưa tên Node vào biến môi trường `NODE_NAME`. Container có thể biết mình đang phục vụ Node nào mà không cần gọi Kubernetes API.

Không nên tự gắn cứng `spec.nodeName` vào Pod template. DaemonSet controller và Scheduler cần tự xử lý placement.

### Vì sao cần resource requests và limits?

```yaml
resources:
  requests:
    cpu: 10m
    memory: 16Mi
  limits:
    memory: 32Mi
```

- `requests` giúp Scheduler biết cần dành bao nhiêu tài nguyên trên mỗi Node.
- `limits` giới hạn mức sử dụng runtime theo cơ chế tương ứng.

Vì Pod chạy trên nhiều Node, một request nhỏ vẫn có thể trở thành chi phí lớn trên toàn cluster. Phần sau sẽ tính cụ thể.

## Theo dõi trạng thái

Sau khi apply, chờ rollout:

```bash
kubectl rollout status daemonset/node-agent \
  -n daemon-lab --timeout=180s
```

Nếu thành công:

```text
daemonset "node-agent" successfully rolled out
```

Xem DaemonSet và Pod:

```bash
kubectl get daemonset node-agent -n daemon-lab
kubectl get pods -n daemon-lab -o wide
```

Output DaemonSet minh họa:

```text
NAME         DESIRED   CURRENT   READY   UP-TO-DATE   AVAILABLE   NODE SELECTOR
node-agent   3         3         3       3            3           <none>
```

Cách đọc:

| Cột/status field | Ý nghĩa |
|---|---|
| `DESIRED` / `desiredNumberScheduled` | Số Node mà DaemonSet muốn có Pod |
| `CURRENT` / `currentNumberScheduled` | Số Node hiện đã có Pod của DaemonSet |
| `READY` / `numberReady` | Số Pod đang `Ready` |
| `AVAILABLE` / `numberAvailable` | Số Pod được coi là available |
| `UP-TO-DATE` / `updatedNumberScheduled` | Số Pod đang dùng template mới nhất |
| `numberMisscheduled` | Số Pod đang nằm trên Node không còn phù hợp |

`DESIRED=3` không có nghĩa cả ba Pod đều hoạt động tốt. Nếu `READY=2`, cần tìm Node có Pod chưa Ready hoặc Pending.

### So sánh Node và Pod

```bash
kubectl get nodes \
  -o custom-columns='NODE:.metadata.name,READY:.status.conditions[?(@.type=="Ready")].status'

kubectl get pods -n daemon-lab \
  -l app=node-agent \
  -o custom-columns='POD:.metadata.name,NODE:.spec.nodeName,PHASE:.status.phase,READY:.status.containerStatuses[0].ready'
```

Mục tiêu là mỗi Node phù hợp xuất hiện đúng một lần trong cột `NODE` của Pod.

### Xem logs của tất cả Pod

```bash
kubectl logs -n daemon-lab \
  -l app=node-agent \
  --prefix --tail=20
```

Output minh họa:

```text
[pod/node-agent-abc/agent] version=v1 node=node-a pod=node-agent-abc time=...
[pod/node-agent-def/agent] version=v1 node=node-b pod=node-agent-def time=...
```

Tên Node lấy từ Downward API; `$HOSTNAME` mặc định thường là tên Pod. Hai giá trị này không phải một.

## Điều gì xảy ra khi Node hoặc Pod thay đổi?

DaemonSet liên tục reconcile để mỗi Node phù hợp có một Pod.

### Khi thêm Node

```text
Trước: node-a ✓  node-b ✓
Thêm:  node-c
Sau:   node-a ✓  node-b ✓  node-c ✓
```

Controller tạo Pod cho Node mới nếu Node match selector/affinity. Pod vẫn phải vượt qua taint, resource và các điều kiện scheduling khác.

### Khi xóa Node khỏi cluster

Pod gắn với Node đó không còn giá trị và được garbage collect cùng lifecycle liên quan. `DESIRED` giảm theo số Node phù hợp còn lại.

### Khi xóa một Pod

```bash
kubectl delete pod <pod-name> -n daemon-lab
```

DaemonSet phát hiện Node đó thiếu Pod và tạo Pod thay thế hướng tới cùng Node. Pod mới có tên và UID mới; Pod cũ không được “hồi sinh”.

### Khi container bị crash

Vì `restartPolicy: Always`, kubelet thường restart container trong **cùng Pod**. Bạn sẽ thấy cột `RESTARTS` tăng và có thể xem log lần container trước:

```bash
kubectl logs <pod-name> -n daemon-lab --previous
```

DaemonSet chỉ tạo Pod mới khi cần reconcile Pod, không tạo Pod mới cho mọi lần container exit.

### Khi Node mất kết nối

DaemonSet Pod tự có một số toleration cho trạng thái `not-ready` và `unreachable`, vì agent cấp Node có thể cần tiếp tục tồn tại khi Node gặp vấn đề. Tuy nhiên, nếu Node thực sự mất điện hoặc không liên lạc được, Kubernetes không thể làm container trên Node đó chạy tiếp bằng phép màu.

DaemonSet cũng không tạo một Pod “bù” trên Node khác, vì mục tiêu của nó là một Pod trên mỗi Node cụ thể, không phải duy trì tổng số replica.

## Chọn những Node được chạy Pod

Mặc định, DaemonSet nhắm tới mọi Node. Bạn có thể thu hẹp bằng `nodeSelector` hoặc `nodeAffinity`.

```d2 title="Chọn những Node được chạy Pod"
direction: right
n1: "Không có selector/affinity"
n2: "mọi Node được xem xét"
n3: "Có nodeSelector/affinity"
n4: "chỉ Node match điều kiện được xem xét"
n1 -> n2
n3 -> n4
```

### Dùng `nodeSelector` cho điều kiện đơn giản

Gắn label vào Node cần chạy agent:

```bash
kubectl label node node-a node-b \
  workload.example.com/pool=observability
```

Thêm vào `spec.template.spec`:

```yaml
nodeSelector:
  workload.example.com/pool: observability
```

DaemonSet chỉ muốn Pod trên Node có label đó.

Kiểm tra Node match:

```bash
kubectl get nodes \
  -l workload.example.com/pool=observability
```

Nếu không có Node nào match, `DESIRED` có thể bằng `0`. Đây là kết quả đúng của selector, không nhất thiết là lỗi controller.

### Dùng `nodeAffinity` cho điều kiện phức tạp

`nodeSelector` chỉ phù hợp với phép so khớp label đơn giản. Dùng `nodeAffinity` khi cần nhiều giá trị hoặc nhiều biểu thức:

```yaml
spec:
  template:
    spec:
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
              - matchExpressions:
                  - key: kubernetes.io/arch
                    operator: In
                    values:
                      - amd64
                      - arm64
                  - key: workload.example.com/pool
                    operator: In
                    values:
                      - general
                      - observability
```

Điều kiện trên yêu cầu Node:

1. Có architecture là `amd64` hoặc `arm64`.
2. Đồng thời thuộc pool `general` hoặc `observability`.

`requiredDuringSchedulingIgnoredDuringExecution` là điều kiện bắt buộc lúc chọn Node. Nếu label thay đổi sau khi Pod đã chạy, phần `IgnoredDuringExecution` nghĩa là Scheduler không tự evict Pod chỉ vì thay đổi đó. Tuy nhiên, DaemonSet controller sẽ reconcile tập Node mục tiêu và có thể tạo/xóa Pod theo selector mới.

### Label cho workload nhạy cảm

Nếu label quyết định agent bảo mật hoặc workload nhạy cảm được chạy ở đâu, không nên tin một label tùy ý mà kubelet có thể tự sửa trong threat model của bạn.

Khi cluster bật `NodeRestriction` admission plugin, có thể dùng prefix label được bảo vệ, ví dụ:

```text
example.com.node-restriction.kubernetes.io/fips=true
```

Label giúp chọn Node nhưng không tự tạo security boundary. Vẫn cần admission policy, RBAC và hardening phù hợp.

## Hiểu taint và toleration

`nodeSelector` và toleration thường bị nhầm vì đều liên quan tới Node placement.

Có thể hình dung:

```text
nodeSelector/affinity: Pod CHỌN Node nào

taint:                Node TỪ CHỐI Pod nào

toleration:           Pod được PHÉP đi qua một taint
```

Toleration không kéo Pod tới Node. Nó chỉ gỡ một rào cản.

### Ví dụ Node dành riêng cho observability

Taint Node:

```bash
kubectl taint node node-a \
  dedicated=observability:NoSchedule
```

Pod không có toleration tương ứng sẽ không được schedule mới lên `node-a`.

Thêm toleration vào DaemonSet:

```yaml
spec:
  template:
    spec:
      tolerations:
        - key: dedicated
          operator: Equal
          value: observability
          effect: NoSchedule
```

Dòng này chỉ nói: “Pod được phép chạy trên Node có taint này”. Pod vẫn có thể chạy trên Node khác.

Nếu muốn agent **chỉ** chạy trong observability pool, dùng cả node selector và toleration:

```yaml
spec:
  template:
    spec:
      nodeSelector:
        workload.example.com/pool: observability
      tolerations:
        - key: dedicated
          operator: Equal
          value: observability
          effect: NoSchedule
```

Luồng quyết định:

```d2 title="Ví dụ Node dành riêng cho observability"
direction: right
n1: "Node có đúng label không?"
n2: "Không"
n3: "DaemonSet không cần Pod ở đó"
n4: "Có"
n5: "Pod có tolerate taint không?"
n6: "Không"
n7: "Pod không schedule được"
n8: "Có"
n9: "tiếp tục kiểm tra CPU, memory, volume,\nport..."
n2 -> n3
n1 -> n2
n1 -> n4
n4 -> n5
n6 -> n7
n5 -> n6
n8 -> n9
n5 -> n8
```

### Ba taint effect thường gặp

| Effect | Hành vi chính |
|---|---|
| `NoSchedule` | Không schedule Pod mới nếu Pod không tolerate |
| `PreferNoSchedule` | Cố tránh schedule, nhưng không phải cấm tuyệt đối |
| `NoExecute` | Pod đang chạy có thể bị evict và Pod mới không được schedule nếu không tolerate |

### DaemonSet tự có một số toleration

Kubernetes tự thêm một số toleration cho DaemonSet Pod để node-level agent có thể tồn tại trong các trạng thái đặc biệt. Các key thường gồm:

- `node.kubernetes.io/not-ready` với `NoExecute`;
- `node.kubernetes.io/unreachable` với `NoExecute`;
- `node.kubernetes.io/disk-pressure` với `NoSchedule`;
- `node.kubernetes.io/memory-pressure` với `NoSchedule`;
- `node.kubernetes.io/pid-pressure` với `NoSchedule`;
- `node.kubernetes.io/unschedulable` với `NoSchedule`;
- `node.kubernetes.io/network-unavailable` với `NoSchedule` khi Pod dùng `hostNetwork`.

Nhờ toleration `unschedulable`, DaemonSet Pod có thể chạy hoặc tiếp tục được quản lý trên Node đã cordon. Điều này hữu ích cho network, storage hoặc monitoring agent.

Kubernetes **không tự tolerate mọi taint tùy chỉnh**. Taint `dedicated=observability:NoSchedule` hoặc taint control plane vẫn cần toleration rõ nếu agent phải chạy ở đó.

Tránh toleration quá rộng nếu không có lý do:

```yaml
# Cho phép đi qua mọi taint; blast radius rất rộng.
tolerations:
  - operator: Exists
```

## Cập nhật và rollback DaemonSet

Khi Pod template thay đổi, DaemonSet cần thay Pod trên từng Node. Có hai update strategy chính.

### `RollingUpdate`

`RollingUpdate` là mặc định. Controller tự thay Pod cũ bằng Pod mới theo từng batch.

```yaml
spec:
  updateStrategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
```

Ví dụ ba Node với `maxUnavailable: 1`:

Chuyển từng bước để quan sát phiên bản Pod của DaemonSet trên mỗi Node:

```d2 mode=steps title="Rolling update DaemonSet trên ba Node"
direction: right
grid-columns: 3
a: "node-a\nv1"
b: "node-b\nv1"
c: "node-c\nv1"
steps: {
  "Bước 1": {a: "node-a\nv2"}
  "Bước 2": {b: "node-b\nv2"}
  "Kết thúc": {c: "node-c\nv2"}
}
```

Thứ tự thực tế không nhất thiết là `node-a`, rồi `node-b`, rồi `node-c`. Ứng dụng không nên phụ thuộc vào thứ tự rollout.

`maxUnavailable` càng lớn, rollout càng nhanh nhưng nhiều Node có thể tạm thời không có agent. Với CNI, CSI, security hoặc log agent quan trọng, bắt đầu bằng batch nhỏ và theo dõi health.

Theo dõi rollout:

```bash
kubectl rollout status daemonset/node-agent \
  -n daemon-lab --timeout=5m

kubectl rollout history daemonset/node-agent -n daemon-lab
kubectl get daemonset,pods -n daemon-lab -o wide
```

### `OnDelete`

Với `OnDelete`, cập nhật template không tự thay Pod đang chạy:

```yaml
spec:
  updateStrategy:
    type: OnDelete
```

Pod mới chỉ dùng template mới khi Pod cũ bị xóa thủ công hoặc phải được tạo lại vì lý do khác.

Strategy này cho phép kiểm soát từng Node nhưng dễ để cluster chạy nhiều version trong thời gian dài. Chỉ dùng khi có runbook update thủ công rõ.

### Rollback

Nếu rollout mới lỗi:

```bash
kubectl rollout undo daemonset/node-agent -n daemon-lab
kubectl rollout status daemonset/node-agent \
  -n daemon-lab --timeout=5m
```

Kiểm tra revision trước khi rollback:

```bash
kubectl rollout history daemonset/node-agent -n daemon-lab
```

Rollback trong cluster chưa đủ nếu manifest trong Git vẫn chứa cấu hình lỗi. GitOps controller có thể apply lại lỗi. Hãy sửa source of truth và ghi nhận nguyên nhân.

### Vì sao rollout bị kẹt?

Một Pod mới có thể không Ready vì:

- image không tồn tại hoặc không pull được;
- command crash;
- Node thiếu CPU hoặc memory;
- taint hoặc affinity không phù hợp;
- volume/host path không tồn tại;
- readiness probe lỗi;
- agent không có permission cần thiết.

Không tăng `maxUnavailable` chỉ để làm rollout “đi tiếp”. Điều đó có thể khiến nhiều Node cùng mất agent mà không giải quyết nguyên nhân.

## Tài nguyên được nhân theo số Node

DaemonSet Pod xuất hiện trên mọi Node phù hợp, vì vậy resource requests được nhân theo số Node.

Ví dụ một agent yêu cầu:

```yaml
resources:
  requests:
    cpu: 100m
    memory: 200Mi
```

Trên 100 Node:

```text
CPU:    100 Node × 100m  = 10 CPU request
Memory: 100 Node × 200Mi = 20,000Mi ≈ 19.5Gi request
```

Nếu có năm DaemonSet agent, cần cộng chi phí của cả năm. Thêm Node làm application capacity tăng nhưng cũng tự thêm overhead của các DaemonSet.

### Request quá thấp

Scheduler nghĩ agent dùng ít tài nguyên hơn thực tế, làm Node dễ bị overcommit. Nhiều agent cùng vượt request có thể gây memory pressure hoặc ảnh hưởng application Pod.

### Request quá cao

Pod DaemonSet có thể `Pending` trên Node nhỏ dù mức sử dụng thật thấp hơn. Một Node thiếu agent networking, storage hoặc security có thể không hoạt động đúng.

### Limit quá thấp

Memory limit quá thấp có thể khiến container `OOMKilled` và restart liên tục trên nhiều Node. CPU limit quá chặt có thể làm agent xử lý log/metric không kịp trong giờ cao điểm.

Hãy đo mức sử dụng theo nhiều loại Node và workload, sau đó đặt request/limit theo dữ liệu thay vì copy cùng một giá trị cho mọi agent.

## Quyền truy cập host và rủi ro bảo mật

DaemonSet cấp Node thường cần nhiều quyền hơn application Pod. Các quyền thường gặp:

- `hostPath` để đọc file hoặc socket trên Node;
- `hostNetwork` để dùng network namespace của host;
- `hostPID` để quan sát process của host;
- `privileged` hoặc Linux capabilities đặc biệt;
- ServiceAccount và RBAC để đọc resource trong cluster;
- `hostPort` để mở một port trên từng Node.

Mỗi quyền mở rộng đều tăng blast radius nếu image hoặc process bị compromise.

### `hostPath`

Ví dụ log collector đọc `/var/log`:

```yaml
spec:
  template:
    spec:
      containers:
        - name: collector
          volumeMounts:
            - name: varlog
              mountPath: /host/var/log
              readOnly: true
      volumes:
        - name: varlog
          hostPath:
            path: /var/log
            type: Directory
```

`hostPath` đưa dữ liệu của Node vào container. Nếu mount `/` với quyền ghi, container có thể sửa filesystem host. Chỉ mount đúng path cần dùng và đặt `readOnly: true` khi agent chỉ cần đọc.

### `hostNetwork` và `hostPort`

`hostNetwork: true` cho Pod dùng network namespace của Node. `hostPort` chiếm một port trên Node. Cấu hình sai có thể tạo port conflict hoặc làm agent tiếp xúc trực tiếp với network ngoài dự kiến.

Không bật chỉ vì “DaemonSet thường dùng host access”. Nhiều agent push metric hoặc log ra ngoài không cần client kết nối trực tiếp vào từng Node.

### `privileged` và capabilities

`privileged: true` mở quyền rất rộng. Trước khi dùng, kiểm tra agent có thể chạy với:

- non-root user;
- `allowPrivilegeEscalation: false`;
- filesystem chỉ đọc;
- drop toàn bộ capabilities rồi chỉ thêm capability bắt buộc;
- seccomp profile phù hợp.

### RBAC

Dùng ServiceAccount riêng cho từng agent và cấp quyền tối thiểu. Một log collector không nên mặc nhiên có quyền sửa Deployment hoặc đọc mọi Secret.

Checklist giảm rủi ro:

- pin image version hoặc digest;
- scan và ký image theo quy trình của tổ chức;
- chỉ mount host path cần thiết;
- dùng read-only mount khi có thể;
- tránh `hostPID`, `hostNetwork` và `privileged` nếu không bắt buộc;
- giới hạn Node mục tiêu bằng label và policy;
- áp admission policy cho host access;
- giám sát thay đổi DaemonSet vì một rollout lỗi ảnh hưởng nhiều Node.

## DaemonSet trong quá trình bảo trì Node

### Cordon

```bash
kubectl cordon <node-name>
```

Cordon đánh dấu Node không nhận Pod thông thường mới. DaemonSet Pod có toleration `node.kubernetes.io/unschedulable:NoSchedule` được Kubernetes tự thêm, nên DaemonSet vẫn có behavior đặc biệt trên Node này.

### Drain

Khi drain:

```bash
kubectl drain <node-name> \
  --ignore-daemonsets \
  --delete-emptydir-data
```

`kubectl drain` yêu cầu `--ignore-daemonsets` vì Pod DaemonSet không được xử lý giống application Pod thông thường. “Ignore” không có nghĩa xóa agent; Pod DaemonSet thường vẫn còn trên Node trong quá trình drain.

DaemonSet cũng không tạo Pod bù trên Node khác, vì các Node khác đã có Pod riêng.

Trước maintenance production, kiểm tra:

- agent nào vẫn chạy trong lúc drain;
- agent có ghi dữ liệu vào `emptyDir` hoặc host path không;
- workload có phụ thuộc trực tiếp vào agent đó không;
- Node sau reboot có tự nhận đúng label, taint và configuration không;
- DaemonSet Pod có trở lại `Ready` trước khi uncordon không.

### Priority

Agent quan trọng cho networking hoặc storage có thể cần `PriorityClass` cao để được schedule khi Node thiếu tài nguyên. Priority cao có thể preempt application Pod, vì vậy phải đặt request hợp lý và đánh giá blast radius.

Không dùng priority cao để che việc cluster thiếu capacity lâu dài.

## Thực hành hoàn chỉnh

Lab này chứng minh bốn behavior:

1. Mỗi Node phù hợp có một Pod.
2. Xóa Pod làm DaemonSet tạo Pod thay thế trên cùng Node.
3. Thay Pod template kích hoạt rolling update.
4. `nodeSelector` thu hẹp tập Node mục tiêu.

### 1. Tạo Namespace và apply manifest

Dùng file `daemonset.yaml` ở phần đầu bài:

```bash
kubectl get namespace daemon-lab >/dev/null 2>&1 || \
  kubectl create namespace daemon-lab

kubectl apply --dry-run=server -f daemonset.yaml
kubectl apply -f daemonset.yaml
```

Chờ rollout:

```bash
kubectl rollout status daemonset/node-agent \
  -n daemon-lab --timeout=180s
```

### 2. Xác minh mỗi Node phù hợp có một Pod

```bash
kubectl get nodes
kubectl get daemonset node-agent -n daemon-lab
kubectl get pods -n daemon-lab -l app=node-agent -o wide
```

Nếu lab toleration phù hợp với cluster và không có ràng buộc khác, `DESIRED`, `CURRENT` và `READY` nên bằng số Node.

So sánh mapping:

```bash
kubectl get pods -n daemon-lab \
  -l app=node-agent \
  -o custom-columns='POD:.metadata.name,NODE:.spec.nodeName,PHASE:.status.phase,READY:.status.containerStatuses[0].ready'
```

Xem logs:

```bash
kubectl logs -n daemon-lab \
  -l app=node-agent --prefix --tail=20
```

Mỗi Node phải xuất hiện trong `node=...` của một Pod.

### 3. Quan sát self-healing

Chọn Pod đầu tiên và lưu Node hiện tại:

```bash
POD="$(kubectl get pod -n daemon-lab -l app=node-agent \
  -o jsonpath='{.items[0].metadata.name}')"

NODE="$(kubectl get pod "$POD" -n daemon-lab \
  -o jsonpath='{.spec.nodeName}')"

echo "Xóa Pod $POD trên Node $NODE"
```

Xóa Pod và theo dõi:

```bash
kubectl delete pod "$POD" -n daemon-lab
kubectl get pods -n daemon-lab -l app=node-agent -o wide --watch
```

DaemonSet tạo Pod mới hướng tới cùng Node. Xác minh:

```bash
kubectl get pods -n daemon-lab -l app=node-agent -o wide
```

Pod mới có tên khác nhưng cột `NODE` vẫn chứa Node vừa bị thiếu.

### 4. Thử rolling update

Trong `daemonset.yaml`, đổi:

```yaml
- name: AGENT_VERSION
  value: "v1"
```

thành:

```yaml
- name: AGENT_VERSION
  value: "v2"
```

Thay đổi environment variable nằm trong Pod template nên kích hoạt rollout:

```bash
kubectl apply -f daemonset.yaml
kubectl rollout status daemonset/node-agent \
  -n daemon-lab --timeout=180s
```

Kiểm tra revision và logs:

```bash
kubectl rollout history daemonset/node-agent -n daemon-lab
kubectl get pods -n daemon-lab -l app=node-agent -o wide
kubectl logs -n daemon-lab -l app=node-agent --prefix --tail=20
```

Tất cả Pod mới phải in `version=v2`.

Rollback về revision trước:

```bash
kubectl rollout undo daemonset/node-agent -n daemon-lab
kubectl rollout status daemonset/node-agent \
  -n daemon-lab --timeout=180s
```

Sau lab, đưa file `daemonset.yaml` về `v1` nếu muốn source local khớp trạng thái rollback.

### 5. Thử giới hạn vào một Node

Lấy tên Node đầu tiên và thêm label dành riêng cho lab:

```bash
LAB_NODE="$(kubectl get nodes \
  -o jsonpath='{.items[0].metadata.name}')"

kubectl label node "$LAB_NODE" \
  lab.example.com/daemon=true
```

Thêm đoạn sau vào `spec.template.spec` trong `daemonset.yaml`:

```yaml
nodeSelector:
  lab.example.com/daemon: "true"
```

Apply và quan sát:

```bash
kubectl apply -f daemonset.yaml
kubectl get daemonset,pods -n daemon-lab -o wide --watch
```

DaemonSet giữ Pod trên Node có label và xóa Pod trên Node không còn thuộc tập mục tiêu. `DESIRED` trở thành `1` nếu chỉ một Node mang label.

Xác minh selector:

```bash
kubectl get nodes -l lab.example.com/daemon=true
kubectl get pods -n daemon-lab -l app=node-agent -o wide
```

### 6. Cleanup

Xóa label thử nghiệm và Namespace:

```bash
kubectl label node "$LAB_NODE" \
  lab.example.com/daemon-

kubectl config current-context
kubectl delete namespace daemon-lab
```

Xóa DaemonSet theo cách thông thường sẽ xóa các Pod do nó quản lý.

`--cascade=orphan` có thể giữ Pod lại nhưng khiến Pod không còn controller duy trì. Đây là thao tác migration nâng cao, không dùng cho cleanup thông thường.

## Troubleshooting

Khi DaemonSet không đạt trạng thái mong muốn, trước tiên trả lời hai câu hỏi:

```text
1. DaemonSet có MUỐN Pod trên Node đó không?
   → xem DESIRED, nodeSelector, affinity, labels

2. Nếu có, Pod có CHẠY ĐƯỢC trên Node đó không?
   → xem Pod phase, Events, taints, resources, logs
```

Decision tree:

```d2 title="Troubleshooting"
direction: right
n1: "DESIRED thấp hơn số Node mong đợi?"
n2: "Có"
n3: "kiểm tra selector, affinity và Node\nlabels"
n4: "Không"
n5: "CURRENT thấp hơn DESIRED"
n6: "kiểm tra Events và tạo Pod"
n7: "Pod Pending"
n8: "kiểm tra taint, resource, volume, port"
n9: "Pod Running nhưng chưa Ready"
n10: "kiểm tra probe và dependency"
n11: "Pod CrashLoopBackOff"
n12: "kiểm tra logs, exit code, OOM"
n13: "UPDATED thấp"
n14: "kiểm tra rollout và Pod template mới"
n2 -> n3
n1 -> n2
n1 -> n4
n5 -> n6
n4 -> n5
n7 -> n8
n4 -> n7
n9 -> n10
n4 -> n9
n11 -> n12
n4 -> n11
n13 -> n14
n4 -> n13
```

### `DESIRED` thấp hơn số Node mong đợi

```bash
kubectl get daemonset node-agent -n daemon-lab
kubectl get daemonset node-agent -n daemon-lab -o yaml
kubectl get nodes --show-labels
kubectl describe daemonset node-agent -n daemon-lab
```

Kiểm tra:

- `nodeSelector` có match label Node không;
- required node affinity có đúng không;
- Node architecture/OS có phù hợp không;
- label Node vừa bị thay đổi không;
- DaemonSet controller đã kịp reconcile chưa.

Kiểm tra trực tiếp một selector:

```bash
kubectl get nodes \
  -l workload.example.com/pool=observability
```

Nếu selector không match Node nào, `DESIRED=0` là đúng.

### `DESIRED` đúng nhưng Pod `Pending`

```bash
kubectl get pods -n daemon-lab -l app=node-agent -o wide
kubectl describe pod <pod-name> -n daemon-lab
kubectl describe node <node-name>
```

Đọc phần `Events`. Các message thường gặp:

- `Insufficient cpu` hoặc `Insufficient memory`;
- `untolerated taint`;
- volume không attach hoặc mount được;
- `hostPort` bị trùng trên Node;
- image architecture không phù hợp;
- admission policy hoặc quota chặn;
- Node không còn Ready hoặc có pressure.

Thêm toleration không sửa được thiếu CPU. Tăng memory không sửa được image pull. Dùng Event để xác định đúng lớp lỗi.

### Pod `Running` nhưng chưa `Ready`

```bash
kubectl describe pod <pod-name> -n daemon-lab
kubectl logs <pod-name> -n daemon-lab --all-containers
kubectl get pod <pod-name> -n daemon-lab \
  -o jsonpath='{.status.conditions}'
```

Kiểm tra:

- readiness probe có đúng port/path không;
- host file hoặc socket cần thiết đã mount chưa;
- agent có permission đọc host resource không;
- dependency của agent có sẵn sàng không;
- init container có hoàn thành không;
- memory limit có gây OOM không.

`Running` chỉ cho biết container đã khởi động; không chứng minh agent đã cung cấp chức năng đúng.

### Pod `CrashLoopBackOff`

```bash
kubectl logs <pod-name> -n daemon-lab
kubectl logs <pod-name> -n daemon-lab --previous
kubectl describe pod <pod-name> -n daemon-lab
```

Kiểm tra command, arguments, environment variable, permission, host path, exit code và `OOMKilled`.

Không cần tăng `restartPolicy`; DaemonSet đã dùng `Always`. Cần sửa nguyên nhân khiến process exit.

### Chỉ một vài Node bị lỗi

Nếu hầu hết Pod khỏe nhưng một Pod lỗi, so sánh Node đó với Node khỏe:

```bash
kubectl get pods -n daemon-lab -l app=node-agent -o wide
kubectl describe node <problem-node>
kubectl describe node <healthy-node>
kubectl get node <problem-node> --show-labels
```

Khác biệt có thể nằm ở:

- OS hoặc architecture;
- label và taint;
- capacity và pressure;
- host path hoặc socket;
- kernel/module/driver;
- port đã bị chiếm;
- image cache hoặc registry connectivity.

Đừng restart toàn bộ DaemonSet nếu lỗi chỉ nằm trên một Node.

### Rollout bị kẹt

```bash
kubectl rollout status daemonset/node-agent \
  -n daemon-lab --timeout=60s
kubectl get daemonset node-agent -n daemon-lab -o yaml
kubectl get pods -n daemon-lab -l app=node-agent -o wide
kubectl describe daemonset node-agent -n daemon-lab
```

So sánh:

- `desiredNumberScheduled`;
- `updatedNumberScheduled`;
- `numberReady`;
- `numberAvailable`.

Tìm Pod dùng template mới nhưng `Pending`, `ImagePullBackOff`, `CrashLoopBackOff` hoặc chưa Ready. Nếu template mới lỗi, sửa manifest hoặc rollback; không tăng batch để che lỗi.

### `numberMisscheduled` lớn hơn 0

Điều này nghĩa là có Pod DaemonSet đang chạy trên Node không còn phù hợp với selector/affinity hiện tại.

```bash
kubectl get daemonset node-agent -n daemon-lab -o yaml
kubectl get pods -n daemon-lab -l app=node-agent -o wide
kubectl get nodes --show-labels
```

Kiểm tra thay đổi label, affinity và selector gần đây. Chờ controller reconcile trước khi xóa Pod hàng loạt.

### `kubectl drain` báo còn DaemonSet Pod

Đây thường là behavior bảo vệ mặc định. Dùng:

```bash
kubectl drain <node-name> \
  --ignore-daemonsets \
  --delete-emptydir-data
```

Trước production drain, xác định Pod DaemonSet nào giữ local data, Pod nào phải tiếp tục chạy và agent nào ảnh hưởng tới networking/storage của Node.

### Pod không xuất hiện trên control-plane Node

Kiểm tra taint:

```bash
kubectl describe node <control-plane-node> | grep -A3 Taints
```

Nếu DaemonSet thật sự cần chạy ở đó, thêm toleration cụ thể:

```yaml
tolerations:
  - key: node-role.kubernetes.io/control-plane
    operator: Exists
    effect: NoSchedule
```

Không thêm toleration chỉ để làm `DESIRED` bằng tổng số Node. Nhiều agent không cần và không nên chạy trên control plane.

### Logs biến mất sau khi Pod được thay

Rolling update hoặc self-healing tạo Pod mới và Pod cũ bị xóa. `kubectl logs` chỉ đọc được Pod còn tồn tại.

Agent production phải gửi logs/metrics ra hệ thống tập trung. Đừng dựa vào lifecycle của Pod để lưu evidence lâu dài.

## Best practices

- Dùng DaemonSet khi cần một Pod trên mỗi Node phù hợp; dùng Deployment nếu chỉ cần tổng cộng N replica.
- Giữ mental model: DaemonSet chọn Node mục tiêu, Scheduler kiểm tra Pod có chạy được trên Node đó không.
- Dùng selector cụ thể, ổn định và không overlap workload khác.
- Dùng `nodeSelector` cho điều kiện đơn giản, `nodeAffinity` cho điều kiện phức tạp.
- Kết hợp node selection và toleration nếu muốn agent chỉ chạy trong dedicated Node pool.
- Không thêm toleration quá rộng hoặc control-plane toleration nếu agent không cần.
- Khai báo resource requests/limits và tính tổng overhead trên toàn bộ fleet.
- Dùng `RollingUpdate` với batch nhỏ cho network, storage, security và observability agent quan trọng.
- Theo dõi cả `desired`, `current`, `ready`, `available`, `updated` và `misscheduled`.
- Test rollout lỗi, rollback, Node mới, Node replacement, cordon/drain và cluster có nhiều architecture.
- Giảm `hostPath`, `hostNetwork`, `hostPID`, `hostPort`, `privileged` và RBAC xuống mức tối thiểu.
- Mount host path read-only nếu agent chỉ cần đọc.
- Pin image version hoặc digest và có quy trình cập nhật rõ.
- Dùng PriorityClass cao chỉ cho agent thật sự quan trọng và hiểu tác động preemption.
- Gửi logs/metrics tới hệ thống tập trung trước khi Pod bị rollout hoặc xóa.
- Nhớ rằng DaemonSet chỉ quản lý placement và lifecycle; ứng dụng bên trong vẫn phải tự xử lý health, dữ liệu và failure mode.

## Tóm tắt

Mental model ngắn nhất:

```d2 title="Tóm tắt"
direction: right
n1: "DaemonSet"
n2: "với mỗi Node phù hợp"
n3: "duy trì một Pod của DaemonSet"
n1 -> n2
n2 -> n3
```

Ba lớp quyết định placement:

```text
nodeSelector/affinity
→ Node nào thuộc tập mục tiêu?

Taint/toleration
→ Pod có được phép vào Node đó không?

Resource/volume/port/scheduler constraints
→ Pod có thực sự chạy được không?
```

Các field và status quan trọng:

| Field/status | Câu hỏi mà nó trả lời |
|---|---|
| `spec.selector` | Pod nào thuộc DaemonSet? |
| `spec.template` | Pod trên mỗi Node chạy như thế nào? |
| `nodeSelector` / `nodeAffinity` | Node nào cần Pod? |
| `tolerations` | Pod được phép đi qua taint nào? |
| `updateStrategy` | Pod được thay khi template đổi như thế nào? |
| `desiredNumberScheduled` | DaemonSet muốn Pod trên bao nhiêu Node? |
| `numberReady` | Bao nhiêu Pod đang Ready? |
| `updatedNumberScheduled` | Bao nhiêu Pod đã dùng template mới? |
| `numberMisscheduled` | Có Pod nào nằm trên Node không còn phù hợp không? |

Bốn điều quan trọng nhất:

1. DaemonSet không có `replicas`; số Pod theo số Node phù hợp.
2. Toleration chỉ cho phép đi qua taint, không chọn Node thay cho selector.
3. Một DaemonSet nhỏ trên từng Node có thể tạo overhead lớn trên toàn cluster.
4. Host access giúp agent làm việc ở cấp Node nhưng cũng mở rộng blast radius bảo mật.

Tiếp tục với [Job](/workloads/job/) để học workload chạy đến khi hoàn thành thay vì chạy liên tục trên từng Node.

## Tài liệu tham khảo

- [DaemonSet](https://kubernetes.io/docs/concepts/workloads/controllers/daemonset/)
- [Perform a Rolling Update on a DaemonSet](https://kubernetes.io/docs/tasks/manage-daemon/update-daemon-set/)
- [Perform a Rollback on a DaemonSet](https://kubernetes.io/docs/tasks/manage-daemon/rollback-daemon-set/)
- [Assigning Pods to Nodes](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/)
- [Taints and Tolerations](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/)
- [Pod Lifecycle](/workloads/pod-lifecycle/)
