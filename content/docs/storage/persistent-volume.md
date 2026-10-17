---
title: "PersistentVolume"
description: "Giải thích PersistentVolume từ mental model đến lifecycle: PV đại diện storage thật như thế nào, cách bind với PVC, static/dynamic provisioning, reclaim policy và troubleshooting."
---

# PersistentVolume

## Mục lục

- [Tổng quan](#tổng-quan)
- [1. Vì sao Kubernetes cần PersistentVolume](#1-vì-sao-kubernetes-cần-persistentvolume)
- [2. Mental model: PV là hồ sơ của storage thật](#2-mental-model-pv-là-hồ-sơ-của-storage-thật)
- [3. PV chứa gì và không chứa gì](#3-pv-chứa-gì-và-không-chứa-gì)
- [4. PV được tạo bằng cách nào](#4-pv-được-tạo-bằng-cách-nào)
- [5. PV bind với PVC như thế nào](#5-pv-bind-với-pvc-như-thế-nào)
- [6. Đọc một manifest PV](#6-đọc-một-manifest-pv)
- [7. Lifecycle và phase của PV](#7-lifecycle-và-phase-của-pv)
- [8. Reclaim policy và tác động khi xóa](#8-reclaim-policy-và-tác-động-khi-xóa)
- [9. Topology và node affinity](#9-topology-và-node-affinity)
- [10. Ví dụ static provisioning](#10-ví-dụ-static-provisioning)
- [11. Thực hành quan sát một PV động](#11-thực-hành-quan-sát-một-pv-động)
- [12. Pre-binding và phục hồi volume Retain](#12-pre-binding-và-phục-hồi-volume-retain)
- [13. Finalizer và bảo vệ storage đang dùng](#13-finalizer-và-bảo-vệ-storage-đang-dùng)
- [14. Troubleshooting theo triệu chứng](#14-troubleshooting-theo-triệu-chứng)
- [15. Checklist vận hành PV](#15-checklist-vận-hành-pv)
- [Tài liệu tham khảo](#tài-liệu-tham-khảo)

---

## Tổng quan

Một Pod có thể bị xóa rồi được Deployment hoặc StatefulSet tạo lại trên Node khác. Nếu dữ liệu chỉ nằm trong writable layer của container hoặc một `emptyDir`, Pod mới không tự nhận lại dữ liệu cũ. Dữ liệu cần sống lâu hơn Pod phải nằm trên một storage asset có lifecycle riêng, ví dụ cloud disk, NFS share, SAN LUN hoặc local disk đã được quản lý.

Kubernetes cần một object để biết storage asset đó là gì, có dung lượng bao nhiêu, Pod nào được dùng, truy cập từ đâu và xử lý ra sao khi không còn được claim. Object đó là **PersistentVolume**.

> **Định nghĩa ngắn:** `PersistentVolume` (PV) là API object cấp cluster đại diện cho một storage asset có lifecycle độc lập với Pod.

Điểm dễ nhầm nhất là: **PV không chứa bytes dữ liệu trong API server**. Dữ liệu thật nằm trên storage backend. PV chỉ lưu thông tin để Kubernetes và storage driver tìm, bind, attach, mount và reclaim asset đó.

```d2 title="Tổng quan"
direction: right
asset: "Storage backend asset\ncloud disk / NFS / SAN\nchứa bytes dữ liệu" {shape: cylinder}
pv: "PersistentVolume\nhồ sơ trong Kubernetes\ncapacity, mode, class, topology,\nvolume handle,…"
asset -- pv: đại diện
```

Nếu chỉ nhớ năm điều, hãy nhớ:

1. PV đại diện cho **một volume cụ thể**, không phải một loại storage chung.
2. PV là **cluster-scoped**, không thuộc Namespace.
3. Application thường không chọn PV trực tiếp; application tạo **PVC** để yêu cầu storage.
4. Một PV chỉ bind độc quyền với một PVC tại một thời điểm.
5. Xóa PVC có thể giữ hoặc xóa cả volume thật, tùy reclaim policy của PV.

## 1. Vì sao Kubernetes cần PersistentVolume

Compute và storage có lifecycle khác nhau:

- Pod là tài nguyên có thể bị thay thế thường xuyên.
- Storage chứa state thường phải tồn tại qua nhiều thế hệ Pod.
- Pod mới có thể chạy trên Node khác nhưng vẫn cần dữ liệu cũ.
- Storage backend có API, topology, credential và cơ chế attach/mount riêng.

Nếu Pod tham chiếu trực tiếp một disk ID của cloud provider, manifest sẽ gắn chặt với một môi trường cụ thể và application phải biết quá nhiều chi tiết hạ tầng. PV tạo lớp trung gian giữa storage thật và cách workload yêu cầu storage.

So sánh ba nơi lưu dữ liệu:

| Nơi lưu | Sống qua container restart trong cùng Pod | Sống qua Pod replacement | Object đại diện |
|---|---:|---:|---|
| Writable layer của container | Không nên dựa vào | Không | Container runtime quản lý |
| `emptyDir` | Có | Không | Volume thuộc Pod |
| Persistent storage | Có | Có, nếu Pod mới dùng lại PVC | PV đại diện asset, PVC yêu cầu asset |

PV không tự làm backend bền hơn. Khả năng chịu lỗi, replication và durability vẫn phụ thuộc storage backend. PV chỉ giúp Kubernetes quản lý và sử dụng backend đó theo một contract thống nhất.

Xem sự khác nhau giữa volume tạm thời và persistent storage tại [Volumes](/storage/volumes/).

## 2. Mental model: PV là hồ sơ của storage thật

Storage model đầy đủ có các thành phần sau:

| Thành phần | Vai trò |
|---|---|
| Storage backend | Nơi chứa bytes thật: cloud disk, filesystem share, SAN, local disk,... |
| CSI driver/volume plugin | Chuyển yêu cầu Kubernetes thành thao tác create, attach, mount, resize, delete trên backend |
| PersistentVolume | Hồ sơ trong Kubernetes đại diện một volume cụ thể |
| PersistentVolumeClaim | Yêu cầu storage của workload trong một Namespace |
| Pod | Dùng PVC để mount filesystem hoặc nhận raw block device |
| StorageClass | Mẫu mô tả cách cấp một loại storage, chủ yếu cho dynamic provisioning |

Quan hệ giữa chúng:

```d2 title="2. Mental model: PV là hồ sơ của storage thật"
direction: right
B: "Storage backend asset"
D: "CSI driver"
PV: "PersistentVolume cluster-scoped"
PVC: "PersistentVolumeClaim namespaced"
P: "Pod"
SC: "StorageClass"
B <-> D
D <-> PV
PV <-> PVC
PVC -> P
SC -> D: "hướng dẫn provision" {style.stroke-dash: 4}
```

Có thể đọc sơ đồ từ phải sang trái:

1. Pod tham chiếu PVC bằng tên trong cùng Namespace.
2. PVC bind với một PV.
3. PV chứa thông tin để CSI driver tìm volume thật.
4. CSI driver attach/mount volume từ backend vào Node và Pod.

### Phân biệt PV, PVC và StorageClass

| Object | Câu hỏi nó trả lời | Ví dụ |
|---|---|---|
| StorageClass | “Cấp loại storage nào và theo policy nào?” | `database-zonal` |
| PVC | “Workload cần bao nhiêu storage và mode nào?” | 20Gi, `ReadWriteOnce` |
| PV | “Volume cụ thể nào đã được cấp?” | `pvc-2f0b...`, volume handle `vol-...` |

Một StorageClass có thể tạo nhiều PV. Mỗi PVC được bind với một PV riêng. Pod thường chỉ biết tên PVC, không cần biết tên PV hoặc volume handle.

## 3. PV chứa gì và không chứa gì

PV lưu contract và thông tin nhận dạng của volume:

- Dung lượng được quảng bá cho binding.
- `Filesystem` hay raw `Block`.
- Access modes mà volume cung cấp.
- StorageClass của volume.
- Reclaim policy.
- Topology/Node mà volume có thể được dùng.
- Thông tin volume source như CSI driver và `volumeHandle`.
- Claim đang sở hữu volume.
- Phase và finalizer phục vụ lifecycle.

PV **không**:

- Chứa file hoặc block dữ liệu trong etcd.
- Là backup của volume.
- Chứng minh volume đang khỏe chỉ vì phase là `Bound`.
- Chia một volume cho nhiều PVC chỉ vì access mode là `ReadWriteMany`.
- Tự bảo đảm filesystem permission cho process trong container.

> [!IMPORTANT]
> `ReadWriteMany` cho phép nhiều client mount theo capability của backend; nó không làm một PV bind với nhiều PVC. Binding PV ↔ PVC vẫn là một-một. Nhiều Pod thường chia sẻ cùng một PVC trong cùng Namespace.

PV là cluster-scoped:

```bash
kubectl get pv
```

Không dùng `-n` vì PV không thuộc Namespace. Ngược lại, PVC thuộc Namespace và phải được truy vấn với `-n` khi không ở Namespace hiện tại.

## 4. PV được tạo bằng cách nào

Có hai cách chính: static provisioning và dynamic provisioning.

### Static provisioning

Administrator thực hiện trước các bước:

1. Tạo hoặc chọn storage asset thật.
2. Tạo PV mô tả asset đó.
3. Chờ một PVC phù hợp bind với PV.

```d2 title="Static provisioning"
direction: right
asset: Administrator tạo asset
pv: tạo PV Available
pvc: PVC phù hợp xuất hiện
bound: PV ↔ PVC Bound
asset -> pv -> pvc -> bound
```

Static provisioning phù hợp khi:

- Import volume hoặc dữ liệu đã tồn tại.
- Backend không có dynamic provisioner.
- Quản lý inventory local disk.
- Quy trình cấp storage cần phê duyệt thủ công.

Đổi lại, administrator phải tự quản lý inventory, mapping, cleanup và tránh trỏ nhiều PV vào cùng một asset.

### Dynamic provisioning

Application tạo PVC chọn một StorageClass. Provisioner tạo storage asset và PV dành riêng cho PVC đó:

```d2 title="Dynamic provisioning"
direction: right
pvc: PVC
sc: StorageClass
provisioner: CSI provisioner
asset: tạo backend volume
pv: tạo PV
bound: PV ↔ PVC Bound
pvc -> sc -> provisioner
provisioner -> asset
provisioner -> pv -> bound
```

Dynamic provisioning là cách phổ biến cho application self-service. Application bundle thường khai báo PVC, không khai báo PV vendor-specific.

Xem luồng controller chi tiết tại [Dynamic Provisioning](/storage/dynamic-provisioning/) và cách StorageClass điều khiển provisioning tại [StorageClass](/storage/storage-class/).

## 5. PV bind với PVC như thế nào

PVC mô tả nhu cầu; control plane tìm PV phù hợp hoặc yêu cầu provisioner tạo PV mới. Khi match thành công, PV và PVC bind độc quyền với nhau.

```d2 title="5. PV bind với PVC như thế nào"
direction: down
C: "PVC mới"
M: "Có PV phù hợp?" {shape: diamond}
B: "Bind PV với PVC"
D: "Có dynamic provisioner phù hợp?" {shape: diamond}
N: "Tạo backend volume và PV mới"
P: "PVC tiếp tục Pending"
C -> M
M -> B: "Có"
M -> D: "Không"
D -> N: "Có"
N -> B
D -> P: "Không"
```

Với PV tĩnh, binder xét các điều kiện chính:

| Tiêu chí | Điều kiện cơ bản |
|---|---|
| StorageClass | Tên class của PV và PVC phải tương thích |
| Capacity | PV phải có dung lượng bằng hoặc lớn hơn PVC yêu cầu |
| Access modes | PV phải cung cấp mode PVC yêu cầu |
| Volume mode | `Filesystem`/`Block` phải tương thích |
| Selector | Label của PV phải khớp nếu PVC có selector |
| Reservation | `claimRef`/`volumeName` phải không xung đột |

PVC yêu cầu 8Gi có thể bind với PV tĩnh 10Gi. Phần 2Gi dư không được tách để cấp cho PVC khác vì toàn bộ PV đã thuộc claim đó.

Binding là quan hệ hai chiều:

- PVC ghi tên PV trong `.spec.volumeName` sau khi bind.
- PV ghi Namespace/tên PVC trong `.spec.claimRef`.

Kiểm tra:

```bash
kubectl get pvc PVC -n NS \
  -o jsonpath='{.spec.volumeName}{"\n"}'
kubectl get pv PV \
  -o jsonpath='{.spec.claimRef.namespace}{"/"}{.spec.claimRef.name}{"\n"}'
```

PVC `Pending` không phải lúc nào cũng là lỗi. Với StorageClass dùng `WaitForFirstConsumer`, PVC có thể chờ Pod để scheduler chọn topology trước khi PV được tạo/bind.

## 6. Đọc một manifest PV

Ví dụ PV tĩnh dùng NFS đã tồn tại:

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: reports-nfs-pv
  labels:
    data-tier: reports
spec:
  capacity:
    storage: 100Gi
  volumeMode: Filesystem
  accessModes:
    - ReadWriteMany
  persistentVolumeReclaimPolicy: Retain
  storageClassName: nfs-static
  mountOptions:
    - hard
    - nfsvers=4.1
  nfs:
    server: nfs.example.internal
    path: /exports/reports
```

Đây là manifest minh họa. NFS server/export phải tồn tại và các Node cần NFS client phù hợp.

Đọc manifest theo thứ tự:

1. PV tên `reports-nfs-pv` đại diện một NFS export cụ thể.
2. Nó quảng bá capacity 100Gi.
3. Pod sử dụng dưới dạng filesystem.
4. PV hỗ trợ request `ReadWriteMany` theo contract đã khai báo.
5. PVC phải yêu cầu class `nfs-static` để match.
6. Xóa PVC không tự xóa NFS export vì policy là `Retain`.
7. Kubelet dùng NFS server, export path và mount options để mount volume.

### Các field quan trọng

| Field | Ý nghĩa | Điểm dễ nhầm |
|---|---|---|
| `capacity.storage` | Dung lượng PV cung cấp cho binding | Không phải metric free space thời gian thực |
| `volumeMode` | `Filesystem` hoặc raw `Block` | Mặc định là `Filesystem` nếu bỏ trống |
| `accessModes` | Mode PV có thể đáp ứng | Không thay thế lock/concurrency của application |
| `storageClassName` | Class dùng để match PVC | Exact match; `""` nghĩa là không class |
| `persistentVolumeReclaimPolicy` | Xử lý sau khi PVC bị xóa | Kiểm tra trên PV trước cleanup |
| `mountOptions` | Option dùng khi mount | API không validate correctness |
| `nodeAffinity` | Node/topology có thể truy cập volume | Bắt buộc với local PV |
| Volume source | Cách tìm asset thật | Với CSI thường là `csi.driver` và `csi.volumeHandle` |

### CSI volume source

PV động hiện đại thường có phần tương tự:

```yaml
spec:
  csi:
    driver: csi.storage.example.com
    volumeHandle: volume-123456
    fsType: ext4
```

- `driver` xác định CSI driver xử lý volume.
- `volumeHandle` là identifier của asset trên backend.
- `fsType` là filesystem mà driver/kubelet dùng khi phù hợp.

Không tự sửa `volumeHandle` để trỏ sang disk khác. Mapping sai có thể mount nhầm dữ liệu hoặc tạo concurrent writer.

## 7. Lifecycle và phase của PV

PV đi qua các trạng thái chính:

```d2 title="7. Lifecycle và phase của PV"
direction: right
provisioning: Provisioning
available: Available
bound: Bound
released: Released
retain: "Retain\nxử lý thủ công"
delete: "Delete\nxóa asset/PV"
failed: Failed
provisioning -> available
available -> bound: bind PVC
bound -> released: xóa PVC
released -> retain
released -> delete
released -> failed: Automated reclaim lỗi {style.stroke-dash: 4}
```

| Phase | Ý nghĩa | Hành động thường gặp |
|---|---|---|
| `Available` | PV chưa bind, có thể được claim phù hợp | Kiểm tra inventory và class |
| `Bound` | PV đã bind với một PVC | Trạng thái bình thường khi workload dùng storage |
| `Released` | PVC cũ đã bị xóa nhưng PV/asset chưa được reclaim hoàn tất | Xác định owner, recover hoặc sanitize |
| `Failed` | Automated reclaim thất bại | Kiểm tra controller, CSI và backend |

> [!WARNING]
> `Released` không có nghĩa volume đã sạch và sẵn sàng cho PVC khác. Dữ liệu của owner cũ có thể vẫn còn và `claimRef` thường ngăn bind lại để bảo vệ isolation.

Quan sát phase và claim:

```bash
kubectl get pv
kubectl describe pv PV_NAME
kubectl get pv PV_NAME \
  -o custom-columns=NAME:.metadata.name,PHASE:.status.phase,CLAIM_NS:.spec.claimRef.namespace,CLAIM:.spec.claimRef.name,CLASS:.spec.storageClassName,RECLAIM:.spec.persistentVolumeReclaimPolicy
```

Phase chỉ mô tả lifecycle API. PV `Bound` không chứng minh filesystem không hỏng, backend không đầy hoặc Pod đã mount thành công.

## 8. Reclaim policy và tác động khi xóa

Reclaim policy nằm trên từng PV tại `.spec.persistentVolumeReclaimPolicy`. Nó quyết định chuyện gì xảy ra **sau khi PVC đang bind bị xóa**.

### Delete

```yaml
persistentVolumeReclaimPolicy: Delete
```

Với driver hỗ trợ, luồng thường là:

```d2 title="Delete"
direction: right
n1: "Xóa PVC"
n2: "xóa backing storage asset"
n3: "xóa PV"
n1 -> n2
n2 -> n3
```

PV được dynamic provision kế thừa policy từ StorageClass; StorageClass mặc định dùng `Delete` nếu không khai báo `reclaimPolicy`.

`Delete` giảm orphan volume và chi phí, nhưng xóa nhầm PVC có thể dẫn đến mất disk thật. Cần backup, admission guardrail và quyền xóa phù hợp với mức độ quan trọng của dữ liệu.

### Retain

```yaml
persistentVolumeReclaimPolicy: Retain
```

Luồng thường là:

```d2 title="Retain"
direction: right
delete: Xóa PVC
released: PV Released
retained: PV và backing asset còn lại
operator: operator quyết định recover / sanitize / delete
delete -> released -> retained -> operator
```

`Retain` tạo cơ hội phục hồi thủ công nhưng không phải backup. Volume vẫn có thể hỏng hoặc bị xóa ngoài Kubernetes, đồng thời tiếp tục phát sinh chi phí.

### Recycle

`Recycle` đã deprecated. Cơ chế này chỉ scrub dữ liệu cơ bản và không phải workflow isolation/recovery an toàn cho platform hiện đại. Dùng dynamic provisioning hoặc quy trình sanitize backend được kiểm chứng.

### Xóa object nào ảnh hưởng gì

| Thao tác | PV | Backing asset |
|---|---|---|
| Xóa Pod | Không tự xóa | Không tự xóa |
| Xóa PVC khi policy `Delete` | Thường bị xóa sau reclaim | Thường bị xóa bởi provisioner |
| Xóa PVC khi policy `Retain` | Chuyển `Released` | Được giữ |
| Xóa StorageClass | PV hiện có vẫn tồn tại | Không tự xóa |
| Xóa PV `Retain` | PV object biến mất | Asset ngoài Kubernetes vẫn tồn tại |

Trước mọi cleanup, lấy policy trực tiếp từ PV:

```bash
PV=$(kubectl get pvc PVC -n NS -o jsonpath='{.spec.volumeName}')
kubectl get pv "$PV" \
  -o custom-columns=NAME:.metadata.name,RECLAIM:.spec.persistentVolumeReclaimPolicy,HANDLE:.spec.csi.volumeHandle
```

Nếu cần thay policy cho một volume cụ thể trước thao tác đã được review:

```bash
kubectl patch pv "$PV" \
  -p '{"spec":{"persistentVolumeReclaimPolicy":"Retain"}}'
```

Patch policy không tạo backup và không thay đổi dữ liệu hiện có.

## 9. Topology và node affinity

Không phải storage nào cũng truy cập được từ mọi Node:

- Cloud block disk thường thuộc một zone.
- Local disk chỉ tồn tại trên một Node.
- Một storage endpoint có thể chỉ phục vụ một tập topology cụ thể.

PV dùng `nodeAffinity` để mô tả Node nào có thể sử dụng volume:

```yaml
nodeAffinity:
  required:
    nodeSelectorTerms:
      - matchExpressions:
          - key: topology.kubernetes.io/zone
            operator: In
            values:
              - zone-a
```

Scheduler kết hợp PV node affinity với CPU/memory, Pod affinity, node selector, taint/toleration và các ràng buộc khác. Pod chỉ được đặt vào Node thỏa tất cả điều kiện.

Với local PV, `nodeAffinity` là bắt buộc vì storage gắn với một Node cụ thể. Với CSI dynamic provisioning, driver thường ghi topology phù hợp vào PV.

StorageClass dùng `WaitForFirstConsumer` giúp scheduler chọn topology trước khi tạo/bind volume. Nếu tạo zonal volume quá sớm bằng `Immediate`, Pod có thể báo `volume node affinity conflict`.

Không xóa hoặc sửa node affinity chỉ để ép Pod chạy. Backend có thể không attach hoặc không route được tới Node mới. Nếu dữ liệu đã được migrate sang topology khác, làm theo capability/version của cluster và runbook driver thay vì sửa theo phỏng đoán.

## 10. Ví dụ static provisioning

Ví dụ sau minh họa một NFS export đã được administrator chuẩn bị. Thay server/path bằng giá trị thật:

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: static-reports-pv
spec:
  capacity:
    storage: 20Gi
  volumeMode: Filesystem
  accessModes:
    - ReadWriteMany
  persistentVolumeReclaimPolicy: Retain
  storageClassName: nfs-static
  nfs:
    server: REPLACE_WITH_NFS_SERVER
    path: /exports/reports
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: reports-data
  namespace: reports
spec:
  storageClassName: nfs-static
  accessModes:
    - ReadWriteMany
  resources:
    requests:
      storage: 10Gi
```

Trước khi apply:

1. NFS export phải tồn tại và Node truy cập được.
2. Permission/export option phải phù hợp UID/GID của workload.
3. `storageClassName`, access mode và volume mode của PV/PVC phải khớp.
4. PV 20Gi sẽ được dành toàn bộ cho PVC 10Gi sau khi bind.
5. `Retain` nghĩa là cleanup cần xử lý thủ công.

Tạo Namespace và apply:

```bash
kubectl create namespace reports
kubectl apply -f static-pv.yaml
kubectl get pv static-reports-pv
kubectl get pvc reports-data -n reports
```

Expected state là PV và PVC cùng `Bound`. Nếu PVC vẫn `Pending`, dùng `kubectl describe` ở cả hai object và so sánh các điều kiện binding.

> [!WARNING]
> Không dùng `hostPath` như persistent storage cho workload multi-node. `hostPath` trỏ vào filesystem của một Node và không cung cấp scheduling contract phù hợp. Với disk cục bộ bền, dùng `local` PV có `nodeAffinity`.

## 11. Thực hành quan sát một PV động

Prerequisite: cluster có default StorageClass hỗ trợ dynamic provisioning hoặc thêm `storageClassName` phù hợp vào PVC.

Tạo file `pv-observe.yaml`:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: storage-lab
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: pv-observe
  namespace: storage-lab
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
---
apiVersion: v1
kind: Pod
metadata:
  name: pv-consumer
  namespace: storage-lab
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "echo persistent-volume-ok > /data/status; sleep 3600"]
      volumeMounts:
        - name: data
          mountPath: /data
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: pv-observe
```

Apply và chờ:

```bash
kubectl apply -f pv-observe.yaml
kubectl get pod,pvc -n storage-lab -w
```

Khi PVC `Bound` và Pod `Ready`, lấy tên PV:

```bash
PV=$(kubectl get pvc pv-observe -n storage-lab -o jsonpath='{.spec.volumeName}')
printf 'PersistentVolume=%s\n' "$PV"
kubectl get pv "$PV" -o yaml
kubectl exec pv-consumer -n storage-lab -- cat /data/status
```

Tìm các field:

```bash
kubectl get pv "$PV" \
  -o custom-columns=NAME:.metadata.name,CLASS:.spec.storageClassName,PHASE:.status.phase,CLAIM_NS:.spec.claimRef.namespace,CLAIM:.spec.claimRef.name,SIZE:.spec.capacity.storage,RECLAIM:.spec.persistentVolumeReclaimPolicy,DRIVER:.spec.csi.driver,HANDLE:.spec.csi.volumeHandle
```

Đây là trace cần hiểu:

```d2 title="11. Thực hành quan sát một PV động"
direction: right
pvc: PVC storage-lab/pv-observe
pv: PV pvc-<uid>
asset: storage asset thật trên backend
pvc -- pv: bind
pv -> asset: csi.volumeHandle
```

Trước cleanup, xem reclaim policy và xác nhận dữ liệu lab không cần giữ:

```bash
kubectl get pv "$PV" \
  -o custom-columns=NAME:.metadata.name,RECLAIM:.spec.persistentVolumeReclaimPolicy,HANDLE:.spec.csi.volumeHandle
kubectl delete namespace storage-lab
```

Nếu policy là `Retain`, PV/backend asset có thể còn lại và cần dọn theo runbook platform.

## 12. Pre-binding và phục hồi volume Retain

Thông thường binder tự chọn PV. Khi cần import/recover một volume cụ thể, PVC có thể chỉ định `volumeName`:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: recovered-data
  namespace: recovery
spec:
  storageClassName: ""
  volumeName: recovered-pv
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 100Gi
```

PV có thể reserve ngược lại cho PVC bằng `claimRef`:

```yaml
spec:
  claimRef:
    name: recovered-data
    namespace: recovery
```

Pre-binding vẫn yêu cầu class, access modes và requested size hợp lệ. Nó cũng không làm volume ở sai zone trở nên truy cập được.

Workflow phục hồi asset `Retain` cần change control:

1. Xác định đúng volume handle, owner và dữ liệu cần phục hồi.
2. Xác nhận workload cũ đã dừng; tránh hai writer.
3. Tạo snapshot/backup nếu backend còn cho phép.
4. Tạo lại hoặc điều chỉnh PV theo procedure chính thức của driver.
5. Reserve/pre-bind PVC recovery với đúng PV.
6. Mount read-only vào recovery Pod trước nếu có thể.
7. Kiểm tra filesystem và application data.
8. Khôi phục reclaim policy, monitoring và ownership mong muốn.

Không xóa `claimRef` của PV đang dùng và không tạo hai PV trỏ vào cùng một writable asset.

## 13. Finalizer và bảo vệ storage đang dùng

Kubernetes trì hoãn xóa storage object khi xóa ngay có thể làm mất dữ liệu hoặc bỏ dở backend operation.

Các finalizer thường gặp:

- `kubernetes.io/pv-protection`: bảo vệ PV còn bind với PVC.
- `kubernetes.io/pvc-protection`: bảo vệ PVC còn được Pod object tham chiếu.
- Finalizer của CSI external provisioner: giúp hoàn tất xóa backing asset trước khi PV `Delete` biến mất.

Kiểm tra:

```bash
kubectl get pv PV_NAME -o jsonpath='{.metadata.finalizers}{"\n"}'
kubectl get pvc PVC_NAME -n NS -o jsonpath='{.metadata.finalizers}{"\n"}'
```

Object có thể ở `Terminating` trong khi controller chờ dependency hoặc backend operation hoàn tất.

> [!WARNING]
> Không xóa finalizer thủ công chỉ để object biến mất. Việc đó có thể orphan disk, làm mất dấu volume handle hoặc bỏ qua quy trình xóa an toàn. Thu thập Events, CSI controller log và trạng thái backend trước.

## 14. Troubleshooting theo triệu chứng

Bắt đầu bằng cách map PVC với PV và đọc Events:

```bash
kubectl get pvc PVC -n NS -o wide
kubectl describe pvc PVC -n NS
kubectl get pv
kubectl get events -n NS --sort-by=.lastTimestamp
```

### PV Available nhưng PVC vẫn Pending

```bash
kubectl get pv PV -o yaml
kubectl get pvc PVC -n NS -o yaml
```

So sánh:

- `storageClassName`.
- Capacity.
- `accessModes`.
- `volumeMode`.
- PVC selector và PV labels.
- `claimRef` hoặc `volumeName`.

Đừng chỉ nhìn size. Một field mode/class không khớp cũng đủ làm PVC không bind.

### PV Bound nhưng Pod kẹt ContainerCreating

Binding đã xong, lỗi nằm ở scheduling, attach hoặc mount:

```bash
kubectl describe pod POD -n NS
kubectl get volumeattachment
kubectl get pv PV -o yaml
kubectl get pods -A -o wide | grep -i csi
```

Kiểm tra topology conflict, stale attachment, attach limit, CSI node plugin, mount helper, filesystem, mount option và permission.

### PV Released

Đây thường là kết quả của policy `Retain` sau khi PVC bị xóa:

```bash
kubectl get pv PV \
  -o custom-columns=NAME:.metadata.name,PHASE:.status.phase,CLAIM_NS:.spec.claimRef.namespace,CLAIM:.spec.claimRef.name,RECLAIM:.spec.persistentVolumeReclaimPolicy,HANDLE:.spec.csi.volumeHandle
```

Xác định owner và quyết định recover, sanitize hay delete. Không cố sửa `.status.phase`; phase do controller quản lý.

### PV hoặc PVC kẹt Terminating

```bash
kubectl describe pv PV
kubectl describe pvc PVC -n NS
kubectl get volumeattachment
kubectl get pv PV -o jsonpath='{.metadata.finalizers}{"\n"}'
```

Tìm Pod còn tham chiếu PVC, PV còn bind, attachment còn tồn tại, CSI controller lỗi hoặc backend delete timeout. Sửa root cause trước khi cân nhắc can thiệp finalizer.

### Volume node affinity conflict

```bash
kubectl get pv PV -o jsonpath='{.spec.nodeAffinity}{"\n"}'
kubectl describe pod POD -n NS
kubectl get nodes -L topology.kubernetes.io/zone
```

So sánh zone/Node của PV với scheduling constraints của Pod. Không xóa affinity để ép schedule; dùng class `WaitForFirstConsumer` cho volume mới hoặc thực hiện migration dữ liệu có kiểm soát.

### Mount option hoặc filesystem lỗi

Kubernetes không validate `mountOptions`. Event có thể chứa `MountVolume` hoặc exit status từ mount helper. Đối chiếu option với driver/filesystem, kiểm tra Node plugin và thử trên môi trường canary. Không đổi hàng loạt PV đang chạy trước khi xác định option gây lỗi.

### PV đã mất nhưng backend asset vẫn còn

Dùng audit log, tag backend hoặc inventory để map asset với cluster/PVC UID. Kiểm tra CSI provisioner log, credential, API timeout và finalizer history. Đây là lý do volume backend nên được tag bằng cluster, Namespace, PVC UID và owner.

## 15. Checklist vận hành PV

- [ ] Hiểu PV đại diện asset nào và `volumeHandle` map tới đâu trên backend.
- [ ] StorageClass, capacity, access mode và volume mode khớp nhu cầu PVC.
- [ ] Topology/node affinity đúng với nơi Pod có thể chạy.
- [ ] Reclaim policy được kiểm tra trước cleanup.
- [ ] `Delete` có backup/deletion guardrail; `Retain` có runbook orphan/recovery.
- [ ] Không dùng phase `Bound` như bằng chứng storage và dữ liệu đang khỏe.
- [ ] Không sửa trực tiếp `PV.spec.capacity` để resize; sửa request trên PVC.
- [ ] Không xóa finalizer hoặc force detach trước khi xác minh backend và writer cũ.
- [ ] Static PV không trỏ trùng writable asset với PV khác.
- [ ] Có monitoring cho PV `Released`, `Failed`, `Terminating` lâu và orphan volume.
- [ ] Backup/restore và node/zone failure đã được diễn tập theo mức quan trọng của dữ liệu.

## Tài liệu tham khảo

- [Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)
- [Change the Reclaim Policy of a PersistentVolume](https://kubernetes.io/docs/tasks/administer-cluster/change-pv-reclaim-policy/)
- [Local Volumes](https://kubernetes.io/docs/concepts/storage/volumes/#local)
- [Volumes](/storage/volumes/)
- [PersistentVolumeClaim](/storage/persistent-volume-claim/)
- [StorageClass](/storage/storage-class/)
- [Dynamic Provisioning](/storage/dynamic-provisioning/)
- [Access Modes và Volume Modes](/storage/access-modes-volume-modes/)
