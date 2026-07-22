---
title: "Patches trong Kustomize"
description: "Thay đổi replicas, image, resources và field khác bằng patches có target rõ ràng mà không sửa manifest base."
---

# Patches trong Kustomize

Patch là một thay đổi có phạm vi hẹp lên resource đã được nạp. Patch tốt nói rõ **object nào**, **field nào** và **vì sao môi trường này khác base**. Không nên dùng patch để viết lại gần như toàn bộ manifest.

## Field `patches`

Kustomize dùng field `patches` cho các patch file hoặc inline patch. Một patch có thể được áp dụng theo target `group`, `version`, `kind`, `name`, `namespace`, `labelSelector` hoặc `annotationSelector`.

Ví dụ tăng replica và đặt resource limit:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - ../../base

patches:
  - path: replicas.yaml
  - path: resources.yaml
```

`replicas.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 3
```

`resources.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  template:
    spec:
      containers:
        - name: web
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi
```

Khi patch có `metadata.name` và `kind` tương ứng resource, Kustomize có thể suy ra target. Với nhiều resource cùng loại/tên ở namespace khác nhau hoặc khi cần JSON Patch, khai báo target tường minh.

## Strategic Merge Patch

Strategic Merge Patch biểu diễn phần YAML cần merge vào object. Kubernetes-aware merge key, thường là `name` với list container, cho phép sửa một container mà không viết lại toàn bộ list.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  template:
    spec:
      containers:
        - name: web
          image: registry.example.com/web:2.0
```

Cách này dễ đọc khi sửa các Kubernetes built-in resource có schema được Kustomize hiểu. Tuy nhiên, không phải CRD nào cũng có đủ OpenAPI schema cho strategic merge. Với resource tùy chỉnh hoặc field list có semantics đặc biệt, kết quả có thể không giống điều người viết đoán.

Trong code mới, ưu tiên field `patches` thay vì các field legacy như `patchesStrategicMerge` và `patchesJson6902`; nếu repository đang dùng field cũ, nên migrate có kiểm thử output.

## JSON Patch (RFC 6902)

JSON Patch là một danh sách operation có path cụ thể. Nó phù hợp khi cần thay thế, thêm hoặc xóa chính xác một node, kể cả resource không hỗ trợ strategic merge.

`replicas-json.yaml`:

```yaml
- op: replace
  path: /spec/replicas
  value: 5
```

Khai báo target:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - ../../base

patches:
  - path: replicas-json.yaml
    target:
      group: apps
      version: v1
      kind: Deployment
      name: web
```

Các operation thường gặp là `add`, `remove`, `replace`, `move`, `copy` và `test`. Path là JSON Pointer nên list dùng index, ví dụ `/spec/template/spec/containers/0`. Index dễ vỡ khi base thêm hoặc sắp xếp lại container; nếu có thể, strategic merge theo `name` thường dễ bảo trì hơn.

## Chọn loại patch

| Tình huống | Lựa chọn phù hợp |
| --- | --- |
| Đổi `replicas`, image hoặc một field map đơn giản | Strategic merge qua `patches`. |
| Đổi container theo `name` trong resource built-in | Strategic merge, kiểm tra output. |
| Sửa CRD hoặc path cụ thể không có merge schema | JSON Patch với target rõ. |
| Đổi image hàng loạt theo tên image | `images`, không cần patch. |
| Truyền giá trị giữa resource sau name transformation | `replacements`, khi quan hệ field được mô tả rõ. |

## Kiểm tra patch

Render trước, tìm đúng resource và field:

```bash
kubectl kustomize overlays/prod/ > /tmp/prod.yaml
grep -n -A20 -B5 'name: web' /tmp/prod.yaml
```

Sau đó dùng schema của API Server:

```bash
kubectl apply --dry-run=server -k overlays/prod/
kubectl diff -k overlays/prod/
```

Nếu patch không match, Kustomize thường fail ngay khi build. Nếu patch match sai resource do target quá rộng, build vẫn có thể thành công nhưng output sai; vì vậy target nên cụ thể và test output phải kiểm tra cả tên, namespace, image, replicas và resource chính.

> [!WARNING]
> Không dùng JSON Patch với index container mà không kiểm tra layout base. Thêm một sidecar ở đầu list có thể khiến patch vẫn chạy nhưng sửa nhầm container.
