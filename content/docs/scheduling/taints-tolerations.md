---
title: "Taints và Tolerations"
description: "Cơ chế taint trên Node và toleration trên Pod, các effect NoSchedule, PreferNoSchedule, NoExecute, node-condition taints và mô hình dedicated node pool."
---

# Taints và Tolerations

## Mục lục

- [Tổng quan](#tổng-quan)
- [1. Cú pháp và matching](#1-cú-pháp-và-matching)
- [2. Ba taint effect](#2-ba-taint-effect)
- [3. Toleration không phải attraction](#3-toleration-không-phải-attraction)
- [4. Dedicated Node](#4-dedicated-node)
- [5. Node-condition taints và eviction](#5-node-condition-taints-và-eviction)
- [6. Toleration trong Pod manifest](#6-toleration-trong-pod-manifest)
- [7. Thực hành](#7-thực-hành)
- [8. Troubleshooting](#8-troubleshooting)
- [9. Best practices](#9-best-practices)
- [Tài liệu tham khảo](#tài-liệu-tham-khảo)

---

## Tổng quan

Taint gắn vào Node để **đẩy ra** các Pod không phù hợp. Toleration gắn vào Pod để cho phép Pod chịu một taint cụ thể. Scheduler lấy các taint trên Node, loại những taint mà Pod match bằng toleration, rồi xử lý các taint chưa được tolerate theo effect.

```text
Node: dedicated=ml:NoSchedule

Pod không có toleration       → Node bị loại
Pod tolerate dedicated=ml    → Node có thể được xét
```

Toleration chỉ mở cửa; nó không kéo Pod đến Node đó và không dự trữ Node. Dedicated node pool thường kết hợp taint/toleration với Node Affinity.

## 1. Cú pháp và matching

Thêm taint:

```bash
kubectl taint nodes NODE_NAME dedicated=ml:NoSchedule
```

Một taint có ba phần:

```text
key = value : effect
```

`value` có thể rỗng. `effect` là `NoSchedule`, `PreferNoSchedule` hoặc `NoExecute`.

Toleration match theo `key`, `operator`, `value` và `effect`:

```yaml
tolerations:
  - key: dedicated
    operator: Equal
    value: ml
    effect: NoSchedule
```

Hai operator:

- `Equal`: `key`, `value` và effect phải phù hợp; đây là default khi bỏ `operator`.
- `Exists`: chỉ cần key và effect phù hợp; không đặt `value`.

Nếu bỏ `effect`, toleration match mọi effect có cùng key/value theo operator. Một toleration với `operator: Exists` và không có `key` match rất rộng; tránh dùng trừ khi hiểu rõ blast radius.

## 2. Ba taint effect

### 2.1 `NoSchedule`

Scheduler không đặt Pod mới lên Node nếu còn taint `NoSchedule` chưa được tolerate. Pod đang chạy không tự bị evict khi taint được thêm.

Dùng cho dedicated pool, Node chưa sẵn sàng nhận workload hoặc nhóm hardware chỉ dành cho Pod được phép.

### 2.2 `PreferNoSchedule`

Scheduler cố tránh Node nhưng có thể vẫn đặt Pod vào đó nếu cần. Đây là soft constraint, phù hợp cho migration hoặc capacity preference không tuyệt đối.

### 2.3 `NoExecute`

Effect này tác động cả placement mới và Pod đã bind:

- Pod mới không được schedule nếu không tolerate.
- Pod đang chạy không tolerate có thể bị evict.
- Pod tolerate không có `tolerationSeconds` có thể ở lại khi taint còn tồn tại.
- Pod có `tolerationSeconds` được ở lại trong khoảng thời gian đó, sau đó bị evict nếu taint vẫn còn.

```yaml
tolerations:
  - key: maintenance.example.com/drain
    operator: Exists
    effect: NoExecute
    tolerationSeconds: 60
```

> [!WARNING]
> Thêm `NoExecute` vào Node production có thể làm nhiều Pod bị evict gần như đồng thời. Kiểm tra workload, PDB, capacity còn lại và rollback command trước khi thao tác.

## 3. Toleration không phải attraction

Giả sử cluster có Node thường và Node GPU mang taint `accelerator=gpu:NoSchedule`. Pod có toleration này nhưng không có Node Affinity hay GPU resource request vẫn có thể chạy trên Node thường.

Để placement đầy đủ:

```text
Taint + toleration  → ngăn Pod không được phép vào pool
Node affinity       → kéo workload đúng về pool
Resource request    → cấp phát thiết bị nếu pool có extended resource
```

Với GPU, request extended resource thường tự giới hạn feasible Nodes vào Node advertise GPU. Taint vẫn hữu ích để tránh workload thường dùng CPU/memory của Node đắt tiền.

## 4. Dedicated Node

Thiết kế pool `ml`:

1. Label Node để workload chọn pool.
2. Taint Node để workload khác bị loại.
3. Pod dùng required Node Affinity và matching toleration.

```bash
kubectl label node NODE_NAME workload.example.com/pool=ml
kubectl taint node NODE_NAME dedicated=ml:NoSchedule
```

Pod template:

```yaml
spec:
  nodeSelector:
    workload.example.com/pool: ml
  tolerations:
    - key: dedicated
      operator: Equal
      value: ml
      effect: NoSchedule
  containers:
    - name: trainer
      image: example.invalid/ml-trainer:VERSION
```

`example.invalid` là placeholder; thay bằng image thật. Trong workload accelerator thực tế, thêm extended resource request phù hợp.

Taint không phải security boundary hoàn chỉnh. RBAC/admission phải kiểm soát ai có thể thêm toleration và dùng pool nhạy cảm.

## 5. Node-condition taints và eviction

Control plane biểu diễn nhiều Node condition thành taint, gồm các key thường gặp:

- `node.kubernetes.io/not-ready`
- `node.kubernetes.io/unreachable`
- `node.kubernetes.io/memory-pressure`
- `node.kubernetes.io/disk-pressure`
- `node.kubernetes.io/pid-pressure`
- `node.kubernetes.io/network-unavailable`
- `node.kubernetes.io/unschedulable`

Tùy condition, scheduler dùng taint để tránh placement và taint-eviction controller xử lý `NoExecute` eviction.

API server tự thêm toleration 300 giây cho `not-ready` và `unreachable` vào Pod thông thường nếu Pod không cung cấp toleration tương ứng. Điều này tránh evict ngay vì một gián đoạn ngắn. DaemonSet Pods nhận một số toleration condition đặc thù để agent node-level có thể tiếp tục tồn tại.

> [!IMPORTANT]
> Tăng `tolerationSeconds` không làm Node phục hồi nhanh hơn. Nó chỉ thay đổi thời điểm Pod bị evict. Giá trị dài giảm churn trong network partition ngắn nhưng kéo dài thời gian workload bị mắc trên Node thật sự đã mất.

Ví dụ workload stateful chấp nhận chờ 30 giây khi Node unreachable:

```yaml
tolerations:
  - key: node.kubernetes.io/unreachable
    operator: Exists
    effect: NoExecute
    tolerationSeconds: 30
  - key: node.kubernetes.io/not-ready
    operator: Exists
    effect: NoExecute
    tolerationSeconds: 30
```

Quyết định này phải phù hợp với storage fencing, application failover và mục tiêu availability; eviction object không bảo đảm process cũ đã dừng trên Node partitioned.

## 6. Toleration trong Pod manifest

### Match taint có value

```yaml
tolerations:
  - key: workload.example.com/class
    operator: Equal
    value: batch
    effect: NoSchedule
```

### Match mọi value của một key

```yaml
tolerations:
  - key: workload.example.com/class
    operator: Exists
    effect: NoSchedule
```

### Match mọi effect của key

```yaml
tolerations:
  - key: workload.example.com/class
    operator: Equal
    value: batch
```

Cấu hình càng rộng càng khó audit. Ghi `effect` rõ khi workload chỉ cần một behavior.

Nhiều taint được xử lý như bộ lọc: bỏ các taint được tolerate; effect của các taint còn lại quyết định kết quả. Chỉ một `NoSchedule` chưa được tolerate cũng đủ loại Node.

## 7. Thực hành

Lab cần quyền sửa Node. Chọn Node không phải Node duy nhất phục vụ workload quan trọng.

```bash
kubectl create namespace taint-lab
kubectl get nodes
export LAB_NODE=<ten-node-test>
kubectl taint node "$LAB_NODE" scheduling.example.com/lab=true:NoSchedule
```

Tạo Pod vừa chọn đúng Node vừa không có toleration:

```bash
cat <<EOF > /tmp/taint-blocked.yaml
apiVersion: v1
kind: Pod
metadata:
  name: blocked
  namespace: taint-lab
spec:
  nodeSelector:
    kubernetes.io/hostname: ${LAB_NODE}
  containers:
    - name: pause
      image: registry.k8s.io/pause:3.10
EOF
kubectl apply -f /tmp/taint-blocked.yaml
kubectl describe pod blocked -n taint-lab
```

Expected state: Pod `Pending`, Event nêu taint không được tolerate. Tạo Pod thứ hai có toleration:

```bash
cat <<EOF > /tmp/taint-allowed.yaml
apiVersion: v1
kind: Pod
metadata:
  name: allowed
  namespace: taint-lab
spec:
  nodeSelector:
    kubernetes.io/hostname: ${LAB_NODE}
  tolerations:
    - key: scheduling.example.com/lab
      operator: Equal
      value: "true"
      effect: NoSchedule
  containers:
    - name: pause
      image: registry.k8s.io/pause:3.10
EOF
kubectl apply -f /tmp/taint-allowed.yaml
kubectl get pods -n taint-lab -o wide
```

`allowed` phải được bind vào `$LAB_NODE` nếu Node còn schedulable và đủ resource.

Cleanup taint bằng cùng key/value/effect với dấu `-`:

```bash
kubectl taint node "$LAB_NODE" scheduling.example.com/lab=true:NoSchedule-
kubectl delete namespace taint-lab
rm -f /tmp/taint-blocked.yaml /tmp/taint-allowed.yaml
```

Luôn xác minh taint đã được xóa:

```bash
kubectl describe node "$LAB_NODE" | grep -A2 '^Taints:'
```

## 8. Troubleshooting

### Pod Pending vì taint

```bash
kubectl describe pod POD -n NAMESPACE
kubectl get node NODE -o jsonpath='{.spec.taints}{"\n"}'
kubectl get pod POD -n NAMESPACE -o jsonpath='{.spec.tolerations}{"\n"}'
```

So sánh exact key, value, operator và effect. Kiểm tra admission controller có thêm taint/toleration không.

### Pod có toleration nhưng không vào dedicated Node

Đây thường là hiểu nhầm “toleration kéo Pod”. Thêm Node Affinity/selector hoặc request extended resource để biểu diễn attraction. Đồng thời kiểm tra resource và các hard constraint khác.

### Pod bị evict sau Node failure

Đọc Pod Event, Node conditions và taints theo timeline:

```bash
kubectl describe node NODE
kubectl get events -A --sort-by=.lastTimestamp
```

Không xóa Pod mới trước khi xác minh Node cũ, Volume attachment và fencing. Với StatefulSet, việc tạo replacement an toàn phụ thuộc storage/application semantics.

### Không xóa được taint

Removal command phải khớp key và effect. Liệt kê JSON trước, sau đó dùng:

```bash
kubectl taint node NODE key:Effect-
```

Có thể bỏ value khi remove theo key/effect.

## 9. Best practices

- Kết hợp taint với affinity cho dedicated pool.
- Giới hạn RBAC/admission để tenant không tự thêm toleration đặc quyền.
- Dùng key thuộc domain tổ chức và ghi owner/lifecycle.
- Ưu tiên `NoSchedule`; chỉ dùng `NoExecute` khi đã đánh giá eviction blast radius.
- Thiết kế `tolerationSeconds` cùng failover, fencing, RTO và failure detection.
- Không xóa taint pressure do controller tạo để che lỗi Node; xử lý disk/memory/PID pressure gốc.
- Test mất Node, drain và autoscaling cho từng pool.
- Alert khi Node pool thiếu label/taint hoặc Pod Pending vì untolerated taint.

## Tài liệu tham khảo

- [Taints and Tolerations](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/)
- [nodeSelector và Node Affinity](/scheduling/node-selector/)
- [Extended Resources và Device Plugins](/scheduling/extended-resources-device-plugins/)
