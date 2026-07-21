---
title: "nodeSelector và Node Affinity"
description: "Cách dùng Node label, nodeSelector và required/preferred Node Affinity để đặt Pod đúng nhóm Node, kèm verification và troubleshooting."
---

# nodeSelector và Node Affinity

## Mục lục

- [Tổng quan](#tổng-quan)
- [1. Node label là dữ liệu để scheduler chọn Node](#1-node-label-là-dữ-liệu-để-scheduler-chọn-node)
- [2. nodeSelector](#2-nodeselector)
- [3. Node Affinity](#3-node-affinity)
- [4. Operator và logic kết hợp](#4-operator-và-logic-kết-hợp)
- [5. Hard constraint và soft preference](#5-hard-constraint-và-soft-preference)
- [6. Thiết kế label an toàn](#6-thiết-kế-label-an-toàn)
- [7. Thực hành](#7-thực-hành)
- [8. Troubleshooting](#8-troubleshooting)
- [9. Best practices](#9-best-practices)
- [Tài liệu tham khảo](#tài-liệu-tham-khảo)

---

## Tổng quan

`nodeSelector` và Node Affinity cho phép Pod chọn Node dựa trên label. Chúng trả lời câu hỏi **Pod cần hoặc muốn chạy trên loại Node nào**: kiến trúc CPU, zone, loại disk, nhóm hardware, compliance boundary hoặc node pool.

- `nodeSelector` biểu diễn các phép so khớp `key=value` bắt buộc, đơn giản.
- `requiredDuringSchedulingIgnoredDuringExecution` biểu diễn hard constraint với expression phong phú.
- `preferredDuringSchedulingIgnoredDuringExecution` thêm điểm ưu tiên nhưng không chặn Pod khỏi Node khác.

```text
Node labels + Pod placement rules
              │
              ▼
Filter hard requirements
              │
              ▼
Score soft preferences
              │
              ▼
Bind Pod vào Node phù hợp nhất
```

`IgnoredDuringExecution` nghĩa scheduler kiểm tra rule lúc placement; thay đổi label sau đó không tự evict Pod đang chạy chỉ vì affinity không còn match.

## 1. Node label là dữ liệu để scheduler chọn Node

Liệt kê label hiện tại:

```bash
kubectl get nodes --show-labels
kubectl get nodes -L kubernetes.io/arch,topology.kubernetes.io/zone
```

Kubernetes và hạ tầng thường cung cấp label chuẩn như:

- `kubernetes.io/hostname`
- `kubernetes.io/os`
- `kubernetes.io/arch`
- `topology.kubernetes.io/zone`
- `topology.kubernetes.io/region`

Không giả định mọi cluster có zone/region label. Local cluster một Node hoặc bare-metal không tích hợp cloud có thể thiếu chúng.

Thêm label do platform quản lý:

```bash
kubectl label node NODE_NAME workload.example.com/tier=general
```

Xóa label:

```bash
kubectl label node NODE_NAME workload.example.com/tier-
```

> [!WARNING]
> Label dùng cho isolation hoặc compliance phải được bảo vệ khỏi kubelet/node bị compromise. Với label nhạy cảm, dùng prefix được NodeRestriction admission plugin bảo vệ theo hướng dẫn chính thức, và chỉ cho platform automation có quyền sửa Node.

## 2. nodeSelector

`nodeSelector` là map các label bắt buộc. Mọi entry được kết hợp bằng logic AND.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: arm64-worker
spec:
  nodeSelector:
    kubernetes.io/os: linux
    kubernetes.io/arch: arm64
  containers:
    - name: worker
      image: registry.k8s.io/pause:3.10
```

Pod chỉ có thể chạy trên Node vừa có `os=linux` vừa có `arch=arm64`. Nếu cluster không có Node như vậy, Pod giữ `Pending`.

Dùng `nodeSelector` khi điều kiện là equality đơn giản và bắt buộc. Cấu hình dễ đọc hơn affinity tương đương.

## 3. Node Affinity

Node Affinity nằm tại `spec.affinity.nodeAffinity` và hỗ trợ hard rules lẫn weighted preferences.

### 3.1 Required Node Affinity

Ví dụ Pod chỉ chạy trên Node thuộc tier `general` hoặc `compute`, đồng thời không có label `workload.example.com/retiring`:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: required-affinity
spec:
  affinity:
    nodeAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
          - matchExpressions:
              - key: workload.example.com/tier
                operator: In
                values:
                  - general
                  - compute
              - key: workload.example.com/retiring
                operator: DoesNotExist
  containers:
    - name: app
      image: nginx:1.27-alpine
```

Trong một `nodeSelectorTerm`, các expression là AND. Nhiều `nodeSelectorTerms` là OR. Ở ví dụ này chỉ có một term nên cả hai expression phải đúng.

### 3.2 Preferred Node Affinity

Ví dụ ưu tiên zone `zone-a`; nếu không thể, Pod vẫn có thể chạy ở zone khác:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: preferred-affinity
spec:
  affinity:
    nodeAffinity:
      preferredDuringSchedulingIgnoredDuringExecution:
        - weight: 80
          preference:
            matchExpressions:
              - key: topology.kubernetes.io/zone
                operator: In
                values:
                  - zone-a
        - weight: 20
          preference:
            matchExpressions:
              - key: workload.example.com/cost
                operator: In
                values:
                  - low
  containers:
    - name: app
      image: nginx:1.27-alpine
```

Mỗi preference match sẽ cộng weight vào điểm Node trước khi scheduler tổng hợp với các Score plugin khác. Weight cao hơn chỉ biểu thị ảnh hưởng tương đối trong Node Affinity; nó không bảo đảm Node đó thắng mọi scoring signal.

### 3.3 Kết hợp `nodeSelector` và affinity

Nếu Pod có cả `nodeSelector` và required Node Affinity, Node phải thỏa **cả hai**. Đây là nguồn phổ biến tạo tập giao rỗng.

## 4. Operator và logic kết hợp

| Operator | `values` | Ý nghĩa |
|---|---:|---|
| `In` | Bắt buộc | Label tồn tại và value thuộc danh sách |
| `NotIn` | Bắt buộc | Label tồn tại và value không thuộc danh sách |
| `Exists` | Không dùng | Key tồn tại, không quan tâm value |
| `DoesNotExist` | Không dùng | Key không tồn tại |
| `Gt` | Một value | Giá trị label được parse là integer và lớn hơn ngưỡng |
| `Lt` | Một value | Giá trị label được parse là integer và nhỏ hơn ngưỡng |

`NotIn` yêu cầu key tồn tại. Nếu muốn loại cả Node có value không mong muốn và Node thiếu label, hãy biểu diễn yêu cầu theo hướng allow-list bằng `In` khi có thể.

Logic cần nhớ:

```text
nodeSelector entries:             AND
expressions trong một term:       AND
nhiều nodeSelectorTerms:          OR
required + nodeSelector:          AND
nhiều preferred terms:            cộng weight khi match
```

## 5. Hard constraint và soft preference

Chọn hard rule khi vi phạm làm workload không thể hoặc không được phép chạy:

- Image chỉ hỗ trợ một CPU architecture.
- Node pool có thiết bị bắt buộc.
- Data residency/compliance đã được enforce bằng boundary đáng tin cậy.
- Workload cần topology tương thích với Volume.

Chọn soft preference khi Node khác vẫn chạy đúng nhưng kém tối ưu:

- Ưu tiên Node có chi phí thấp.
- Ưu tiên gần cache hoặc dependency.
- Ưu tiên một zone nhưng không muốn giảm availability khi zone đó đầy.

Hard constraint tăng tính xác định nhưng giảm feasible capacity. Soft preference tăng khả năng schedule nhưng không phải isolation control.

> [!IMPORTANT]
> Node Affinity không thay thế taint. Affinity kéo Pod về Node phù hợp; taint đẩy các Pod không được phép ra khỏi Node. Dedicated node pool thường cần cả hai.

## 6. Thiết kế label an toàn

Một label tốt cần:

- Có owner rõ: cloud provider, node provisioning system hay platform team.
- Có schema value nhỏ và ổn định; tránh nhúng dữ liệu thay đổi liên tục.
- Có quy trình add/remove khi Node vào hoặc rời pool.
- Được quan sát để phát hiện Node thiếu/sai label.
- Không bị workload tenant tùy ý sửa.

Không dùng `kubernetes.io/hostname` như một hardware ID bất biến. Giá trị label do môi trường cung cấp và chỉ phù hợp để mô tả topology hostname trong cluster đó.

Với rolling migration giữa pool cũ và mới, ưu tiên label semantic như `workload.example.com/tier=compute` thay vì tên node pool cụ thể. Điều này giảm việc sửa manifest khi hạ tầng đổi tên.

## 7. Thực hành

Lab cần quyền label Node. Chọn một Node test và lưu tên:

```bash
kubectl create namespace node-affinity-lab
kubectl get nodes
export LAB_NODE=<ten-node-test>
kubectl label node "$LAB_NODE" scheduling.example.com/lab=target
```

Tạo Pod bắt buộc chọn label vừa thêm:

```bash
cat <<'EOF' > /tmp/node-affinity-pod.yaml
apiVersion: v1
kind: Pod
metadata:
  name: selected
  namespace: node-affinity-lab
spec:
  nodeSelector:
    scheduling.example.com/lab: target
  containers:
    - name: web
      image: nginx:1.27-alpine
EOF
kubectl apply -f /tmp/node-affinity-pod.yaml
kubectl get pod selected -n node-affinity-lab -o wide
```

Cột `NODE` phải là Node đã label. Xác minh trực tiếp:

```bash
kubectl get pod selected -n node-affinity-lab \
  -o jsonpath='{.spec.nodeName}{"\n"}'
```

Xóa label khi Pod đang chạy:

```bash
kubectl label node "$LAB_NODE" scheduling.example.com/lab-
kubectl get pod selected -n node-affinity-lab -o wide
```

Pod không tự bị evict; đây là behavior `IgnoredDuringExecution`. Nếu xóa Pod để controller tạo Pod mới hoặc tự tạo lại manifest, Pod mới sẽ `Pending` vì không còn Node match.

Cleanup:

```bash
kubectl delete namespace node-affinity-lab
rm -f /tmp/node-affinity-pod.yaml
```

## 8. Troubleshooting

### Pod báo không match selector hoặc affinity

```bash
kubectl describe pod POD -n NAMESPACE
kubectl get nodes -L LABEL_KEY
kubectl get pod POD -n NAMESPACE -o yaml
```

Kiểm tra lần lượt:

1. Key có đúng prefix và spelling không.
2. Value có đúng case không; label value phân biệt hoa thường.
3. `nodeSelectorTerms` có vô tình biến OR thành AND không.
4. Có cả `nodeSelector` lẫn required affinity không.
5. Admission webhook có inject thêm rule không.
6. Node match label có bị cordon, thiếu resource hoặc có taint không được tolerate không.

### Preferred rule không được chọn

Preferred rule chỉ là một Score signal. Node mong muốn có thể bị hard filter khác loại, hoặc tổng điểm từ resource, topology và plugin khác thấp hơn. Xác nhận Node đó thực sự feasible trước khi điều chỉnh weight.

### Pod vẫn chạy sau khi label bị xóa

Đây là behavior dự kiến của `IgnoredDuringExecution`, không phải scheduler cache lỗi. Muốn thay đổi placement của Pod đã chạy, cần rollout/recreate có kiểm soát và bảo vệ availability bằng controller/PDB phù hợp.

## 9. Best practices

- Dùng label chuẩn cho OS, architecture và topology; dùng domain riêng cho taxonomy nội bộ.
- Dùng `nodeSelector` cho equality bắt buộc đơn giản; dùng affinity khi cần set, existence, range hoặc preference.
- Dùng allow-list (`In`) cho isolation thay vì nhiều rule phủ định khó audit.
- Kiểm tra feasible Node count trước khi rollout hard constraint.
- Kết hợp dedicated pool với taint/toleration, không chỉ affinity.
- Không dùng preferred affinity để thực thi security/compliance.
- Theo dõi drift của Node label và thử scheduling trong mỗi failure domain.

## Tài liệu tham khảo

- [Assigning Pods to Nodes](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/)
- [Taints và Tolerations](/scheduling/taints-tolerations/)
- [Topology Spread Constraints](/scheduling/topology-spread/)
