---
title: "Scheduling Best Practices"
description: "Hướng dẫn thiết kế placement production từ requests, labels, affinity, taints, topology spread, priority và thiết bị, kèm rollout checklist và runbook Pending Pod."
---

# Scheduling Best Practices

## Mục lục

- [Tổng quan](#tổng-quan)
- [1. Bắt đầu từ requirement, không bắt đầu từ field](#1-bắt-đầu-từ-requirement-không-bắt-đầu-từ-field)
- [2. Đặt resource requests có cơ sở](#2-đặt-resource-requests-có-cơ-sở)
- [3. Xây taxonomy Node label và taint](#3-xây-taxonomy-node-label-và-taint)
- [4. Chọn hard constraint và soft preference](#4-chọn-hard-constraint-và-soft-preference)
- [5. Thiết kế availability theo topology](#5-thiết-kế-availability-theo-topology)
- [6. Dùng priority và preemption có governance](#6-dùng-priority-và-preemption-có-governance)
- [7. Accelerator và scarce resources](#7-accelerator-và-scarce-resources)
- [8. Tương tác với autoscaling và disruption](#8-tương-tác-với-autoscaling-và-disruption)
- [9. Scenario thiết kế end-to-end](#9-scenario-thiết-kế-end-to-end)
- [10. Observability và capacity signals](#10-observability-và-capacity-signals)
- [11. Runbook Pod Pending](#11-runbook-pod-pending)
- [12. Rollout và change management](#12-rollout-và-change-management)
- [13. Anti-patterns](#13-anti-patterns)
- [14. Checklist production](#14-checklist-production)
- [Tài liệu tham khảo](#tài-liệu-tham-khảo)

---

## Tổng quan

Scheduling policy tốt đặt workload đúng failure domain và resource pool mà không làm feasible capacity nhỏ hơn cần thiết. Mục tiêu không phải ép scheduler cho kết quả “đẹp” ở trạng thái bình thường, mà giữ được behavior dự đoán khi rollout, Node đầy, mất zone, autoscaling chậm hoặc thiết bị lỗi.

Một thiết kế placement production cần nối sáu lớp:

```text
Workload requirements
  → resource requests
  → Node taxonomy và isolation
  → topology availability
  → priority/disruption policy
  → capacity, autoscaling và observability
```

Scheduler chỉ chọn Node từ snapshot hiện tại. Nó không đo business criticality, tự thêm capacity, sửa request sai hoặc rebalance Pod cũ. Những intent đó phải được biểu diễn và vận hành ở các lớp xung quanh.

## 1. Bắt đầu từ requirement, không bắt đầu từ field

Trước khi viết YAML, trả lời:

- Workload chạy đúng trên những CPU architecture, OS, device và storage nào?
- Vi phạm placement nào làm application sai, và placement nào chỉ kém tối ưu?
- Cần sống sót khi mất một Node, rack hay zone không?
- Startup latency tối đa khi capacity thiếu là bao nhiêu?
- Workload nào được phép preempt workload nào?
- Có thể checkpoint/retry không?
- Ai quản lý Node label, taint và PriorityClass?

Chuyển requirement thành primitive:

| Requirement | Primitive chính |
|---|---|
| Cần Node có thuộc tính bắt buộc | `nodeSelector` hoặc required Node Affinity |
| Ưu tiên một pool/zone | Preferred Node Affinity |
| Đẩy workload không được phép khỏi pool | Taint + toleration |
| Phân bố replicas đều | Topology Spread Constraints |
| Đặt gần/tách khỏi workload khác | Pod Affinity/Anti-affinity |
| Thứ tự tranh capacity | PriorityClass |
| Cho workload critical đẩy workload thấp | Preempting PriorityClass |
| Cấp phát GPU/NIC/FPGA | Extended resource/Device Plugin hoặc DRA phù hợp |

Không dùng một primitive cho mục tiêu nó không bảo đảm. Toleration không kéo Pod; preferred affinity không enforce compliance; PDB không bảo vệ tuyệt đối khỏi preemption.

## 2. Đặt resource requests có cơ sở

Scheduler filter dựa trên **requests và Node allocatable**, không dựa vào usage tức thời từ `kubectl top`. Request quá thấp cho phép overpacking rồi gây CPU throttling, memory pressure hoặc eviction. Request quá cao làm Pod Pending và tăng chi phí.

### 2.1 Quy trình sizing

1. Thu metric theo percentile và tách startup/steady-state/peak.
2. Xác định headroom theo SLO, burst và failure scenario.
3. Đặt CPU/memory request, rồi load-test.
4. Theo dõi request-to-usage và OOM/throttling.
5. Review sau release hoặc traffic shift.

Đừng dùng một tỷ lệ cố định cho mọi workload. CPU thường compressible; memory vượt khả năng dẫn đến OOM/eviction. Init Container và Pod overhead cũng ảnh hưởng effective scheduling request.

### 2.2 Requests ở mọi container

Sidecar không có request vẫn tiêu thụ resource. Hãy tính application, proxy, log sidecar và init Containers. Dùng LimitRange để tạo guardrail, nhưng default không thay thế profiling.

Xem chi tiết tại [Resource Requests và Limits](/cau-hinh/resource-requests-limits/) và [Pod QoS](/cau-hinh/quality-of-service/).

## 3. Xây taxonomy Node label và taint

### 3.1 Label contract

Phân loại label theo owner:

- Kubernetes/cloud provider: hostname, OS, architecture, zone, region.
- Node provisioning: node pool, instance family, lifecycle.
- Platform: compliance tier, workload class, accelerator model.

Mỗi custom label cần schema, owner, source automation, drift alert và deprecation plan. Dùng prefix domain tổ chức, ví dụ `platform.example.com/pool`.

### 3.2 Taint contract

Mỗi taint cần mô tả:

- Pod nào được tolerate.
- Effect và lý do.
- Admission policy bảo vệ toleration.
- Cách bootstrap system DaemonSets.
- Cách rollback khi pool thiếu capacity.

Dedicated pool thường dùng cả:

```text
label + required affinity → attraction
 taint + toleration       → repulsion/isolation
```

Không để tenant tự gắn toleration cho pool nhạy cảm. Taint là scheduling control; kết hợp RBAC, admission, runtime isolation và network/storage policy cho security boundary hoàn chỉnh.

## 4. Chọn hard constraint và soft preference

Hard constraint phù hợp với correctness hoặc policy bắt buộc. Mỗi hard rule thu hẹp feasible set theo phép giao:

```text
Node có architecture đúng
AND đúng pool
AND đúng zone/Volume topology
AND tolerate mọi NoSchedule taint
AND đủ CPU/memory/device
```

Một rule có vẻ hợp lý riêng lẻ vẫn có thể làm giao rỗng khi kết hợp.

Soft preference phù hợp với cost, latency hoặc distribution có thể vi phạm trong degraded mode. Ưu tiên soft khi service chạy ở vị trí khác vẫn đúng và availability quan trọng hơn tối ưu.

### Decision test

Hỏi: “Nếu chỉ còn Node không thỏa rule trong 30 phút, Pod nên `Pending` hay chạy ở đó?”

- Nếu chạy sẽ sai hoặc vi phạm policy: hard.
- Nếu chạy vẫn đúng nhưng đắt/chậm hơn: soft.
- Nếu câu trả lời phụ thuộc trạng thái incident: cần runbook/admission hoặc tách workload tier, không cố nhét toàn bộ logic vào một manifest.

## 5. Thiết kế availability theo topology

### 5.1 Replicas không tự tạo HA

Ba replicas có thể nằm cùng Node hoặc zone nếu không có placement intent. Dùng Topology Spread Constraints để phân bố theo hostname/zone và kiểm tra Service endpoints thực tế.

### 5.2 Chọn mức cứng

Một pattern thường gặp:

- Zone spread `DoNotSchedule` khi có ít nhất ba zone và SLO yêu cầu.
- Hostname spread `ScheduleAnyway` để vẫn chạy khi số Node ít.
- `minDomains` chỉ khi chấp nhận giữ replica Pending nếu thiếu zone.

Không copy pattern này nếu cluster chỉ có một zone. Hard constraint theo topology không tồn tại chỉ tạo outage.

### 5.3 Phối hợp PDB

Topology quyết định Pod nằm đâu; PDB giới hạn voluntary disruption; replicas/readiness quyết định serving capacity. Cần cả ba:

```text
Replicas + topology spread + readiness + PDB + spare capacity
```

PDB không tạo thêm Pod và không bảo vệ mọi loại disruption. Xem [PodDisruptionBudget](/cau-hinh/pod-disruption-budget/).

## 6. Dùng priority và preemption có governance

Tạo ít PriorityClass với semantic rõ, khoảng value đủ để mở rộng. Tách hai nhu cầu:

- Cần được xét trước nhưng không gây disruption: `preemptionPolicy: Never`.
- Cần giải phóng capacity từ workload thấp hơn: `PreemptLowerPriority`.

Preempting class cần:

- Admission giới hạn caller.
- Danh sách victim tier chấp nhận được.
- Victim có checkpoint/idempotency.
- Alert preemption rate và startup wait.
- Load test trong overload và Node loss.

Không dùng `system-cluster-critical`/`system-node-critical` cho application. Không tăng priority để xử lý affinity sai hoặc thiếu GPU; preemption không giải những lỗi đó.

## 7. Accelerator và scarce resources

Với GPU/FPGA/NIC:

- Request extended resource chính xác.
- Đặt CPU/memory requests cho feeder process.
- Taint Node đắt tiền để workload thường không chiếm chỗ.
- Dùng label/affinity cho model hoặc capability nếu resource name chưa phân biệt.
- Theo dõi device health, allocatable và plugin registration.
- Đánh giá NUMA/CPU alignment cho workload nhạy performance.

Đừng schedule theo label `gpu=true` mà không request device. Label chỉ chọn Node; Device Plugin/DRA mới cấp phát concrete device và ngăn double allocation.

## 8. Tương tác với autoscaling và disruption

### 8.1 Cluster Autoscaler

Autoscaler chỉ thêm Node nếu một node group template có thể thỏa Pod constraints. Các lỗi thường gặp:

- Pod yêu cầu label không node group nào tạo.
- Pod không tolerate taint của pool mục tiêu.
- `minDomains` cần zone không có node group.
- Request lớn hơn Node type tối đa.
- Extended resource không được advertise trên Node mới do plugin/driver bootstrap lỗi.

Đo thời gian từ `FailedScheduling` đến Node Ready, device plugin ready và Pod Ready; chỉ đo VM provision time là chưa đủ.

### 8.2 Scale down và consolidation

Hard anti-affinity/spread có thể hạn chế khả năng dồn Pod và scale down. Soft spread tăng flexibility nhưng có thể làm distribution tạm thời lệch. Chọn theo availability và cost, rồi test consolidation.

### 8.3 Drain

`kubectl drain` tạo voluntary disruption và làm controller tạo replacement. Replacement vẫn phải qua scheduler. Trước maintenance, mô phỏng rằng các Node còn lại đủ requests, topology domains, taints và Volume compatibility.

## 9. Scenario thiết kế end-to-end

Giả sử service `checkout-api` có các yêu cầu:

- Sáu replicas, chạy Linux amd64.
- Sống sót khi mất một zone trong cluster ba zone.
- Ưu tiên tách replicas theo Node nhưng degraded mode vẫn phải chạy.
- Priority cao hơn batch nhưng không muốn preempt.
- Request mỗi Pod: 250m CPU, 256Mi memory dựa trên load test.

PriorityClass:

```yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: online-standard
value: 10000
globalDefault: false
preemptionPolicy: Never
description: "Online services được xét trước batch nhưng không tạo victims"
```

Deployment placement:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout-api
spec:
  replicas: 6
  selector:
    matchLabels:
      app.kubernetes.io/name: checkout-api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: checkout-api
    spec:
      priorityClassName: online-standard
      nodeSelector:
        kubernetes.io/os: linux
        kubernetes.io/arch: amd64
      topologySpreadConstraints:
        - maxSkew: 1
          minDomains: 3
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app.kubernetes.io/name: checkout-api
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels:
              app.kubernetes.io/name: checkout-api
      containers:
        - name: api
          image: example.invalid/checkout-api:VERSION
          resources:
            requests:
              cpu: 250m
              memory: 256Mi
            limits:
              memory: 512Mi
          readinessProbe:
            httpGet:
              path: /ready
              port: 8080
```

`example.invalid`, image tag, port và endpoint là placeholder. Thiết kế cố ý:

- Hard OS/architecture vì image compatibility.
- Hard zone spread vì requirement ba domain.
- Soft Node spread để một Node thiếu không chặn mọi replica.
- Non-preempting priority để ưu tiên queue nhưng tránh disruption batch.

Trước production, phải test trường hợp mất zone. `minDomains: 3` có thể giữ replacement Pending khi chỉ còn hai zone; điều đó bảo vệ distribution intent nhưng mâu thuẫn với mục tiêu duy trì sáu replicas trong degraded mode. Nếu service phải tiếp tục chạy ở hai zone, bỏ `minDomains` hoặc chuyển zone constraint thành `ScheduleAnyway`. Đây là quyết định SLO, không có default đúng cho mọi hệ thống.

## 10. Observability và capacity signals

Theo dõi theo workload, priority và pool:

- Số Pod `Pending` và tuổi Pending.
- `PodScheduled=False` reason/message.
- Scheduling attempt rate, latency và plugin latency.
- Node allocatable so với tổng requests, không chỉ usage.
- Replicas/ready endpoints theo zone và Node.
- Preemption/victim rate và Pod restart.
- Node taint/label drift.
- Device capacity, allocatable, unhealthy count.
- Autoscaler unschedulable reason và scale-up latency.

Event có retention hữu hạn và không phải metrics store dài hạn. Export Event/metrics vào observability platform nếu cần incident timeline và trend.

## 11. Runbook Pod Pending

### Bước 1: Không thay đổi trước khi thu evidence

```bash
kubectl get pod POD -n NAMESPACE -o wide
kubectl get pod POD -n NAMESPACE -o yaml > /tmp/POD.yaml
kubectl describe pod POD -n NAMESPACE
kubectl get events -n NAMESPACE --sort-by=.lastTimestamp
```

Xác nhận `spec.nodeName` rỗng. Nếu đã có Node, chuyển sang kubelet/runtime/CNI/CSI troubleshooting.

### Bước 2: Phân loại scheduler Event

| Message | Kiểm tra tiếp |
|---|---|
| `Insufficient cpu/memory` | Requests, allocatable, quota defaults, capacity/autoscaler |
| `Insufficient vendor/resource` | Device Plugin, allocatable, pool affinity/taint |
| `didn't match node affinity/selector` | Node labels và giao các hard rules |
| `untolerated taint` | Exact taints/tolerations và pool intent |
| `topology spread constraints` | Selector, domain labels, skew, `minDomains` |
| `pod anti-affinity` | Matching Pods, namespace scope, eligible domains |
| PVC/Volume binding | StorageClass, CSI, topology và binding mode |
| `preemption is not helpful` | Hard constraints hoặc resource không thể thu hồi |

### Bước 3: Tính feasible set

Liệt kê Node labels/taints/allocatable:

```bash
kubectl get nodes -o wide --show-labels
kubectl describe nodes
```

Không sửa từng lỗi riêng lẻ mà quên phép giao. Một Node đúng label có thể thiếu resource; Node đủ resource có thể sai zone.

### Bước 4: Chọn fix ít blast radius

Ưu tiên theo nguyên nhân:

- Sửa typo/selector sai trong Pod template và rollout.
- Khôi phục label/taint automation nếu Node drift.
- Sửa requests dựa trên evidence, không giảm tùy tiện.
- Thêm capacity/pool/domain phù hợp.
- Nới soft/hard constraint chỉ khi requirement cho phép.
- Sửa Device Plugin/CSI bootstrap.

Không tăng priority hoặc xóa Pod khác trước khi chứng minh resource contention là nguyên nhân.

### Bước 5: Xác minh sau fix

```bash
kubectl get pod POD -n NAMESPACE -w
kubectl get pod POD -n NAMESPACE \
  -o jsonpath='{.spec.nodeName}{"\t"}{.status.conditions[?(@.type=="Ready")].status}{"\n"}'
```

Binding chỉ là milestone đầu. Xác minh Pod `Ready`, endpoint, topology distribution và application health.

## 12. Rollout và change management

Scheduling change có thể không tác động Pod cũ vì nhiều rule là `IgnoredDuringExecution`. Đánh giá cả:

- Pod mới trong rolling update.
- Scale-up replicas.
- Replacement sau Node failure.
- Existing Pods chưa được rebalance.

Quy trình:

1. Kiểm kê feasible Nodes và headroom.
2. Server-side dry-run/schema validation khi phù hợp.
3. Canary một workload/Namespace/node pool.
4. Theo dõi Pending, distribution, preemption và readiness.
5. Rollout theo batch nhỏ.
6. Có rollback manifest, label/taint và PriorityClass plan.

Với thay đổi Node label/taint, quyết định thứ tự để tránh window sai:

- Khi đưa Node vào dedicated pool: thường thêm taint để chặn workload mới, chuẩn bị workload allowed, rồi migrate có kiểm soát.
- Khi rút Node khỏi pool: dừng placement mới, drain theo PDB, sau đó bỏ label/taint theo lifecycle automation.

## 13. Anti-patterns

### Pin Pod bằng `nodeName`

`spec.nodeName` bỏ qua scheduler và dễ tạo coupling với Node cụ thể. Chỉ dùng trong component đặc thù hiểu rõ behavior; application nên dùng affinity/selector.

### Required anti-affinity cho mọi replica

Khi replicas nhiều hơn Node/domain, rollout kẹt. Dùng topology spread hoặc preferred anti-affinity nếu mục tiêu chỉ là giảm dồn.

### Toleration rất rộng

`operator: Exists` không key/effect có thể cho Pod vào nhiều Node dành riêng hoặc pressure state. Viết toleration hẹp và kiểm soát admission.

### Label thiết bị nhưng không request resource

Hai Pod có thể cùng nghĩ mình sở hữu một thiết bị. Dùng Device Plugin/DRA allocation.

### Priority inflation

Mọi team chọn priority cao làm thứ tự mất ý nghĩa và tăng preemption. Priority là policy cấp platform.

### Nới requests để “hết Pending”

Giảm request không làm workload dùng ít resource hơn; nó chuyển lỗi từ scheduling sang runtime pressure. Sizing từ metric/load test hoặc thêm capacity.

### Kỳ vọng tự rebalance

Scheduler không live-migrate Pod cũ sau khi Node mới xuất hiện. Dùng rollout/descheduling có kiểm soát nếu lợi ích đáng disruption.

## 14. Checklist production

### Workload

- [ ] Mọi container có requests dựa trên measurement.
- [ ] Hard constraints gắn với correctness/policy; optimization dùng soft preference.
- [ ] Selector đủ đặc hiệu và match Pod template.
- [ ] Replica distribution được test theo Node/zone failure.
- [ ] PriorityClass đúng và quyền sử dụng được kiểm soát.
- [ ] Termination, retry/checkpoint phù hợp với preemption/drain.

### Platform

- [ ] Node label/taint có owner, automation và drift alert.
- [ ] Mỗi required topology domain có node group/capacity thực.
- [ ] Autoscaler template thỏa label, taint và device bootstrap.
- [ ] Priority taxonomy, quota/admission và victim policy được review.
- [ ] Scheduler/Event/device metrics được lưu và alert.
- [ ] Upgrade kiểm tra scheduler config và API field lifecycle.

### Validation

- [ ] Test scale from zero và peak replicas.
- [ ] Test mất Node/zone, drain và rolling update.
- [ ] Test thiếu capacity, autoscaler latency và preemption.
- [ ] Test plugin/driver restart cho scarce resources.
- [ ] Rollback policy và manifest đã được diễn tập.

## Tài liệu tham khảo

- [Scheduling, Preemption and Eviction](https://kubernetes.io/docs/concepts/scheduling-eviction/)
- [Scheduling Framework](/scheduling/scheduling-framework/)
- [nodeSelector và Node Affinity](/scheduling/node-selector/)
- [Pod Affinity và Anti-affinity](/scheduling/pod-affinity-anti-affinity/)
- [Taints và Tolerations](/scheduling/taints-tolerations/)
- [Topology Spread Constraints](/scheduling/topology-spread/)
- [PriorityClass](/scheduling/priority-classes/)
- [Pod Preemption](/scheduling/preemption/)
