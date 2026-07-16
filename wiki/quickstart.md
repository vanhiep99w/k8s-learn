---
title: "Wiki quickstart"
description: "Bản đồ repository k8s-learn và hướng dẫn cho người mới hoặc coding agent."
---

# Wiki quickstart

## Repository này là gì?

`k8s-learn` là một website tài liệu học Kubernetes bằng tiếng Việt. Repository không chứa cluster, service backend hay manifest triển khai ứng dụng; sản phẩm chính là bộ Markdown/MDX trong `content/docs/`, được build thành site tĩnh bằng Next.js, Fumadocs và Cloudflare Pages.

Mục tiêu nội dung là dẫn người học từ Container và Kubernetes fundamentals đến workloads, networking, storage, security, observability, delivery, cluster administration và production. `content/docs/meta.json` và các `meta.json` theo category là nguồn xác định thứ tự học trên sidebar.

## Bắt đầu nhanh

### Người đọc tài liệu

1. Đọc [Nền tảng Container](/gioi-thieu/container-fundamentals/) rồi [Kubernetes là gì?](/gioi-thieu/kubernetes-la-gi/).
2. Làm theo [Cài đặt môi trường học tập](/gioi-thieu/cai-dat-moi-truong/); đường dẫn chính dùng Docker hoặc Podman, `kind` và `kubectl`.
3. Thực hành [Triển khai ứng dụng đầu tiên](/gioi-thieu/first-application/).
4. Khi gặp lỗi, bắt đầu từ nhóm Troubleshooting trong [bản đồ nội dung](content-map.md).

### Người phát triển repository

```bash
npm install
npm run dev       # mở http://localhost:3000
npm run build     # tạo static output trong dist/
npm run preview   # chạy dist/ qua Wrangler Pages dev
npm run deploy    # build rồi deploy dist/ lên Cloudflare Pages
```

Route `/` redirect đến `/gioi-thieu/container-fundamentals/`; hành vi này nằm trong `src/app/[[...slug]]/page.tsx`. Site dùng `trailingSlash: true`, vì vậy URL tài liệu nên giữ dấu `/` cuối.

## Bản đồ Wiki

- [Kiến trúc site](architecture.md) — pipeline từ file `.md` đến page tĩnh, MDX plugins, component và search.
- [Bản đồ nội dung](content-map.md) — curriculum, trạng thái nội dung, quy ước `meta.json`/frontmatter và cách chọn nơi sửa.
- [Hướng dẫn phát triển](development.md) — workflow local/build/deploy, kiểm tra trước commit và các bẫy thường gặp.

## Các phần tài liệu chính

Thứ tự dưới đây lấy từ `content/docs/meta.json`; mỗi phần có `meta.json` riêng để định nghĩa title và pages:

| Phần | Vai trò | Nguồn |
|---|---|---|
| Bắt đầu | Container, Kubernetes overview, môi trường, `kubectl`, YAML và app đầu tiên | `content/docs/gioi-thieu/` |
| Kiến trúc Kubernetes | Control Plane, Worker Node, API Server, etcd, Scheduler và reconciliation | `content/docs/kien-truc/` |
| Workloads | Pod, Deployment, StatefulSet, DaemonSet, Job và CronJob | `content/docs/workloads/` |
| Cấu hình ứng dụng | Environment, ConfigMap, Secret, resources, probes và QoS | `content/docs/cau-hinh/` |
| Networking | Pod network, Service, DNS, Ingress, Gateway API và NetworkPolicy | `content/docs/networking/` |
| Storage | Volumes, PV/PVC, StorageClass, CSI, snapshot và backup | `content/docs/storage/` |
| Scheduling | Selector, affinity, taints/tolerations, priority và topology spread | `content/docs/scheduling/` |
| Security | Authentication, Authorization, RBAC, ServiceAccount, admission và runtime security | `content/docs/security/` |
| Observability | Events, logs, metrics, Prometheus, Grafana, tracing và alerting | `content/docs/observability/` |
| Application Delivery | Helm, Kustomize, CI/CD, GitOps, rollout và autoscaling | `content/docs/delivery/` |
| Cluster Administration | Bootstrap, node, HA, DNS, certificate, upgrade và etcd | `content/docs/cluster-administration/` |
| Troubleshooting | Methodology và chẩn đoán Pod, Deployment, Service, DNS, Node, Storage, Control Plane | `content/docs/troubleshooting/` |
| Ecosystem | CRD, Operator, ingress/gateway controller, cert-manager, KEDA, policy và mesh | `content/docs/ecosystem/` |
| Production | Readiness, HA, multi-tenancy, DR, cost, hardening và platform engineering | `content/docs/production/` |
| Labs và Projects | Labs theo chủ đề và capstone production platform | `content/docs/labs-projects/` |
| Certifications | CKA, CKAD, CKS, exam strategy và kubectl cheatsheet | `content/docs/certifications/` |

## Rule loading

Trước khi sửa bất kỳ file nào, đọc [global Wiki rules](_rules.md) và mọi `_rules.md` thuộc section liên quan (nếu có). Hiện tại repository chỉ có `wiki/_rules.md`; không sửa các file `_rules.md` ngoài workflow Harness được phê duyệt. Nếu phạm vi thay đổi chuyển sang domain khác, đọc lại các rule áp dụng.

## Điều cần nhớ cho agent

- Source of truth của sidebar là các `meta.json`, không phải việc file `.md` tồn tại trên disk.
- Mỗi page nội dung cần frontmatter `title` và `description`; internal link trong `content/docs/` dùng trailing slash.
- Nhiều page vẫn là placeholder curriculum. Không suy ra rằng một chủ đề đã được triển khai chỉ vì nó có tên trong sidebar.
- `next.config.mjs` và `source.config.ts` có thay đổi chưa commit tại thời điểm Wiki này được tạo; kiểm tra `git status` trước khi kết luận về baseline.
- Không đọc hoặc ghi secret, `.env`, token hay file cấu hình nhạy cảm. Thay đổi tài liệu repository chỉ nên nằm trong `content/docs/` theo hướng dẫn dự án; riêng Wiki nằm dưới `wiki/`.

## Đọc tiếp theo

- Nếu cần hiểu runtime/build: đọc [Kiến trúc site](architecture.md).
- Nếu cần thêm hoặc hoàn thiện một bài học: đọc [Bản đồ nội dung](content-map.md) rồi [Hướng dẫn phát triển](development.md).
- Nếu cần thay đổi route, MDX component hoặc search: bắt đầu từ `src/app/[[...slug]]/page.tsx`, `source.config.ts` và `src/app/api/search/route.ts`, sau đó chạy build.
