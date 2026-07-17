---
title: "Declarative Model và Reconciliation Loop"
description: "Mô hình declarative của Kubernetes, spec/status, control loop, idempotency, eventual consistency, drift, ownership và cách debug convergence."
---

# Declarative Model và Reconciliation Loop

## Mục lục

- [Tổng quan](#tổng-quan)
- [1. Imperative và declarative](#1-imperative-và-declarative)
- [2. Desired state, actual state và observed state](#2-desired-state-actual-state-và-observed-state)
- [3. Reconciliation loop](#3-reconciliation-loop)
- [4. Event-driven nhưng level-based](#4-event-driven-nhưng-level-based)
- [5. Idempotency và retry](#5-idempotency-và-retry)
- [6. Eventual consistency và convergence](#6-eventual-consistency-và-convergence)
- [7. Ownership, selectors và dependency graph](#7-ownership-selectors-và-dependency-graph)
- [8. Generation, resourceVersion và conditions](#8-generation-resourceversion-và-conditions)
- [9. Drift và nhiều actor cùng quản lý](#9-drift-và-nhiều-actor-cùng-quản-lý)
- [10. Finalizers và compensation](#10-finalizers-và-compensation)
- [11. Anti-patterns](#11-anti-patterns)
- [12. Troubleshooting reconciliation](#12-troubleshooting-reconciliation)
- [13. Thực hành quan sát self-healing](#13-thực-hành-quan-sát-self-healing)
- [14. Áp dụng khi thiết kế platform](#14-áp-dụng-khi-thiết-kế-platform)
- [Tài liệu tham khảo](#tài-liệu-tham-khảo)

---

## Tổng quan

Declarative model là nền tảng của Kubernetes: người dùng khai báo trạng thái mong muốn, còn controller liên tục quan sát và đưa trạng thái thực tế tiến về trạng thái đó. Khác biệt giữa hai trạng thái không phải ngoại lệ; nó là đầu vào bình thường của control loop.

```text
          ┌──────────────────────────────┐
          │ Desired state: spec          │
          │ "Tôi muốn 3 replicas"        │
          └──────────────┬───────────────┘
                         │ compare
                         ▼
                Reconciliation loop
                         │ act
                         ▼
          ┌──────────────────────────────┐
          │ Actual/observed state        │
          │ "Hiện có 2 Pods Ready"       │
          └──────────────┬───────────────┘
                         └──── observe again
```

> [!IMPORTANT]
> Kubernetes không hứa rằng actual state luôn bằng desired state ngay lập tức. Nó cung cấp cơ chế để trạng thái **hội tụ theo thời gian**, đồng thời báo status/conditions khi chưa hội tụ.

---

## 1. Imperative và declarative

### 1.1 Imperative

Imperative mô tả các bước:

```text
1. Tạo VM A
2. Start process trên A
3. Nếu A lỗi, tạo VM B
4. Start process trên B
```

Workflow phải nhớ bước nào đã chạy. Retry giữa chừng dễ tạo duplicate hoặc bỏ sót cleanup.

### 1.2 Declarative

Declarative mô tả kết quả:

```yaml
spec:
  replicas: 3
```

Controller tự tính action dựa trên state hiện tại:

```text
current=2 → create 1
current=3 → no-op
current=4 → remove 1
```

### 1.3 Kubernetes vẫn có command imperative

`kubectl create`, `scale` hoặc `set image` là interface imperative, nhưng cuối cùng chúng thay đổi API object. Controllers vẫn reconcile từ state đã lưu.

Trong GitOps, manifest trong Git thường là source of intent cấp cao; GitOps controller đưa cluster API state về Git state, rồi built-in controllers đưa runtime về API state.

```text
Git desired state
  → GitOps reconciliation
  → Kubernetes API desired state
  → built-in reconciliation
  → Pods/Nodes/external resources
```

---

## 2. Desired state, actual state và observed state

### 2.1 Desired state

Nằm chủ yếu trong `spec`, do user hoặc controller khác khai báo. Ví dụ:

```yaml
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: web
          image: nginx:1.27-alpine
```

### 2.2 Actual state

Là thực tế bên ngoài API: process có chạy, Node có reachable, load balancer có tồn tại, volume có attach, endpoint có phục vụ.

### 2.3 Observed state

Controller không luôn thấy actual state tức thời. Nó thấy observation qua API cache, cloud API, runtime status hoặc metrics. Observation có thể trễ.

Phân biệt này quan trọng:

```text
actual state thay đổi
  → observer phát hiện
  → status được cập nhật
  → client mới thấy observed state
```

Status là báo cáo, không phải bản thân reality tuyệt đối.

---

## 3. Reconciliation loop

Pseudocode tối giản:

```text
reconcile(key):
    desired = read_spec(key)
    actual = observe_current_state(key)

    if object_is_deleting:
        cleanup_external_state()
        remove_finalizer()
        return

    diff = compare(desired, actual)

    if diff.exists:
        apply_minimal_action(diff)

    update_status_from_observation()
```

### 3.1 Observe

Controller đọc object và dependency. Cache giúp scale nhưng có eventual delay.

### 3.2 Compare

Controller tính invariant nào chưa đạt. Ví dụ Service selector phải ánh xạ đến EndpointSlices từ Pod phù hợp.

### 3.3 Act

Action nên tối thiểu và idempotent: create resource thiếu, update field sở hữu, delete resource dư hoặc gọi external API.

### 3.4 Report

Controller cập nhật status/condition/Event để operator biết tiến trình và lỗi.

### 3.5 Repeat

Event mới, timer, retry hoặc resync kích hoạt reconcile tiếp. Reconciliation không có “completed forever” vì drift có thể xảy ra sau đó.

---

## 4. Event-driven nhưng level-based

### 4.1 Event chỉ là trigger

Watch event nói “có thể state đã đổi”. Reconciler phải đọc state mới nhất, không giả định event chứa toàn bộ lịch sử.

### 4.2 Vì sao không edge-triggered thuần túy

Nếu logic yêu cầu nhận chính xác chuỗi:

```text
ADDED → MODIFIED A → MODIFIED B → DELETED
```

mất một event có thể làm state sai vĩnh viễn. Level-based controller chỉ hỏi:

```text
State hiện tại là gì? Desired là gì? Cần làm gì bây giờ?
```

### 4.3 Resync và periodic reconciliation

Periodic reconcile giúp phát hiện:

- External drift không phát event Kubernetes.
- Watch reconnect.
- Lỗi trước đó đã hết.
- Dependency state thay đổi.

Nhưng interval quá ngắn gây API/external load. Event-driven và periodic repair phải cân bằng.

---

## 5. Idempotency và retry

### 5.1 Bài toán response bị mất

Controller gọi cloud API tạo load balancer. Load balancer đã được tạo nhưng response timeout. Nếu retry luôn “create mới”, sẽ có duplicate.

Thiết kế an toàn:

- Dùng idempotency key nếu API hỗ trợ.
- Tag external resource bằng Kubernetes UID.
- Observe trước khi create.
- Lưu external ID vào status sau khi xác minh.
- Cleanup orphan theo policy.

### 5.2 API conflict

Nhiều actor update object có thể nhận `409 Conflict`. Reconciler phải fetch state mới, apply intent lên bản mới rồi retry.

### 5.3 Backoff

Dependency outage không nên tạo hot loop:

```text
retry 1s → 2s → 4s → ... → max delay
```

Event mới có thể reset hoặc kích hoạt retry tùy queue implementation.

### 5.4 At-least-once thinking

Reconcile/action có thể xảy ra nhiều lần. Hãy thiết kế side effect như thể message delivery là at least once, không “chính xác một lần” theo giả định.

---

## 6. Eventual consistency và convergence

### 6.1 Convergence có nhiều bước

Apply Deployment không tạo Pod trực tiếp:

```text
Deployment spec
  → Deployment controller creates ReplicaSet
  → ReplicaSet controller creates Pods
  → Scheduler binds Pods
  → kubelet starts Containers
  → probes set Ready
  → EndpointSlice includes ready endpoints
```

Mỗi arrow có queue, cache, API call và retry riêng.

### 6.2 Success ở tầng trước không đảm bảo tầng sau

- API create success: object đã persist.
- Deployment Available: workload controller đánh giá availability.
- Pod Ready: kubelet/probe đánh giá Pod.
- Service usable: network path và app response vẫn cần verify.

### 6.3 Timeout nên phản ánh SLO

CLI/pipeline cần chờ condition có ý nghĩa:

```bash
kubectl rollout status deployment/web --timeout=5m
kubectl wait \
  --for=condition=Ready \
  pod \
  -l app=web \
  --timeout=120s
```

Không dùng `sleep 10` rồi giả định hội tụ. Thời gian phụ thuộc image, capacity, scheduling và dependency.

### 6.4 Không có convergence

Nếu controller liên tục sửa rồi actor khác đổi ngược lại, hệ thống **oscillate**. Nếu desired state bất khả thi, hệ thống retry nhưng không đạt condition. Cần sửa intent hoặc constraint, không chờ vô hạn.

---

## 7. Ownership, selectors và dependency graph

### 7.1 Ownership graph

Owner references mô tả lifecycle dependency:

```text
Deployment → ReplicaSet → Pod
```

Garbage collector dùng UID để xử lý dependent khi owner bị xóa.

### 7.2 Selector graph

Controller cũng tìm object qua label selector. Selector không giống ownership:

- Ownership quyết định lifecycle/garbage collection.
- Selector quyết định object nào được đếm hoặc route.

Một Pod có thể do ReplicaSet sở hữu nhưng bị sửa label khiến không còn match selector, làm controller tạo Pod khác.

### 7.3 Dependency external

Cloud load balancer, DNS record hoặc database user không có ownerReference native. Controller cần status/finalizer/tag để duy trì mapping và cleanup.

### 7.4 UID quan trọng hơn name

Object bị xóa và tạo lại cùng name có UID khác. Controller phải tránh coi external state của UID cũ là ownership của object mới mà không xác minh.

---

## 8. Generation, resourceVersion và conditions

### 8.1 `generation`

Thường biểu thị phiên bản desired spec. Tăng khi spec thay đổi theo semantics resource.

### 8.2 `observedGeneration`

Controller báo generation đã xử lý. Dùng để tránh đọc condition cũ như kết quả của spec mới.

### 8.3 `resourceVersion`

Dùng cho concurrency và watch position. Không phải version nghiệp vụ, timestamp hay số nên đem so sánh tùy ý.

### 8.4 Conditions

Condition nên trả lời câu hỏi ổn định, ví dụ `Available`, `Progressing`, `Ready`. Đọc cả:

- status.
- reason.
- message.
- observedGeneration.
- lastTransitionTime.

### 8.5 Events

Event giúp giải thích action/error gần đây, nhưng retention giới hạn và có thể aggregate. Conditions/status phù hợp hơn cho machine-readable long-lived state.

---

## 9. Drift và nhiều actor cùng quản lý

### 9.1 Drift

Drift là actual/API state khác source of truth. Nguyên nhân:

- Operator sửa tay.
- Controller khác mutate.
- External resource bị đổi ngoài Kubernetes.
- Admission default/mutation.
- Upgrade thay semantics/default.

### 9.2 Field ownership

Server-Side Apply ghi `managedFields` để theo dõi actor quản lý field. Khi hai actor apply cùng field với intent khác, conflict giúp ngăn ghi đè im lặng.

```bash
kubectl get deployment web -o yaml --show-managed-fields
```

### 9.3 GitOps loop

Nếu Git nói replicas=3 nhưng operator scale=5 bằng kubectl, GitOps controller có thể đưa về 3. Đây không phải Kubernetes “tự mất thay đổi”; là hai desired state cạnh tranh.

### 9.4 Chọn một owner cho mỗi field

Thiết kế tốt:

- GitOps quản lý template và policy.
- HPA quản lý replicas.
- Controller chuyên biệt quản lý status.

Nếu GitOps liên tục apply `spec.replicas` trong khi HPA scale, hai actor có thể xung đột. Cần cấu hình ownership/ignore phù hợp.

---

## 10. Finalizers và compensation

### 10.1 Delete là một desired transition

Khi delete object có finalizer, API đặt `deletionTimestamp`. Controller quan sát trạng thái “đang xóa”, cleanup rồi bỏ finalizer.

### 10.2 Compensation thay rollback transaction

Kubernetes và external systems không có một ACID transaction chung. Nếu flow tạo ba resource rồi bước cuối fail, controller thường reconcile/compensate thay vì rollback tức thì toàn bộ.

```text
Create cloud resource succeeded
Status update failed
  → next reconcile discovers resource by UID tag
  → updates status instead of creating duplicate
```

### 10.3 Finalizer contract

Mỗi finalizer cần:

- Controller owner rõ.
- Cleanup idempotent.
- Error condition/log/metric.
- Timeout/escalation runbook.
- Cách xử lý khi external system mất vĩnh viễn.

Force-remove chỉ là quyết định chấp nhận orphan/leak sau khi đánh giá.

---

## 11. Anti-patterns

### 11.1 Reconcile như workflow tuyến tính

Sai:

```text
Nếu status.step=2 thì giả định step=1 đã hoàn tất mãi mãi
```

Đúng hơn: observe resource của step 1 có thực sự tồn tại/đúng không.

### 11.2 Side effect không idempotent

Mỗi retry gửi email, charge payment hoặc tạo cloud resource mới mà không có key/deduplication.

### 11.3 Update toàn object

Ghi lại object cache cũ có thể xóa field actor khác. Chỉ mutate field sở hữu, dùng patch/apply/status subresource phù hợp.

### 11.4 Hot loop

Requeue ngay lập tức khi dependency down làm tăng outage. Dùng backoff và condition.

### 11.5 Status không hữu ích

Chỉ log error mà không cập nhật condition khiến user không biết vì sao resource không Ready.

### 11.6 Finalizer không thể hoàn tất

Controller bị xóa trước CRs hoặc RBAC bị thu hồi, khiến resource kẹt. Upgrade/uninstall plan phải xử lý finalizers.

### 11.7 Nhiều source of truth

Manual changes, GitOps, autoscaler và Operator cùng quản lý một field tạo oscillation.

---

## 12. Troubleshooting reconciliation

### 12.1 Xác định desired state

```bash
kubectl get <kind> <name> -n <namespace> -o yaml
```

Đọc spec, generation, managedFields và source of truth ngoài cluster nếu có.

### 12.2 Xác định observed state

Đọc status/conditions và resource con:

```bash
kubectl describe <kind> <name> -n <namespace>
kubectl get events -n <namespace> --sort-by=.metadata.creationTimestamp
```

### 12.3 Xác định controller

Dùng:

- ownerReferences.
- finalizer name.
- labels/annotations.
- API docs.
- controller deployment/logs.

### 12.4 Tìm nơi flow dừng

| Layer | Evidence |
|-------|----------|
| API intent | Object/spec/generation |
| Controller observed | observedGeneration, conditions |
| Child resources | ownerReferences, counts |
| Scheduling | PodScheduled, `spec.nodeName`, Events |
| Node execution | containerStatuses, kubelet Events |
| Service exposure | EndpointSlices, readiness |
| External resource | Controller status/log/provider state |

### 12.5 Kiểm tra conflict/oscillation

```bash
kubectl get <kind> <name> -n <namespace> \
  -o yaml \
  --show-managed-fields
```

Theo dõi field thay đổi và audit log nếu có. Không chỉ patch lại nhanh hơn controller.

### 12.6 Kiểm tra controller health

- Replica và leader election.
- Work queue depth/retries.
- Reconcile error rate/duration.
- API throttling.
- Dependency latency.
- RBAC/admission errors.

---

## 13. Thực hành quan sát self-healing

### 13.1 Tạo Deployment

```bash
kubectl create namespace reconciliation-lab
kubectl create deployment web \
  --image=nginx:1.27-alpine \
  --replicas=3 \
  -n reconciliation-lab

kubectl rollout status deployment/web -n reconciliation-lab
kubectl get deployment,replicaset,pods -n reconciliation-lab -o wide
```

### 13.2 Xóa một Pod

Terminal 1:

```bash
kubectl get pods -n reconciliation-lab --watch
```

Terminal 2:

```bash
POD_NAME="$(kubectl get pod \
  -n reconciliation-lab \
  -l app=web \
  -o jsonpath='{.items[0].metadata.name}')"

kubectl delete pod "$POD_NAME" -n reconciliation-lab
```

ReplicaSet controller tạo Pod mới để số replica quay về 3. Pod name/UID mới chứng minh đây là replacement, không phải hồi sinh object cũ.

### 13.3 Tạo drift ở replicas

```bash
kubectl scale deployment/web --replicas=5 -n reconciliation-lab
kubectl get deployment web -n reconciliation-lab \
  -o custom-columns='GEN:.metadata.generation,OBSERVED:.status.observedGeneration,DESIRED:.spec.replicas,READY:.status.readyReplicas'
```

Chờ controller hội tụ:

```bash
kubectl rollout status deployment/web -n reconciliation-lab
```

### 13.4 Quan sát ownership

```bash
kubectl get replicaset,pod -n reconciliation-lab -o yaml
```

Tìm `ownerReferences`, UID và labels.

Cleanup:

```bash
kubectl delete namespace reconciliation-lab
```

---

## 14. Áp dụng khi thiết kế platform

Khi xây CRD/Operator hoặc automation:

1. Xác định desired state ngắn gọn, không nhét workflow history vào spec.
2. Định nghĩa observable conditions và success criteria.
3. Reconcile level-based và idempotent.
4. Gán stable identity cho external resource.
5. Dùng finalizer cho cleanup bắt buộc.
6. Phân định field ownership.
7. Retry transient error với backoff.
8. Không retry vô hạn terminal error mà thiếu condition.
9. Expose metrics cho queue, reconcile duration/error và dependency.
10. Test restart giữa mọi bước và test duplicate event.
11. Test API conflict, timeout-after-success và external drift.
12. Có upgrade/uninstall plan cho CRD, webhook và finalizer.

Mô hình tư duy cuối cùng:

```text
Không hỏi: "Lệnh đã chạy chưa?"
Hãy hỏi: "Desired state là gì, controller đã quan sát generation nào,
actual state hiện ra sao và điều gì ngăn convergence?"
```

Quay lại [Tổng quan Kubernetes Cluster](/kien-truc/tong-quan-cluster/) hoặc tiếp tục với [Pod](/workloads/pod/) để áp dụng mô hình này vào workload đầu tiên.

---

## Tài liệu tham khảo

- [Controllers](https://kubernetes.io/docs/concepts/architecture/controller/)
- [Kubernetes Objects](https://kubernetes.io/docs/concepts/overview/working-with-objects/)
- [Owners and Dependents](https://kubernetes.io/docs/concepts/overview/working-with-objects/owners-dependents/)
- [Finalizers](https://kubernetes.io/docs/concepts/overview/working-with-objects/finalizers/)
- [Server-Side Apply](https://kubernetes.io/docs/reference/using-api/server-side-apply/)
