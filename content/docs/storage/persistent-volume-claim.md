---
title: "PersistentVolumeClaim"
description: "Giải thích PersistentVolumeClaim từ mental model đến cách dùng: PVC yêu cầu storage như thế nào, bind với PV, được Pod mount, giữ dữ liệu qua Pod replacement, resize và troubleshooting."
---

# PersistentVolumeClaim

## Mục lục

- [Tổng quan](#tổng-quan)
- [1. Vì sao application dùng PVC thay vì chọn disk trực tiếp](#1-vì-sao-application-dùng-pvc-thay-vì-chọn-disk-trực-tiếp)
- [2. Mental model: PVC là phiếu yêu cầu storage](#2-mental-model-pvc-là-phiếu-yêu-cầu-storage)
- [3. Đọc một manifest PVC tối thiểu](#3-đọc-một-manifest-pvc-tối-thiểu)
- [4. PVC bind với PV như thế nào](#4-pvc-bind-với-pv-như-thế-nào)
- [5. Hiểu đúng storageClassName](#5-hiểu-đúng-storageclassname)
- [6. Pod sử dụng PVC như thế nào](#6-pod-sử-dụng-pvc-như-thế-nào)
- [7. PVC giữ dữ liệu qua lifecycle nào](#7-pvc-giữ-dữ-liệu-qua-lifecycle-nào)
- [8. Access modes và volume modes](#8-access-modes-và-volume-modes)
- [9. Resize PVC](#9-resize-pvc)
- [10. Clone, snapshot và data source](#10-clone-snapshot-và-data-source)
- [11. Quota, permission và security boundary](#11-quota-permission-và-security-boundary)
- [12. Thực hành chứng minh dữ liệu sống qua Pod replacement](#12-thực-hành-chứng-minh-dữ-liệu-sống-qua-pod-replacement)
- [13. Cleanup PVC an toàn](#13-cleanup-pvc-an-toàn)
- [14. Troubleshooting theo triệu chứng](#14-troubleshooting-theo-triệu-chứng)
- [15. Checklist sử dụng PVC](#15-checklist-sử-dụng-pvc)
- [Tài liệu tham khảo](#tài-liệu-tham-khảo)

---

## Tổng quan

Application cần lưu dữ liệu lâu dài thường biết nhu cầu của mình, ví dụ:

- Cần 20Gi.
- Cần filesystem để mount vào `/var/lib/app`.
- Chỉ cần một Node ghi tại một thời điểm.
- Muốn dùng loại storage `database-zonal`.

Application không nên phải biết cloud disk ID, NFS server, SAN LUN, credential của storage backend hoặc Node cụ thể. Nó gửi yêu cầu cho Kubernetes bằng một **PersistentVolumeClaim**.

> **Định nghĩa ngắn:** `PersistentVolumeClaim` (PVC) là API object trong một Namespace, mô tả yêu cầu persistent storage của workload.

Kubernetes đáp ứng yêu cầu bằng cách bind PVC với một **PersistentVolume** (PV) phù hợp. Nếu cluster hỗ trợ dynamic provisioning, provisioner có thể tạo cả volume thật và PV mới dành cho PVC.

```d2 title="Tổng quan"
direction: down
n1: "Application: \"cần 20Gi, ReadWriteOnce,\nclass database-zonal\""
n2: "PVC production/app-data"
n3: "PV pvc-<uid>"
n4: "cloud disk / NFS / storage thật"
n1 -> n2
n2 -> n3: "bind một-một"
n3 -> n4: "đại diện"
```

Pod sau đó tham chiếu PVC, không tham chiếu trực tiếp PV hay disk ID.

Nếu chỉ nhớ năm điều, hãy nhớ:

1. PVC là **yêu cầu storage**, không phải storage thật.
2. PVC thuộc Namespace; Pod chỉ dùng được PVC trong cùng Namespace.
3. PVC bind độc quyền với một PV.
4. Xóa Pod thường không xóa PVC, nên Pod mới có thể dùng lại dữ liệu.
5. Xóa PVC có thể dẫn đến xóa volume thật; phải kiểm tra reclaim policy của PV trước.

## 1. Vì sao application dùng PVC thay vì chọn disk trực tiếp

Nếu manifest Pod chứa trực tiếp thông tin backend, application sẽ phụ thuộc hạ tầng:

- Cluster A dùng một CSI driver và cloud disk.
- Cluster B dùng Ceph.
- Cluster C dùng NFS.
- Tên volume, zone, credential và API cấp phát đều khác nhau.

PVC tách **nhu cầu** khỏi **cách triển khai**:

| Application khai báo trong PVC | Platform/storage system quyết định |
|---|---|
| Dung lượng cần thiết | Tạo/chọn asset cụ thể nào |
| Access mode | Driver và backend thực thi attach/mount ra sao |
| `Filesystem` hay `Block` | Filesystem, volume handle và device mapping cụ thể |
| Tên StorageClass | Backend tier, parameters, topology và policy của class |

Điều này tương tự cách Pod yêu cầu CPU/memory mà không chọn chính xác CPU core trên Node. PVC yêu cầu storage; control plane tìm hoặc tạo PV đáp ứng yêu cầu.

PVC cũng là tên ổn định để controller sử dụng. Pod có thể bị xóa và tạo lại với tên/UID khác nhưng vẫn tham chiếu cùng PVC, nhờ đó tiếp tục dùng cùng dữ liệu.

## 2. Mental model: PVC là phiếu yêu cầu storage

Các object liên quan có vai trò khác nhau:

| Thành phần | Mental model | Vai trò thật |
|---|---|---|
| StorageClass | Mẫu/catalog item | Mô tả loại storage và policy provisioning |
| PVC | Phiếu yêu cầu | Nêu class, dung lượng, access mode và volume mode |
| PV | Phiếu cấp phát | Đại diện một volume cụ thể đã có hoặc vừa được tạo |
| Storage backend | Kho chứa thật | Lưu bytes dữ liệu |
| CSI driver | Bộ phận thực hiện | Tạo, attach, mount, resize hoặc xóa volume |
| Pod | Người sử dụng | Mount PVC vào container hoặc dùng raw block device |

Luồng phổ biến:

```d2 title="2. Mental model: PVC là phiếu yêu cầu storage"
direction: right
U: "Application tạo PVC"
C: "Chọn StorageClass và yêu cầu dung\nlượng"
R: "Có PV phù hợp?" {shape: diamond}
B: "Bind PV với PVC"
D: "Provisioner tạo volume và PV"
P: "Pod dùng PVC"
U -> C
C -> R
R -> B: "Có"
R -> D: "Không"
D -> B
B -> P
```

### PVC không phải là gì

PVC **không**:

- Chứa dữ liệu application trong etcd.
- Là một PV khác tên.
- Là StorageClass.
- Tự bảo đảm backup hoặc replication.
- Tự làm một backend chỉ hỗ trợ block storage trở thành shared filesystem.
- Tự ngăn database corruption khi nhiều process cùng ghi.

PVC chỉ là claim và stable reference của workload. Capability thật đến từ PV, CSI driver và storage backend.

## 3. Đọc một manifest PVC tối thiểu

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: app-data
  namespace: production
spec:
  storageClassName: general
  accessModes:
    - ReadWriteOnce
  volumeMode: Filesystem
  resources:
    requests:
      storage: 20Gi
```

Đọc manifest theo thứ tự:

1. Tạo PVC tên `app-data` trong Namespace `production`.
2. Yêu cầu loại storage có tên `general`.
3. Yêu cầu access mode `ReadWriteOnce`.
4. Muốn dùng volume như một filesystem, không phải raw block device.
5. Yêu cầu ít nhất 20Gi.

### Các field quan trọng

| Field | Ý nghĩa | Điểm cần nhớ |
|---|---|---|
| `metadata.name` | Tên Pod dùng trong `claimName` | Chỉ có ý nghĩa trong Namespace |
| `storageClassName` | Storage profile được yêu cầu | Có ba behavior: tên cụ thể, bỏ field hoặc chuỗi rỗng |
| `accessModes` | Cách workload cần volume được mount | Phải được PV/backend hỗ trợ |
| `volumeMode` | `Filesystem` hoặc raw `Block` | Mặc định `Filesystem` |
| `resources.requests.storage` | Dung lượng tối thiểu yêu cầu | PV tĩnh lớn hơn vẫn có thể bind |
| `selector` | Lọc PV tĩnh theo label | PVC có selector không được dynamic provision theo behavior hiện tại |
| `volumeName` | Chỉ định/pre-bind một PV cụ thể | Dùng cho import/recovery có kiểm soát |
| `dataSource` | Tạo volume từ PVC hoặc VolumeSnapshot | Phụ thuộc CSI driver/capability |

Với `Filesystem`, 20Gi là kích thước volume được backend cấp. Dung lượng ghi được bên trong có thể nhỏ hơn một chút do filesystem metadata.

PVC không có field chuẩn phổ quát để yêu cầu IOPS hay throughput trong manifest cơ bản. Platform thường biểu diễn tier hiệu năng qua StorageClass, ví dụ `general` và `database-high-iops`.

## 4. PVC bind với PV như thế nào

Khi PVC được tạo, control plane cố đáp ứng claim theo một trong hai cách:

1. Tìm một PV tĩnh phù hợp.
2. Nếu không có và StorageClass hỗ trợ, yêu cầu provisioner tạo volume/PV mới.

```d2 title="4. PVC bind với PV như thế nào"
direction: down
C: "PVC mới"
M: "Có PV tĩnh phù hợp?" {shape: diamond}
B: "PV và PVC Bound"
D: "Class và dynamic provisioner khả\ndụng?" {shape: diamond}
V: "Tạo backend volume và PV"
P: "PVC Pending và có Event"
C -> M
M -> B: "Có"
M -> D: "Không"
D -> V: "Có"
V -> B
D -> P: "Không"
```

Binder so sánh các điều kiện chính:

- `storageClassName`.
- Capacity: PV phải bằng hoặc lớn hơn request.
- `accessModes`.
- `volumeMode`.
- Selector nếu PVC khai báo.
- Reservation/pre-binding nếu có `volumeName` hoặc PV có `claimRef`.

Binding là một-một và độc quyền:

```text
PVC production/app-data  ↔  PV pvc-abc123
```

Một PV không được chia thành nhiều phần cho nhiều PVC. Nếu PVC 8Gi bind với PV tĩnh 10Gi, toàn bộ PV thuộc PVC đó; 2Gi dư không được cấp cho claim khác.

### Quan sát binding

```bash
kubectl get pvc app-data -n production
kubectl describe pvc app-data -n production
kubectl get pvc app-data -n production \
  -o jsonpath='{.status.phase}{" "}{.spec.volumeName}{" "}{.status.capacity.storage}{"\n"}'
```

Expected state sau khi bind:

- PVC `.status.phase` là `Bound`.
- PVC `.spec.volumeName` có tên PV.
- PV `.spec.claimRef` trỏ ngược về Namespace/tên PVC.

PVC `Pending` không luôn là lỗi. Với StorageClass dùng `WaitForFirstConsumer`, claim có thể chờ đến khi một Pod tham chiếu nó để scheduler chọn Node/zone phù hợp.

## 5. Hiểu đúng storageClassName

Ba cách khai báo tạo ra ba behavior khác nhau:

| Khai báo | Ý nghĩa |
|---|---|
| `storageClassName: database` | Chọn chính xác StorageClass `database` |
| Không có field `storageClassName` | Dùng default StorageClass nếu cluster có |
| `storageClassName: ""` | Chủ động yêu cầu PV không có class; không dùng default dynamic provisioning |

### Chọn class cụ thể

```yaml
spec:
  storageClassName: database
```

Tên phải exact match và phân biệt chữ hoa/chữ thường. Nếu class không tồn tại hoặc provisioner không hoạt động, PVC thường tiếp tục `Pending`.

### Dùng default class

```yaml
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 20Gi
```

Bỏ field giúp manifest portable hơn nếu các cluster đều cung cấp default class phù hợp. Helm chart nên cho phép người triển khai override class khi cần.

Kiểm tra default:

```bash
kubectl get storageclass
kubectl get storageclass \
  -o custom-columns=NAME:.metadata.name,DEFAULT:.metadata.annotations.storageclass\.kubernetes\.io/is-default-class,PROVISIONER:.provisioner
```

Nếu PVC được tạo khi chưa có default và `storageClassName` chưa được đặt, control plane có thể gán default về sau khi default class xuất hiện.

### Chủ động không dùng class

```yaml
spec:
  storageClassName: ""
```

Dùng trường hợp này khi muốn bind với PV tĩnh cũng không có class. PVC khai báo chuỗi rỗng sẽ không được gán default class về sau.

> [!IMPORTANT]
> “Không có field” và `storageClassName: ""` không giống nhau. Trường hợp đầu cho phép defaulting; trường hợp sau chủ động từ chối default class.

Tìm hiểu sâu hơn về class, provisioner, reclaim và binding mode tại [StorageClass](/storage/storage-class/).

## 6. Pod sử dụng PVC như thế nào

Pod tham chiếu PVC trong `spec.volumes`, sau đó container chọn nơi mount qua `volumeMounts`:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app
  namespace: production
spec:
  securityContext:
    fsGroup: 2000
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "echo started >> /data/history; sleep 3600"]
      volumeMounts:
        - name: data
          mountPath: /data
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: app-data
```

Có ba tên/path riêng biệt:

| Giá trị | Vai trò |
|---|---|
| `app-data` | Tên PVC đã tồn tại trong Namespace `production` |
| `data` | Tên Volume nội bộ trong Pod, nối `volumes` với `volumeMounts` |
| `/data` | Đường dẫn container nhìn thấy filesystem |

Pod và PVC phải ở cùng Namespace. Pod ở `team-a` không thể tham chiếu trực tiếp PVC ở `team-b`.

Khi Pod start:

1. Kubernetes tìm PVC `app-data` trong Namespace của Pod.
2. PVC cho biết PV đang bind.
3. Scheduler đặt Pod vào Node phù hợp topology của volume.
4. CSI driver attach volume nếu cần.
5. Kubelet/CSI node plugin stage và mount volume.
6. Container nhìn thấy filesystem tại `/data`.

PVC `Bound` chỉ chứng minh API binding. Pod vẫn có thể kẹt `ContainerCreating` nếu attach, mount, filesystem hoặc permission lỗi.

### Raw block volume

Nếu PVC dùng `volumeMode: Block`, Pod không dùng `volumeMounts`. Nó nhận block device qua `volumeDevices`:

```yaml
containers:
  - name: app
    image: busybox:1.36
    command: ["sh", "-c", "sleep 3600"]
    volumeDevices:
      - name: data
        devicePath: /dev/xvda
volumes:
  - name: data
    persistentVolumeClaim:
      claimName: app-block
```

Application phải biết cách làm việc an toàn với raw block device. Không tự format device chứa dữ liệu đã tồn tại.

## 7. PVC giữ dữ liệu qua lifecycle nào

PVC tách lifecycle dữ liệu khỏi một Pod cụ thể:

| Thao tác | PVC | PV/backend volume | Dữ liệu |
|---|---|---|---|
| Container restart trong cùng Pod | Còn | Còn | Thường còn |
| Xóa Pod | Còn | Còn | Còn |
| Controller tạo Pod thay thế dùng cùng PVC | Còn | Còn | Pod mới thấy lại dữ liệu |
| Scale workload về 0 | Còn | Còn | Còn |
| Xóa PVC | Bị xóa sau protection | Phụ thuộc reclaim policy | Có thể bị xóa |
| Xóa Namespace | PVC trong Namespace bị xóa | Phụ thuộc reclaim policy | Có thể bị xóa |

Điều này giải thích từ “persistent”: dữ liệu có thể sống qua **Pod replacement**, miễn là PVC/PV/backend volume vẫn tồn tại và Pod mới dùng lại claim đó.

> [!IMPORTANT]
> Persistent không đồng nghĩa với backup hoặc high availability. Một zonal disk có thể giữ dữ liệu qua Pod replacement nhưng vẫn unavailable khi cả zone lỗi. Backup và restore phải được thiết kế riêng.

### PVC và controller workload

- Deployment có thể dùng một PVC được khai báo riêng, nhưng phải bảo đảm access mode và concurrency phù hợp khi scale nhiều replica.
- StatefulSet thường tạo một PVC riêng cho mỗi replica qua `volumeClaimTemplates`.
- Xóa StatefulSet không nên được suy luận là luôn xóa PVC; retention behavior phụ thuộc cấu hình và thao tác cụ thể.

Xem [Storage cho Stateful Workloads](/storage/stateful-storage/) trước khi gắn database nhiều replica với PVC.

## 8. Access modes và volume modes

### Access modes

PVC yêu cầu cách volume cần được mount:

| Mode | Ý nghĩa ngắn |
|---|---|
| `ReadWriteOnce` (RWO) | Read-write từ một Node; nhiều Pod trên cùng Node vẫn có thể dùng trong một số trường hợp |
| `ReadOnlyMany` (ROX) | Read-only từ nhiều Node |
| `ReadWriteMany` (RWX) | Read-write từ nhiều Node |
| `ReadWriteOncePod` (RWOP) | Read-write bởi một Pod trên toàn cluster khi CSI/cluster hỗ trợ |

Các hiểu lầm cần tránh:

- RWO không có nghĩa tuyệt đối là chỉ một Pod; nó nói về một Node.
- RWX không làm application tự an toàn với concurrent write.
- Khai báo RWX không thể ép block storage chỉ hỗ trợ RWO trở thành shared filesystem.
- Access mode tham gia binding/scheduling nhưng không thay thế permission, file lock hoặc protocol của database.

### Volume modes

| Mode | Pod sử dụng | Khi phù hợp |
|---|---|---|
| `Filesystem` | `volumeMounts` + `mountPath` | Hầu hết application cần thư mục/file |
| `Block` | `volumeDevices` + `devicePath` | Application hiểu raw block device |

PV và PVC phải có volume mode tương thích. Nếu PVC yêu cầu `Block` nhưng PV tĩnh là `Filesystem`, chúng không bind.

Xem giải thích đầy đủ tại [Access Modes và Volume Modes](/storage/access-modes-volume-modes/).

## 9. Resize PVC

Để tăng dung lượng PVC, cần đồng thời:

1. StorageClass có `allowVolumeExpansion: true`.
2. CSI driver/backend hỗ trợ expansion.
3. Request mới lớn hơn dung lượng hiện tại.
4. Filesystem/node expansion được hỗ trợ nếu dùng `Filesystem`.

Kiểm tra class:

```bash
SC=$(kubectl get pvc app-data -n production -o jsonpath='{.spec.storageClassName}')
kubectl get storageclass "$SC" \
  -o custom-columns=NAME:.metadata.name,PROVISIONER:.provisioner,EXPAND:.allowVolumeExpansion
```

Tăng từ 20Gi lên 40Gi bằng cách sửa **PVC**, không sửa PV:

```bash
kubectl patch pvc app-data -n production \
  -p '{"spec":{"resources":{"requests":{"storage":"40Gi"}}}}'
```

Theo dõi desired và actual capacity:

```bash
kubectl get pvc app-data -n production -w
kubectl describe pvc app-data -n production
kubectl get pvc app-data -n production \
  -o jsonpath='{.spec.resources.requests.storage}{" requested; "}{.status.capacity.storage}{" actual\n"}'
```

Resize có thể gồm hai giai đoạn:

1. Controller/backend mở rộng volume.
2. Node/kubelet mở rộng filesystem khi volume được mount read-write, tùy driver/filesystem.

> [!WARNING]
> Không sửa trực tiếp `PV.spec.capacity`. Control plane có thể tưởng resize đã hoàn tất trong khi backing volume chưa được mở rộng.

Kubernetes không hỗ trợ shrink volume xuống dưới dung lượng hiện tại. Nếu expansion request quá lớn, controller có thể retry liên tục. Thu thập Events, kiểm tra quota và làm theo recovery procedure của platform; không xóa PVC khi chưa bảo vệ dữ liệu.

Trước resize production:

- Xác nhận backup/restore point.
- Kiểm tra quota và kích thước tối đa của backend.
- Kiểm tra driver/filesystem hỗ trợ online expansion hay cần Pod restart.
- Theo dõi application latency, PVC conditions và filesystem capacity sau resize.

## 10. Clone, snapshot và data source

Một CSI driver có thể tạo PVC mới từ PVC hiện có:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: app-data-clone
  namespace: production
spec:
  storageClassName: general
  dataSource:
    apiGroup: ""
    kind: PersistentVolumeClaim
    name: app-data
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 20Gi
```

Hoặc tạo PVC từ `VolumeSnapshot`:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: app-data-restored
  namespace: production
spec:
  storageClassName: general
  dataSource:
    apiGroup: snapshot.storage.k8s.io
    kind: VolumeSnapshot
    name: app-data-snapshot
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 20Gi
```

Các constraint phụ thuộc CSI driver:

- Source/target Namespace.
- StorageClass.
- Size target.
- Volume mode.
- Clone/snapshot capability.
- Cross-namespace data source support nếu có.

Snapshot hoặc clone ở storage layer chỉ là point-in-time operation. Nếu database đang ghi, snapshot có thể crash-consistent nhưng chưa chắc application-consistent. Cần quiesce, flush hoặc dùng database-native coordination theo yêu cầu consistency.

Xem [Volume Snapshots](/storage/volume-snapshots/) và [Storage Backup và Restore](/storage/storage-backup-restore/).

## 11. Quota, permission và security boundary

### ResourceQuota

PVC có thể tiêu thụ storage và chi phí lớn. Namespace nên có quota phù hợp:

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: tenant-storage
  namespace: tenant-a
spec:
  hard:
    persistentvolumeclaims: "10"
    requests.storage: 100Gi
```

Quota này giới hạn số PVC và tổng requested storage trong Namespace. Platform có thể cần quota chi tiết hơn theo StorageClass tùy policy và version.

### Permission bên trong volume

PVC `Bound` và volume mount thành công không bảo đảm process có quyền ghi. Kiểm tra:

- UID/GID của process.
- Owner/mode của filesystem.
- `runAsUser`, `runAsGroup`, `fsGroup`.
- Mount `readOnly`.
- NFS export option hoặc backend ACL.
- SELinux/AppArmor và CSI driver behavior.

Ví dụ:

```yaml
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 10001
    runAsGroup: 10001
    fsGroup: 20001
    fsGroupChangePolicy: OnRootMismatch
```

`fsGroup` behavior phụ thuộc volume type và CSI capability. Recursive ownership change trên volume nhiều file có thể làm Pod start chậm.

### Security boundary

PVC là namespaced nhưng PV và backend asset là cluster-scoped/external. Isolation còn phụ thuộc:

- RBAC và admission policy.
- Driver credential.
- Storage export/ACL.
- Node access.
- Encryption/KMS.
- Snapshot/clone permission.
- Sanitization trước khi tái sử dụng asset `Retain`.

Không coi Namespace boundary là đủ nếu storage backend bị cấu hình export hoặc credential sai.

## 12. Thực hành chứng minh dữ liệu sống qua Pod replacement

Bài thực hành tạo PVC và Pod, ghi một dòng, xóa Pod rồi tạo Pod mới dùng lại cùng PVC.

Prerequisite: cluster có default StorageClass hỗ trợ dynamic provisioning. Nếu không, thêm `storageClassName` phù hợp vào PVC.

Tạo file `pvc-persistence-demo.yaml`:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: storage-lab
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: persistence-demo
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
  name: persistence-writer
  namespace: storage-lab
spec:
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c"]
      args:
        - echo "$HOSTNAME $(date -Iseconds)" >> /data/history; sleep 3600
      volumeMounts:
        - name: data
          mountPath: /data
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: persistence-demo
```

### Bước 1: Tạo PVC và Pod đầu tiên

```bash
kubectl apply -f pvc-persistence-demo.yaml
kubectl get pod,pvc -n storage-lab -w
```

Khi Pod `Ready`, đọc file:

```bash
kubectl exec persistence-writer -n storage-lab -- cat /data/history
```

Output minh họa:

```text
persistence-writer 2026-07-25T02:30:00+00:00
```

### Bước 2: Xóa riêng Pod

```bash
kubectl delete pod persistence-writer -n storage-lab
kubectl get pvc persistence-demo -n storage-lab
```

PVC vẫn `Bound`. Dữ liệu chưa bị xóa vì claim và PV còn tồn tại.

### Bước 3: Tạo lại Pod dùng cùng PVC

Apply lại file. Namespace/PVC đã tồn tại nên chỉ Pod được tạo lại:

```bash
kubectl apply -f pvc-persistence-demo.yaml
kubectl wait --for=condition=Ready pod/persistence-writer \
  -n storage-lab --timeout=120s
kubectl exec persistence-writer -n storage-lab -- cat /data/history
```

File bây giờ có hai dòng với hai timestamp khác nhau. Điều này chứng minh:

- Pod mới mount lại cùng PVC.
- PVC vẫn bind với cùng PV.
- Dữ liệu sống qua Pod replacement.

Nó **không** chứng minh backup, multi-zone durability, RWX hoặc khả năng phục hồi khi backend hỏng.

### Bước 4: Trace PVC tới PV

```bash
PV=$(kubectl get pvc persistence-demo -n storage-lab -o jsonpath='{.spec.volumeName}')
SC=$(kubectl get pvc persistence-demo -n storage-lab -o jsonpath='{.spec.storageClassName}')

printf 'StorageClass=%s\nPersistentVolume=%s\n' "$SC" "$PV"
kubectl get pv "$PV" \
  -o custom-columns=NAME:.metadata.name,PHASE:.status.phase,CLASS:.spec.storageClassName,RECLAIM:.spec.persistentVolumeReclaimPolicy,HANDLE:.spec.csi.volumeHandle
```

## 13. Cleanup PVC an toàn

Xóa PVC là thao tác có thể phá hủy dữ liệu. Luôn map reclaim policy trước:

```bash
PV=$(kubectl get pvc persistence-demo -n storage-lab -o jsonpath='{.spec.volumeName}')
kubectl get pv "$PV" \
  -o custom-columns=NAME:.metadata.name,PHASE:.status.phase,RECLAIM:.spec.persistentVolumeReclaimPolicy,HANDLE:.spec.csi.volumeHandle
```

Checklist trước khi xóa:

1. Xác nhận đúng cluster context và Namespace.
2. Dừng mọi writer.
3. Xác nhận dữ liệu không còn cần hoặc backup/restore point hợp lệ.
4. Đọc policy trên PV cụ thể, không chỉ trên StorageClass.
5. Biết ai xử lý asset nếu policy là `Retain`.

Cleanup bài lab:

```bash
kubectl delete pod persistence-writer -n storage-lab
kubectl delete pvc persistence-demo -n storage-lab
kubectl delete namespace storage-lab
```

- Với `Delete`, PV và backing asset có thể bị xóa.
- Với `Retain`, PV chuyển `Released` và asset còn lại để operator xử lý.

Nếu PVC đang được Pod object tham chiếu, PVC có thể ở `Terminating` với finalizer `kubernetes.io/pvc-protection` cho đến khi không còn được dùng. Không xóa finalizer chỉ để cleanup nhanh.

## 14. Troubleshooting theo triệu chứng

Thu thập theo thứ tự:

```bash
kubectl get pvc PVC -n NS -o wide
kubectl describe pvc PVC -n NS
kubectl get storageclass
kubectl describe pod POD -n NS
kubectl get events -n NS --sort-by=.lastTimestamp
```

### PVC Pending

| Event/signal | Giả thuyết chính |
|---|---|
| `storageclass ... not found` | Sai tên class |
| `no persistent volumes available` | Không có PV tĩnh phù hợp và không dynamic provision |
| `waiting for first consumer` | Behavior đúng của `WaitForFirstConsumer`; cần Pod qua scheduler |
| Provisioning timeout/failure | CSI controller, credential, parameter, quota hoặc backend lỗi |
| Quota exceeded | Namespace vượt quota PVC/storage |
| Volume node affinity conflict | PV topology không khớp Node Pod có thể chạy |

So sánh PVC với class:

```bash
SC=$(kubectl get pvc PVC -n NS -o jsonpath='{.spec.storageClassName}')
kubectl get storageclass "$SC" -o yaml
```

Nếu `SC` rỗng, kiểm tra PVC cố ý dùng `storageClassName: ""` hay cluster chưa gán default.

### Waiting for first consumer kéo dài

```bash
kubectl describe pvc PVC -n NS
kubectl describe pod POD -n NS
```

Xác nhận Pod thật sự tham chiếu PVC. Sau đó kiểm tra CPU/memory, node selector, affinity, taint/toleration, zone capacity và `spec.nodeName`. Không tạo Pod giả ở topology khác chỉ để ép PVC bind.

### PVC Bound nhưng Pod không start

Chuyển sang attach/mount layer:

```bash
PV=$(kubectl get pvc PVC -n NS -o jsonpath='{.spec.volumeName}')
kubectl describe pod POD -n NS
kubectl get volumeattachment
kubectl get pv "$PV" -o yaml
kubectl get pods -A -o wide | grep -i csi
```

Các nguyên nhân phổ biến:

- Disk ở zone khác.
- Stale attachment trên Node cũ.
- Node chạm attach limit.
- CSI node plugin không chạy.
- Filesystem hoặc mount option lỗi.
- Permission/ACL không cho process ghi.

### Multi-Attach error

RWO volume có thể còn attach ở Node cũ trong khi Pod mới chạy trên Node khác. Xác nhận:

- Pod cũ đã thật sự dừng chưa.
- Node cũ còn khỏe hay mất kết nối.
- `VolumeAttachment` nào còn tồn tại.
- Driver có detach timeout/runbook nào.

Không force detach nếu writer cũ có thể còn chạy; hai writer có thể corrupt data.

### Permission denied hoặc read-only filesystem

```bash
kubectl exec POD -n NS -c CONTAINER -- id
kubectl exec POD -n NS -c CONTAINER -- stat -c '%u:%g %a %n' /MOUNT/PATH
kubectl get pod POD -n NS -o jsonpath='{.spec.securityContext}{"\n"}'
```

Kiểm tra `readOnly`, UID/GID, `fsGroup`, backend ACL/export option và security policy. Không sửa bằng `privileged: true` trước khi biết permission nào sai.

### PVC resize không hoàn tất

```bash
kubectl describe pvc PVC -n NS
kubectl get pvc PVC -n NS \
  -o jsonpath='{.spec.resources.requests.storage}{" requested; "}{.status.capacity.storage}{" actual\n"}{.status.conditions}{"\n"}'
```

Kiểm tra `allowVolumeExpansion`, CSI capability, quota, backend max size và filesystem expansion. Không chỉnh `PV.spec.capacity` để làm status trông đúng.

### PVC kẹt Terminating

```bash
kubectl get pvc PVC -n NS -o jsonpath='{.metadata.finalizers}{"\n"}'
kubectl get pod -n NS -o yaml | grep -n "claimName: PVC" -B 5 -A 5
```

Tìm Pod object còn tham chiếu claim, kể cả Pod đang `Pending` hoặc `Terminating`. Thu thập evidence trước khi xóa workload/finalizer.

### Xóa PVC nhưng volume vẫn còn

Lấy PV name từ log/inventory nếu PVC đã mất. Với PV `Released` và policy `Retain`, đây là behavior dự kiến. Với policy `Delete`, kiểm tra CSI provisioner log, finalizer, credential và backend API.

## 15. Checklist sử dụng PVC

- [ ] PVC nằm cùng Namespace với Pod sẽ dùng nó.
- [ ] `storageClassName` dùng đúng một trong ba behavior: class cụ thể, default hoặc `""`.
- [ ] Capacity, access mode và volume mode phù hợp application/backend.
- [ ] Helm chart cho phép override class và size giữa các cluster.
- [ ] Workload nhiều replica không vi phạm access/concurrency model.
- [ ] Permission, UID/GID và `fsGroup` đã được kiểm tra trên volume thật.
- [ ] Quota, cost owner và capacity alert đã được thiết lập.
- [ ] Resize chỉ thực hiện sau khi kiểm tra driver, quota và backup.
- [ ] Snapshot/clone được phối hợp với application consistency requirement.
- [ ] Reclaim policy của PV được kiểm tra trước uninstall, xóa PVC hoặc Namespace.
- [ ] Dữ liệu quan trọng có backup và restore test; PVC `Bound` không phải backup status.
- [ ] Có runbook cho PVC `Pending`, multi-attach, mount failure và `Terminating` lâu.

## Tài liệu tham khảo

- [Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)
- [Configure a Pod to Use a PersistentVolume for Storage](https://kubernetes.io/docs/tutorials/configuration/configure-persistent-volume-storage/)
- [Expanding PersistentVolumeClaims](https://kubernetes.io/docs/concepts/storage/persistent-volumes/#expanding-persistent-volumes-claims)
- [PersistentVolume](/storage/persistent-volume/)
- [StorageClass](/storage/storage-class/)
- [Dynamic Provisioning](/storage/dynamic-provisioning/)
- [Access Modes và Volume Modes](/storage/access-modes-volume-modes/)
- [Storage cho Stateful Workloads](/storage/stateful-storage/)
