---
title: "Storage cho Stateful Workloads"
description: "Thiết kế storage cho StatefulSet và database: identity, volumeClaimTemplates, topology, replication, capacity, retention, migration và failure recovery."
---

# Storage cho Stateful Workloads

## Mục lục

- [Tổng quan](#tổng-quan)
- [1. Stateful không chỉ là gắn PVC](#1-stateful-không-chỉ-là-gắn-pvc)
- [2. Identity Pod, PVC và data](#2-identity-pod-pvc-và-data)
- [3. volumeClaimTemplates](#3-volumeclaimtemplates)
- [4. PVC retention khi scale và delete](#4-pvc-retention-khi-scale-và-delete)
- [5. Replication và failure domain](#5-replication-và-failure-domain)
- [6. Scheduling, topology và attach](#6-scheduling-topology-và-attach)
- [7. Performance và capacity](#7-performance-và-capacity)
- [8. Backup, consistency và disaster recovery](#8-backup-consistency-và-disaster-recovery)
- [9. Resize và migration](#9-resize-và-migration)
- [10. Manifest StatefulSet hoàn chỉnh](#10-manifest-statefulset-hoàn-chỉnh)
- [11. Thực hành persistence theo ordinal](#11-thực-hành-persistence-theo-ordinal)
- [12. Failure scenarios và troubleshooting](#12-failure-scenarios-và-troubleshooting)
- [13. Checklist production](#13-checklist-production)
- [Tài liệu tham khảo](#tài-liệu-tham-khảo)

---

## Tổng quan

Stateful workload cần nhiều hơn việc giữ file qua Pod restart. Thiết kế phải nối application identity, storage identity, replication protocol, topology, backup và recovery:

```text
StatefulSet db
├── db-0 ↔ data-db-0 ↔ volume A
├── db-1 ↔ data-db-1 ↔ volume B
└── db-2 ↔ data-db-2 ↔ volume C

Application protocol: leader/quorum/replication
Storage backend: durability/zone/snapshot
Kubernetes: identity/scheduling/attach/mount
```

Kubernetes cung cấp building blocks. Nó không tự biến ba disk thành database cluster nhất quán, không tự backup và không quyết định member nào an toàn để xóa.

## 1. Stateful không chỉ là gắn PVC

Các requirement thường bị trộn lẫn:

| Requirement | Thành phần chính |
|---|---|
| Pod name/DNS ổn định | StatefulSet + Headless Service |
| Volume riêng cho mỗi replica | `volumeClaimTemplates` |
| Dữ liệu sống qua Pod replacement | PV/PVC + storage backend |
| Chịu mất Pod/Node/zone | Application replication + topology + backend |
| Point-in-time recovery | Database backup/WAL + snapshot/object storage |
| Tránh hai writer | Application fencing/consensus + access mode/attach |
| Khôi phục sau cluster mất | Off-cluster backup, metadata, credentials, runbook |

Một single-replica database dùng regional disk có durability tốt hơn local disk, nhưng vẫn có application downtime và không chống logical corruption. Một database ba replica trên cùng zone vẫn không chịu được zone outage.

## 2. Identity Pod, PVC và data

StatefulSet gán ordinal ổn định:

```text
mysql-0 → data-mysql-0
mysql-1 → data-mysql-1
mysql-2 → data-mysql-2
```

Khi `mysql-1` được thay, Pod mới giữ tên `mysql-1` và tham chiếu PVC cũ. Pod UID, IP, container và Node có thể đổi.

Identity ổn định giúp application map member với data directory, nhưng cũng tạo invariant:

- Không tráo PVC giữa ordinals nếu application lưu member identity trong data.
- Không clone một PVC rồi cho hai member cùng quảng bá identity.
- Scale down không đồng nghĩa dữ liệu/member metadata đã được remove an toàn.
- Restore cần map đúng ordinal, cluster ID và replication state.

Xem controller semantics tại [StatefulSet](/workloads/statefulset/).

## 3. volumeClaimTemplates

```yaml
volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      accessModes: ["ReadWriteOnce"]
      storageClassName: database-zonal
      resources:
        requests:
          storage: 100Gi
```

Controller tạo một PVC cho mỗi ordinal. PVC có lifecycle tách Pod, vì vậy container/Pod replacement tái dùng claim.

`volumeClaimTemplates` không phải template được áp lại tự do lên PVC cũ. Nhiều field của StatefulSet claim template bị giới hạn khi sửa; tăng size thường phải patch từng PVC nếu class/driver hỗ trợ. Đổi StorageClass cần data migration, không phải edit template.

### 3.1 Một PVC mỗi replica hay shared RWX

Một PVC RWO/RWOP mỗi replica thường phù hợp database có replication riêng:

- Failure domain rõ.
- Không chia filesystem metadata/latency giữa replicas.
- Application kiểm soát data replication.

Shared RWX phù hợp khi application thật sự cần shared filesystem. Nó không thay database replication và có thể tạo single failure/performance domain chung.

## 4. PVC retention khi scale và delete

Mặc định bảo thủ là giữ PVC được tạo từ claim template. StatefulSet hỗ trợ `persistentVolumeClaimRetentionPolicy` trên cluster/version phù hợp:

```yaml
spec:
  persistentVolumeClaimRetentionPolicy:
    whenDeleted: Retain
    whenScaled: Retain
```

Mỗi policy có thể là `Retain` hoặc `Delete`:

- `whenDeleted`: khi StatefulSet bị xóa.
- `whenScaled`: khi replica bị xóa do scale down.

`Retain/Retain` an toàn hơn cho database; đổi lại cần inventory PVC không còn Pod. `Delete` giảm orphan cost nhưng scale/uninstall nhầm có thể kích hoạt reclaim và xóa backing volume.

> [!WARNING]
> Retention policy chỉ quản lý PVC lifecycle trong các tình huống controller tương ứng. Nó không tạo backup, không bảo vệ khỏi xóa PVC trực tiếp và không hiểu quorum/member removal của database.

Trước scale down:

1. Xác định ordinal bị remove.
2. Chuyển leader và remove/rebalance member theo application protocol.
3. Tạo/verify recovery point.
4. Xác nhận PVC retention và PV reclaim policy.
5. Scale từng bước, theo dõi quorum/replication lag.

## 5. Replication và failure domain

Có hai lớp replication khác nhau:

- **Application replication:** WAL/logical/consensus giữa database replicas; hiểu transaction/order.
- **Storage replication:** mirror bytes trong backend; thường không hiểu transaction.

Dùng cả hai có thể phù hợp nhưng không thay thế nhau. Storage replicated ba bản trong một region không tạo database read replica; ba database replicas trên local disk không bảo đảm backup khi operator xóa dữ liệu logic.

Topology spread cho database replicas:

```yaml
spec:
  template:
    spec:
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app: database
```

Kiểm tra storage backend cũng nằm ở failure domain phù hợp. Pod phân tán zone nhưng Volume mỗi Pod bị provision sai topology sẽ làm scheduling hoặc recovery thất bại.

## 6. Scheduling, topology và attach

Dùng StorageClass `WaitForFirstConsumer` cho zonal/local storage. Scheduler khi đó giải giao điểm:

```text
Node có CPU/memory
∩ Node qua taint/affinity
∩ topology của StorageClass/PV
∩ anti-affinity/spread giữa replicas
∩ attach limit còn trống
```

Nếu giao điểm rỗng, Pod Pending là đúng. Đừng nới anti-affinity hoặc xóa PV node affinity ngay; đánh giá availability trade-off.

### 6.1 Node failure và stale attachment

RWO Volume có thể cần detach Node cũ trước khi attach Node mới. Nếu Node mất network nhưng vẫn ghi storage, force detach có thể tạo hai writers. Recovery cần fencing Node cũ ở infrastructure/storage layer trước khi ép reattach.

Runbook phải ghi rõ:

- Khi nào Node được coi là fenced.
- Ai có quyền force detach.
- Cách xác nhận application member cũ không còn phục vụ.
- Cách kiểm tra filesystem/database sau failover.

## 7. Performance và capacity

Database performance bị ảnh hưởng bởi latency tail, fsync, IOPS, throughput, queue depth và noisy neighbor. Requested GiB không biểu diễn đầy đủ performance.

Benchmark đúng workload:

- Read/write size và random/sequential ratio.
- Sync write/fsync, không chỉ buffered throughput.
- P95/P99 latency trong steady state và khi snapshot/rebuild.
- Compaction/checkpoint/backup đồng thời.
- Failure recovery và replica catch-up.

Capacity plan gồm:

```text
live data
+ index/metadata
+ WAL/binlog
+ compaction/rewrite headroom
+ backup staging
+ replication/rebuild headroom
```

Alert trước khi filesystem đầy. Nhiều database có behavior xấu hoặc cần manual recovery khi hết disk/inode.

## 8. Backup, consistency và disaster recovery

Storage snapshot đang khi database ghi thường chỉ crash-consistent. Application-consistent recovery có thể cần:

- Flush/checkpoint.
- Freeze writes hoặc filesystem trong khoảng ngắn.
- Database-native backup.
- WAL/binlog archiving để point-in-time recovery.
- Coordinated snapshot cho nhiều Volume.

Backup phải rời failure domain của cluster/storage chính, được mã hóa và có retention. Restore drill mới xác nhận RPO/RTO; snapshot `readyToUse: true` chỉ xác nhận backend hoàn thành snapshot.

Xem [Volume Snapshots](/storage/volume-snapshots/) và [Backup và Restore Storage](/storage/storage-backup-restore/).

## 9. Resize và migration

### 9.1 Resize

Patch từng PVC khi StorageClass cho expansion:

```bash
kubectl patch pvc data-db-0 -n database \
  -p '{"spec":{"resources":{"requests":{"storage":"200Gi"}}}}'
```

Theo dõi backend expansion, PVC capacity, filesystem resize và application. Với nhiều replicas, canary một member/follower trước; giữ quorum và backup.

### 9.2 Migration StorageClass/backend

Không đổi `storageClassName` để di chuyển bytes. Các chiến lược:

- Database replication sang StatefulSet/cluster mới.
- Backup restore vào PVC mới.
- CSI snapshot/clone nếu source-target support.
- File copy khi application đã quiesce và semantics cho phép.

Plan cutover cần DNS/Service, identity, replication lag, write freeze, validation, rollback point và cleanup delay.

## 10. Manifest StatefulSet hoàn chỉnh

Lab dưới đây chứng minh identity/PVC, không phải database HA:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: web-headless
  namespace: storage-lab
spec:
  clusterIP: None
  selector:
    app: stateful-web
  ports:
    - name: http
      port: 80
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: web
  namespace: storage-lab
spec:
  serviceName: web-headless
  replicas: 2
  persistentVolumeClaimRetentionPolicy:
    whenDeleted: Retain
    whenScaled: Retain
  selector:
    matchLabels:
      app: stateful-web
  template:
    metadata:
      labels:
        app: stateful-web
    spec:
      initContainers:
        - name: initialize
          image: busybox:1.36
          command: ["sh", "-c"]
          args:
            - test -f /data/index.html || echo "$HOSTNAME initialized $(date -Iseconds)" > /data/index.html
          volumeMounts:
            - name: data
              mountPath: /data
      containers:
        - name: nginx
          image: nginx:1.27-alpine
          ports:
            - name: http
              containerPort: 80
          readinessProbe:
            httpGet:
              path: /
              port: http
          volumeMounts:
            - name: data
              mountPath: /usr/share/nginx/html
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 1Gi
```

Manifest dùng default StorageClass. Nếu cluster/version không hỗ trợ retention field, API validation sẽ báo lỗi; bỏ field cho lab và nhớ behavior mặc định là giữ PVC.

## 11. Thực hành persistence theo ordinal

```bash
kubectl create namespace storage-lab
kubectl apply -f stateful-storage-lab.yaml
kubectl rollout status statefulset/web -n storage-lab --timeout=180s
kubectl get pod,pvc -n storage-lab -o wide
```

Đọc dữ liệu:

```bash
kubectl exec web-0 -n storage-lab -- cat /usr/share/nginx/html/index.html
kubectl exec web-1 -n storage-lab -- cat /usr/share/nginx/html/index.html
```

Xóa `web-0`, chờ controller tạo lại rồi đọc:

```bash
kubectl delete pod web-0 -n storage-lab
kubectl wait --for=condition=Ready pod/web-0 -n storage-lab --timeout=180s
kubectl exec web-0 -n storage-lab -- cat /usr/share/nginx/html/index.html
```

Dòng vẫn chứa thời điểm/identity khởi tạo cũ vì PVC `data-web-0` được tái dùng.

Scale down và quan sát PVC:

```bash
kubectl scale statefulset/web -n storage-lab --replicas=1
kubectl get pod,pvc -n storage-lab
```

Với `whenScaled: Retain`, `data-web-1` còn lại. Scale lên 2 sẽ tái dùng claim đó.

Cleanup cần kiểm tra PV reclaim trước khi xóa PVC:

```bash
kubectl delete statefulset web -n storage-lab
kubectl get pvc -n storage-lab
kubectl get pv
# Sau khi xác nhận không cần dữ liệu:
kubectl delete pvc -n storage-lab data-web-0 data-web-1
kubectl delete namespace storage-lab
```

## 12. Failure scenarios và troubleshooting

### Pod Pending, PVC Pending

```bash
kubectl describe pod POD -n NS
kubectl describe pvc PVC -n NS
kubectl get storageclass
kubectl get nodes -L topology.kubernetes.io/zone
```

Kiểm tra first consumer, capacity, anti-affinity, zone và provisioner.

### Pod Pending, PVC Bound

Tập trung PV node affinity, resource/taint constraints và attach limit:

```bash
PV=$(kubectl get pvc PVC -n NS -o jsonpath='{.spec.volumeName}')
kubectl get pv "$PV" -o yaml
kubectl describe pod POD -n NS
```

### Pod `ContainerCreating`

Tìm `FailedAttachVolume`/`FailedMount`, stale `VolumeAttachment`, CSI node plugin và permission/filesystem error.

### Rollout kẹt ở một ordinal

StatefulSet `OrderedReady` chờ Pod Ready. Điều tra Pod/PVC/application log ở ordinal đó; đừng xóa hàng loạt Pods. Database member có thể cần recovery/catch-up trước khi readiness thành công.

### Scale down rồi scale up dùng dữ liệu cũ ngoài ý muốn

Đây là hệ quả retention. Trước reuse, xác định PVC cũ còn phù hợp cluster membership. Nếu cần member mới sạch, archive/backup rồi xóa hoặc đổi claim theo procedure của application; không xóa PVC theo cảm tính.

### Volume full

Dừng growth không cần thiết, xác định WAL/log/temp/compaction, backup, rồi expand hoặc migrate. Xóa file database trực tiếp để lấy chỗ có thể phá consistency.

## 13. Checklist production

- [ ] Mỗi replica/PVC map với identity và membership rõ.
- [ ] Application replication, quorum và fencing được test.
- [ ] Pod và Volume phân bố đúng Node/zone failure domain.
- [ ] StorageClass dùng binding mode, reclaim, encryption và tier phù hợp.
- [ ] PVC retention khi scale/delete được khai báo hoặc ghi rõ behavior mặc định.
- [ ] Capacity alert tính cả WAL, compaction và rebuild headroom.
- [ ] Benchmark có fsync/tail latency và chạy cùng snapshot/backup.
- [ ] Backup application-consistent, off-failure-domain và restore drill đạt RPO/RTO.
- [ ] Runbook có Node fencing, force detach, member replacement và migration.
- [ ] Cleanup StatefulSet/Namespace không tự động xóa dữ liệu chưa được phê duyệt.

## Tài liệu tham khảo

- [StatefulSets](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/)
- [Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)
- [Storage Classes](https://kubernetes.io/docs/concepts/storage/storage-classes/)
