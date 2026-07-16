---
title: "Kubernetes API Resources"
description: "Giải thích Kubernetes API, resource, object, group/version/kind, scope, subresource, discovery và cách tra schema."
---

# Kubernetes API Resources

## Mục lục

- [Tổng quan](#tổng-quan)
- [1. API là trung tâm của Kubernetes](#1-api-là-trung-tâm-của-kubernetes)
- [2. Resource, object và kind](#2-resource-object-và-kind)
- [3. API group và version](#3-api-group-và-version)
- [4. Namespaced và cluster-scoped](#4-namespaced-và-cluster-scoped)
- [5. Spec, status và subresources](#5-spec-status-và-subresources)
- [6. API verbs và CRUD](#6-api-verbs-và-crud)
- [7. Discovery và OpenAPI](#7-discovery-và-openapi)
- [8. Các resource cốt lõi](#8-các-resource-cốt-lõi)
- [9. Ownership, finalizers và deletion](#9-ownership-finalizers-và-deletion)
- [10. API version lifecycle](#10-api-version-lifecycle)
- [11. Thực hành khám phá API](#11-thực-hành-khám-phá-api)
- [12. Lỗi thường gặp](#12-lỗi-thường-gặp)
- [Tài liệu tham khảo](#tài-liệu-tham-khảo)

---

## Tổng quan

Kubernetes API cho phép đọc và thay đổi trạng thái các object như Pod, Deployment, Namespace, ConfigMap và Event. Người dùng, `kubectl`, controller, Scheduler, kubelet và các hệ thống bên ngoài đều giao tiếp thông qua API Server.

```text
kubectl ───────┐
controllers ───┼──▶ kube-apiserver ───▶ etcd
scheduler ─────┤           ▲
kubelet ───────┤           │
operators ─────┘       watch/list/update
```

Mỗi cluster tự công bố các API mà nó phục vụ. Vì cluster có thể cài thêm CRD hoặc tắt API nhất định, cách đúng để biết resource khả dụng là dùng API discovery trên chính cluster đó.

---

## 1. API là trung tâm của Kubernetes

Khi chạy:

```bash
kubectl get pods -n demo
```

`kubectl` thực hiện về mặt khái niệm:

1. Đọc kubeconfig và context.
2. Chọn API Server endpoint và credentials.
3. Discovery resource `pods` thuộc core group `v1`.
4. Gửi GET đến endpoint Namespace tương ứng.
5. API Server authentication và authorization request.
6. Đọc object từ storage và trả response.
7. `kubectl` format response thành bảng.

Tương tự, `kubectl apply` không SSH vào Node. Nó tạo hoặc patch object qua API.

API Server là nơi thực hiện các bước như authentication, authorization, admission và validation trước khi object được persist.

---

## 2. Resource, object và kind

Ba thuật ngữ liên quan nhưng không giống nhau.

### 2.1 Resource

Resource là endpoint/API collection, thường dùng tên số nhiều và lowercase:

```text
pods
deployments
services
```

### 2.2 Object

Object là một instance cụ thể:

```text
Pod demo/web-7f9d
Deployment demo/web
Node kind-control-plane
```

Object có name, UID, resourceVersion và dữ liệu cụ thể.

### 2.3 Kind

Kind là kiểu biểu diễn trong payload:

```yaml
kind: Deployment
```

| Ngữ cảnh | Ví dụ |
|----------|-------|
| Resource name | `deployments` |
| Shortname | `deploy` |
| Kind | `Deployment` |
| Object | `demo/web` |

`kubectl get deploy web` dùng resource name/shortname; manifest dùng `kind: Deployment`.

---

## 3. API group và version

Kubernetes tổ chức API theo group và version.

### 3.1 Core group

Core group được truy cập dưới `/api/v1` và manifest chỉ viết version:

```yaml
apiVersion: v1
kind: Pod
```

Ví dụ core resources: Pod, Service, ConfigMap, Secret, Namespace, Node và Event.

### 3.2 Named groups

Named group nằm dưới `/apis/<group>/<version>`:

```yaml
apiVersion: apps/v1
kind: Deployment
```

Ví dụ:

| apiVersion | Kind |
|------------|------|
| `apps/v1` | Deployment, StatefulSet, DaemonSet |
| `batch/v1` | Job, CronJob |
| `networking.k8s.io/v1` | Ingress, NetworkPolicy |
| `rbac.authorization.k8s.io/v1` | Role, ClusterRole, bindings |
| `autoscaling/v2` | HorizontalPodAutoscaler |

### 3.3 GroupVersionKind và GroupVersionResource

- **GVK:** group, version, kind; mô tả kiểu object trong payload.
- **GVR:** group, version, resource; mô tả REST endpoint.

Client library và controller thường phải chuyển giữa GVK và GVR thông qua REST mapping/discovery.

### 3.4 Cùng dữ liệu, nhiều API versions

API Server có thể phục vụ nhiều version của cùng resource và chuyển đổi giữa version phục vụ với storage version. Version trong manifest là schema client dùng để giao tiếp, không nhất thiết là representation được lưu trong etcd.

---

## 4. Namespaced và cluster-scoped

### 4.1 Namespaced resources

Danh tính gồm Namespace và name. Ví dụ:

- Pod.
- Deployment.
- Service.
- ConfigMap.
- Secret.
- Role.
- PersistentVolumeClaim.

Endpoint khái niệm:

```text
/api/v1/namespaces/demo/pods/web
```

### 4.2 Cluster-scoped resources

Không thuộc Namespace:

- Node.
- Namespace.
- PersistentVolume.
- ClusterRole.
- StorageClass.
- CustomResourceDefinition.

Endpoint khái niệm:

```text
/api/v1/nodes/kind-control-plane
```

Kiểm tra scope:

```bash
kubectl api-resources --namespaced=true
kubectl api-resources --namespaced=false
```

> [!NOTE]
> Namespace là biên tổ chức và policy, không phải cluster ảo tuyệt đối. Một số resource và thành phần vẫn có scope toàn cluster.

---

## 5. Spec, status và subresources

### 5.1 spec và status

- `spec`: desired state.
- `status`: actual state quan sát được.

Controller thường đọc `spec`, thao tác hệ thống, rồi cập nhật `status`.

```yaml
spec:
  replicas: 3
status:
  readyReplicas: 2
```

Chênh lệch cho biết hệ thống chưa hội tụ hoặc đang có lỗi.

### 5.2 status subresource

Nhiều resource có endpoint `/status`. Điều này cho phép controller cập nhật status mà không vô tình sửa spec và cho phép RBAC phân quyền riêng.

```bash
kubectl get deployment web --subresource=status
```

### 5.3 scale subresource

Workload có thể cung cấp `/scale` để autoscaler và client thao tác số replica theo giao diện thống nhất.

```bash
kubectl get deployment web --subresource=scale
```

### 5.4 logs, exec và port-forward

Một số hành vi được biểu diễn qua subresource hoặc endpoint đặc biệt:

- `pods/log`.
- `pods/exec`.
- `pods/portforward`.

RBAC có thể cho phép đọc Pod nhưng không cho phép `pods/exec`.

---

## 6. API verbs và CRUD

Discovery công bố verbs resource hỗ trợ.

| Kubernetes verb | Ý nghĩa gần đúng |
|-----------------|------------------|
| `get` | Đọc một object |
| `list` | Đọc collection |
| `watch` | Nhận stream thay đổi |
| `create` | Tạo object |
| `update` | Thay object với resourceVersion phù hợp |
| `patch` | Sửa một phần object |
| `delete` | Yêu cầu xóa object |
| `deletecollection` | Xóa collection theo điều kiện |

Controller thường dùng `list` ban đầu rồi `watch` thay đổi. Watch tránh polling toàn bộ object liên tục, nhưng client phải xử lý reconnect và resourceVersion đúng cách.

### 6.1 Optimistic concurrency

`metadata.resourceVersion` giúp phát hiện conflict. Nếu hai client cùng update object từ một version cũ, API Server có thể trả conflict để tránh mất thay đổi.

### 6.2 Patch types

Kubernetes hỗ trợ nhiều kiểu patch tùy client/resource, như JSON Patch, Merge Patch và Strategic Merge Patch. Server-Side Apply dùng field ownership để nhiều actor quản lý các field khác nhau có kiểm soát.

---

## 7. Discovery và OpenAPI

### 7.1 Discovery API

Discovery trả lời:

- Có API groups/versions nào?
- Có resource nào?
- Resource thuộc Namespace hay cluster?
- Hỗ trợ verbs nào?
- Kind và shortname là gì?

```bash
kubectl api-resources -o wide
kubectl api-versions
```

Kubernetes hỗ trợ aggregated discovery ổn định để giảm số request client cần gửi.

### 7.2 OpenAPI

OpenAPI mô tả schema chi tiết của API objects. `kubectl explain`, validation, editor plugin và code generator có thể dùng schema này.

Server-side dry run là cách thực tế để kiểm tra cả schema và admission behavior:

```bash
kubectl apply --dry-run=server -f manifest.yaml
```

### 7.3 Truy cập API qua kubectl proxy

Trong local lab:

```bash
kubectl proxy
```

Terminal khác:

```bash
curl http://127.0.0.1:8001/api
curl http://127.0.0.1:8001/apis
curl http://127.0.0.1:8001/api/v1/namespaces/default/pods
```

`kubectl proxy` dùng credentials/context hiện tại và chỉ nên bind local cho lab. Không expose proxy tùy tiện ra mạng.

---

## 8. Các resource cốt lõi

| Nhóm | Resource | Controller hoặc actor chính |
|------|----------|-----------------------------|
| Workload | Pod | kubelet |
| Workload | Deployment | Deployment controller |
| Workload | ReplicaSet | ReplicaSet controller |
| Workload | StatefulSet | StatefulSet controller |
| Workload | Job | Job controller |
| Network | Service | Service routing components |
| Network | EndpointSlice | EndpointSlice controller |
| Config | ConfigMap, Secret | API storage; kubelet/projected volume |
| Storage | PVC, PV | PV controller, CSI components |
| Identity | ServiceAccount | ServiceAccount controllers/API |
| Access | Role, RoleBinding | Authorization evaluation |
| Cluster | Node | kubelet và Node controller |

Một object có thể do nhiều actor quan sát, nhưng cần hiểu actor nào sở hữu quyết định chính.

---

## 9. Ownership, finalizers và deletion

### 9.1 Owner references

Controller đặt `metadata.ownerReferences` để thể hiện ownership. Ví dụ:

```text
Deployment → ReplicaSet → Pods
```

Garbage collector có thể xóa dependents khi owner bị xóa, tùy propagation policy.

Kiểm tra:

```bash
kubectl get pod <pod-name> -o jsonpath='{.metadata.ownerReferences}'
```

### 9.2 Finalizers

Finalizer là key trong metadata ngăn object bị xóa hoàn toàn trước khi controller hoàn tất cleanup.

Khi delete:

1. API Server đặt `deletionTimestamp`.
2. Object vẫn tồn tại trong trạng thái terminating.
3. Controller thực hiện cleanup.
4. Controller bỏ finalizer.
5. API Server xóa object.

Không xóa finalizer bằng tay nếu chưa hiểu cleanup nào sẽ bị bỏ qua, đặc biệt với storage và cloud resources.

---

## 10. API version lifecycle

Mức ổn định thường gặp:

| Mức | Ví dụ suffix | Đặc điểm |
|-----|--------------|----------|
| Alpha | `v1alpha1` | Có thể tắt mặc định và thay đổi không tương thích |
| Beta | `v1beta1` | Gần ổn định hơn nhưng vẫn cần kế hoạch migration |
| Stable/GA | `v1`, `v2` | Cam kết compatibility mạnh hơn |

API deprecation không đồng nghĩa bị xóa ngay, nhưng cluster upgrade có thể ngừng serve version cũ sau thời gian deprecation. Cần:

- Theo dõi release notes.
- Audit manifests và live objects.
- Migrate sang API version thay thế.
- Test trên cluster version mới trước production.

CRD do bên thứ ba cung cấp có policy compatibility riêng; không tự động có cùng cam kết với built-in API.

---

## 11. Thực hành khám phá API

```bash
# Resource và scope
kubectl api-resources
kubectl api-resources --namespaced=true
kubectl api-resources --namespaced=false

# Lọc resource hỗ trợ list và get
kubectl api-resources --verbs=list,get -o wide

# Schema
kubectl explain deployment
kubectl explain deployment.spec
kubectl explain deployment.spec.template.spec.containers

# API endpoint
kubectl get --raw /api
kubectl get --raw /apis
kubectl get --raw /apis/apps/v1

# Object metadata
kubectl get namespace default -o yaml
```

Tạo Deployment tạm và xem ownership:

```bash
kubectl create deployment api-lab --image=nginx:1.27-alpine
kubectl get deployment,replicaset,pod
kubectl get replicaset -l app=api-lab -o yaml
kubectl get pod -l app=api-lab -o jsonpath='{.items[0].metadata.ownerReferences}'
kubectl delete deployment api-lab
```

---

## 12. Lỗi thường gặp

| Lỗi | Nguyên nhân | Cách kiểm tra |
|-----|-------------|--------------|
| `no matches for kind` | Sai/mất API group-version hoặc CRD chưa cài | `kubectl api-resources`, `api-versions` |
| `the server doesn't have a resource type` | Dùng sai resource name | `kubectl api-resources` |
| `Forbidden` | Identity thiếu RBAC verb | `kubectl auth can-i` |
| `Conflict` | resourceVersion cũ hoặc field ownership conflict | Đọc object mới và retry có kiểm soát |
| Object kẹt `Terminating` | Finalizer chưa hoàn tất | Kiểm tra finalizers và controller |
| Resource không thấy ở Namespace | Sai scope/Namespace | `api-resources`, `-A`, context |
| Field bị từ chối | Schema hoặc admission policy | Server-side dry run và error message |

---

## Tài liệu tham khảo

- [The Kubernetes API](https://kubernetes.io/docs/concepts/overview/kubernetes-api/)
- [Objects in Kubernetes](https://kubernetes.io/docs/concepts/overview/working-with-objects/)
- [API Overview](https://kubernetes.io/docs/reference/using-api/)
- [Kubernetes API Reference](https://kubernetes.io/docs/reference/kubernetes-api/)
- [API Deprecation Policy](https://kubernetes.io/docs/reference/using-api/deprecation-policy/)
- [Custom Resources](/ecosystem/custom-resources/)
