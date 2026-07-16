---
title: "Bản đồ nội dung"
description: "Curriculum Kubernetes, quy ước tổ chức page và trạng thái nội dung trong content/docs."
---

# Bản đồ nội dung

## Curriculum hiện tại

Root `content/docs/meta.json` định nghĩa 17 entry theo thứ tự sidebar: `index`, `gioi-thieu`, `kien-truc`, `workloads`, `cau-hinh`, `networking`, `storage`, `scheduling`, `security`, `observability`, `delivery`, `cluster-administration`, `troubleshooting`, `ecosystem`, `production`, `labs-projects` và `certifications`.

Mỗi directory có `meta.json` riêng. `title` là tên hiển thị; `pages` là danh sách basename không có `.md` và đồng thời là thứ tự điều hướng. Vì vậy `meta.json` là một phần của public navigation contract.

| Nhóm | Câu hỏi mà nhóm trả lời | Nên đọc khi |
|---|---|---|
| `gioi-thieu/` | Kubernetes là gì, cần công cụ gì, dùng `kubectl`/YAML ra sao? | Bắt đầu từ số 0 hoặc tạo lab đầu tiên. |
| `kien-truc/` | Control Plane, Node và control loop phối hợp thế nào? | Cần hiểu nguyên nhân thay vì chỉ nhớ command. |
| `workloads/` | Pod và các controller quản lý vòng đời workload thế nào? | Viết hoặc sửa Deployment/StatefulSet/Job. |
| `cau-hinh/` | Cấu hình, Secret, resource, probe và QoS đi vào workload ra sao? | Ứng dụng cần config hoặc giới hạn tài nguyên. |
| `networking/` | Pod, Service, DNS, Ingress/Gateway và policy kết nối ra sao? | Không truy cập được service hoặc thiết kế traffic. |
| `storage/` | Volume, PV/PVC, StorageClass và CSI cung cấp dữ liệu bền vững thế nào? | Workload có state hoặc cần backup. |
| `scheduling/` | Scheduler dùng selector, affinity, taint, priority và topology thế nào? | Cần kiểm soát Pod chạy ở Node nào. |
| `security/` | Identity, authentication, authorization, RBAC và runtime guardrail? | Cấp quyền, hardening hoặc điều tra access denied. |
| `observability/` | Logs, Events, metrics, traces, dashboard và alert? | Cần biết hệ thống đang xảy ra gì. |
| `delivery/` | Manifest management, Helm/Kustomize, GitOps, rollout và autoscaling? | Đưa thay đổi vào cluster lặp lại được. |
| `cluster-administration/` | Bootstrap, node lifecycle, HA, certificate, upgrade và etcd? | Vận hành chính cluster. |
| `troubleshooting/` | Methodology và runbook cho từng lớp lỗi? | Triệu chứng đã biết nhưng chưa có root cause. |
| `ecosystem/` | CRD, Operator, controller và các integration phổ biến? | Mở rộng Kubernetes bằng platform component. |
| `production/` | Readiness, DR, cost, tenancy, hardening và platform engineering? | Đánh giá workload/cluster trước production. |
| `labs-projects/` | Bài thực hành và capstone nối các domain? | Muốn kiểm chứng bằng một sản phẩm end-to-end. |
| `certifications/` | CKA, CKAD, CKS và chiến lược luyện thi? | Học theo mục tiêu chứng chỉ. |

Lộ trình khuyến nghị đi theo thứ tự trong các file `meta.json`: Container → Kubernetes API → Workloads → Networking → Storage → Scheduling → Security → Observability → Delivery → Cluster Administration → Production. Thứ tự này nên được ưu tiên khi thêm cross-link hoặc mở rộng curriculum.

## Trạng thái nội dung

Inventory hiện tại có **182 file Markdown** dưới `content/docs/`; **174 file** chứa marker `placeholder`. Nhóm `gioi-thieu/` có các page đã viết chi tiết như:

- `container-fundamentals.md`
- `docker-vs-containerd.md`
- `kubernetes-la-gi.md`
- `cai-dat-moi-truong.md`
- `kubectl-co-ban.md`
- `yaml-manifest.md`
- `api-resources.md`
- `first-application.md`

Phần lớn các nhóm còn lại hiện giữ curriculum placeholder. Ví dụ `kien-truc/tong-quan-cluster.md`, `workloads/deployment.md`, `networking/service.md`, `security/rbac.md`, `troubleshooting/troubleshooting-methodology.md` và `production/production-readiness.md` đều mô tả mục tiêu dự kiến thay vì hướng dẫn hoàn chỉnh.

`content/docs/index.md` vẫn ghi rằng các trang là placeholder. Nhận định này đã lỗi thời một phần vì commit gần nhất đã hoàn thiện nhóm giới thiệu; khi viết tài liệu mới, ưu tiên trạng thái file thực tế và git diff hơn mô tả tổng quát cũ.

## Quy ước page

Mỗi page content cần frontmatter tối thiểu:

```yaml
---
title: "Tên hiển thị"
description: "Mô tả ngắn cho page và metadata"
---
```

Theo `AGENTS.md` và skill `write-docs`:

- Viết nội dung bằng tiếng Việt; giữ tên kỹ thuật, service, tool và code bằng English.
- Khi tạo hoặc đổi tên page, cập nhật `meta.json` cùng lúc.
- Link nội bộ dùng URL có trailing slash, ví dụ `/workloads/deployment/`.
- Dùng heading theo cấp, fenced code block có language, và giữ cấu trúc giải thích → thực hành → troubleshooting phù hợp với loại page.
- Có thể dùng Callout, Cards, Steps, Tabs, Accordion, TypeTable và Mermaid; chúng đã được đăng ký trong MDX renderer.

Skill chi tiết nằm ở `.agents/skills/write-docs/SKILL.md` và các reference files bên cạnh nó. Đây là hướng dẫn cho việc viết content, không phải source runtime của site.

## Workflow chọn nơi sửa

### Thêm một concept Kubernetes

1. Chọn nhóm theo domain, thay vì tạo directory mới cho mỗi concept.
2. Đọc `meta.json` của nhóm và các page liên quan để tránh trùng nội dung.
3. Viết page có frontmatter tiếng Việt.
4. Thêm basename vào `pages` ở vị trí logic.
5. Thêm link từ page liên quan nếu concept là bước học tiếp theo.
6. Chạy `npm run build`.

### Hoàn thiện placeholder

Giữ filename và thứ tự sidebar hiện có nếu không có lý do điều hướng rõ ràng. Thay nội dung placeholder bằng hành vi đã kiểm chứng, ví dụ command, manifest, điều kiện, failure mode và cách xác minh. Không coi phần `Nội dung dự kiến` là bằng chứng rằng implementation hay workflow cụ thể đã tồn tại trong repository.

### Thay đổi curriculum

Nếu đổi tên hoặc di chuyển nhóm, phải cập nhật root `content/docs/meta.json`, `meta.json` của nhóm, các internal links và các page có liên quan. Với URL public, ưu tiên giữ slug cũ hoặc bổ sung kế hoạch redirect phù hợp với static export; repository hiện không có redirect map riêng.

## Nguồn sự thật và giới hạn

- Sidebar: `content/docs/meta.json` và `content/docs/*/meta.json`.
- Metadata page: frontmatter của từng `.md`.
- Route/render behavior: `src/app/[[...slug]]/page.tsx`.
- Nội dung học: chính các page Markdown; README chỉ là overview ngắn.
- Không có tests, fixtures, application manifests hay API schema nghiệp vụ được phát hiện trong inventory hiện tại. Kiểm thử chủ yếu là build và kiểm tra site/render/search.
