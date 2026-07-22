---
title: "Kustomize"
description: "Lộ trình thực hành Kustomize để tổ chức, tùy biến, kiểm tra và triển khai Kubernetes manifests giữa nhiều môi trường."
---

# Kustomize

Kustomize giúp bạn tạo một bộ Kubernetes manifests cuối cùng từ các resource YAML, file cấu hình và các phép biến đổi được khai báo trong `kustomization.yaml`. Thay vì sao chép toàn bộ manifest cho từng môi trường, bạn giữ phần dùng chung trong **base** rồi đặt khác biệt của `dev`, `staging` hoặc `production` trong các **overlay**.

Kustomize phù hợp với cách quản lý declarative của Kubernetes: source code chứa cấu hình mong muốn, còn `kubectl` render và gửi cấu hình đó đến API Server. Công cụ không phải là một deployment controller; sau khi `kubectl apply -k` kết thúc, việc rollout vẫn do Kubernetes controllers thực hiện.

## Câu hỏi trung tâm

Sau phần này, bạn có thể tổ chức một project Kustomize có base và overlays, render output trước khi apply, dùng patch và generator đúng mục đích, rồi chẩn đoán lỗi từ đường dẫn nguồn cho đến API Server.

## Lộ trình học

1. [Kustomize là gì?](./concepts/) — mental model, pipeline render và phạm vi của công cụ.
2. [Cấu trúc project Kustomize](./project-structure/) — `kustomization.yaml`, resource và layout.
3. [Base và Overlays](./bases-and-overlays/) — tái sử dụng manifest giữa các môi trường.
4. [Patches trong Kustomize](./patches/) — thay đổi field có chủ đích.
5. [ConfigMap và Secret Generators](./generators/) — sinh cấu hình và quản lý name hash.
6. [Lệnh kubectl với Kustomize](./commands/) — build, diff, apply và delete an toàn.
7. [Troubleshooting Kustomize](./troubleshooting/) — phân loại lỗi build, patch và cluster.
8. [Best practices cho Kustomize](./best-practices/) — quy ước review, bảo mật và ownership.

## Prerequisites

Bạn nên biết các thành phần cơ bản của Kubernetes như `Deployment`, `Service`, `ConfigMap`, `Secret`, namespace và label selector. Bài thực hành cần có:

- `kubectl` đã cài và có thể chạy `kubectl version --client`;
- một thư mục làm việc có thể tạo file YAML;
- cluster và kubeconfig nếu muốn thực hiện `diff`, `apply` hoặc `delete`.

`kubectl kustomize` chỉ render local và không cần cluster. Ngược lại, `kubectl diff -k`, `apply -k` và `delete -k` gửi request đến API Server nên cần đúng context, quyền RBAC và namespace.

## Bài thực hành xuyên suốt

Một project nhỏ có thể được tổ chức như sau:

```text
kustomize-demo/
├── base/
│   ├── deployment.yaml
│   ├── service.yaml
│   └── kustomization.yaml
└── overlays/
    ├── dev/
    │   └── kustomization.yaml
    └── prod/
        └── kustomization.yaml
```

Hãy luôn bắt đầu bằng việc render output:

```bash
kubectl kustomize overlays/dev/
```

Sau đó kiểm tra thay đổi so với cluster trước khi apply:

```bash
kubectl diff -k overlays/dev/
kubectl apply -k overlays/dev/
```

Nếu đã apply trong một namespace thử nghiệm, có thể dọn tài nguyên bằng chính overlay đó:

```bash
kubectl delete -k overlays/dev/
```

> [!WARNING]
> `kubectl delete -k` xóa các object được xác định từ output hiện tại của Kustomize. Hãy kiểm tra output và `--context`, `--namespace` trước khi chạy trên cluster thật. Không dùng `delete` làm cách thử nghiệm nếu overlay đang trỏ vào tài nguyên dùng chung.

## Kustomize không giải quyết mọi vấn đề

Kustomize không tự tạo release history, không quản lý dependency chart như Helm và không thay thế GitOps controller như Argo CD hoặc Flux. Nó cũng không biến Secret plaintext trong Git thành dữ liệu an toàn. Khi cần template logic phức tạp, dependency management hoặc một controller liên tục reconcile Git với cluster, hãy xem xét công cụ phù hợp hơn và xác định rõ ranh giới ownership.
