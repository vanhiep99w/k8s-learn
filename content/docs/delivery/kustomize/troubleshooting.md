---
title: "Troubleshooting Kustomize"
description: "Chẩn đoán lỗi khi build, render, validate và apply Kustomization vào Kubernetes cluster theo từng lớp."
---

# Troubleshooting Kustomize

Hãy xác định lỗi xảy ra ở lớp nào trước khi sửa file:

```text
filesystem/YAML → Kustomize build → API validation/admission → controller rollout → application
```

Lỗi ở lớp sau không chứng minh lớp trước sai. Một manifest render thành công vẫn có thể tham chiếu image không tồn tại hoặc bị policy của cluster từ chối.

## Không tìm thấy file hoặc path

Triệu chứng thường là `file not found`, `must build at directory` hoặc lỗi không tìm thấy `kustomization.yaml`.

Kiểm tra:

```bash
pwd
find overlays/dev -maxdepth 2 -type f -print
kubectl kustomize overlays/dev/
```

Đường dẫn trong `resources`, `patches` và generator được tính tương đối từ thư mục Kustomization chứa chúng. Đừng giả định đường dẫn tương đối tính từ root repository. Kiểm tra cả chữ hoa/chữ thường khi CI chạy trên Linux.

## YAML hợp lệ nhưng build fail

Các nguyên nhân phổ biến:

- indentation làm sai kiểu map/list;
- duplicate resource identity (`apiVersion`, `kind`, name, namespace);
- resource được khai báo hai lần qua hai nhánh `resources`;
- remote base không tải được hoặc không được phép bởi load restrictor;
- generator tham chiếu file ngoài root hợp lệ.

Chạy build trực tiếp và đọc object/path trong error:

```bash
kubectl kustomize overlays/dev/ > /tmp/rendered.yaml
```

Không bỏ qua lỗi bằng cách thêm flag nguy hiểm. Việc nới load restriction hoặc bật plugin có thể làm mất tính relocatable và tăng rủi ro supply-chain; chỉ dùng khi workflow đã review.

## Patch không match target

Triệu chứng có thể là `no matches for OriginalId` hoặc patch không thay đổi field như mong đợi.

So sánh patch với resource base:

```bash
grep -R -n -E '^(apiVersion|kind:|  name:|  namespace:)' base overlays/dev
```

Kiểm tra:

- `group` của `apps/v1` là `apps`, còn core `v1` có group rỗng;
- `kind`, `version`, `name`, namespace đúng;
- patch target dùng tên trước `namePrefix`/`nameSuffix`;
- selector không match quá rộng hoặc không match object nào;
- strategic merge có schema/merge key phù hợp.

Với JSON Patch, kiểm tra path và index. Với list container, strategic merge theo `name` thường ít dễ vỡ hơn index.

## Generator tạo tên không mong đợi

Nếu output có `app-config-<hash>`, đó là content hash mặc định. Tìm reference logical trong resource nguồn và xem Kustomize đã rewrite chưa:

```bash
kubectl kustomize overlays/dev/ | grep -E 'name: (app-config|app-config-)'
```

Không sửa reference thành một hash cụ thể vì lần thay đổi tiếp theo sẽ tạo hash mới. Nếu app nhận tên qua command argument hoặc custom field không được nhận diện, dùng `replacements` hoặc thay đổi thiết kế reference.

Nếu ConfigMap/Secret thay đổi nhưng Pod không rollout, kiểm tra `disableNameSuffixHash`, cách app đọc cấu hình và việc object reference có nằm trong Pod template hay không.

## Render đúng nhưng apply fail

Dùng server-side dry-run để tách lỗi API khỏi rollout:

```bash
kubectl apply --dry-run=server -k overlays/dev/
```

Các triệu chứng và hướng kiểm tra:

| Triệu chứng | Kiểm tra |
| --- | --- |
| `forbidden` | `kubectl auth can-i ...` với đúng user/context. |
| `namespace not found` | `kubectl get namespace`; tạo namespace qua pipeline hoặc resource đúng ownership. |
| unknown field / invalid field | API version, schema cluster và typo trong output render. |
| quota exceeded | `kubectl describe resourcequota -n <namespace>`. |
| admission denied | message của webhook/policy; không xóa policy để né lỗi. |
| immutable field | Xác định field, thay bằng migration hoặc recreate có kế hoạch. |

## Apply thành công nhưng Pod không Ready

Sau apply, theo dõi controller và Events:

```bash
kubectl rollout status deployment/<name> -n <namespace> --timeout=180s
kubectl get pods -n <namespace> -o wide
kubectl describe pod <pod> -n <namespace>
kubectl logs <pod> -n <namespace> --all-containers --tail=100
kubectl get events -n <namespace> --sort-by=.lastTimestamp
```

Phân biệt các nhóm lỗi:

- `ImagePullBackOff`: image/tag/digest, registry credential hoặc network;
- `Pending`: resource request, taint, affinity, quota hoặc PVC;
- `CrashLoopBackOff`: command, config, Secret, probe hoặc ứng dụng;
- `Ready` false: readiness probe, Service selector hoặc dependency.

Đây là lỗi runtime/controller, không phải lỗi Kustomize chỉ vì manifest được deploy qua Kustomize.

## Debug theo output, không theo file nguồn đơn lẻ

Khi nhiều overlay và patch cùng tác động, file base không cho biết trạng thái cuối. Lưu output của đúng entry point:

```bash
kubectl kustomize overlays/prod/ > /tmp/prod.yaml
kubectl diff -f /tmp/prod.yaml
```

Review output cho `metadata.name`, namespace, selector, image, probe, resources và Secret reference. Nếu output đúng nhưng cluster khác dự kiến, kiểm tra mutating webhook, defaulting và object live:

```bash
kubectl get deployment <name> -n <namespace> -o yaml
```

Object live có thể chứa field do API Server hoặc webhook default; so sánh desired render với live object theo ownership thay vì ghi đè mù quáng.
