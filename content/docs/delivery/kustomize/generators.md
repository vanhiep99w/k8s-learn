---
title: "ConfigMap và Secret Generators"
description: "Tạo ConfigMap và Secret từ file, env hoặc literal bằng Kustomize và hiểu name hash cùng cách xử lý secret an toàn."
---

# ConfigMap và Secret Generators

Generator tạo `ConfigMap` hoặc `Secret` từ source file, env file hay literal. Kustomize tự cập nhật reference mà nó nhận diện khi tên generated object có content hash suffix. Đây là cách hữu ích để thay đổi cấu hình làm Pod template đổi theo, từ đó Deployment tạo ReplicaSet mới.

## `configMapGenerator`

Tạo ConfigMap từ một file:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

configMapGenerator:
  - name: app-config
    files:
      - config/app.properties
```

Kết quả có key là tên file, ví dụ `app.properties`, và value là nội dung file. Nếu muốn mỗi dòng `KEY=value` thành một key riêng, dùng `envs`:

```yaml
configMapGenerator:
  - name: app-settings
    envs:
      - config/dev.env
```

`literals` phù hợp với giá trị nhỏ, không nhạy cảm:

```yaml
configMapGenerator:
  - name: app-flags
    literals:
      - LOG_LEVEL=debug
      - FEATURE_CHECKOUT=true
```

Hai cách `files` và `envs` có semantics khác nhau: `files` thường tạo một key chứa toàn bộ file, còn `envs` parse các cặp biến thành nhiều data key. Hãy render để xác nhận shape trước khi mount hoặc inject vào container.

## `secretGenerator`

Cú pháp tương tự nhưng Kustomize tạo `Secret` và encode giá trị vào `data`:

```yaml
secretGenerator:
  - name: db-credentials
    literals:
      - username=app
      - password=REPLACE_IN_LOCAL_ONLY
    type: Opaque
```

Có thể đọc từ file:

```yaml
secretGenerator:
  - name: tls-material
    files:
      - tls.crt
      - tls.key
    type: kubernetes.io/tls
```

Base64 trong `Secret.data` chỉ là encoding, không phải encryption. Không commit password thật, private key hoặc token vào Git chỉ vì chúng nằm dưới `secretGenerator` hay được encode trong YAML.

## Content hash và rollout

Generator mặc định thêm content hash vào tên, chẳng hạn `app-config-<hash>`. Khi nội dung thay đổi, tên mới được sinh ra. Reference trong `Deployment` được Kustomize rewrite từ tên logical `app-config` sang tên generated tương ứng. Thay đổi Pod template khiến Deployment rollout phiên bản mới.

Ví dụ dùng ConfigMap trong volume:

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
          image: example/web:1.0
          volumeMounts:
            - name: config
              mountPath: /etc/web
      volumes:
        - name: config
          configMap:
            name: app-config
```

Không hard-code tên đã có hash vào resource nguồn. Khi cần tham chiếu generated name trong argument hoặc field Kustomize không tự nhận diện, dùng `replacements` hoặc thiết kế application đọc từ file/env reference được hỗ trợ.

## `generatorOptions`

Có thể đặt metadata chung và điều khiển hash:

```yaml
generatorOptions:
  labels:
    app.kubernetes.io/part-of: checkout
  annotations:
    config.kubernetes.io/managed-by: kustomize
  disableNameSuffixHash: false
```

Giữ `disableNameSuffixHash: false` hoặc bỏ field để duy trì behavior mặc định. Chỉ tắt hash khi có lý do tương thích rõ ràng, chẳng hạn một hệ thống bên ngoài bắt buộc tên cố định. Khi tắt hash, thay đổi ConfigMap/Secret không còn tự làm Pod template đổi tên; cần có cơ chế rollout rõ ràng và phải hiểu behavior reload của ứng dụng.

## Kiểm tra và bảo mật

Render để xem name và data key:

```bash
kubectl kustomize overlays/dev/
```

Không in Secret thật vào log CI. Pipeline nên:

- lấy secret từ Secret Manager, SOPS/age, Sealed Secrets hoặc cơ chế tương đương;
- giới hạn quyền đọc source và artifact render;
- scan repository để phát hiện credential;
- tách giá trị nhạy cảm khỏi base public;
- xác định rõ công cụ nào decrypt/generate trước khi apply.

Kustomize tự thân không mã hóa source file và không quản lý vòng đời credential. Người đọc có thể xem thêm [Secret](/cau-hinh/secret/) để hiểu runtime semantics của Kubernetes Secret.
