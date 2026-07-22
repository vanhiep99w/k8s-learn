---
title: "Lệnh kubectl với Kustomize"
description: "Render, diff, dry-run, apply và xóa Kustomization bằng kubectl theo quy trình triển khai an toàn."
---

# Lệnh kubectl với Kustomize

Giả sử entry point của môi trường là `overlays/dev/`. Luôn kiểm tra đường dẫn này trước khi chạy lệnh; `-k` nhận **thư mục chứa Kustomization**, không nhận trực tiếp file `kustomization.yaml`.

## Kiểm tra client và context

```bash
kubectl version --client
kubectl config current-context
kubectl cluster-info
```

`kubectl kustomize` không cần kết nối cluster, nhưng các lệnh thao tác cluster dùng context hiện tại. Nếu làm việc với nhiều cluster, truyền `--context` tường minh trong script hoặc thiết lập context ngay trước thao tác.

## Render local với `kubectl kustomize`

```bash
kubectl kustomize overlays/dev/
```

Ghi output vào artifact để review hoặc đưa qua tool khác:

```bash
kubectl kustomize overlays/dev/ > /tmp/dev-rendered.yaml
```

Đây là bước build, không tạo hoặc sửa resource trên cluster. Lỗi path, YAML, duplicate resource và patch target thường được phát hiện ở bước này.

Một số option hữu ích phụ thuộc phiên bản `kubectl`, nên xem help của client đang dùng:

```bash
kubectl kustomize --help
```

## Server-side dry-run

Khi đã có kubeconfig và quyền tương ứng, gửi object đến API Server nhưng không persist:

```bash
kubectl apply --dry-run=server -k overlays/dev/
```

Server-side dry-run giúp kiểm tra API version, schema và admission policy của cluster. Nó vẫn có thể fail nếu RBAC, webhook, quota hoặc policy không cho phép request; đó là tín hiệu hữu ích, không phải lỗi của render local.

`--dry-run=client` có thể dùng để xem object phía client sẽ gửi, nhưng không kiểm tra đầy đủ schema và admission của cluster:

```bash
kubectl apply --dry-run=client -k overlays/dev/ -o yaml
```

## Xem diff trước apply

```bash
kubectl diff -k overlays/dev/
```

Exit code của `kubectl diff` thường phân biệt không có khác biệt với có khác biệt hoặc lỗi; khi dùng trong CI, đọc contract của phiên bản `kubectl` và xử lý exit code phù hợp thay vì coi mọi code khác 0 là build failure.

Diff nên được review theo các nhóm: object mới/xóa, namespace, image, replicas, resource requests/limits, selector, Secret/ConfigMap name và security fields. Một diff xóa resource ngoài dự kiến là lý do để dừng rollout.

## Apply

```bash
kubectl apply -k overlays/dev/
```

Kết quả apply chỉ nói API Server đã nhận desired state. Với Deployment, kiểm tra rollout tiếp:

```bash
kubectl rollout status deployment/dev-web -n app-dev --timeout=120s
kubectl get deployment,pods,service -n app-dev
kubectl describe deployment/dev-web -n app-dev
```

Nếu dùng server-side apply, đặt field manager riêng và cân nhắc ownership:

```bash
kubectl apply --server-side \
  --field-manager=delivery-kustomize \
  -k overlays/dev/
```

Không chuyển tùy tiện giữa nhiều field manager cùng sửa một object. Server-side apply có thể báo field conflict; `--force-conflicts` là thao tác có rủi ro và chỉ dùng khi đã xác định owner đúng.

## Delete

```bash
kubectl delete -k overlays/dev/
```

Kustomize build tại thời điểm delete quyết định object nào được gửi delete request. Nếu overlay hiện tại đã bỏ một resource, lệnh này không tự biết object cũ từng được apply từ revision trước. Với workload stateful hoặc resource dùng chung, hãy xem danh sách resource và ownership trước khi xóa.

> [!WARNING]
> Không dùng `kubectl delete -k` như cơ chế rollback. Rollback thường là build/apply lại revision manifest trước để Kubernetes controllers duy trì object và history phù hợp. Delete có thể gây downtime hoặc mất resource mà không tạo lại đúng trạng thái cũ.

## Quy trình an toàn tối thiểu

```bash
set -euo pipefail

kubectl kustomize overlays/staging/ > /tmp/staging.yaml
kubectl apply --dry-run=server -k overlays/staging/
kubectl diff -k overlays/staging/
# review diff ở đây
kubectl apply -k overlays/staging/
kubectl rollout status deployment/staging-web -n app-staging --timeout=180s
```

Các tên Deployment và namespace trong lệnh trên là ví dụ; thay bằng output thật của overlay. Không copy nguyên lệnh vào production nếu chưa xác nhận context, namespace và resource ownership.
