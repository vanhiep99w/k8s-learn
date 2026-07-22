---
title: "Cấu trúc project Kustomize"
description: "Tổ chức kustomization.yaml, resource Kubernetes và thư mục project để dễ đọc, validate và tái sử dụng."
---

# Cấu trúc project Kustomize

## File `kustomization.yaml`

Kustomize nhận diện một thư mục là Kustomization khi thư mục đó có `kustomization.yaml`, `kustomization.yml` hoặc `Kustomization`. Nên thống nhất dùng `kustomization.yaml` để người đọc không phải đoán.

Ví dụ tối thiểu:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - deployment.yaml
  - service.yaml

namespace: demo
commonAnnotations:
  owner: platform-team
```

`resources` có thể trỏ đến file YAML chứa một hoặc nhiều object, hoặc một thư mục có Kustomization khác. Đường dẫn tương đối được tính từ thư mục chứa file hiện tại. Không nên phụ thuộc vào working directory nơi lệnh được gọi.

## Một layout có thể bảo trì

```text
my-app/
├── base/
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── kustomization.yaml
│   └── config/
│       └── app.properties
└── overlays/
    ├── dev/
    │   ├── kustomization.yaml
    │   └── replica-patch.yaml
    ├── staging/
    │   ├── kustomization.yaml
    │   └── replica-patch.yaml
    └── prod/
        ├── kustomization.yaml
        ├── replica-patch.yaml
        └── resource-patch.yaml
```

Base nên chứa cấu hình có ý nghĩa cho mọi môi trường. Overlay nên chứa quyết định của môi trường đó, không sửa trực tiếp file trong base. Một base không nên biết overlay nào đang sử dụng nó; nhờ vậy nhiều overlay có thể tái sử dụng cùng một base.

## Ví dụ resource và Kustomization

`base/deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  labels:
    app.kubernetes.io/name: web
spec:
  replicas: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: web
  template:
    metadata:
      labels:
        app.kubernetes.io/name: web
    spec:
      containers:
        - name: web
          image: nginx:1.27
          ports:
            - name: http
              containerPort: 80
```

`base/service.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  selector:
    app.kubernetes.io/name: web
  ports:
    - name: http
      port: 80
      targetPort: http
```

`base/kustomization.yaml`:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - deployment.yaml
  - service.yaml
```

Render từ thư mục project:

```bash
kubectl kustomize base/
```

Output phải có một `Deployment` và một `Service`. Nếu không, kiểm tra tên file trong `resources` và indentation YAML trước khi tìm lỗi ở overlay.

## Những field thường dùng

| Field | Dùng để | Lưu ý |
| --- | --- | --- |
| `resources` | Nạp resource hoặc Kustomization lồng nhau. | Tránh trỏ đến cùng object nhiều lần. |
| `namespace` | Gán namespace cho resource namespaced. | Không thay thế namespace của resource cluster-scoped. |
| `namePrefix`, `nameSuffix` | Đổi tên theo môi trường. | Kustomize cập nhật một số reference được nhận diện; không hard-code tên đã biến đổi trong app. |
| `images` | Đổi registry, tag hoặc digest. | Ưu tiên digest trong production khi quy trình đã hỗ trợ. |
| `labels` | Thêm label theo quy tắc. | Cẩn thận khi label được đưa vào selector bất biến. |
| `patches` | Sửa một phần object. | Target cần đủ cụ thể và patch nên nhỏ. |
| `generatorOptions` | Điều khiển metadata/name hash của generator. | Tắt hash làm mất một cơ chế trigger rollout tự nhiên. |

## Validate trước khi commit

Render từng entry point mà CI hoặc GitOps sẽ dùng:

```bash
for dir in overlays/*; do
  echo "== $dir =="
  kubectl kustomize "$dir" >/dev/null
 done
```

Lệnh trên chỉ kiểm tra build. Với schema và policy của cluster, có thể tiếp tục dùng `kubectl apply --dry-run=server -k overlays/dev/` khi kubeconfig có quyền truy cập API Server. Nếu dùng admission policy hoặc tool lint riêng, chạy chúng trên output render, không chỉ trên file base.
