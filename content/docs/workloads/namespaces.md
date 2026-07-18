---
title: "Namespaces"
description: "Dùng Namespace để phân vùng tên và phạm vi policy trong Kubernetes; hiểu giới hạn isolation, DNS, context và quy trình xóa an toàn."
---

# Namespaces

## Mục lục

- [Tổng quan](#tổng-quan)
- [1. Namespaced và cluster-scoped resources](#1-namespaced-và-cluster-scoped-resources)
- [2. Namespace cung cấp và không cung cấp điều gì](#2-namespace-cung-cấp-và-không-cung-cấp-điều-gì)
- [3. Namespace mặc định](#3-namespace-mặc-định)
- [4. Truy cập resource giữa Namespaces](#4-truy-cập-resource-giữa-namespaces)
- [5. Thiết kế Namespace](#5-thiết-kế-namespace)
- [6. Context và thao tác an toàn](#6-context-và-thao-tác-an-toàn)
- [7. Policy theo Namespace](#7-policy-theo-namespace)
- [8. Xóa Namespace và trạng thái Terminating](#8-xóa-namespace-và-trạng-thái-terminating)
- [9. Thực hành](#9-thực-hành)
- [10. Best practices](#10-best-practices)
- [Tài liệu tham khảo](#tài-liệu-tham-khảo)

---

## Tổng quan

Namespace là ranh giới logic trong một cluster. Nó cho phép nhiều object có cùng tên ở các Namespace khác nhau và tạo scope để áp dụng RBAC, quota, policy mạng hoặc cấu hình mặc định.

```text
Cluster
├── namespace: team-a
│   ├── Deployment/api
│   └── Service/api
└── namespace: team-b
    ├── Deployment/api
    └── Service/api
```

`team-a/api` và `team-b/api` là hai objects khác nhau.

> [!IMPORTANT]
> Namespace không phải security boundary hoàn chỉnh. Isolation thực tế cần kết hợp RBAC, NetworkPolicy, ResourceQuota, Pod Security, Secret management và đôi khi cluster riêng.

---

## 1. Namespaced và cluster-scoped resources

Resources namespaced:

- Pod, Deployment, StatefulSet, DaemonSet.
- Service, Ingress, NetworkPolicy.
- ConfigMap, Secret, ServiceAccount.
- Job, CronJob, PVC.
- Role, RoleBinding.

Resources cluster-scoped:

- Node, Namespace.
- PersistentVolume, StorageClass.
- ClusterRole, ClusterRoleBinding.
- CustomResourceDefinition.

Khám phá bằng API:

```bash
kubectl api-resources --namespaced=true
kubectl api-resources --namespaced=false
```

Tên chỉ cần unique trong scope của resource. `Node/worker-1` là cluster-wide; `Pod/api` có thể lặp giữa Namespaces.

---

## 2. Namespace cung cấp và không cung cấp điều gì

### 2.1 Namespace cung cấp

- Name scope.
- API query scope.
- Scope cho RBAC Role/RoleBinding.
- Điểm gắn ResourceQuota, LimitRange, NetworkPolicy.
- Lifecycle cleanup theo nhóm khi xóa Namespace.
- Boundary tổ chức cho team, tenant hoặc environment.

### 2.2 Namespace không tự cung cấp

- Network isolation: mặc định Pods khác Namespace vẫn có thể giao tiếp.
- Node isolation: Scheduler có thể đặt Pods các Namespace trên cùng Node.
- Strong tenant isolation: kernel và cluster control plane vẫn dùng chung.
- Cost limit: cần requests, quotas và reporting.
- Permission isolation: cần RBAC.

Namespace chỉ là foundation để policy khác dựa vào.

---

## 3. Namespace mặc định

Các Namespace thường thấy:

| Namespace | Mục đích |
|---|---|
| `default` | Namespace mặc định khi request không chỉ định |
| `kube-system` | Components do Kubernetes/system quản lý |
| `kube-public` | Dữ liệu có thể được đọc công khai theo cấu hình cluster |
| `kube-node-lease` | Lease objects phục vụ heartbeat Node |

Không triển khai application vào `kube-system`. Hạn chế dùng `default` cho production vì khó áp policy, ownership và cleanup rõ ràng.

---

## 4. Truy cập resource giữa Namespaces

Service DNS trong cùng Namespace có thể dùng short name:

```text
http://api
```

Từ Namespace khác, dùng:

```text
http://api.team-a
http://api.team-a.svc.cluster.local
```

DNS name không tự cấp quyền hoặc bypass NetworkPolicy. Nó chỉ giải quyết service discovery.

### 4.1 References thường bị giới hạn scope

Pod thường chỉ tham chiếu ConfigMap, Secret, ServiceAccount và PVC trong cùng Namespace. Không thể mount Secret ở Namespace khác trực tiếp. Đây là boundary có chủ ý; nếu cần chia sẻ, dùng automation sao chép có kiểm soát hoặc external secret system.

---

## 5. Thiết kế Namespace

Mô hình phổ biến:

### 5.1 Theo team

```text
team-payments
team-checkout
team-platform
```

Phù hợp khi team sở hữu nhiều services và RBAC/quota theo team.

### 5.2 Theo environment

```text
checkout-dev
checkout-staging
checkout-prod
```

Dễ tách policy và release, nhưng nhiều app có thể tạo số Namespace lớn.

### 5.3 Theo tenant

Mỗi tenant một Namespace giúp scope resource, nhưng không đủ cho hostile multi-tenancy. Đánh giá số lượng objects, policy automation và mức trust. Tenant yêu cầu isolation mạnh có thể cần cluster riêng.

Không dùng Namespace để mô hình hóa mọi microservice nhỏ nếu không có policy/lifecycle boundary tương ứng.

---

## 6. Context và thao tác an toàn

Xem context hiện tại:

```bash
kubectl config current-context
kubectl config view --minify
```

Đặt Namespace mặc định cho context hiện tại:

```bash
kubectl config set-context --current --namespace=workloads-lab
```

Kiểm tra:

```bash
kubectl config view --minify -o jsonpath='{..namespace}{"\n"}'
```

Dù context có default Namespace, manifest production nên khai báo `metadata.namespace` hoặc deployment tool phải truyền Namespace rõ ràng. Điều này giảm khả năng apply nhầm.

> [!WARNING]
> `kubectl get all -A` không thật sự lấy “mọi resource type”, và `kubectl delete all --all` không xóa ConfigMap, Secret, PVC hoặc custom resources. Không dùng `all` như inventory/cleanup hoàn chỉnh.

---

## 7. Policy theo Namespace

Namespace thường đi cùng baseline objects:

```text
Namespace
├── ResourceQuota
├── LimitRange
├── default-deny NetworkPolicy
├── RoleBindings
├── ServiceAccounts
└── labels cho Pod Security / cost / ownership
```

Ví dụ labels:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: checkout-prod
  labels:
    environment: production
    owner: checkout-team
    pod-security.kubernetes.io/enforce: restricted
```

Trước khi bật enforcement, audit workload hiện có để tránh chặn deployment. Policy cụ thể được trình bày ở các phần Security, Networking và Cấu hình.

---

## 8. Xóa Namespace và trạng thái Terminating

Xóa Namespace kích hoạt xóa hàng loạt namespaced resources:

```bash
kubectl delete namespace workloads-lab
```

Đây là thao tác có blast radius lớn. API đánh dấu Namespace terminating, namespace controller discovery resources và xóa chúng. Finalizers có thể giữ resource hoặc Namespace lại cho đến khi cleanup hoàn tất.

Nếu kẹt:

```bash
kubectl get namespace <name> -o yaml
kubectl api-resources --verbs=list --namespaced -o name
kubectl get <resource-type> -n <name>
```

Không xóa finalizers cưỡng bức trước khi xác định controller nào sở hữu và external resource nào có thể bị orphan.

---

## 9. Thực hành

Tạo hai Namespaces và hai Pods cùng tên:

```bash
kubectl create namespace team-a
kubectl create namespace team-b
kubectl run web --image=nginx:1.27-alpine -n team-a
kubectl run web --image=nginx:1.27-alpine -n team-b
kubectl get pods -A -l run=web
```

Tạo Service trong `team-a`:

```bash
kubectl expose pod web --name=web --port=80 -n team-a
kubectl get service,endpointslices -n team-a
```

Kiểm tra DNS từ `team-b`:

```bash
kubectl run client \
  --image=busybox:1.36 \
  --restart=Never \
  --rm -it \
  -n team-b \
  -- wget -qO- http://web.team-a
```

Nếu cluster có default-deny NetworkPolicy, request có thể bị chặn; đó là behavior đúng theo policy.

Cleanup:

```bash
kubectl delete namespace team-a team-b
```

---

## 10. Best practices

- Tạo Namespace theo ownership, policy và lifecycle boundary rõ ràng.
- Tránh application production trong `default` và `kube-system`.
- Bootstrap Namespace kèm quota, limit, RBAC và network baseline.
- Dùng labels chuẩn cho owner, environment, cost center và policy tier.
- Khai báo Namespace rõ trong manifest hoặc deployment configuration.
- Kiểm tra context/Namespace trước thao tác mutate hoặc delete.
- Không coi Namespace là isolation đầy đủ cho untrusted tenants.
- Xóa Namespace qua change process phù hợp và inventory dữ liệu/PVC trước.
- Theo dõi Namespace kẹt `Terminating` và controller/finalizer liên quan.

Tiếp tục với [ReplicaSet](/workloads/replicaset/) để hiểu controller duy trì số lượng Pod.

---

## Tài liệu tham khảo

- [Namespaces](https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/)
- [DNS for Services and Pods](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/)
- [Share a Cluster with Namespaces](https://kubernetes.io/docs/tasks/administer-cluster/namespaces/)
