---
title: "Best practices cho Kustomize"
description: "Nguyên tắc tổ chức base và overlay, review output, bảo vệ secret và quản lý ownership khi dùng Kustomize trong production."
---

# Best practices cho Kustomize

## Thiết kế source tree theo ownership

Mỗi overlay nên có một entry point rõ ràng và một owner chịu trách nhiệm cho output. Đặt tên thư mục theo môi trường hoặc target thực tế, ví dụ `overlays/staging` và `overlays/prod`, thay vì tên chung như `overlay-1`.

Giữ base nhỏ và ổn định. Base nên mô tả workload chung; overlay chỉ thay đổi các giá trị có chủ ý. Nếu patch bắt đầu sao chép cả Deployment, tách resource hoặc thiết kế lại API cấu hình thay vì tiếp tục chồng patch.

```text
app/
├── base/                 # contract dùng chung
└── overlays/
    ├── dev/              # target riêng, có owner
    ├── staging/
    └── prod/
```

## Một nguồn sự thật cho mỗi field

Không để Helm, Kustomize, HPA, Operator và người vận hành cùng sở hữu một field:

| Field | Ví dụ owner nên chọn |
| --- | --- |
| `spec.replicas` | HPA hoặc Kustomize, không để cả hai tranh chấp. |
| container image | CI/GitOps manifest hoặc image automation controller. |
| CRD spec | Operator hoặc GitOps source, tùy contract của operator. |
| Secret data | Secret Manager/SOPS pipeline hoặc external-secrets controller. |
| metadata do admission thêm | Cluster policy/webhook, không patch ngược để đánh nhau. |

Nếu HPA quản lý replica, không patch `spec.replicas` ở mỗi release như một giá trị vận hành thường xuyên. Nếu Operator reconcile CR, Kustomize nên sở hữu CR spec và không cố quản lý object con do Operator sinh.

## Luôn review output đã render

Review source là cần thiết nhưng chưa đủ. Pull request và CI nên build từng overlay:

```bash
for dir in overlays/*; do
  kubectl kustomize "$dir" > "artifacts/$(basename "$dir").yaml"
done
```

Kiểm tra tối thiểu:

- object có đúng kind, name và namespace;
- image dùng tag/digest mong muốn;
- selector không bị thay đổi ngoài chủ ý;
- replicas, requests, limits và probes phù hợp capacity;
- Secret/ConfigMap reference có đúng hash;
- object bị xóa hoặc đổi tên có migration/rollback plan;
- output không chứa credential hoặc debug value.

Kết hợp với server-side validation khi CI có cluster validation:

```bash
kubectl apply --dry-run=server -k overlays/staging/
```

## Patch nhỏ, target cụ thể

Mỗi patch nên làm một việc: đổi replicas, image policy, resources hoặc một phần security context. Đặt tên theo intent như `set-prod-resources.yaml`, không đặt tên theo thứ tự `patch-1.yaml`.

Target cụ thể giúp tránh sửa nhầm:

```yaml
patches:
  - path: set-prod-resources.yaml
    target:
      group: apps
      version: v1
      kind: Deployment
      name: web
      namespace: app-prod
```

Không dùng JSON Patch index nếu có thể dùng merge theo container name. Khi patch thay đổi selector hoặc immutable field, bắt buộc review blast radius và kế hoạch migration.

## Quản lý image có thể truy xuất

Dùng `images` để thay image thay vì patch chuỗi rải rác:

```yaml
images:
  - name: example/web
    newName: registry.example.com/example/web
    newDigest: sha256:REPLACE_WITH_DIGEST
```

Tag dễ đọc cho dev, còn production thường cần digest immutable hoặc quy trình đảm bảo tag không bị thay đổi. Dù chọn cách nào, pipeline phải kiểm tra image tồn tại và có provenance phù hợp trước rollout.

## Secret không nằm plaintext trong Git

`secretGenerator` không phải secret store; base64 cũng không phải encryption. Không commit credential thật vào `literals`, file generator hoặc rendered artifact.

Một quy trình an toàn cần xác định:

1. secret được tạo/lưu ở hệ thống nào;
2. bước nào decrypt hoặc fetch secret;
3. artifact render được lưu ở đâu và ai đọc được;
4. rotation và revoke thực hiện thế nào;
5. audit log kiểm tra ra sao.

Nếu dùng SOPS, Sealed Secrets hoặc External Secrets, để công cụ đó sở hữu phần secret tương ứng và ghi rõ contract trong README/runbook của project.

## Hash và rollout phải có chủ ý

Giữ content hash của ConfigMap/Secret generator khi muốn thay đổi data tạo ra Pod template mới. Chỉ tắt `disableNameSuffixHash` khi ứng dụng có cơ chế reload rõ ràng hoặc có rollout trigger khác. Kiểm tra cả hai trường hợp trong staging, vì container có thể chỉ đọc file cấu hình lúc startup.

## CI/CD và GitOps

Pipeline nên tách các bước:

```text
lint/YAML → kustomize build → policy/schema validation → diff/review → apply/reconcile → rollout verification
```

GitOps controller thường build overlay và reconcile thay vì pipeline chạy `kubectl apply` trực tiếp. Không nên để cả controller và pipeline cùng apply một entry point nếu chưa có ownership rõ ràng. Khi promotion, promote commit hoặc immutable image reference; tránh sửa trực tiếp object live rồi để Git tự ghi đè.

## Rollback và cleanup

Rollback Kustomize thường là revert hoặc chọn lại revision Git rồi build/apply lại overlay. Trước rollback, kiểm tra schema migration, database compatibility và behavior của controller.

```bash
git checkout <known-good-revision> -- overlays/prod/
kubectl diff -k overlays/prod/
kubectl apply -k overlays/prod/
kubectl rollout status deployment/<name> -n <namespace>
```

Đây là ví dụ quy trình, không chạy trực tiếp nếu chưa xác định revision và resource. Không dùng `delete -k` để rollback workload stateful; delete có thể gây downtime hoặc mất volume/resource phụ thuộc.

## Quy ước review nên ghi thành policy

Một project production nên tài liệu hóa:

- entry point nào được phép apply;
- namespace/context hợp lệ;
- owner của replicas, image, Secret và CRD;
- command build và validation bắt buộc;
- cách promotion, rollback và cleanup;
- tiêu chí không được merge, chẳng hạn Secret plaintext, `:latest`, target patch mơ hồ hoặc output có object ngoài allowlist.

Kustomize đơn giản khi graph biến đổi ngắn và ownership rõ. Khi project lớn hơn, tính minh bạch này quan trọng hơn việc tận dụng mọi transformer có thể có.
