---
title: "Pod"
description: "Hiểu Kubernetes Pod từ nền tảng: Pod bọc container như thế nào, chia sẻ network và volume ra sao, được schedule lên Node thế nào và vì sao production cần controller quản lý Pod."
---

# Pod

## Mục lục

- [Pod là gì?](#pod-là-gì)
- [Vì sao Kubernetes cần Pod thay vì chạy container trực tiếp?](#vì-sao-kubernetes-cần-pod-thay-vì-chạy-container-trực-tiếp)
- [Pod nằm ở đâu trong Kubernetes?](#pod-nằm-ở-đâu-trong-kubernetes)
- [Một Pod nên có bao nhiêu container?](#một-pod-nên-có-bao-nhiêu-container)
- [Tạo Pod đầu tiên](#tạo-pod-đầu-tiên)
- [Đọc manifest Pod](#đọc-manifest-pod)
- [Pod được tạo và chạy như thế nào?](#pod-được-tạo-và-chạy-như-thế-nào)
- [Các container trong Pod chia sẻ những gì?](#các-container-trong-pod-chia-sẻ-những-gì)
- [Pod IP, containerPort và cách truy cập Pod](#pod-ip-containerport-và-cách-truy-cập-pod)
- [Pod là tài nguyên tạm thời](#pod-là-tài-nguyên-tạm-thời)
- [Container restart khác Pod replacement](#container-restart-khác-pod-replacement)
- [Vì sao production không nên tạo Pod trần?](#vì-sao-production-không-nên-tạo-pod-trần)
- [Pod template](#pod-template)
- [Resource requests và limits](#resource-requests-và-limits)
- [Cấu hình bảo mật cơ bản](#cấu-hình-bảo-mật-cơ-bản)
- [Static Pod và mirror Pod](#static-pod-và-mirror-pod)
- [Thực hành hoàn chỉnh](#thực-hành-hoàn-chỉnh)
- [Troubleshooting](#troubleshooting)
- [Best practices](#best-practices)
- [Tóm tắt](#tóm-tắt)
- [Tài liệu tham khảo](#tài-liệu-tham-khảo)

---

## Pod là gì?

`Pod` là đơn vị triển khai nhỏ nhất mà Kubernetes có thể tạo và quản lý.

Một Pod chứa:

- một hoặc nhiều container;
- cấu hình network dùng chung;
- các volume mà container có thể mount;
- thông tin resource, security, health check và cách chạy container.

Ví dụ phổ biến nhất là một Pod có một container:

```d2 title="Pod là gì?"
direction: right
n1: "Pod web"
n2: "container nginx"
n1 -> n2
```

Một Pod cũng có thể có nhiều container phối hợp chặt chẽ:

```d2 title="Pod là gì?"
direction: right
n1: "Pod web"
n2: "container application"
n3: "container log-sidecar"
n4: "Pod IP dùng chung"
n5: "volume dùng chung"
n1 -> n2
n1 -> n3
n1 -> n4
n1 -> n5
```

Tất cả container trong một Pod luôn được đặt trên **cùng một Node** và có cùng vòng đời cấp Pod. Kubernetes không thể đặt container `application` ở `node-a` nhưng đặt `log-sidecar` của cùng Pod ở `node-b`.

Điểm quan trọng nhất cần nhớ:

> **Kubernetes schedule và quản lý Pod, không schedule từng container riêng lẻ.**

Pod không phải một máy ảo thu nhỏ. Nó là một “vỏ chạy” hay “logical host” dành cho một nhóm process cần ở gần nhau.

## Vì sao Kubernetes cần Pod thay vì chạy container trực tiếp?

Container runtime như containerd có thể tạo container. Tuy nhiên, Kubernetes cần một đơn vị chung để gắn nhiều thông tin vận hành vào workload:

```d2 title="Vì sao Kubernetes cần Pod thay vì chạy container trực tiếp?"
direction: right
n1: "Pod"
n2: "Container image và command"
n3: "Network identity"
n4: "Volume"
n5: "Resource requests/limits"
n6: "Security context"
n7: "Health probes"
n8: "Scheduling constraints"
n9: "Restart policy"
n1 -> n2
n1 -> n3
n1 -> n4
n1 -> n5
n1 -> n6
n1 -> n7
n1 -> n8
n1 -> n9
```

Nếu Kubernetes chỉ quản lý từng container riêng lẻ, việc phối hợp hai container cần dùng chung network và volume sẽ phức tạp hơn. Pod tạo ra một ranh giới rõ:

- Scheduler đặt toàn bộ nhóm lên một Node.
- kubelet trên Node chạy các container của nhóm.
- Các container có thể giao tiếp qua `localhost`.
- Các container có thể mount chung một volume.
- Controller tạo, thay thế và scale theo đơn vị Pod.

Có thể hiểu:

```text
Container = process được đóng gói
Pod       = môi trường Kubernetes dùng để chạy container đó
```

Một container không tự trở thành Pod. Manifest Pod nói cho Kubernetes biết cần chạy container trong context nào.

## Pod nằm ở đâu trong Kubernetes?

Pod là điểm nối giữa workload controller và hạ tầng Node.

```d2 title="Pod nằm ở đâu trong Kubernetes?"
direction: right
D: "Deployment"
RS: "ReplicaSet"
P1: "Pod 1"
P2: "Pod 2"
C1: "Container"
C2: "Container"
N1: "Node A"
N2: "Node B"
D -> RS
RS -> P1
RS -> P2
P1 -> C1
P2 -> C2
P1 -> N1
P2 -> N2
```

Đọc sơ đồ từ trái sang phải:

1. Deployment mô tả ứng dụng mong muốn.
2. ReplicaSet duy trì số lượng Pod.
3. Mỗi Pod bọc một hoặc nhiều container.
4. Scheduler chọn Node cho từng Pod.
5. kubelet trên Node chạy container.

Các controller khác cũng tạo Pod:

| Controller | Pod được tạo để làm gì? |
|---|---|
| Deployment | Chạy nhiều replica stateless và rollout phiên bản mới |
| StatefulSet | Chạy Pod có identity và storage ổn định hơn |
| DaemonSet | Chạy một Pod trên mỗi Node phù hợp |
| Job | Chạy Pod đến khi task hoàn thành |
| CronJob | Tạo Job theo lịch, sau đó Job tạo Pod |

Pod vẫn là đơn vị runtime cuối cùng dù bạn bắt đầu từ controller nào.

## Một Pod nên có bao nhiêu container?

Mô hình phổ biến nhất là **một application container trong mỗi Pod**:

```d2 title="Một Pod nên có bao nhiêu container?"
direction: right
n1: "Pod api-1"
n2: "container api"
n3: "Pod api-2"
n4: "container api"
n5: "Pod api-3"
n6: "container api"
n1 -> n2
n3 -> n4
n5 -> n6
```

Muốn có ba bản sao, hãy tạo ba Pod thay vì đặt ba container giống nhau vào một Pod.

```d2 title="Một Pod nên có bao nhiêu container?"
direction: right
wrong: Không nên dùng để scale {
  pod: Pod {
    a: api container 1
    b: api container 2
    c: api container 3
  }
}
right: Nên dùng {
  deployment: Deployment replicas=3
  p1: Pod 1 {api: api container}
  p2: Pod 2 {api: api container}
  p3: Pod 3 {api: api container}
  deployment -> p1
  deployment -> p2
  deployment -> p3
}
```

### Khi nào nhiều container nên ở cùng Pod?

Chỉ đặt chung khi chúng thực sự tạo thành một đơn vị:

1. Phải chạy trên cùng Node.
2. Phải giao tiếp qua `localhost` hoặc volume dùng chung.
3. Có vòng đời gắn bó chặt chẽ.
4. Cần scale và rollout cùng nhau.
5. Không có giá trị khi chạy tách rời.

Ví dụ hợp lý:

- application và sidecar proxy;
- web server và container cập nhật file trong volume dùng chung;
- application và agent chuyển đổi log có quan hệ chặt;
- application container cùng init container chuẩn bị dữ liệu trước khi start.

Ví dụ không nên đặt chung:

- frontend cần 10 replica nhưng worker chỉ cần 2 replica;
- API và database có lifecycle, storage và cách scale khác nhau;
- hai service chỉ giao tiếp qua HTTP nhưng không cần cùng Node;
- nhiều container giống nhau chỉ để tăng capacity.

Nếu hai thành phần cần scale, deploy, rollback hoặc cấp quyền độc lập, hãy tách chúng thành workload riêng.

Đọc sâu hơn tại [Multi-container Pods](/workloads/multi-container-pods/) và [Init Containers](/workloads/init-containers/).

## Tạo Pod đầu tiên

Ví dụ đầu tiên chạy một Nginx container. Mục tiêu là quan sát rõ chuỗi `Pod → container` trước khi dùng Deployment.

### Điều kiện trước khi bắt đầu

Bạn cần:

- một Kubernetes cluster đang hoạt động;
- `kubectl` đã kết nối tới cluster;
- quyền tạo Namespace và Pod.

Kiểm tra context:

```bash
kubectl config current-context
kubectl get nodes -o wide
```

> [!WARNING]
> Các lệnh trong bài tạo và xóa Namespace. Không chạy trên cluster dùng chung hoặc production nếu chưa kiểm tra đúng context.

### Tạo manifest

Lưu nội dung sau vào file `pod.yaml`:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: web
  namespace: pod-lab
  labels:
    app: web
spec:
  containers:
    - name: nginx
      image: nginx:1.27-alpine
      ports:
        - name: http
          containerPort: 80
      resources:
        requests:
          cpu: 50m
          memory: 32Mi
        limits:
          memory: 64Mi
  restartPolicy: Always
```

Tạo Namespace, kiểm tra manifest tại API Server rồi apply:

```bash
kubectl create namespace pod-lab
kubectl apply --dry-run=server -f pod.yaml
kubectl apply -f pod.yaml
```

Kết quả:

```text
pod/web created
```

`created` chỉ nghĩa là API Server đã lưu Pod object. Nó chưa chứng minh container đã chạy hoặc Nginx đã sẵn sàng.

### Chờ Pod sẵn sàng

```bash
kubectl wait --for=condition=Ready pod/web \
  -n pod-lab --timeout=120s
```

Nếu thành công:

```text
pod/web condition met
```

Kiểm tra nhanh:

```bash
kubectl get pod web -n pod-lab -o wide
```

Output minh họa:

```text
NAME   READY   STATUS    RESTARTS   AGE   IP           NODE
web    1/1     Running   0          20s   10.244.1.8   node-a
```

Cách đọc:

- `READY 1/1`: một container trên tổng một container đã Ready.
- `STATUS Running`: Pod đã bind vào Node và container đang chạy.
- `RESTARTS 0`: container chưa bị kubelet restart.
- `IP`: địa chỉ của Pod trong cluster.
- `NODE`: Node đang chạy Pod.

## Đọc manifest Pod

Manifest Pod có hai phần lớn:

```text
metadata → Pod này là ai?
spec     → Pod này phải chạy như thế nào?
```

### `apiVersion`, `kind` và `metadata`

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: web
  namespace: pod-lab
  labels:
    app: web
```

- `apiVersion: v1` là API của Pod.
- `kind: Pod` xác định loại resource.
- `metadata.name` là tên Pod trong Namespace.
- `metadata.namespace` xác định phạm vi chứa Pod.
- `metadata.labels` là metadata dùng để truy vấn và làm selector.

Tên Pod chỉ cần unique trong cùng Namespace. Hai Namespace khác nhau có thể cùng có Pod tên `web`.

### `spec.containers`

```yaml
spec:
  containers:
    - name: nginx
      image: nginx:1.27-alpine
```

`containers` là danh sách application container trong Pod.

- `name` phải unique trong Pod.
- `image` xác định container image cần chạy.

Nếu Pod có nhiều container, command `kubectl logs` và `kubectl exec` cần chỉ rõ container bằng `-c` khi Kubernetes không thể tự chọn:

```bash
kubectl logs <pod-name> -c <container-name> -n <namespace>
kubectl exec <pod-name> -c <container-name> -n <namespace> -- <command>
```

### `ports.containerPort`

```yaml
ports:
  - name: http
    containerPort: 80
```

Field này mô tả container lắng nghe port `80` và cho phép đặt tên port là `http`.

> [!IMPORTANT]
> `containerPort` không tự tạo Service, không public ứng dụng ra Internet và không map port ra máy local.

Container vẫn có thể lắng nghe port dù không khai báo `containerPort`. Field này chủ yếu làm manifest rõ hơn và cho resource khác tham chiếu port theo tên.

### `resources`

```yaml
resources:
  requests:
    cpu: 50m
    memory: 32Mi
  limits:
    memory: 64Mi
```

- Scheduler dùng `requests` để chọn Node có đủ capacity.
- kubelet và container runtime áp dụng `limits` theo cơ chế của resource.
- Vượt memory limit có thể làm container bị `OOMKilled`.
- CPU limit, nếu cấu hình, thường được thực thi bằng throttling thay vì kill process.

Không có một giá trị đúng cho mọi ứng dụng. Hãy đo workload và điều chỉnh theo dữ liệu.

### `restartPolicy`

```yaml
restartPolicy: Always
```

`restartPolicy` nói cho kubelet biết phải làm gì khi application container kết thúc:

| Policy | Exit code `0` | Exit code khác `0` |
|---|---|---|
| `Always` | Restart | Restart |
| `OnFailure` | Không restart | Restart |
| `Never` | Không restart | Không restart |

Pod chạy server lâu dài thường dùng `Always`. Job thường dùng `Never` hoặc `OnFailure`.

Restart policy áp dụng cho việc restart container trong **cùng Pod trên cùng Node**. Nó không tạo Pod mới trên Node khác.

## Pod được tạo và chạy như thế nào?

Khi chạy `kubectl apply`, nhiều thành phần phối hợp để đưa Pod từ YAML thành container đang chạy.

```d2 title="Pod được tạo và chạy như thế nào?"
shape: sequence_diagram
U: "kubectl"
A: "API Server"
S: "Scheduler"
K: "kubelet"
R: "Container runtime"
U -> A: "Gửi Pod manifest"
A -> A: "Validate và lưu Pod"
S -> A: "Quan sát Pod chưa có Node"
S -> A: "Bind Pod vào một Node"
K -> A: "Quan sát Pod được giao"
K -> R: "Tạo sandbox, pull image, chạy\ncontainer"
K -> A: "Cập nhật Pod status"
```

Luồng theo từng bước:

1. `kubectl` gửi manifest tới API Server.
2. API Server kiểm tra schema, admission policy và quyền rồi lưu Pod.
3. Scheduler tìm Pod chưa có Node.
4. Scheduler lọc và chấm điểm các Node dựa trên requests, taints, affinity, volume và constraint khác.
5. Scheduler bind Pod vào một Node.
6. kubelet trên Node đó phát hiện Pod mới.
7. Container runtime tạo Pod sandbox, network và container.
8. kubelet chạy health probes, restart container khi cần và cập nhật status.

Có thể nhớ trách nhiệm:

```text
API Server → lưu desired state
Scheduler  → chọn Node
kubelet    → làm Pod chạy trên Node đã chọn
Runtime    → tạo và chạy container
```

Kubernetes schedule một Pod đúng một lần trong lifecycle của Pod đó. Sau khi đã bind vào Node, cùng Pod không được “chuyển” sang Node khác. Nếu cần chạy ở Node khác, controller tạo Pod thay thế có UID mới.

Đọc sâu hơn về control loop tại [Declarative Model và Reconciliation Loop](/kien-truc/declarative-reconciliation/).

## Các container trong Pod chia sẻ những gì?

Các container trong cùng Pod gần nhau hơn container ở hai Pod khác nhau, nhưng chúng không chia sẻ mọi thứ.

### Chia sẻ network namespace

Các container trong Pod:

- dùng chung Pod IP;
- dùng chung port space;
- gọi nhau qua `localhost`;
- có cùng network identity khi giao tiếp ra ngoài Pod.

Ví dụ:

```text
Pod IP: 10.244.1.8

container app   lắng nghe localhost:8080
container proxy gọi        localhost:8080
```

Vì dùng chung port space, hai container trong cùng Pod không thể cùng bind `0.0.0.0:8080` với cùng protocol.

Hai Pod khác nhau thường có hai IP khác nhau và không dùng `localhost` để gọi nhau:

```text
Pod A: localhost chỉ trỏ về Pod A
Pod B: localhost chỉ trỏ về Pod B
```

### Có thể chia sẻ volume

Filesystem writable của mỗi container vẫn riêng. Muốn chia sẻ file, các container phải mount cùng một Pod volume.

Ví dụ volume `shared-data`:

```yaml
spec:
  volumes:
    - name: shared-data
      emptyDir: {}
  containers:
    - name: writer
      image: busybox:1.36
      volumeMounts:
        - name: shared-data
          mountPath: /data
    - name: reader
      image: busybox:1.36
      volumeMounts:
        - name: shared-data
          mountPath: /shared
```

`/data` trong container `writer` và `/shared` trong container `reader` trỏ tới cùng volume dù mount path khác nhau.

`emptyDir` được tạo cùng Pod:

- container restart không làm mất `emptyDir` vì Pod vẫn là Pod cũ;
- Pod bị xóa hoặc thay thế thì `emptyDir` cũ mất theo Pod;
- dữ liệu cần tồn tại qua Pod replacement phải dùng storage bền vững phù hợp.

### Không mặc định chia sẻ process namespace

Mỗi container thường thấy process namespace riêng. Nếu có nhu cầu đặc biệt, Pod hỗ trợ `shareProcessNamespace`, nhưng đây không phải mặc định và làm giảm isolation giữa các container.

Không bật chỉ để debug tiện hơn. Dùng ephemeral container hoặc công cụ debug phù hợp khi cần.

### Resource được khai báo theo container

Mỗi container có requests/limits riêng. Scheduler dùng tổng requests của các container để đánh giá Pod có fit trên Node không.

Ví dụ:

```text
container app:     200m CPU + 256Mi
container sidecar:  50m CPU +  64Mi
----------------------------------
Pod request:       250m CPU + 320Mi
```

Hai container trong cùng Pod cũng được schedule cùng nhau. Kubernetes không thể đặt sidecar sang Node khác để giải quyết thiếu capacity.

## Pod IP, `containerPort` và cách truy cập Pod

Mỗi Pod thường nhận một IP trong cluster. IP này thuộc về **Pod**, không thuộc riêng một container.

```d2 title="Pod IP, `containerPort` và cách truy cập Pod"
direction: right
n1: "Pod web"
n2: "Pod IP: 10.244.1.8"
n3: "nginx lắng nghe port 80"
n1 -> n2
n1 -> n3
```

### Pod IP không phải endpoint ổn định

Pod có thể bị thay thế và nhận IP mới:

```text
Pod cũ: UID 111, IP 10.244.1.8  → bị xóa
Pod mới: UID 222, IP 10.244.2.9 → được tạo
```

Client không nên lưu cứng Pod IP. Dùng `Service` để cung cấp endpoint ổn định và chọn các Pod backend bằng label.

### `containerPort` không expose ứng dụng

Manifest:

```yaml
ports:
  - containerPort: 80
```

không tạo những thứ sau:

- không tạo Service;
- không mở NodePort;
- không tạo LoadBalancer;
- không forward tới `localhost` của máy bạn;
- không thay firewall rule bên ngoài cluster.

### Dùng port-forward trong lab

Để truy cập Pod từ máy local khi học:

```bash
kubectl port-forward pod/web 8080:80 -n pod-lab
```

Luồng:

```d2 title="Dùng port-forward trong lab"
direction: right
n1: "localhost:8080"
n2: "kubectl port-forward"
n3: "Pod web port 80"
n1 -> n2
n2 -> n3
```

Ở terminal khác:

```bash
curl -I http://localhost:8080
```

`port-forward` là kết nối tạm thời dành cho debug và development. Khi command dừng, tunnel biến mất. Không dùng nó làm cách expose production.

Để học endpoint ổn định, tiếp tục với [Service](/networking/service/).

## Pod là tài nguyên tạm thời

Pod được thiết kế là resource tương đối ngắn hạn và có thể thay thế.

Mỗi Pod có identity gồm:

- name;
- Namespace;
- UID;
- creation timestamp;
- Pod IP trong lúc chạy;
- Node đã được bind.

UID mới là identity duy nhất của object. Một Pod mới có thể dùng lại cùng name sau khi Pod cũ bị xóa, nhưng đó vẫn là object khác.

```d2 title="Pod là tài nguyên tạm thời"
direction: right
old: "Pod web\nname=web\nUID=aaa-111\nIP=10.244.1.8"
removed: bị xóa
new: "Pod web mới\nname=web\nUID=bbb-222\nIP=10.244.2.9"
old -> removed
removed -> new: Tạo lại
```

Hệ quả thực tế:

- không phụ thuộc vào Pod IP;
- không lưu state quan trọng trong container writable layer;
- không coi Pod name là identity nghiệp vụ lâu dài;
- dùng PersistentVolume khi dữ liệu phải sống qua replacement;
- dùng Service để tìm workload qua network;
- dùng controller để tạo Pod thay thế.

### Pod không được reschedule sang Node khác

Nếu `web` đã bind vào `node-a`, Kubernetes không di chuyển cùng UID đó sang `node-b`.

```text
Sai mental model:
Pod UID 111 trên node-a → di chuyển sang node-b

Đúng mental model:
Pod UID 111 trên node-a → bị xóa
Pod UID 222             → được tạo và schedule lên node-b
```

Từ bên ngoài, hai Pod có thể chạy cùng image và label nên trông giống nhau. Tuy nhiên, chúng có UID, IP, container ID và lifecycle khác nhau.

## Container restart khác Pod replacement

Đây là một trong những điểm quan trọng nhất khi học Pod.

### Container restart

Khi process trong container kết thúc và `restartPolicy` yêu cầu restart:

```d2 title="Container restart"
direction: right
pod: "Pod web\nUID aaa, IP 10.244.1.8" {
  old: container nginx ID 1
  crash: crash
  new: container nginx ID 2
  old -> crash
  crash -> new: kubelet tạo lại trong cùng Pod
}
```

Những gì thường giữ nguyên:

- Pod name;
- Pod UID;
- Pod IP;
- Node;
- Pod volume như `emptyDir`.

Container ID và restart count thay đổi.

### Pod replacement

Khi Deployment rollout, Pod bị xóa hoặc Node failure cần thay workload:

```d2 title="Pod replacement"
direction: right
n1: "Pod cũ UID aaa"
n2: "bị xóa"
n3: "Pod mới UID bbb"
n4: "controller tạo"
n1 -> n2
n3 -> n4
```

Những gì có thể thay đổi:

- UID chắc chắn thay đổi;
- IP có thể thay đổi;
- Node có thể thay đổi;
- container ID thay đổi;
- `emptyDir` được tạo mới và dữ liệu cũ mất.

Bảng so sánh:

| Tình huống | Pod UID | Pod IP | Node | Container ID |
|---|---|---|---|---|
| Container restart trong cùng Pod | Giữ nguyên | Thường giữ nguyên | Giữ nguyên | Thay đổi |
| Controller tạo Pod thay thế | Thay đổi | Có thể thay đổi | Có thể thay đổi | Thay đổi |
| Xóa Pod trần rồi tạo lại cùng name | Thay đổi | Có thể thay đổi | Có thể thay đổi | Thay đổi |

Đọc sâu về phase, condition, restart và termination tại [Vòng đời Pod](/workloads/pod-lifecycle/).

## Vì sao production không nên tạo Pod trần?

Pod trần là Pod được tạo trực tiếp mà không có Deployment, StatefulSet, DaemonSet hoặc Job làm owner.

```d2 title="Vì sao production không nên tạo Pod trần?"
direction: right
user: Bạn
pod: tạo Pod trực tiếp
controller: không có workload controller duy trì replacement
user -> pod
pod -- controller
```

Nếu xóa Pod trần:

```bash
kubectl delete pod web -n pod-lab
```

Pod biến mất và không có controller tạo lại.

Kubelet có thể restart container trong Pod theo `restartPolicy`, nhưng kubelet không tạo Pod replacement trên Node khác khi Pod object bị xóa hoặc Node không còn phù hợp.

Với Deployment:

```d2 mode=steps title="Vì sao production không nên tạo Pod trần?"
direction: right
deployment: Deployment desired replicas=3
A: Pod A
B: Pod B
C: Pod C
deployment -> A
deployment -> B
deployment -> C
steps: {
  deleted: {B: Pod B bị xóa}
  replacement: {
    B: null
    deployment: Deployment phát hiện chỉ còn 2
    D: Tạo Pod D → trở lại 3
    deployment -> D
  }
}
```

Dùng Pod trần cho:

- học cấu trúc Pod;
- thử một image nhanh;
- debug ngắn hạn;
- kiểm tra scheduling hoặc network trong lab.

Dùng controller cho production:

- `Deployment` cho ứng dụng stateless chạy liên tục;
- `StatefulSet` cho workload cần identity/storage ổn định hơn;
- `DaemonSet` cho agent trên mỗi Node;
- `Job` cho task chạy đến khi hoàn thành;
- `CronJob` cho Job theo lịch.

## Pod template

Controller không lưu một danh sách Pod cố định. Nó lưu **Pod template**, tức bản mẫu dùng để tạo Pod mới.

Ví dụ một phần Deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
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
```

Phần sau là Pod template:

```yaml
template:
  metadata:
    labels:
      app: web
  spec:
    containers:
      - name: nginx
        image: nginx:1.27-alpine
```

Nó gần giống Pod manifest nhưng không có `apiVersion`, `kind` và `metadata.name` riêng. Controller tự tạo tên cho mỗi Pod.

Khi template thay đổi, controller thường tạo Pod mới theo strategy của workload. Nó không biến mọi field của Pod cũ tại chỗ.

### Pod spec phần lớn không nên được sửa trực tiếp

Một số field của Pod có thể cập nhật qua API hoặc subresource, nhưng nhiều field cấu trúc là immutable. Ví dụ, không thể tùy ý đổi Node, volume hoặc phần lớn scheduling configuration của Pod đang chạy.

Trong production, hãy sửa Pod template của controller và để controller rollout replacement. Nếu sửa trực tiếp Pod do controller quản lý, controller có thể ghi đè thay đổi hoặc tạo lại Pod theo template cũ.

## Resource requests và limits

Resource configuration ảnh hưởng cả scheduling lẫn runtime.

```yaml
resources:
  requests:
    cpu: 200m
    memory: 256Mi
  limits:
    memory: 512Mi
```

### Requests dùng để schedule

Scheduler cộng requests của các container trong Pod rồi tìm Node đủ capacity.

```d2 title="Requests dùng để schedule"
direction: right
pod: "Pod request\n500m CPU, 512Mi memory"
a: "node-a còn 200m\nkhông fit"
b: "node-b còn 1 CPU, 1Gi\ncó thể fit"
c: "node-c bị taint\ncòn phải kiểm tra toleration"
pod -> a
pod -> b
pod -> c
```

Request quá cao có thể làm Pod `Pending`. Request quá thấp khiến Scheduler đặt quá nhiều workload lên Node so với nhu cầu thật.

### Memory limit

Khi container vượt memory limit, kernel có thể kill process và Kubernetes hiển thị `OOMKilled`.

```bash
kubectl describe pod <pod-name> -n <namespace>
kubectl get pod <pod-name> -n <namespace> \
  -o jsonpath='{.status.containerStatuses[0].lastState.terminated.reason}{"\n"}'
```

Không tự động tăng memory limit trước khi kiểm tra memory leak, traffic, cache và usage thực tế.

### CPU limit có trade-off

CPU limit có thể ngăn một container chiếm CPU của workload khác, nhưng cũng có thể gây throttling ngay cả khi Node còn CPU rảnh. Quyết định dùng CPU limit phụ thuộc workload, latency target và mô hình multi-tenancy.

Resource sizing cần dựa trên metric và load test, không dựa trên giá trị copy từ ví dụ lab.

## Cấu hình bảo mật cơ bản

Pod và container chạy trong kernel của Node, vì vậy image và quyền runtime ảnh hưởng trực tiếp tới blast radius.

Security context có thể giới hạn quyền:

```yaml
spec:
  securityContext:
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: app
      image: example.com/app:1.0.0
      securityContext:
        runAsNonRoot: true
        allowPrivilegeEscalation: false
        capabilities:
          drop:
            - ALL
```

Manifest này chỉ chạy nếu image hỗ trợ non-root và không cần Linux capabilities đã bỏ. Không copy nguyên xi cho image chưa được kiểm tra.

Các nguyên tắc cơ bản:

- chạy non-root khi ứng dụng hỗ trợ;
- không dùng `privileged` nếu không bắt buộc;
- tắt privilege escalation;
- drop capabilities rồi chỉ thêm capability cần thiết;
- dùng seccomp profile phù hợp;
- không mount host path hoặc container runtime socket tùy tiện;
- dùng ServiceAccount và RBAC với quyền tối thiểu;
- pin image version hoặc digest và scan image;
- không đặt Secret trực tiếp trong image hoặc plaintext manifest.

Pod security không chỉ là một field. Nó còn phụ thuộc image, admission policy, ServiceAccount, volume, Node và runtime configuration.

## Static Pod và mirror Pod

Đây là phần nâng cao; application workload thông thường không cần tạo Static Pod.

### Static Pod

Static Pod được kubelet trên một Node quản lý trực tiếp từ manifest local, không do API Server hoặc Scheduler tạo.

```d2 title="Static Pod"
direction: right
n1: "File manifest trên node-a"
n2: "kubelet node-a"
n3: "chạy Static Pod trên chính node-a"
n1 -> n2
n2 -> n3
```

Static Pod luôn gắn với kubelet đó. Use case phổ biến là chạy các control-plane component trong cluster được bootstrap theo mô hình như kubeadm.

### Mirror Pod

Kubelet tạo một mirror Pod object trên API Server để người vận hành có thể nhìn thấy Static Pod bằng `kubectl`.

```d2 title="Mirror Pod"
direction: right
n1: "Static Pod thật trên Node"
n2: "mirror Pod trên API Server để quan sát"
n1 -> n2
```

Sửa hoặc xóa mirror Pod không thay đổi source manifest local đang được kubelet quản lý. Kubelet có thể tạo lại mirror Pod.

Application thông thường nên dùng Deployment, StatefulSet, DaemonSet hoặc Job vì chúng có scheduling và quản lý tập trung tốt hơn.

## Thực hành hoàn chỉnh

Lab này chứng minh:

1. Pod được schedule lên một Node.
2. Nginx chạy bên trong container của Pod.
3. `containerPort` không tự expose ứng dụng.
4. `port-forward` tạo đường truy cập tạm thời.
5. Xóa Pod trần không có controller tự tạo lại.
6. Tạo lại cùng name vẫn sinh UID mới.

### 1. Tạo Namespace và Pod

Lưu file `pod.yaml` từ phần đầu bài, sau đó chạy:

```bash
kubectl get namespace pod-lab >/dev/null 2>&1 || \
  kubectl create namespace pod-lab

kubectl apply --dry-run=server -f pod.yaml
kubectl apply -f pod.yaml
```

Chờ Ready:

```bash
kubectl wait --for=condition=Ready pod/web \
  -n pod-lab --timeout=120s
```

### 2. Quan sát Pod từ tổng quan đến chi tiết

```bash
kubectl get pod web -n pod-lab -o wide
kubectl describe pod web -n pod-lab
kubectl get pod web -n pod-lab -o yaml
```

Tìm các thông tin:

- Pod UID;
- Node name;
- Pod IP;
- phase;
- `Ready` condition;
- container state;
- image và image ID;
- resource requests/limits;
- Events ở cuối `kubectl describe`.

Lấy một số field bằng JSONPath:

```bash
kubectl get pod web -n pod-lab \
  -o jsonpath='name={.metadata.name}{"\n"}uid={.metadata.uid}{"\n"}node={.spec.nodeName}{"\n"}ip={.status.podIP}{"\n"}phase={.status.phase}{"\n"}'
```

### 3. Xem logs và chạy command trong container

Nginx ghi access log ra `stdout` và error log ra `stderr`.

```bash
kubectl logs web -n pod-lab
```

Kiểm tra version Nginx trong container:

```bash
kubectl exec web -n pod-lab -- nginx -v
```

Kiểm tra filesystem và hostname:

```bash
kubectl exec web -n pod-lab -- sh -c \
  'echo "hostname=$HOSTNAME"; cat /etc/os-release | head'
```

`kubectl exec` phù hợp cho debug ngắn hạn. Không sửa filesystem container thủ công rồi coi đó là cấu hình production; thay đổi sẽ mất khi container hoặc Pod bị thay.

### 4. Truy cập Nginx bằng port-forward

Mở tunnel:

```bash
kubectl port-forward pod/web 8080:80 -n pod-lab
```

Giữ terminal này chạy. Trong terminal khác:

```bash
curl -I http://localhost:8080
```

Kết quả đúng có HTTP response từ Nginx, thường gồm status `200 OK`.

Xem access log sau request:

```bash
kubectl logs web -n pod-lab --tail=20
```

Dừng port-forward bằng `Ctrl+C`. Sau đó `localhost:8080` không còn đường tới Pod.

### 5. Chứng minh Pod trần không self-heal

Lưu UID, IP và Node hiện tại:

```bash
OLD_UID="$(kubectl get pod web -n pod-lab \
  -o jsonpath='{.metadata.uid}')"
OLD_IP="$(kubectl get pod web -n pod-lab \
  -o jsonpath='{.status.podIP}')"
OLD_NODE="$(kubectl get pod web -n pod-lab \
  -o jsonpath='{.spec.nodeName}')"

printf 'old_uid=%s\nold_ip=%s\nold_node=%s\n' \
  "$OLD_UID" "$OLD_IP" "$OLD_NODE"
```

Xóa Pod:

```bash
kubectl delete pod web -n pod-lab
kubectl get pods -n pod-lab
```

Danh sách không còn `web`. Chờ thêm cũng không làm Pod xuất hiện vì không có controller quản lý.

### 6. Tạo lại cùng name và so sánh identity

```bash
kubectl apply -f pod.yaml
kubectl wait --for=condition=Ready pod/web \
  -n pod-lab --timeout=120s

NEW_UID="$(kubectl get pod web -n pod-lab \
  -o jsonpath='{.metadata.uid}')"
NEW_IP="$(kubectl get pod web -n pod-lab \
  -o jsonpath='{.status.podIP}')"
NEW_NODE="$(kubectl get pod web -n pod-lab \
  -o jsonpath='{.spec.nodeName}')"

printf 'new_uid=%s\nnew_ip=%s\nnew_node=%s\n' \
  "$NEW_UID" "$NEW_IP" "$NEW_NODE"
```

`NEW_UID` phải khác `OLD_UID`. IP và Node có thể giống hoặc khác tùy Scheduler và networking, nên không dùng chúng làm bằng chứng duy nhất.

### 7. Xem owner của Pod

Pod trần không có `ownerReferences`:

```bash
kubectl get pod web -n pod-lab \
  -o jsonpath='{.metadata.ownerReferences}{"\n"}'
```

Output thường trống. Pod do Deployment, StatefulSet, DaemonSet hoặc Job tạo sẽ có owner reference tương ứng hoặc owner trung gian.

### 8. Cleanup

Kiểm tra context rồi xóa Namespace:

```bash
kubectl config current-context
kubectl delete namespace pod-lab
```

Xóa Namespace sẽ xóa Pod và resource khác bên trong.

## Troubleshooting

Debug Pod theo thứ tự:

```d2 title="Troubleshooting"
direction: right
n1: "Pod đã được schedule chưa?"
n2: "Chưa"
n3: "xem Scheduling Events"
n4: "Rồi"
n5: "Container chưa tạo"
n6: "xem image, volume, Secret, CNI"
n7: "Container crash"
n8: "xem logs và exit code"
n9: "Container chạy nhưng chưa Ready"
n10: "xem probes và dependency"
n11: "Pod hoạt động nhưng client không truy\ncập được"
n12: "xem port, Service, NetworkPolicy"
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
```

Bộ command nền tảng:

```bash
kubectl get pod <pod-name> -n <namespace> -o wide
kubectl describe pod <pod-name> -n <namespace>
kubectl logs <pod-name> -n <namespace>
kubectl logs <pod-name> -n <namespace> --previous
kubectl get events -n <namespace> \
  --sort-by=.metadata.creationTimestamp
```

### Pod `Pending`

`Pending` có thể nghĩa là Pod chưa được schedule hoặc đang chờ container setup.

```bash
kubectl describe pod <pod-name> -n <namespace>
kubectl get events -n <namespace> \
  --sort-by=.metadata.creationTimestamp
```

Tìm các nguyên nhân:

- `Insufficient cpu` hoặc `Insufficient memory`;
- Pod không tolerate taint;
- node selector/affinity không match;
- PVC chưa bind;
- quota hoặc admission policy chặn;
- Pod đang chờ image hoặc volume setup.

Đọc `PodScheduled` condition để phân biệt đã có Node hay chưa:

```bash
kubectl get pod <pod-name> -n <namespace> \
  -o custom-columns='NAME:.metadata.name,NODE:.spec.nodeName,SCHEDULED:.status.conditions[?(@.type=="PodScheduled")].status'
```

### `ErrImagePull` hoặc `ImagePullBackOff`

```bash
kubectl describe pod <pod-name> -n <namespace>
```

Kiểm tra:

- repository và tag có đúng không;
- registry có truy cập được từ Node không;
- image có hỗ trợ architecture của Node không;
- `imagePullSecrets` có đúng không;
- registry có rate limit hoặc certificate lỗi không.

`ImagePullBackOff` là cơ chế chờ giữa các lần pull, không phải root cause. Root cause nằm trong Events gần đó.

### `CrashLoopBackOff`

Container start rồi liên tục exit hoặc bị kill.

```bash
kubectl logs <pod-name> -n <namespace>
kubectl logs <pod-name> -n <namespace> --previous
kubectl describe pod <pod-name> -n <namespace>
```

`--previous` rất quan trọng vì nó đọc log của lần container trước.

Kiểm tra:

- command/arguments sai;
- thiếu environment variable hoặc config file;
- application không kết nối được dependency;
- liveness/startup probe kill container;
- container bị `OOMKilled`;
- permission hoặc filesystem lỗi.

Không sửa bằng cách tăng restart count; cần sửa lý do process kết thúc.

### Pod `Running` nhưng `0/1 Ready`

`Running` không đồng nghĩa sẵn sàng nhận traffic.

```bash
kubectl describe pod <pod-name> -n <namespace>
kubectl get pod <pod-name> -n <namespace> \
  -o jsonpath='{.status.conditions}'
```

Kiểm tra readiness probe, startup probe, readiness gates và dependency. Nếu Pod thuộc Service, Pod chưa Ready thường không được dùng như endpoint sẵn sàng.

### Không xem được logs

Nếu Pod có nhiều container, chỉ rõ container:

```bash
kubectl logs <pod-name> -c <container-name> -n <namespace>
```

Nếu container chưa từng start, có thể chưa có logs. Xem Events và container waiting reason:

```bash
kubectl describe pod <pod-name> -n <namespace>
```

Nếu Pod cũ đã bị xóa, `kubectl logs` không lấy lại log từ API. Production cần hệ thống log tập trung.

### `kubectl exec` thất bại

Các nguyên nhân thường gặp:

- container chưa Running;
- chọn sai container;
- image không có shell `sh` hoặc command cần chạy;
- RBAC không cho phép `pods/exec`;
- kubelet hoặc network tới Node có vấn đề.

Không giả định mọi image đều có Bash:

```bash
kubectl exec <pod-name> -n <namespace> -- sh
```

Distroless image có thể không có cả `sh`. Khi đó cân nhắc ephemeral debug container theo policy của cluster.

### Không truy cập được ứng dụng

Kiểm tra theo đường đi:

```d2 title="Không truy cập được ứng dụng"
direction: right
n1: "Process có listen đúng port/address?"
n2: "Pod có Ready không?"
n3: "Service selector có chọn Pod không?"
n4: "EndpointSlice có endpoint không?"
n5: "NetworkPolicy có chặn không?"
n6: "Ingress/Gateway/LoadBalancer có đúng\nkhông?"
n1 -> n2
n2 -> n3
n3 -> n4
n4 -> n5
n5 -> n6
```

Trong Pod:

```bash
kubectl exec <pod-name> -n <namespace> -- \
  sh -c 'wget -qO- http://127.0.0.1:<port> || true'
```

Từ local, test tạm bằng port-forward:

```bash
kubectl port-forward pod/<pod-name> 8080:<port> -n <namespace>
```

Nếu port-forward hoạt động nhưng Service không hoạt động, tập trung kiểm tra selector, target port, readiness và EndpointSlice.

### Pod `Terminating` quá lâu

```bash
kubectl get pod <pod-name> -n <namespace> -o yaml
kubectl describe pod <pod-name> -n <namespace>
```

Kiểm tra:

- `deletionTimestamp`;
- finalizers;
- `preStop` hook;
- `terminationGracePeriodSeconds`;
- application không xử lý `SIGTERM`;
- Node mất kết nối;
- volume detach/unmount bị kẹt.

Không force delete ngay trước khi thu thập evidence và hiểu rủi ro. Force delete object khỏi API không đảm bảo process trên Node mất kết nối đã dừng ngay.

### `kubectl apply` báo field immutable

Nhiều field của Pod không thể đổi sau khi Pod đã tạo. Với Pod lab, có thể xóa rồi tạo lại:

```bash
kubectl delete pod web -n pod-lab
kubectl apply -f pod.yaml
```

Với production, sửa Pod template của controller và dùng rollout phù hợp. Không xóa Pod thủ công nếu workload không có đủ replica hoặc chưa đánh giá availability.

## Best practices

- Hiểu Pod là đơn vị scheduling và replacement, không phải máy ảo thu nhỏ.
- Mặc định dùng một application container trong mỗi Pod.
- Chỉ dùng multi-container Pod khi các container cần cùng Node, network, volume và lifecycle.
- Dùng Deployment, StatefulSet, DaemonSet hoặc Job thay vì tạo Pod trần trong production.
- Không phụ thuộc vào Pod IP; dùng Service cho endpoint ổn định.
- Không lưu dữ liệu cần bền vững trong container writable layer hoặc `emptyDir`.
- Khai báo resource requests dựa trên usage thực tế; đặt limits theo trade-off của workload.
- Tách đúng `startupProbe`, `readinessProbe` và `livenessProbe`.
- Ghi logs ra `stdout`/`stderr` và gửi tới hệ thống tập trung.
- Xử lý `SIGTERM` và graceful shutdown vì Pod có thể bị thay thế.
- Dùng labels nhất quán để selector, truy vấn và phân bổ chi phí.
- Pin image bằng tag bất biến hoặc digest; tránh `latest` trong production.
- Chạy non-root, giảm capabilities và privilege khi image hỗ trợ.
- Không sửa trực tiếp Pod do controller quản lý; sửa Pod template và rollout.
- Khi debug, đọc status theo lớp: phase → conditions → container state → Events → logs.

## Tóm tắt

Mental model ngắn nhất:

```d2 title="Tóm tắt"
direction: right
n1: "Controller tạo Pod"
n2: "Scheduler chọn Node cho Pod"
n3: "kubelet chạy container trên Node đó"
n4: "Pod giữ nguyên trên Node trong lifecycle\ncủa UID"
n5: "khi cần thay thế, controller tạo Pod mới\ncó UID mới"
n1 -> n2
n2 -> n3
n3 -> n4
n4 -> n5
```

Các thành phần chính:

```d2 title="Tóm tắt"
direction: right
n1: "Pod"
n2: "metadata: name, namespace, labels, UID"
n3: "spec"
n4: "containers"
n5: "volumes"
n6: "resources"
n7: "security"
n8: "probes"
n9: "restartPolicy"
n10: "status"
n11: "phase"
n12: "conditions"
n13: "Pod IP và Node"
n14: "containerStatuses"
n1 -> n2
n1 -> n3
n3 -> n4
n3 -> n5
n3 -> n6
n3 -> n7
n3 -> n8
n3 -> n9
n1 -> n10
n10 -> n11
n10 -> n12
n10 -> n13
n10 -> n14
```

Năm điều quan trọng nhất:

1. Kubernetes schedule Pod, không schedule từng container riêng.
2. Các container trong Pod dùng chung network và có thể mount chung volume.
3. Một Pod được bind vào một Node; nó không di chuyển sang Node khác.
4. Container restart trong cùng Pod khác với controller tạo Pod replacement.
5. Production workload nên dùng controller vì Pod trần không tự được tạo lại sau khi bị xóa.

Tiếp tục với [Vòng đời Pod](/workloads/pod-lifecycle/) để hiểu `Pending`, `Running`, `Ready`, restart, probes và graceful termination.

## Tài liệu tham khảo

- [Pods](https://kubernetes.io/docs/concepts/workloads/pods/)
- [Pod Lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)
- [Static Pods](https://kubernetes.io/docs/tasks/configure-pod-container/static-pod/)
- [Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)
- [Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/)
