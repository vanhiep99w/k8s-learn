---
title: "PriorityClass"
description: "Cách PriorityClass xác định thứ tự scheduling và quyền preemption, gồm globalDefault, preemptionPolicy, governance và kiểm chứng trên workload."
---

# PriorityClass

## Mục lục

- [Tổng quan](#tổng-quan)
- [1. Priority ảnh hưởng điều gì](#1-priority-ảnh-hưởng-điều-gì)
- [2. Cấu trúc PriorityClass](#2-cấu-trúc-priorityclass)
- [3. Gán priority cho Pod](#3-gán-priority-cho-pod)
- [4. Preempting và non-preempting](#4-preempting-và-non-preempting)
- [5. globalDefault và system PriorityClass](#5-globaldefault-và-system-priorityclass)
- [6. Thiết kế taxonomy priority](#6-thiết-kế-taxonomy-priority)
- [7. Security và multi-tenancy](#7-security-và-multi-tenancy)
- [8. Thực hành](#8-thực-hành)
- [9. Troubleshooting](#9-troubleshooting)
- [10. Best practices](#10-best-practices)
- [Tài liệu tham khảo](#tài-liệu-tham-khảo)

---

## Tổng quan

`PriorityClass` là resource cluster-scoped ánh xạ một tên ổn định sang giá trị priority số nguyên. Pod tham chiếu tên qua `spec.priorityClassName`; admission điền giá trị vào `spec.priority`. Scheduler dùng priority để ưu tiên Pod trong queue và, nếu policy cho phép, cân nhắc preempt Pod priority thấp hơn.

```text
PriorityClass name
      │ admission lookup
      ▼
Pod.spec.priority
      │
      ├─ thứ tự trong scheduling queue
      └─ khả năng preempt Pod priority thấp hơn
```

Priority không tạo thêm CPU, không bỏ qua affinity/taint và không bảo đảm application quan trọng sẽ `Ready`. Nó chỉ thay đổi thứ tự cạnh tranh và quyền giải phóng resource qua preemption.

## 1. Priority ảnh hưởng điều gì

### 1.1 Thứ tự scheduling

Pod priority cao thường được xét trước Pod priority thấp trong active queue. Scheduler vẫn áp dụng backoff; một Pod priority cao nhưng không thể schedule không nhất thiết chặn tuyệt đối mọi Pod phía sau.

### 1.2 Preemption

Nếu Pod priority cao không có Node phù hợp vì resource đang được Pod priority thấp giữ, scheduler có thể chọn victims để giải phóng đủ resource. Cơ chế chi tiết nằm ở [Pod Preemption](/scheduling/preemption/).

### 1.3 Priority không vượt hard constraints

Pod priority cao vẫn `Pending` nếu:

- Không có Node match required affinity.
- Không tolerate taint bắt buộc.
- PVC/Volume topology không phù hợp.
- Request extended resource không tồn tại.
- Giải phóng mọi Pod priority thấp vẫn không đủ resource.

Event `preemption is not helpful` thường cho biết vấn đề không thể giải chỉ bằng việc xóa workload thấp hơn.

## 2. Cấu trúc PriorityClass

```yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: platform-critical
value: 900000
globalDefault: false
preemptionPolicy: PreemptLowerPriority
description: "Dành cho platform service cần phục hồi trước workload thông thường"
```

| Field | Ý nghĩa |
|---|---|
| `metadata.name` | Tên Pod tham chiếu qua `priorityClassName` |
| `value` | Priority số nguyên; lớn hơn nghĩa priority cao hơn |
| `globalDefault` | Nếu `true`, áp dụng cho Pod không chỉ định class |
| `preemptionPolicy` | `PreemptLowerPriority` hoặc `Never` |
| `description` | Mục đích và policy sử dụng |

Kubernetes cho phép giá trị tới 1 tỷ cho PriorityClass do người dùng tạo; giá trị lớn hơn được dành cho system-critical classes. Không cần dùng số sát giới hạn. Quan trọng là thứ tự tương đối và khoảng trống để thêm tier sau này.

`value` không thể thay đổi trên PriorityClass đã tạo. Muốn đổi, cần tạo class mới hoặc thay thế resource có đánh giá migration; thay class có thể ảnh hưởng admission của Pod mới.

## 3. Gán priority cho Pod

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
    spec:
      priorityClassName: platform-critical
      containers:
        - name: api
          image: nginx:1.27-alpine
          resources:
            requests:
              cpu: 100m
              memory: 64Mi
```

Kiểm tra name và numeric value trên Pod:

```bash
kubectl get pod POD -o custom-columns=NAME:.metadata.name,CLASS:.spec.priorityClassName,PRIORITY:.spec.priority
```

Nếu class không tồn tại, API request tạo Pod bị từ chối. Vì vậy, triển khai PriorityClass trước workload tham chiếu và không xóa class khi template còn dùng.

Priority được ghi vào từng Pod. Thay `priorityClassName` trong Deployment template tạo rollout Pod mới; nó không đổi in-place priority của Pod cũ.

## 4. Preempting và non-preempting

### 4.1 `PreemptLowerPriority`

Đây là default `preemptionPolicy`. Pod có thể preempt Pod priority thấp hơn khi scheduler tìm được Node candidate phù hợp.

```yaml
preemptionPolicy: PreemptLowerPriority
```

Dùng khi workload thật sự quan trọng hơn việc giữ workload thấp hơn chạy liên tục, và platform đã thiết kế victim workloads có thể bị gián đoạn.

### 4.2 `Never`

Non-preempting PriorityClass cho Pod đứng trước trong queue nhưng không đẩy Pod khác ra:

```yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: batch-urgent
value: 50000
globalDefault: false
preemptionPolicy: Never
description: "Xếp hàng trước batch thường nhưng không hủy công việc đang chạy"
```

Phù hợp với job đắt tiền: job urgent được schedule sớm khi capacity tự giải phóng nhưng không làm mất tiến độ job khác. Pod này vẫn có thể bị Pod priority cao hơn preempt.

## 5. globalDefault và system PriorityClass

Chỉ nên có tối đa một PriorityClass với `globalDefault: true`. Pod không chỉ định `priorityClassName` dùng giá trị của global default; nếu không có global default, priority của Pod mặc định là 0.

Đặt global default khác 0 là thay đổi policy toàn cluster. Workload legacy không khai báo class cũng bị ảnh hưởng. Thường an toàn hơn khi yêu cầu workload quan trọng chọn class tường minh.

Kubernetes cung cấp các class `system-cluster-critical` và `system-node-critical` cho component hệ thống. Không gán chúng cho application để “chữa” thiếu capacity. Lạm dụng có thể làm application cạnh tranh hoặc preempt control-plane/add-on quan trọng.

## 6. Thiết kế taxonomy priority

Một taxonomy ví dụ, không phải default Kubernetes:

| Class | Value ví dụ | Preemption | Mục đích |
|---|---:|---|---|
| `platform-critical` | 900000 | Có | DNS, policy/webhook quan trọng đã được phê duyệt |
| `service-critical` | 100000 | Có | Dịch vụ có SLO cao và victim plan rõ |
| `service-standard` | 10000 | Không | Dịch vụ online ưu tiên queue nhưng tránh disruption |
| `batch-urgent` | 1000 | Không | Batch deadline gần |
| Không class | 0 | Theo default | Workload thông thường |
| `batch-preemptible` | -1000 | Có thể bị preempt | Batch restart/checkpoint được |

Giá trị âm hợp lệ và hữu ích cho opportunistic workload. Để khoảng trống giữa tier, vì `value` immutable và taxonomy có thể mở rộng.

Mỗi class cần ghi:

- Owner và workload đủ điều kiện.
- Queue intent và preemption policy.
- Victim class có thể bị ảnh hưởng.
- Availability/capacity assumption.
- Alert và quy trình review.

## 7. Security và multi-tenancy

Priority cao là quyền tiêu thụ capacity và gây disruption. Trong cluster nhiều tenant:

- Giới hạn ai được create/update/delete PriorityClass bằng RBAC.
- Dùng admission policy để giới hạn `priorityClassName` theo Namespace, ServiceAccount hoặc tenant.
- Kết hợp ResourceQuota để priority không trở thành cách vượt capacity governance.
- Audit Pod dùng class critical và theo dõi preemption Event.
- Không dựa vào naming convention tự nguyện.

`PriorityClass` là cluster-scoped nên một thay đổi có blast radius vượt Namespace. Application team thường chỉ cần quyền tham chiếu class đã được duyệt, không cần quản trị class.

## 8. Thực hành

Lab này xác minh admission và numeric priority, không cố ép preemption vì capacity khác nhau giữa các cluster.

Tạo hai class:

```bash
cat <<'EOF' > /tmp/priority-lab.yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: lab-high-nonpreempting
value: 10000
globalDefault: false
preemptionPolicy: Never
description: "Temporary scheduling lab"
---
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: lab-low
value: -1000
globalDefault: false
preemptionPolicy: PreemptLowerPriority
description: "Temporary scheduling lab"
EOF
kubectl apply -f /tmp/priority-lab.yaml
kubectl get priorityclasses
```

Tạo Namespace và hai Pods:

```bash
kubectl create namespace priority-lab
kubectl run high -n priority-lab \
  --image=registry.k8s.io/pause:3.10 \
  --restart=Never \
  --overrides='{"spec":{"priorityClassName":"lab-high-nonpreempting"}}'
kubectl run low -n priority-lab \
  --image=registry.k8s.io/pause:3.10 \
  --restart=Never \
  --overrides='{"spec":{"priorityClassName":"lab-low"}}'
```

Xác minh:

```bash
kubectl get pods -n priority-lab \
  -o custom-columns=NAME:.metadata.name,CLASS:.spec.priorityClassName,VALUE:.spec.priority,NODE:.spec.nodeName
```

Expected values là `10000` và `-1000`. Việc cả hai cùng chạy chỉ cho thấy cluster có capacity; không phủ định priority.

Cleanup:

```bash
kubectl delete namespace priority-lab
kubectl delete priorityclass lab-high-nonpreempting lab-low
rm -f /tmp/priority-lab.yaml
```

## 9. Troubleshooting

### Pod bị reject khi tạo

```bash
kubectl get priorityclass
kubectl get deployment DEPLOYMENT -o jsonpath='{.spec.template.spec.priorityClassName}{"\n"}'
```

Class có thể sai tên hoặc chưa được tạo. Kiểm tra admission policy nếu class tồn tại nhưng request vẫn bị từ chối.

### Pod priority cao vẫn Pending

Đọc `FailedScheduling`:

```bash
kubectl describe pod POD -n NAMESPACE
```

Phân biệt thiếu resource có thể preempt với hard constraint không thể preempt. Nếu class có `preemptionPolicy: Never`, scheduler sẽ không chọn victims.

### Workload không mong muốn bị gián đoạn

Tìm Event có reason liên quan preemption, đọc `nominatedNodeName`, priority của preemptor/victims và PDB. Thu thập evidence trước khi hạ priority hoặc recreate Pod; thay đổi vội có thể tạo vòng preemption mới.

### Xóa class làm rollout lỗi

Pod cũ có thể còn tồn tại, nhưng controller không tạo Pod mới tham chiếu class đã mất. Khôi phục PriorityClass cùng policy đã duyệt hoặc đổi template sang class hợp lệ rồi xác minh rollout.

## 10. Best practices

- Dùng số tier nhỏ, khoảng cách rõ và description có owner.
- Chỉ cấp preempting priority khi có victim policy và capacity analysis.
- Ưu tiên `preemptionPolicy: Never` nếu chỉ cần queue ordering.
- Không gán system-critical class cho application.
- Quản trị quyền dùng class bằng admission, RBAC và quota.
- Theo dõi Pod Pending theo priority, preemption rate và victim restart.
- Test overload, Node loss và rolling update; priority không thay thế capacity hoặc topology design.

## Tài liệu tham khảo

- [Pod Priority and Preemption](https://kubernetes.io/docs/concepts/scheduling-eviction/pod-priority-preemption/)
- [Pod Preemption](/scheduling/preemption/)
- [ResourceQuota và LimitRange](/cau-hinh/resource-quota-limitrange/)
