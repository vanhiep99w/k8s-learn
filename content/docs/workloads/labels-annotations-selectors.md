---
title: "Labels, Annotations và Selectors"
description: "Tổ chức Kubernetes objects bằng labels, lưu metadata bằng annotations và dùng selectors an toàn cho controller, Service và kubectl."
---

# Labels, Annotations và Selectors

## Mục lục

- [Tổng quan](#tổng-quan)
- [1. Labels](#1-labels)
- [2. Annotations](#2-annotations)
- [3. Selectors](#3-selectors)
- [4. Selector trong controller và Service](#4-selector-trong-controller-và-service)
- [5. Schema labels khuyến nghị](#5-schema-labels-khuyến-nghị)
- [6. Thực hành](#6-thực-hành)
- [7. Lỗi thường gặp](#7-lỗi-thường-gặp)
- [8. Best practices](#8-best-practices)
- [Tài liệu tham khảo](#tài-liệu-tham-khảo)

---

## Tổng quan

Labels và annotations đều là metadata dạng key/value, nhưng mục đích khác nhau:

- **Labels** dùng để nhận diện, nhóm và chọn objects.
- **Annotations** lưu thông tin bổ sung không dùng để chọn object.
- **Selectors** là biểu thức tìm objects dựa trên labels.

```text
Pod labels: app=checkout, env=prod, track=stable
                  │
       ┌──────────┴──────────┐
       ▼                     ▼
Service selector        kubectl query
app=checkout            env=prod,app=checkout
```

> [!IMPORTANT]
> Labels không chỉ để trang trí. Service và workload controllers dùng selector để quyết định object nào nhận traffic hoặc thuộc desired replica set. Một label sai có thể gây outage.

---

## 1. Labels

Labels nằm trong `metadata.labels`:

```yaml
metadata:
  labels:
    app.kubernetes.io/name: checkout
    app.kubernetes.io/instance: checkout-prod
    app.kubernetes.io/version: "2.4.1"
    app.kubernetes.io/component: api
    app.kubernetes.io/part-of: commerce
    app.kubernetes.io/managed-by: argocd
    environment: production
```

### 1.1 Cú pháp key/value

Key có thể có prefix DNS và name, ví dụ:

```text
example.com/team: payments
```

Prefix giúp tránh collision giữa organization, tool và Kubernetes. Prefix `kubernetes.io/` và `k8s.io/` được dành cho Kubernetes.

Label value nên ngắn, ổn định và có cardinality hữu hạn. Không đặt log, JSON dài, timestamp thay đổi liên tục hoặc dữ liệu nhạy cảm vào label.

### 1.2 Labels không có uniqueness

Nhiều objects có thể dùng cùng labels. Kubernetes không bảo đảm `app=web` chỉ chọn một nhóm duy nhất. Thiết kế selector phải đủ cụ thể trong phạm vi Namespace.

---

## 2. Annotations

Annotations phù hợp với metadata mà client/controller cần đọc nhưng không dùng để nhóm object:

```yaml
metadata:
  annotations:
    example.com/owner: "team-checkout"
    example.com/runbook: "https://runbooks.example.com/checkout"
    example.com/git-commit: "7f20a19"
    example.com/change-ticket: "CHG-1042"
```

Use cases:

- URL runbook, dashboard hoặc source repository.
- Build/version provenance.
- Cấu hình cho Ingress controller, service mesh hoặc policy tool.
- Checksum để kích hoạt rollout khi config đổi.
- Thông tin cho automation.

Annotations không được index bằng label selector. Dữ liệu nhạy cảm vẫn phải dùng Secret; annotation có thể được người có quyền đọc object nhìn thấy.

---

## 3. Selectors

### 3.1 Equality-based

```bash
kubectl get pods -l app=checkout
kubectl get pods -l app==checkout
kubectl get pods -l environment!=production
```

Nhiều điều kiện phân tách bằng dấu phẩy có quan hệ AND:

```bash
kubectl get pods -l 'app=checkout,environment=production'
```

### 3.2 Set-based

```bash
kubectl get pods -l 'environment in (staging,production)'
kubectl get pods -l 'tier notin (frontend)'
kubectl get pods -l 'canary'
kubectl get pods -l '!deprecated'
```

Ý nghĩa:

- `in`: value thuộc tập.
- `notin`: value không thuộc tập.
- `key`: key tồn tại.
- `!key`: key không tồn tại.

Selector không hỗ trợ OR tổng quát giữa hai key khác nhau. Có thể chạy nhiều query hoặc thiết kế thêm label biểu diễn nhóm cần chọn.

---

## 4. Selector trong controller và Service

Deployment dùng selector để xác định Pods thuộc ReplicaSet, còn Service dùng selector để tìm backend:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout
spec:
  selector:
    matchLabels:
      app: checkout
      track: stable
  template:
    metadata:
      labels:
        app: checkout
        track: stable
    spec:
      containers:
        - name: app
          image: nginx:1.27-alpine
---
apiVersion: v1
kind: Service
metadata:
  name: checkout
spec:
  selector:
    app: checkout
    track: stable
  ports:
    - port: 80
      targetPort: 80
```

Invariant bắt buộc:

```text
Deployment selector ⊆ Pod template labels
```

Nếu Service selector không khớp Pod labels, Service vẫn tồn tại nhưng EndpointSlice không có backend.

### 4.1 Selector overlap nguy hiểm

Hai ReplicaSets trong cùng Namespace có selector overlap có thể tranh Pods. Controller selector nên đại diện ownership ổn định và không chồng lấn.

### 4.2 Selector thường immutable

Selector của Deployment không nên và thường không thể đổi sau khi tạo. Đổi selector có thể thay đổi ownership semantics; cách an toàn là tạo workload mới với tên/selector mới rồi chuyển traffic.

---

## 5. Schema labels khuyến nghị

Kubernetes khuyến nghị nhóm `app.kubernetes.io/*` để các workload, Service, dashboard, Helm chart, GitOps tool và script vận hành cùng hiểu metadata theo một ngôn ngữ chung. Đây không phải cú pháp đặc biệt của Deployment; nó vẫn chỉ là label key/value bình thường. Điểm khác biệt là cộng đồng đã thống nhất ý nghĩa của từng key.

Nếu mỗi team tự đặt label theo cách riêng, cùng một ý “tên ứng dụng” có thể thành `app`, `service`, `application`, `name` hoặc `component`. Khi đó query và automation dễ bị lệch. Nhóm `app.kubernetes.io/*` giảm vấn đề này bằng một schema ổn định hơn:

| Label | Ý nghĩa | Ví dụ |
|---|---|---|
| `app.kubernetes.io/name` | Tên ứng dụng hoặc service logic | `checkout` |
| `app.kubernetes.io/instance` | Một bản triển khai cụ thể của app | `checkout-prod` |
| `app.kubernetes.io/version` | Version app đang chạy | `2.4.1` |
| `app.kubernetes.io/component` | Thành phần trong kiến trúc | `api` |
| `app.kubernetes.io/part-of` | Hệ thống/sản phẩm cấp cao hơn | `commerce` |
| `app.kubernetes.io/managed-by` | Tool quản lý object | `argocd` |

Ví dụ đọc nhanh một object có labels sau:

```yaml
labels:
  app.kubernetes.io/name: checkout
  app.kubernetes.io/instance: checkout-prod
  app.kubernetes.io/component: api
  app.kubernetes.io/part-of: commerce
  app.kubernetes.io/managed-by: argocd
```

Bạn có thể hiểu: đây là component `api` của ứng dụng `checkout`, instance production, thuộc hệ thống `commerce`, và đang được Argo CD quản lý.

Các label này cũng giúp query rõ hơn:

```bash
kubectl get pods -l app.kubernetes.io/name=checkout
kubectl get pods -l app.kubernetes.io/instance=checkout-prod
kubectl get all -l app.kubernetes.io/part-of=commerce
```

Không cần ép mọi label vào selector của Deployment, ReplicaSet hoặc Service. Selector nên dùng các identity labels ổn định như `app.kubernetes.io/name` và `app.kubernetes.io/instance`. Tránh đưa label thay đổi thường xuyên như `app.kubernetes.io/version` vào selector của Deployment, vì đổi selector sau khi tạo workload là thao tác nhạy cảm và thường không nên làm.

Ví dụ tách identity và operations:

```yaml
labels:
  app.kubernetes.io/name: checkout
  app.kubernetes.io/instance: checkout-prod
  app.kubernetes.io/version: "2.4.1"
  environment: production
  team: payments
  track: stable
```

Trong ví dụ này, `name` và `instance` phù hợp để nhận diện workload ổn định; `version`, `environment`, `team`, `track` hữu ích cho quan sát, lọc hoặc rollout strategy tùy hệ thống, nhưng không nhất thiết phải nằm trong selector.

---

## 6. Thực hành

Tạo ba Pods:

```bash
kubectl create namespace metadata-lab
kubectl run web-prod --image=nginx:1.27-alpine -n metadata-lab \
  --labels='app=web,environment=production,tier=frontend'
kubectl run api-prod --image=nginx:1.27-alpine -n metadata-lab \
  --labels='app=api,environment=production,tier=backend'
kubectl run web-stage --image=nginx:1.27-alpine -n metadata-lab \
  --labels='app=web,environment=staging,tier=frontend'
```

Truy vấn:

```bash
kubectl get pods -n metadata-lab --show-labels
kubectl get pods -n metadata-lab -l app=web
kubectl get pods -n metadata-lab -l 'environment=production,tier in (frontend,backend)'
kubectl get pods -n metadata-lab -L app,environment,tier
```

Thêm và xóa metadata:

```bash
kubectl label pod web-stage -n metadata-lab environment=production --overwrite
kubectl annotate pod web-prod -n metadata-lab \
  example.com/runbook='https://example.com/runbook'
kubectl label pod web-stage -n metadata-lab tier-
kubectl annotate pod web-prod -n metadata-lab example.com/runbook-
```

> [!CAUTION]
> Sửa label của Pod đang được Service/controller quản lý có thể lập tức đổi traffic hoặc ownership. Lab dùng Pod trần; production nên sửa source manifest và review diff.

Xóa lab:

```bash
kubectl delete namespace metadata-lab
```

---

## 7. Lỗi thường gặp

### 7.1 Service không có endpoints

```bash
kubectl get service <service> -n <namespace> -o yaml
kubectl get pods -n <namespace> --show-labels
kubectl get endpointslices -n <namespace> \
  -l kubernetes.io/service-name=<service>
```

So sánh từng key/value và readiness của Pod.

### 7.2 Deployment không hợp lệ

Lỗi thường do `spec.selector.matchLabels` không khớp `spec.template.metadata.labels`. Validate server-side:

```bash
kubectl apply --dry-run=server -f manifest.yaml
```

### 7.3 Query trả quá nhiều objects

Selector quá rộng, ví dụ chỉ dùng `app=web` cho nhiều instance. Thêm identity như `app.kubernetes.io/instance` hoặc Namespace boundary.

### 7.4 Cardinality quá cao

Đặt request ID/timestamp vào labels làm tăng metadata churn và gây khó cho metrics/cost systems. Dùng logs/traces hoặc annotation nếu thật sự cần gắn vào object.

---

## 8. Best practices

- Xây schema label dùng chung cho organization.
- Dùng prefix domain cho key tùy chỉnh.
- Giữ controller selector ổn định, cụ thể và không overlap.
- Đảm bảo Service selector có thể kiểm tra bằng EndpointSlice.
- Không đặt Secret hoặc PII trong labels/annotations.
- Dùng annotations cho runbook, commit và metadata của automation.
- Sửa labels qua source of truth thay vì patch tay trong production.
- Kiểm tra selector bằng `kubectl get -l` trước khi delete hoặc mutate hàng loạt.
- Đặt label cardinality có giới hạn và tránh churn không cần thiết.

Tiếp tục với [Namespaces](/workloads/namespaces/) để thêm ranh giới tên và policy cho resources.

---

## Tài liệu tham khảo

- [Labels and Selectors](https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/)
- [Annotations](https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations/)
- [Recommended Labels](https://kubernetes.io/docs/concepts/overview/working-with-objects/common-labels/)
