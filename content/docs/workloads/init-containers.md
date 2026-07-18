---
title: "Init Containers"
description: "Dùng Init Containers để chuẩn bị dữ liệu, chờ dependency và kiểm tra điều kiện trước khi application containers khởi động."
---

# Init Containers

## Mục lục

- [Tổng quan](#tổng-quan)
- [1. Cách Init Containers hoạt động](#1-cách-init-containers-hoạt-động)
- [2. Khi nào nên dùng](#2-khi-nào-nên-dùng)
- [3. Manifest hoàn chỉnh](#3-manifest-hoàn-chỉnh)
- [4. Resource accounting](#4-resource-accounting)
- [5. Init Container, application startup và Job](#5-init-container-application-startup-và-job)
- [6. Native sidecar trong initContainers](#6-native-sidecar-trong-initcontainers)
- [7. Failure và retry](#7-failure-và-retry)
- [8. Thực hành](#8-thực-hành)
- [9. Troubleshooting](#9-troubleshooting)
- [10. Best practices](#10-best-practices)
- [Tài liệu tham khảo](#tài-liệu-tham-khảo)

---

## Tổng quan

Init Containers là các container chạy **trước** application containers. Chúng phù hợp với công việc chuẩn bị cục bộ cho một Pod: tạo file cấu hình, đổi permission, tải artifact hoặc kiểm tra dependency tối thiểu.

```text
init-1 ──success──▶ init-2 ──success──▶ app containers start
   │                    │
 failure              failure
   └──── retry            └──── retry
```

Mỗi init container thông thường phải hoàn thành thành công theo thứ tự khai báo. Nếu init container chưa hoàn tất, application containers chưa chạy.

> [!IMPORTANT]
> Init Container thuộc vòng đời **mỗi Pod**. Deployment có 100 Pods thì bước init có thể chạy 100 lần. Không dùng nó cho database migration toàn cục nếu migration không an toàn khi chạy đồng thời.

---

## 1. Cách Init Containers hoạt động

Init Containers được khai báo trong `spec.initContainers`. Chúng:

- Chạy tuần tự theo thứ tự trong manifest.
- Phải exit code `0` trước khi chuyển sang init container kế tiếp.
- Chia sẻ network và volumes với các container khác trong Pod.
- Có image, command và security context riêng.
- Có thể dùng tool không cần đóng gói vào application image.
- Được restart theo Pod restart semantics nếu thất bại.

Application container không chạy song song với init container thông thường.

### 1.1 Dữ liệu tồn tại qua bước init

Filesystem riêng của init container biến mất khi container kết thúc, nhưng dữ liệu ghi vào shared volume vẫn còn:

```text
init container writes /work/config.json
             │
             ▼
         emptyDir volume
             │
             ▼
app reads /app/config/config.json
```

---

## 2. Khi nào nên dùng

Use cases phù hợp:

| Use case | Ví dụ |
|---|---|
| Chuẩn bị file | Render template vào shared volume |
| Permission | `chown` volume trước khi app chạy |
| Tải artifact | Download model hoặc static assets |
| Kiểm tra dependency | Chờ DNS/service xuất hiện với timeout hữu hạn |
| Tách tool khỏi app image | Dùng image có `git`, `curl`, `envsubst` |

Không phù hợp:

- Migration toàn cluster chạy một lần: dùng Job hoặc delivery pipeline.
- Process cần chạy suốt cùng app: dùng sidecar.
- Logic business startup cốt lõi: app vẫn nên tự retry dependency.
- Chứa Secret trong image hoặc in Secret ra log.

---

## 3. Manifest hoàn chỉnh

Ví dụ init container tạo trang HTML trong `emptyDir`, NGINX phục vụ file đó:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: init-demo
  namespace: workloads-lab
spec:
  initContainers:
    - name: prepare-content
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          set -eu
          cat > /work/index.html <<'HTML'
          <h1>Content created by init container</h1>
          HTML
      volumeMounts:
        - name: content
          mountPath: /work
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
        limits:
          memory: 32Mi
  containers:
    - name: web
      image: nginx:1.27-alpine
      ports:
        - name: http
          containerPort: 80
      volumeMounts:
        - name: content
          mountPath: /usr/share/nginx/html
          readOnly: true
      resources:
        requests:
          cpu: 25m
          memory: 32Mi
        limits:
          memory: 64Mi
  volumes:
    - name: content
      emptyDir: {}
```

Điểm quan trọng:

- Init mount volume read-write để tạo dữ liệu.
- App mount cùng volume read-only.
- `set -eu` làm script dừng khi command lỗi hoặc biến chưa định nghĩa.
- Init và app dùng image khác nhau theo đúng trách nhiệm.

---

## 4. Resource accounting

Scheduler phải bảo đảm Node đủ tài nguyên cho cả giai đoạn init và app. Vì init containers thông thường chạy tuần tự, nhu cầu hiệu dụng gần với:

```text
max(
  tổng requests của application containers,
  request lớn nhất của một init container
)
```

Cộng thêm Pod overhead nếu runtime cấu hình. Điều này cho phép init container dùng CPU/memory lớn tạm thời mà không cộng tất cả init requests lại với nhau, nhưng một init request quá lớn vẫn khiến Pod `Pending`.

Ví dụ app containers tổng request 500m CPU, init lớn nhất request 2 CPU thì Pod cần Node có khả năng đáp ứng khoảng 2 CPU ở scheduling time.

---

## 5. Init Container, application startup và Job

| Cơ chế | Scope | Retry/lifecycle | Dùng khi |
|---|---|---|---|
| Init Container | Mỗi Pod | Gắn với Pod | Chuẩn bị cục bộ trước app |
| App startup logic | Mỗi process | App tự quản lý | Dependency có thể biến động, cần retry runtime |
| Job | Một task độc lập | Controller quản lý completion | Migration, batch, bootstrap dùng chung |

### 5.1 Vấn đề “wait-for-database”

Một loop chờ vô hạn có thể giữ Pod ở `Init` mãi:

```sh
until nc -z database 5432; do sleep 2; done
```

Tốt hơn là có deadline và log rõ:

```sh
for attempt in $(seq 1 30); do
  if nc -z database 5432; then exit 0; fi
  echo "database unavailable: attempt=$attempt" >&2
  sleep 2
done
exit 1
```

Dù init check thành công, database vẫn có thể lỗi sau khi app start. Ứng dụng vẫn cần connection timeout, retry/backoff và circuit breaking phù hợp.

---

## 6. Native sidecar trong initContainers

Kubernetes hỗ trợ sidecar container theo semantics riêng bằng `restartPolicy: Always` trên entry trong `initContainers` ở các phiên bản hỗ trợ tính năng này:

```yaml
spec:
  initContainers:
    - name: log-shipper
      image: example/log-shipper:1.0
      restartPolicy: Always
  containers:
    - name: app
      image: example/app:1.0
```

Khác với init container thông thường, sidecar tiếp tục chạy cùng application containers. Ordering và termination semantics được Kubernetes quản lý rõ hơn, đặc biệt hữu ích với Job.

Trước khi dùng, kiểm tra version/API support của cluster:

```bash
kubectl explain pod.spec.initContainers.restartPolicy
```

Nếu field không được hỗ trợ, API validation sẽ từ chối manifest. Không giả định mọi managed cluster đều bật cùng feature/version.

---

## 7. Failure và retry

Nếu init container thất bại:

- Với Pod `restartPolicy: Always` hoặc `OnFailure`, kubelet retry container với backoff.
- Với `restartPolicy: Never`, Pod có thể đi đến `Failed`.
- Application containers vẫn chưa start.
- Status thường hiển thị `Init:<reason>` hoặc `Init:<completed>/<total>`.

Init step phải idempotent vì nó có thể chạy lại khi container restart hoặc khi Pod bị thay thế.

Ví dụ không idempotent:

```sh
create-user --name app
```

Tốt hơn:

```sh
user-exists app || create-user --name app
```

Với external side effect, dùng idempotency key gắn với intent nghiệp vụ; không chỉ dựa vào Pod name vì Pod replacement tạo identity mới.

---

## 8. Thực hành

```bash
kubectl create namespace workloads-lab
kubectl apply -f init-demo.yaml
kubectl get pod init-demo -n workloads-lab --watch
```

Sau khi Pod Running:

```bash
kubectl logs init-demo -n workloads-lab -c prepare-content
kubectl exec init-demo -n workloads-lab -c web -- cat /usr/share/nginx/html/index.html
kubectl port-forward pod/init-demo 8080:80 -n workloads-lab
```

Terminal khác:

```bash
curl http://localhost:8080
```

Quan sát status từng init container:

```bash
kubectl get pod init-demo -n workloads-lab \
  -o jsonpath='{range .status.initContainerStatuses[*]}{.name}{"\t"}{.state}{"\n"}{end}'
```

### 8.1 Mô phỏng init lỗi

```bash
kubectl run init-failure \
  --image=busybox:1.36 \
  --restart=Never \
  -n workloads-lab \
  -- echo temporary
kubectl delete pod init-failure -n workloads-lab
```

Tạo manifest riêng với init command `exit 1`, sau đó dùng:

```bash
kubectl describe pod <pod> -n workloads-lab
kubectl logs <pod> -n workloads-lab -c <init-container>
```

Cleanup:

```bash
kubectl delete namespace workloads-lab
```

---

## 9. Troubleshooting

```bash
kubectl get pod <pod> -n <namespace>
kubectl describe pod <pod> -n <namespace>
kubectl logs <pod> -n <namespace> -c <init-name>
kubectl logs <pod> -n <namespace> -c <init-name> --previous
kubectl get events -n <namespace> --sort-by=.metadata.creationTimestamp
```

| Triệu chứng | Nguyên nhân thường gặp |
|---|---|
| `Init:ImagePullBackOff` | Sai image/tag hoặc registry auth |
| `Init:CrashLoopBackOff` | Script exit khác 0, permission, dependency timeout |
| `Init:0/2` kéo dài | Init đầu chưa thành công |
| App không thấy file | Hai container không mount cùng volume/path |
| Pod `Pending` | Init resource request quá lớn hoặc PVC chưa bind |
| Init “thành công” nhưng dữ liệu sai | Script không validate output hoặc ghi sai mount path |

Dùng `kubectl logs -c`; `kubectl logs <pod>` mặc định thường chọn application container và không cho thấy lỗi init.

---

## 10. Best practices

- Giữ init task nhỏ, có deadline và log rõ ràng.
- Thiết kế idempotent vì retry và Pod replacement là bình thường.
- Ghi output vào volume; không kỳ vọng filesystem riêng được chia sẻ.
- Mount read-only ở application container khi app không cần sửa dữ liệu.
- Không chạy migration toàn cục trong mọi replica.
- Khai báo requests/limits cho init containers.
- Dùng image tối thiểu, pin version/digest và security context phù hợp.
- Không log Secret hoặc copy Secret sang nơi kém bảo vệ.
- Để app tự chịu được dependency bị mất sau startup.

Tiếp tục với [Multi-container Pods](/workloads/multi-container-pods/) để tìm hiểu sidecar, adapter và ambassador.

---

## Tài liệu tham khảo

- [Init Containers](https://kubernetes.io/docs/concepts/workloads/pods/init-containers/)
- [Sidecar Containers](https://kubernetes.io/docs/concepts/workloads/pods/sidecar-containers/)
- [Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)
