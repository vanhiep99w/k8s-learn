---
title: "StatefulSet"
description: "Triển khai workload stateful với Pod identity, stable network, persistent storage, ordered rollout và các trade-off vận hành."
---

# StatefulSet

## Mục lục

- [Tổng quan](#tổng-quan)
- [1. Guarantees của StatefulSet](#1-guarantees-của-statefulset)
- [2. Identity và Headless Service](#2-identity-và-headless-service)
- [3. Persistent storage](#3-persistent-storage)
- [4. Manifest hoàn chỉnh](#4-manifest-hoàn-chỉnh)
- [5. Pod management policy](#5-pod-management-policy)
- [6. Update strategy](#6-update-strategy)
- [7. Scale và dữ liệu](#7-scale-và-dữ-liệu)
- [8. Failure, replacement và recovery](#8-failure-replacement-và-recovery)
- [9. StatefulSet hay Deployment?](#9-statefulset-hay-deployment)
- [10. Thực hành](#10-thực-hành)
- [11. Troubleshooting](#11-troubleshooting)
- [12. Best practices](#12-best-practices)
- [Tài liệu tham khảo](#tài-liệu-tham-khảo)

---

## Tổng quan

StatefulSet quản lý Pods cần identity ổn định, thứ tự có kiểm soát và storage gắn với từng replica. Pod được đánh số ordinal:

```text
web-0 → PVC data-web-0
web-1 → PVC data-web-1
web-2 → PVC data-web-2
```

Khi `web-1` bị thay thế, Pod mới vẫn mang tên `web-1` và gắn lại PVC tương ứng. Pod UID/IP/container vẫn có thể đổi.

> [!IMPORTANT]
> StatefulSet cung cấp building blocks, không tự biến database thành hệ thống HA. Replication, quorum, backup, restore, failover và consistency vẫn do ứng dụng/Operator thiết kế.

---

## 1. Guarantees của StatefulSet

StatefulSet cung cấp:

- Pod name ổn định theo ordinal.
- Stable DNS identity qua Headless Service.
- PVC riêng tạo từ `volumeClaimTemplates`.
- Ordered create/scale/update mặc định.
- Sticky identity khi Pod được thay thế.

StatefulSet không bảo đảm:

- Pod IP không đổi.
- Volume tự replicate đa zone.
- Database có backup.
- Application tự chọn leader đúng.
- PVC tự bị xóa khi StatefulSet bị xóa, trừ khi retention policy được cấu hình và hỗ trợ như mong muốn.

---

## 2. Identity và Headless Service

`serviceName` trỏ tới một Headless Service (`clusterIP: None`):

```yaml
apiVersion: v1
kind: Service
metadata:
  name: web-headless
  namespace: stateful-lab
spec:
  clusterIP: None
  selector:
    app: web
  ports:
    - name: http
      port: 80
```

DNS identity thường có dạng:

```text
web-0.web-headless.stateful-lab.svc.cluster.local
web-1.web-headless.stateful-lab.svc.cluster.local
```

Service không load-balance qua một ClusterIP trong trường hợp headless; DNS trả records cho Pods. Client/application cần hiểu topology hoặc dùng Service riêng cho endpoint chung.

DNS negative caching có thể làm tên Pod mới chưa resolve ngay sau create. Đừng xây election/failover dựa trên giả định DNS cập nhật tức thời.

---

## 3. Persistent storage

`volumeClaimTemplates` tạo một PVC cho mỗi ordinal:

```text
StatefulSet web replicas=3
├── data-web-0
├── data-web-1
└── data-web-2
```

PVC có lifecycle tách với Pod. Pod restart/replacement vẫn dùng PVC cũ. Việc PVC có sống sau scale-down/delete phụ thuộc retention policy và thao tác; mặc định bảo thủ nhằm tránh mất dữ liệu.

### 3.1 Access mode và topology

Nhiều volume `ReadWriteOnce` chỉ attach read-write vào một Node tại một thời điểm. Khi Pod chuyển Node/zone, cần detach/attach; storage topology có thể làm Pod Pending nếu volume không dùng được ở Node đích.

### 3.2 PVC template gần như không linh hoạt để sửa

Thay storage request/class trong `volumeClaimTemplates` của StatefulSet hiện có thường bị giới hạn. Resize PVC riêng nếu StorageClass/CSI hỗ trợ, theo runbook và backup. Đừng kỳ vọng sửa template tự migrate dữ liệu.

---

## 4. Manifest hoàn chỉnh

```yaml
apiVersion: v1
kind: Service
metadata:
  name: web-headless
  namespace: stateful-lab
spec:
  clusterIP: None
  selector:
    app: web
  ports:
    - name: http
      port: 80
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: web
  namespace: stateful-lab
spec:
  serviceName: web-headless
  replicas: 3
  podManagementPolicy: OrderedReady
  updateStrategy:
    type: RollingUpdate
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: nginx
          image: nginx:1.27-alpine
          ports:
            - name: http
              containerPort: 80
          volumeMounts:
            - name: data
              mountPath: /usr/share/nginx/html
          readinessProbe:
            httpGet:
              path: /
              port: http
            periodSeconds: 5
          resources:
            requests:
              cpu: 25m
              memory: 32Mi
            limits:
              memory: 64Mi
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 1Gi
```

Manifest cần default StorageClass. Kiểm tra:

```bash
kubectl get storageclass
```

---

## 5. Pod management policy

### 5.1 `OrderedReady`

Mặc định:

- Tạo `web-0`, chờ Ready rồi mới tạo `web-1`.
- Scale down theo thứ tự ordinal giảm dần.
- Hữu ích khi startup có dependency thứ tự.

Một Pod không Ready có thể chặn Pod sau, làm failure lan sang rollout/scale.

### 5.2 `Parallel`

```yaml
spec:
  podManagementPolicy: Parallel
```

Cho phép create/delete Pods song song khi scale, nhưng không thay đổi identity/storage. Dùng khi application không cần ordering và muốn scale nhanh hơn.

---

## 6. Update strategy

`RollingUpdate` cập nhật Pods theo ordinal giảm dần và chờ Ready trước khi tiếp tục. `partition` giữ các ordinal thấp hơn ở revision cũ:

```yaml
updateStrategy:
  type: RollingUpdate
  rollingUpdate:
    partition: 2
```

Với replicas 0,1,2, chỉ Pods ordinal từ 2 trở lên nhận template mới. Có thể dùng canary thủ công, nhưng promotion cần quy trình rõ và quan sát application-level health.

`OnDelete` chỉ cập nhật Pod khi operator xóa Pod. Cách này cho kiểm soát thủ công nhưng dễ để fleet lệch revision.

### 6.1 Rollout kẹt

Nếu Pod mới không Ready, ordered rollout dừng. Sau khi sửa template, trong một số tình huống/version bạn có thể cần xóa Pod lỗi để controller tạo lại theo revision đúng. Luôn kiểm tra `currentRevision`, `updateRevision` và controller behavior của cluster.

---

## 7. Scale và dữ liệu

Scale up:

```bash
kubectl scale statefulset/web --replicas=4 -n stateful-lab
```

Tạo `web-3` và PVC `data-web-3`.

Scale down về 2 thường xóa Pods ordinal cao `web-3`, `web-2` nhưng giữ PVC để bảo vệ dữ liệu. Scale up lại có thể tái dùng claims cũ theo identity.

Trước scale down database cluster:

- Rebalance/shard/replica membership.
- Xác nhận ordinal cần xóa không giữ leader/quorum độc nhất.
- Backup dữ liệu.
- Xác minh PVC retention.
- Theo dõi application health sau mỗi bước.

`kubectl scale` không hiểu protocol của database.

---

## 8. Failure, replacement và recovery

### 8.1 Pod failure

StatefulSet tạo lại cùng ordinal và gắn PVC cũ. Attach có thể chậm khi Node cũ mất và storage còn giữ attachment.

### 8.2 Node/zone failure

Volume topology quyết định Pod có thể chạy ở đâu. Zonal volume không tự chuyển dữ liệu sang zone khác. High availability cần replication ở application/storage layer và topology spread/anti-affinity phù hợp.

### 8.3 Force deletion

Force-delete Pod stateful khi Node partition có thể tạo hai instances cùng identity truy cập storage hoặc tham gia cluster, tùy fencing/storage behavior. Đây là nguy cơ split-brain. Chỉ force-delete sau khi xác minh instance cũ không còn chạy và có runbook fencing.

---

## 9. StatefulSet hay Deployment?

| Nhu cầu | Deployment | StatefulSet |
|---|---:|---:|
| Replicas thay thế lẫn nhau | Tốt | Có thể nhưng thừa |
| Stable Pod name | Không | Có |
| PVC riêng mỗi replica | Tự thiết kế | Native template |
| Ordered rollout/scale | Không theo ordinal | Có |
| Stateless API/web | Khuyến nghị | Không cần |
| Database/broker cluster | Không thường dùng | Thường dùng, hay qua Operator |

Nếu application state nằm hoàn toàn ở external managed database/object storage, Deployment thường đơn giản hơn.

---

## 10. Thực hành

```bash
kubectl create namespace stateful-lab
kubectl apply -f statefulset.yaml
kubectl rollout status statefulset/web -n stateful-lab --timeout=5m
kubectl get statefulset,pods,pvc -n stateful-lab -o wide
```

Ghi identity vào từng volume:

```bash
for pod in web-0 web-1 web-2; do
  kubectl exec -n stateful-lab "$pod" -- \
    sh -c "echo $pod > /usr/share/nginx/html/index.html"
done
```

Đọc:

```bash
for pod in web-0 web-1 web-2; do
  kubectl exec -n stateful-lab "$pod" -- cat /usr/share/nginx/html/index.html
done
```

Xóa `web-1` và kiểm tra dữ liệu:

```bash
kubectl delete pod web-1 -n stateful-lab
kubectl wait --for=condition=Ready pod/web-1 -n stateful-lab --timeout=180s
kubectl exec web-1 -n stateful-lab -- cat /usr/share/nginx/html/index.html
```

Cleanup có chủ đích:

```bash
kubectl delete statefulset web -n stateful-lab
kubectl get pvc -n stateful-lab
kubectl delete pvc --all -n stateful-lab
kubectl delete namespace stateful-lab
```

Xóa PVC làm mất dữ liệu của lab. Trong production phải qua backup/approval.

---

## 11. Troubleshooting

### 11.1 Pod Pending

```bash
kubectl describe pod web-0 -n stateful-lab
kubectl get pvc,pv -n stateful-lab
kubectl describe pvc data-web-0 -n stateful-lab
```

Tìm StorageClass, provisioning, topology, attach và capacity.

### 11.2 Rollout kẹt một ordinal

```bash
kubectl get statefulset web -n stateful-lab -o yaml
kubectl describe pod <pod> -n stateful-lab
kubectl logs <pod> -n stateful-lab
```

Đọc `currentRevision`, `updateRevision`, readiness và application cluster state.

### 11.3 DNS không resolve ngay

Kiểm tra Headless Service selector, Pod readiness, EndpointSlice và DNS negative cache. Dùng FQDN để loại bỏ search path ambiguity.

### 11.4 Multi-attach error

Xác minh Pod cũ/Node cũ đã dừng, VolumeAttachment và CSI events. Không force detach/delete khi chưa đánh giá split-brain.

---

## 12. Best practices

- Dùng Operator khi database/broker có lifecycle phức tạp.
- Thiết kế backup và **test restore** độc lập với StatefulSet.
- Dùng Pod anti-affinity/topology spread cho replicas cần HA.
- Hiểu StorageClass topology, reclaim policy và snapshot support.
- Đặt readiness phản ánh membership/serving đúng.
- Scale down theo protocol ứng dụng, không chỉ đổi replicas.
- Theo dõi PVC capacity, IO latency và attach errors.
- Không force-delete stateful Pod thiếu fencing.
- Dùng partition canary có runbook promotion/rollback.
- Inventory và xóa PVC bằng quy trình riêng.

Tiếp tục với [DaemonSet](/workloads/daemonset/) để chạy một Pod trên mỗi Node phù hợp.

---

## Tài liệu tham khảo

- [StatefulSets](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/)
- [Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)
- [Headless Services](https://kubernetes.io/docs/concepts/services-networking/service/#headless-services)
