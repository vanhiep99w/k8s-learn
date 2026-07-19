---
title: "Topology Spread Constraints"
description: "Cách phân bố replicas qua Node, zone và failure domain bằng maxSkew, whenUnsatisfiable, minDomains, selector và topology policies."
---

# Topology Spread Constraints

## Mục lục

- [Tổng quan](#tổng-quan)
- [1. Topology domain và skew](#1-topology-domain-và-skew)
- [2. Các field cốt lõi](#2-các-field-cốt-lõi)
- [3. Cách scheduler tính phân bố](#3-cách-scheduler-tính-phân-bố)
- [4. Hard spread và soft spread](#4-hard-spread-và-soft-spread)
- [5. Spread qua Node và zone](#5-spread-qua-node-và-zone)
- [6. minDomains và eligible domains](#6-mindomains-và-eligible-domains)
- [7. Tương tác với rollout và autoscaling](#7-tương-tác-với-rollout-và-autoscaling)
- [8. Thực hành](#8-thực-hành)
- [9. Troubleshooting](#9-troubleshooting)
- [10. Best practices](#10-best-practices)
- [Tài liệu tham khảo](#tài-liệu-tham-khảo)

---

## Tổng quan

Topology Spread Constraints yêu cầu hoặc ưu tiên scheduler phân bố các Pod có cùng selector qua các **topology domain** như Node, zone hoặc rack. Primitive này phù hợp khi câu hỏi là “replicas có phân bố đủ đều không?”, thay vì “Pod này có được ở cùng Pod kia không?”.

```text
zone-a: 2 matching Pods
zone-b: 2 matching Pods
zone-c: 1 matching Pod

maxSkew=1 → phân bố hợp lệ
```

Scheduler áp dụng constraint khi đặt Pod mới. Nó không tự di chuyển Pod đang chạy để tái cân bằng sau khi thêm Node/zone.

## 1. Topology domain và skew

`topologyKey` trỏ tới label trên Node. Mỗi giá trị label là một domain:

- `kubernetes.io/hostname`: mỗi hostname là một domain, thường tương ứng một Node.
- `topology.kubernetes.io/zone`: mỗi zone là một domain.
- Label rack do platform quản lý: mỗi rack là một domain nếu Node được label nhất quán.

Scheduler đếm các Pod match `labelSelector` trong từng eligible domain. **Skew** đo độ lệch giữa số Pod ở domain candidate sau placement và minimum phù hợp theo semantics của constraint.

Ví dụ có ba zone với số đếm `2, 1, 1`. Đặt Pod tiếp theo vào zone có 2 tạo `3, 1, 1`, skew 2; đặt vào một zone có 1 tạo `2, 2, 1`, skew 1.

## 2. Các field cốt lõi

```yaml
spec:
  topologySpreadConstraints:
    - maxSkew: 1
      minDomains: 3
      topologyKey: topology.kubernetes.io/zone
      whenUnsatisfiable: DoNotSchedule
      labelSelector:
        matchLabels:
          app.kubernetes.io/name: api
```

| Field | Ý nghĩa |
|---|---|
| `maxSkew` | Độ lệch tối đa; bắt buộc và phải lớn hơn 0 |
| `topologyKey` | Node label định nghĩa domain |
| `whenUnsatisfiable` | `DoNotSchedule` để filter hoặc `ScheduleAnyway` để score |
| `labelSelector` | Chọn Pod được đếm |
| `minDomains` | Số eligible domains tối thiểu mong đợi; dùng với `DoNotSchedule` |
| `matchLabelKeys` | Bổ sung selector bằng value label lấy từ incoming Pod trên version hỗ trợ |
| `nodeAffinityPolicy` | `Honor` hoặc `Ignore` node affinity/selector khi xác định eligible domains |
| `nodeTaintsPolicy` | `Honor` hoặc `Ignore` taint khi xác định eligible domains |

Các field có feature lifecycle phụ thuộc Kubernetes minor version. `nodeAffinityPolicy` mặc định tương đương `Honor`; `nodeTaintsPolicy` mặc định tương đương `Ignore` khi không đặt. Kiểm tra API reference của cluster trước khi dùng field mới.

## 3. Cách scheduler tính phân bố

Với mỗi incoming Pod:

1. Xác định Node có topology label cần thiết.
2. Xác định eligible domains theo Node Affinity, taint policy và các điều kiện liên quan.
3. Dùng `labelSelector` để đếm matching Pods trong mỗi domain.
4. Mô phỏng đặt Pod vào từng candidate Node.
5. Filter Node nếu `DoNotSchedule` làm skew vượt giới hạn, hoặc điều chỉnh score nếu `ScheduleAnyway`.

Nhiều `topologySpreadConstraints` được kết hợp bằng logic AND. Pod có thể đồng thời yêu cầu skew theo zone và theo hostname; candidate Node phải thỏa cả hai hard constraint.

> [!IMPORTANT]
> Selector nên match label trong chính Pod template. Nếu selector không match incoming Pods, scheduler có thể đếm một tập khác với replicas bạn muốn phân bố.

## 4. Hard spread và soft spread

### 4.1 `DoNotSchedule`

Node bị loại nếu placement làm constraint không thỏa. Dùng khi độ phân bố tối thiểu là yêu cầu availability rõ ràng và chấp nhận Pod `Pending` khi failure domain thiếu.

```yaml
whenUnsatisfiable: DoNotSchedule
maxSkew: 1
```

### 4.2 `ScheduleAnyway`

Scheduler vẫn có thể chọn Node làm skew cao hơn, nhưng ưu tiên Node giúp giảm skew.

```yaml
whenUnsatisfiable: ScheduleAnyway
maxSkew: 1
```

Đây thường là default thiết kế tốt cho stateless replicas: cố phân bố nhưng không hy sinh toàn bộ capacity trong sự cố zone/Node.

| Yêu cầu | Lựa chọn |
|---|---|
| Không bao giờ dồn quá mức dù replica phải Pending | `DoNotSchedule` |
| Ưu tiên availability của replica khi topology thiếu | `ScheduleAnyway` |
| Muốn bảo đảm số zone tối thiểu | `DoNotSchedule` + `minDomains`, sau khi test capacity |

## 5. Spread qua Node và zone

Một Deployment có thể dùng hai constraints:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
spec:
  replicas: 6
  selector:
    matchLabels:
      app.kubernetes.io/name: api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: api
    spec:
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app.kubernetes.io/name: api
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels:
              app.kubernetes.io/name: api
      containers:
        - name: api
          image: nginx:1.27-alpine
          resources:
            requests:
              cpu: 50m
              memory: 32Mi
```

Thiết kế này bắt buộc cân bằng zone nhưng chỉ ưu tiên cân bằng Node. Tuy nhiên, nếu zone label thiếu hoặc chỉ một zone eligible do Node Affinity, hard zone constraint không tạo ra thêm failure domain.

## 6. minDomains và eligible domains

`minDomains` giúp biểu diễn kỳ vọng tối thiểu về số domain. Khi số eligible domains nhỏ hơn `minDomains`, global minimum dùng để tính skew được xem là 0. Điều này có thể khiến Pod mới không schedule và chờ domain khác xuất hiện.

Ví dụ:

```yaml
maxSkew: 1
minDomains: 3
topologyKey: topology.kubernetes.io/zone
whenUnsatisfiable: DoNotSchedule
```

Nếu chỉ còn hai zone eligible, cấu hình có thể giữ Pod `Pending` thay vì tiếp tục dồn replicas vào hai zone. Đây là trade-off giữa placement guarantee và service capacity.

Eligible domains không chỉ là mọi value label tồn tại. Node Affinity, Node selector, taint inclusion policy và schedulability có thể thu hẹp chúng. Khi debug, phải kiểm tra toàn bộ tập Node mà incoming Pod thật sự có thể dùng.

## 7. Tương tác với rollout và autoscaling

### 7.1 Rolling update

Trong Deployment rollout, Pod cũ và mới có thể cùng mang label app chung. Selector chỉ theo app sẽ đếm cả hai ReplicaSet, thường giúp phân bố tổng capacity. Nếu muốn chỉ đếm Pod cùng revision, `matchLabelKeys` với `pod-template-hash` có thể phù hợp trên Kubernetes version hỗ trợ; cần kiểm tra lifecycle field và behavior của admission/API server.

### 7.2 Cluster Autoscaler

Pod `Pending` vì hard spread có thể kích hoạt autoscaling nếu node group có thể tạo Node trong domain cần thiết và autoscaler hiểu constraints. Thêm Node trong cùng zone không giải quyết thiếu domain khi `minDomains` yêu cầu zone khác.

### 7.3 Scale down

Scheduler không rebalance. Sau scale-down Node hoặc thay đổi topology, phân bố của Pod đang chạy có thể lệch cho tới khi controller recreate Pod hoặc một công cụ descheduling có policy phù hợp. Mọi eviction để rebalance phải tôn trọng disruption budget và capacity.

### 7.4 Default cluster constraints

Cluster operator có thể cấu hình default topology spread constraints trong scheduler. Workload author cần biết platform defaults để tránh lặp hoặc xung đột với constraints trong Pod spec.

## 8. Thực hành

Lab hoạt động rõ nhất trên cluster có ít nhất hai Nodes. Dùng hostname để không phụ thuộc cloud zone label.

```bash
kubectl create namespace spread-lab
```

Tạo Deployment bốn replicas với soft spread:

```bash
cat <<'EOF' > /tmp/spread.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: spread-lab
spec:
  replicas: 4
  selector:
    matchLabels:
      app: spread-web
  template:
    metadata:
      labels:
        app: spread-web
    spec:
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels:
              app: spread-web
      containers:
        - name: web
          image: nginx:1.27-alpine
          resources:
            requests:
              cpu: 10m
              memory: 16Mi
EOF
kubectl apply -f /tmp/spread.yaml
kubectl rollout status deployment/web -n spread-lab
kubectl get pods -n spread-lab -o wide
```

Đếm Pod theo Node:

```bash
kubectl get pods -n spread-lab -l app=spread-web \
  -o jsonpath='{range .items[*]}{.spec.nodeName}{"\n"}{end}' \
  | sort | uniq -c
```

Output phụ thuộc số Node và các constraint khác, nhưng scheduler cố giảm chênh lệch.

Để quan sát hard constraint, đổi `ScheduleAnyway` thành `DoNotSchedule` và scale replicas lớn trong cluster có giới hạn capacity/Node. Đọc Event thay vì giả định mọi Pod phải chạy:

```bash
kubectl describe pod POD_PENDING -n spread-lab
```

Cleanup:

```bash
kubectl delete namespace spread-lab
rm -f /tmp/spread.yaml
```

## 9. Troubleshooting

### Pod Pending dù còn CPU

```bash
kubectl describe pod POD -n NAMESPACE
kubectl get nodes -L kubernetes.io/hostname,topology.kubernetes.io/zone
kubectl get pods -n NAMESPACE --show-labels -o wide
```

Kiểm tra:

1. Mọi Node có `topologyKey` không.
2. Selector đang đếm Pod nào.
3. Node Affinity có thu hẹp về một domain không.
4. Taint và `nodeTaintsPolicy` ảnh hưởng eligible domains ra sao.
5. Nhiều constraints có tạo tập giao rỗng không.
6. `minDomains` có lớn hơn topology thực tế không.

### Phân bố vẫn lệch với `ScheduleAnyway`

Đây là preference, không phải guarantee. Resource, affinity, Volume topology và Score plugin khác cùng ảnh hưởng quyết định. Pod cũ cũng không tự di chuyển sau khi thêm Node.

### Selector đếm nhầm workload

Dùng label đủ đặc hiệu, ví dụ kết hợp name và instance:

```yaml
matchLabels:
  app.kubernetes.io/name: api
  app.kubernetes.io/instance: checkout
```

Không dùng label chung như `tier=backend` nếu nhiều Deployment độc lập không nên ảnh hưởng phân bố của nhau.

## 10. Best practices

- Chuẩn hóa topology labels và kiểm tra drift trên toàn bộ Node pool.
- Dùng soft hostname spread cho đa số stateless replicas; thêm hard zone spread khi SLO và capacity cho phép.
- Đặt selector đủ đặc hiệu và match Pod template.
- Test mất Node, mất zone, rolling update, scale-up và scale-down.
- Dùng `minDomains` chỉ khi chấp nhận giảm replicas thay vì giảm số failure domains.
- Không dùng spread thay cho resource requests, taint isolation hoặc storage topology.
- Theo dõi replicas theo domain và `FailedScheduling`; scheduler không tự rebalance.

## Tài liệu tham khảo

- [Pod Topology Spread Constraints](https://kubernetes.io/docs/concepts/scheduling-eviction/topology-spread-constraints/)
- [Pod Affinity và Anti-affinity](/scheduling/pod-affinity-anti-affinity/)
- [PodDisruptionBudget](/cau-hinh/pod-disruption-budget/)
