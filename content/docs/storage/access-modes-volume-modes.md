---
title: "Access Modes và Volume Modes"
description: "Phân biệt RWO, ROX, RWX, RWOP với Filesystem và Block; cách chúng ảnh hưởng binding, scheduling, mount và concurrent access."
---

# Access Modes và Volume Modes

## Mục lục

- [Tổng quan](#tổng-quan)
- [1. Hai trục độc lập](#1-hai-trục-độc-lập)
- [2. Access Modes](#2-access-modes)
- [3. ReadWriteOnce không phải một Pod](#3-readwriteonce-không-phải-một-pod)
- [4. ReadWriteOncePod](#4-readwriteoncepod)
- [5. ReadOnlyMany và ReadWriteMany](#5-readonlymany-và-readwritemany)
- [6. Filesystem và Block](#6-filesystem-và-block)
- [7. Binding matrix cho volumeMode](#7-binding-matrix-cho-volumemode)
- [8. Manifest Filesystem](#8-manifest-filesystem)
- [9. Manifest raw Block](#9-manifest-raw-block)
- [10. Chọn mode theo workload](#10-chọn-mode-theo-workload)
- [11. Troubleshooting](#11-troubleshooting)
- [12. Best practices](#12-best-practices)
- [Tài liệu tham khảo](#tài-liệu-tham-khảo)

---

## Tổng quan

PVC cần trả lời hai câu hỏi khác nhau:

1. **Access mode:** Volume cần được các Node/Pod truy cập theo mô hình nào?
2. **Volume mode:** Container nhìn thấy một filesystem đã mount hay raw block device?

```text
Access mode: RWO / ROX / RWX / RWOP
                 ×
Volume mode: Filesystem / Block
```

Hai trục cùng tham gia binding/capability. Chọn `ReadWriteMany` không biến block storage chỉ attach một Node thành shared filesystem; chọn `Block` không tự làm database nhanh hơn nếu application không quản lý raw device đúng cách.

## 1. Hai trục độc lập

Ví dụ:

- `RWO + Filesystem`: block disk được format/mount trên một Node; nhiều Pod cùng Node vẫn có thể cùng thấy nó.
- `RWX + Filesystem`: shared/distributed filesystem cho phép nhiều Node mount read-write.
- `RWOP + Filesystem`: CSI Volume được Kubernetes giới hạn cho một Pod read-write trong cluster.
- `RWO + Block`: raw device được attach vào một Node và đưa vào container.

Backend/CSI driver quyết định tổ hợp nào được hỗ trợ. Kubernetes dùng mode để chọn PV và điều phối attach/mount; nó không thêm replication hoặc distributed locking cho storage.

## 2. Access Modes

| Tên | Viết tắt | Contract mount |
|---|---|---|
| `ReadWriteOnce` | RWO | Read-write trên một Node |
| `ReadOnlyMany` | ROX | Read-only trên nhiều Node |
| `ReadWriteMany` | RWX | Read-write trên nhiều Node |
| `ReadWriteOncePod` | RWOP | Read-write bởi một Pod trong toàn cluster |

Một Volume chỉ được mount theo một access mode tại một thời điểm, dù backend quảng bá nhiều capability.

> [!IMPORTANT]
> Trừ RWOP, access modes chủ yếu dùng cho matching và mount topology; chúng không phải cơ chế authorization write bên trong filesystem. Read-only cần được thể hiện ở mount/export và kiểm chứng thực tế.

## 3. ReadWriteOnce không phải một Pod

RWO nghĩa là **một Node**, không phải một Pod. Hai Pod trên cùng Node có thể cùng dùng PVC RWO:

```text
Node A
├── Pod writer-1 ─┐
└── Pod writer-2 ─┴─ PVC RWO
```

Điều này nguy hiểm nếu application tin rằng RWO là singleton lock. Deployment có `replicas: 1` cũng có thể tạm thời tồn tại Pod cũ và Pod mới trong rollout/failure scenario.

Nếu chỉ một process được phép mở data store:

- Dùng RWOP khi CSI driver và cluster hỗ trợ.
- Dùng StatefulSet/leader election/fencing phù hợp.
- Dùng database protocol, không dựa riêng vào scheduler.
- Xử lý stale Node/attachment để tránh split-brain.

## 4. ReadWriteOncePod

RWOP giới hạn PVC read-write cho một Pod trên toàn cluster. Nó chỉ áp dụng cho CSI Volume và cần CSI sidecars/driver tương thích.

```yaml
spec:
  accessModes:
    - ReadWriteOncePod
```

RWOP mạnh hơn RWO cho single-writer, nhưng vẫn không thay thế application fencing:

- Backend có thể được truy cập ngoài Kubernetes.
- Force detach sai khi Node cũ còn chạy vẫn nguy hiểm.
- Backup/restore hoặc admin operation có thể tạo writer khác.
- RWOP không cung cấp distributed transaction hay database HA.

Kiểm tra driver support bằng tài liệu driver và một test failover thực tế; API chấp nhận manifest chưa đủ chứng minh end-to-end capability.

## 5. ReadOnlyMany và ReadWriteMany

### 5.1 ROX

Nhiều Node mount read-only, phù hợp dataset/artifact dùng chung. Nhưng update source và cache consistency phụ thuộc filesystem/backend. Nếu cần immutable distribution, image/object storage/CDN có thể phù hợp hơn shared filesystem.

### 5.2 RWX

Nhiều Node mount read-write. Use case thường gặp:

- Shared uploads/content.
- Build workspace được tool phối hợp.
- Legacy application yêu cầu shared filesystem.

RWX không bảo đảm mọi application an toàn với concurrent writers. Cần hiểu locking, rename, fsync, cache coherency, UID/GID và latency semantics của backend. Nhiều database không hỗ trợ nhiều instance cùng dùng một data directory dù filesystem RWX.

## 6. Filesystem và Block

### 6.1 `Filesystem`

Đây là default khi bỏ `volumeMode`. Nếu backing device chưa có filesystem và driver hỗ trợ, Kubernetes/driver chuẩn bị filesystem rồi mount vào directory. Application dùng file API bình thường.

```yaml
volumeMode: Filesystem
```

Ưu điểm:

- Phù hợp phần lớn application.
- Kubelet/driver quản lý mount lifecycle.
- Dễ kiểm tra capacity và permission bằng tool filesystem.

Trade-off: filesystem overhead, mount option, inode, ownership và consistency semantics.

### 6.2 `Block`

Raw block đưa device vào container, không mount filesystem:

```yaml
volumeMode: Block
```

Application phải biết đọc/ghi block, quản lý metadata/filesystem riêng nếu cần và xử lý alignment, recovery, fencing. Không chạy `mkfs` trên Volume chứa dữ liệu.

Raw block phù hợp với storage engine chuyên dụng hoặc tool quản trị, không phải optimization mặc định.

## 7. Binding matrix cho volumeMode

`volumeMode` của PV/PVC phải tương thích:

| PV | PVC | Bind? |
|---|---|---:|
| Bỏ trống | Bỏ trống | Có (`Filesystem`) |
| Bỏ trống | `Filesystem` | Có |
| Bỏ trống | `Block` | Không |
| `Filesystem` | Bỏ trống/`Filesystem` | Có |
| `Filesystem` | `Block` | Không |
| `Block` | `Block` | Có |
| `Block` | Bỏ trống/`Filesystem` | Không |

PV static sai mode làm PVC `Pending` dù size/class/access mode đều khớp.

## 8. Manifest Filesystem

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: filesystem-data
  namespace: storage-lab
spec:
  storageClassName: REPLACE_WITH_STORAGE_CLASS
  accessModes: ["ReadWriteOnce"]
  volumeMode: Filesystem
  resources:
    requests:
      storage: 1Gi
---
apiVersion: v1
kind: Pod
metadata:
  name: filesystem-consumer
  namespace: storage-lab
spec:
  securityContext:
    fsGroup: 2000
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "echo hello > /data/message; sleep 3600"]
      volumeMounts:
        - name: data
          mountPath: /data
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: filesystem-data
```

Xác minh:

```bash
kubectl get pvc filesystem-data -n storage-lab
kubectl exec filesystem-consumer -n storage-lab -- sh -c 'mount | grep /data; df -h /data; cat /data/message'
```

## 9. Manifest raw Block

Chỉ chạy với StorageClass/CSI driver hỗ trợ raw block:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: block-data
  namespace: storage-lab
spec:
  storageClassName: REPLACE_WITH_BLOCK_STORAGE_CLASS
  accessModes: ["ReadWriteOnce"]
  volumeMode: Block
  resources:
    requests:
      storage: 1Gi
---
apiVersion: v1
kind: Pod
metadata:
  name: block-consumer
  namespace: storage-lab
spec:
  containers:
    - name: inspector
      image: busybox:1.36
      command: ["sh", "-c", "ls -l /dev/xvda; sleep 3600"]
      volumeDevices:
        - name: data
          devicePath: /dev/xvda
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: block-data
```

`volumeDevices` khác `volumeMounts`. Xác minh device tồn tại:

```bash
kubectl exec block-consumer -n storage-lab -- ls -l /dev/xvda
```

> [!WARNING]
> Không dùng `dd`, `mkfs` hoặc tool ghi lên raw device production chỉ để test. Một lệnh sai phá hủy filesystem/data ngay lập tức.

## 10. Chọn mode theo workload

| Requirement | Lựa chọn ban đầu | Câu hỏi phải kiểm chứng |
|---|---|---|
| Một database replica, block disk | RWO/RWOP + Filesystem | Driver hỗ trợ fencing/reattach? |
| Nhiều web replicas đọc dataset | ROX hoặc object/image distribution | Update/cache semantics? |
| Nhiều replicas ghi shared files | RWX + Filesystem | Application locking và latency? |
| Storage engine quản lý device | RWO/RWOP + Block | Engine support, recovery, alignment? |
| StatefulSet mỗi replica một disk | RWO/RWOP + Filesystem qua claim template | Zone, retention, backup? |

Chọn theo smallest capability đáp ứng nhu cầu. RWX thường đắt/phức tạp hơn và mở rộng concurrent-write risk; raw block tăng trách nhiệm cho application.

## 11. Troubleshooting

### PVC `Pending` dù có PV

```bash
kubectl describe pvc PVC -n NS
kubectl get pv PV -o yaml
```

So sánh chính xác `accessModes` và `volumeMode`. Requested mode phải nằm trong capability của PV/driver.

### `Multi-Attach error`

RWO Volume đang attach Node khác. Kiểm tra:

```bash
kubectl get pod -A -o wide | grep PVC_RELATED_WORKLOAD
kubectl get volumeattachment
kubectl describe pod POD -n NS
```

Dừng writer cũ và để driver detach bình thường. Force detach chỉ sau khi fencing Node cũ và xác nhận không còn I/O.

### RWX mount được nhưng ghi lỗi

Kiểm tra mount read-only, export policy, UID/GID, root squash, filesystem quota và backend health:

```bash
kubectl exec POD -n NS -- id
kubectl exec POD -n NS -- mount
kubectl exec POD -n NS -- stat -c '%u:%g %a %n' /DATA
```

Access mode trong PVC không override export/ACL của backend.

### Raw block Pod không start

Kiểm tra driver raw block support, PVC/PV mode, `volumeDevices` thay vì `volumeMounts`, device path unique và Pod Security policy. Event attach/map thường chỉ ra layer lỗi.

### Filesystem mount lỗi hoặc read-only sau recovery

Filesystem có thể lỗi/corrupt và được kernel mount read-only. Dừng writers, snapshot/backup nếu có thể, rồi dùng filesystem-specific recovery runbook trên maintenance host/Pod. Không chạy repair đồng thời với application.

## 12. Best practices

1. Nhớ RWO là một Node; dùng RWOP/application fencing khi cần single Pod writer.
2. Không suy ra concurrent-write safety từ RWX.
3. Dùng `Filesystem` trừ khi application có support raw block rõ ràng.
4. Kiểm tra capability trên exact CSI driver/version và storage tier.
5. Test reschedule, stale Node, detach/reattach và zone failure trước production.
6. Mount read-only ở container không cần ghi; access mode không thay read-only mount.
7. Theo dõi attach limit, latency, filesystem fullness/inode và I/O error.
8. Ghi access/volume mode vào backup/restore metadata; restore sai mode có thể bị chặn hoặc nguy hiểm.

## Tài liệu tham khảo

- [Persistent Volume Access Modes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/#access-modes)
- [Volume Mode](https://kubernetes.io/docs/concepts/storage/persistent-volumes/#volume-mode)
- [Raw Block Volume Support](https://kubernetes.io/docs/concepts/storage/persistent-volumes/#raw-block-volume-support)
