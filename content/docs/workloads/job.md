---
title: "Job"
description: "Chạy batch task đến khi hoàn thành bằng Job; hiểu completions, parallelism, retry, deadlines, indexed jobs, cleanup và tính idempotent."
---

# Job

## Mục lục

- [Tổng quan](#tổng-quan)
- [1. Job hoàn thành khi nào](#1-job-hoàn-thành-khi-nào)
- [2. Manifest cơ bản](#2-manifest-cơ-bản)
- [3. Completions và parallelism](#3-completions-và-parallelism)
- [4. Retry và failure policy](#4-retry-và-failure-policy)
- [5. Deadline và timeout](#5-deadline-và-timeout)
- [6. Indexed Job](#6-indexed-job)
- [7. Idempotency và xử lý chạy lặp](#7-idempotency-và-xử-lý-chạy-lặp)
- [8. Cleanup Job](#8-cleanup-job)
- [9. Thực hành](#9-thực-hành)
- [10. Troubleshooting](#10-troubleshooting)
- [11. Best practices](#11-best-practices)
- [Tài liệu tham khảo](#tài-liệu-tham-khảo)

---

## Tổng quan

Job quản lý Pods chạy một task đến khi đạt số lần hoàn thành yêu cầu. Khác Deployment, process trong Job phải **kết thúc với exit code 0** khi công việc xong.

```text
Job desired completions=3
├── Pod 1 → exit 0 ✓
├── Pod 2 → exit 1 → retry
├── Pod 3 → exit 0 ✓
└── Pod 4 → exit 0 ✓ → Job Complete
```

Use cases: migration có kiểm soát, batch processing, report, import/export, maintenance và one-off automation.

> [!IMPORTANT]
> Job controller có thể tạo lại Pod và task có thể được thực thi nhiều hơn một lần trong một số failure scenario. Side effect phải idempotent hoặc có deduplication ở tầng nghiệp vụ.

---

## 1. Job hoàn thành khi nào

Job theo dõi Pods thành công/thất bại và cập nhật conditions:

- `Complete=True`: đã đạt mục tiêu.
- `Failed=True`: không thể tiếp tục theo policy/deadline.

`kubectl apply` thành công chỉ nghĩa là Job object đã được lưu. Chờ completion:

```bash
kubectl wait --for=condition=complete job/<name> \
  -n <namespace> --timeout=10m
```

Kiểm tra failure song song vì wait complete có thể timeout khi Job đã Failed:

```bash
kubectl get job <name> -n <namespace> -o yaml
```

---

## 2. Manifest cơ bản

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: report
  namespace: job-lab
spec:
  backoffLimit: 3
  activeDeadlineSeconds: 300
  ttlSecondsAfterFinished: 600
  template:
    metadata:
      labels:
        app: report
    spec:
      restartPolicy: Never
      containers:
        - name: report
          image: busybox:1.36
          command:
            - sh
            - -c
            - |
              set -eu
              echo "building report"
              sleep 5
              echo "done"
          resources:
            requests:
              cpu: 25m
              memory: 16Mi
            limits:
              memory: 32Mi
```

Job Pod template chỉ cho phép `restartPolicy: Never` hoặc `OnFailure`.

- `Never`: container failure làm Pod Failed; Job tạo Pod mới khi retry.
- `OnFailure`: kubelet restart container trong cùng Pod.

`Never` thường dễ debug hơn vì giữ Pod failed và logs theo từng attempt, đổi lại tạo nhiều Pods.

---

## 3. Completions và parallelism

```yaml
spec:
  completions: 10
  parallelism: 3
```

Job cần 10 successful completions và chạy tối đa khoảng 3 Pods đồng thời.

```text
work items: 10
workers active: 3
success count tăng dần đến 10
```

Nếu không đặt `completions`, semantics mặc định tùy kiểu Job, thường một completion. Nếu đặt `parallelism` cao hơn capacity/quota, Pods sẽ Pending chứ không giúp task nhanh hơn.

### 3.1 Work queue pattern

Nhiều workers đọc item từ queue dùng chung. Khi queue hết, workers exit 0. Cần protocol chống xử lý trùng, visibility timeout và acknowledgment phù hợp.

### 3.2 Fixed completions

Mỗi Pod thực hiện một phần việc độc lập và Job đếm số lần thành công. Nếu work items cần mapping cố định, dùng Indexed Job.

---

## 4. Retry và failure policy

### 4.1 `backoffLimit`

Giới hạn retry trước khi Job bị Failed. Giá trị quá cao có thể lặp side effect và tiêu tốn tài nguyên; quá thấp không chịu được lỗi transient.

### 4.2 Exit codes

Process cần dùng exit code có nghĩa:

- `0`: thành công.
- Non-zero retryable: dependency tạm lỗi.
- Non-zero terminal: input/config không hợp lệ.

Các cluster/version mới hỗ trợ `podFailurePolicy` để phản ứng khác theo exit code hoặc Pod condition, ví dụ fail Job ngay với config error và bỏ qua một số disruption. Kiểm tra API support:

```bash
kubectl explain job.spec.podFailurePolicy
```

### 4.3 Restart không thay cho retry business

Job retry cả Pod không biết bước nghiệp vụ nào đã commit. Task phải ghi checkpoint/idempotency hoặc transaction ở data layer.

---

## 5. Deadline và timeout

`activeDeadlineSeconds` giới hạn thời gian active của toàn Job, tính qua các retries. Khi vượt deadline, Kubernetes dừng Pods và đánh dấu Job Failed.

Timeout bên trong task vẫn cần thiết:

```text
HTTP connect timeout < operation timeout < Job active deadline < pipeline timeout
```

Nếu command treo mà không có timeout, Job giữ tài nguyên đến deadline. Đặt timeout theo dependency và cleanup signal.

Xóa Job gửi termination tới Pods; task nên xử lý `SIGTERM` để checkpoint hoặc rollback phần chưa commit.

---

## 6. Indexed Job

```yaml
spec:
  completionMode: Indexed
  completions: 5
  parallelism: 2
```

Mỗi Pod nhận completion index, thường qua annotation/hostname và biến môi trường được hỗ trợ. Use case:

- Xử lý shard 0..N-1.
- Render từng partition.
- Chạy test matrix.

Index ổn định giúp ánh xạ work item, nhưng cùng index vẫn có thể attempt nhiều lần. Key idempotency nên bao gồm Job identity + index hoặc business partition ID.

Các phiên bản mới có thêm controls cho backoff theo index/success policy; luôn kiểm tra `kubectl explain job.spec --recursive` trên cluster mục tiêu.

---

## 7. Idempotency và xử lý chạy lặp

Giả sử Job gửi hóa đơn rồi Pod chết trước khi API status ghi success. Retry có thể gửi lần hai.

Thiết kế an toàn:

```text
business key: invoice-2026-0001
        │
        ▼
external API/idempotency table
        │
  first call commits
  repeated call returns same result
```

Các pattern:

- Unique constraint trong database.
- Idempotency key cho external API.
- Transactional outbox.
- Checkpoint sau từng partition.
- Atomic rename khi tạo file.
- Compare-and-set state transition.

Không dựa vào Pod name để deduplicate lâu dài; retry tạo Pod mới.

---

## 8. Cleanup Job

Completed Job và Pods hữu ích cho logs/debug nhưng tích lũy object. Dùng:

```yaml
spec:
  ttlSecondsAfterFinished: 3600
```

TTL controller xóa Job sau khi Complete/Failed và garbage collector xóa dependent Pods. Nếu cluster không hỗ trợ/enabled như mong muốn, cleanup bằng automation.

Đừng xóa evidence quá sớm. Trước cleanup, ship logs/metrics ra hệ thống bền vững và lưu result ở data store.

---

## 9. Thực hành

Tạo parallel Job:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: batch-demo
  namespace: job-lab
spec:
  completions: 6
  parallelism: 2
  backoffLimit: 2
  ttlSecondsAfterFinished: 600
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: worker
          image: busybox:1.36
          command:
            - sh
            - -c
            - |
              echo "pod=$HOSTNAME start=$(date -Iseconds)"
              sleep 3
              echo "pod=$HOSTNAME done=$(date -Iseconds)"
          resources:
            requests:
              cpu: 10m
              memory: 16Mi
            limits:
              memory: 32Mi
```

Apply và quan sát:

```bash
kubectl create namespace job-lab
kubectl apply -f job.yaml
kubectl get job,pods -n job-lab --watch
```

Terminal khác:

```bash
kubectl wait --for=condition=complete job/batch-demo \
  -n job-lab --timeout=180s
kubectl logs job/batch-demo -n job-lab --all-pods=true --prefix
kubectl describe job batch-demo -n job-lab
```

Thử sửa command thành `exit 2`, đổi tên Job rồi quan sát `backoffLimit` và Failed condition.

Cleanup:

```bash
kubectl delete namespace job-lab
```

---

## 10. Troubleshooting

### 10.1 Job không tạo Pod

```bash
kubectl describe job <job> -n <namespace>
kubectl get events -n <namespace> --sort-by=.metadata.creationTimestamp
```

Kiểm tra quota, admission, selector/template và controller.

### 10.2 Pod Pending

Kiểm tra resource requests, PVC, affinity, taints và quota.

### 10.3 Job retry liên tục

```bash
kubectl get pods -n <namespace> -l job-name=<job>
kubectl logs <failed-pod> -n <namespace>
kubectl describe pod <failed-pod> -n <namespace>
```

Đọc exit code, OOM, signal, config và dependency. Dừng Job nếu side effect không idempotent.

### 10.4 Job Complete nhưng kết quả thiếu

Exit code 0 chỉ là tín hiệu process. Task phải validate output/count/checksum và chỉ exit 0 khi business completion thật sự đạt.

### 10.5 Không còn logs

TTL/cleanup có thể đã xóa Pods. Central logging và result store phải tồn tại ngoài Job lifecycle.

---

## 11. Best practices

- Thiết kế task idempotent và retry-safe.
- Dùng `Never` khi cần phân tích từng attempt rõ.
- Đặt `backoffLimit`, `activeDeadlineSeconds` và internal timeouts.
- Chọn parallelism theo dependency capacity, không chỉ cluster capacity.
- Khai báo resources để batch không làm nghẽn workloads khác.
- Dùng Indexed Job cho partition cố định.
- Ship logs/results trước TTL cleanup.
- Phân biệt terminal error và transient error nếu API hỗ trợ policy.
- Xử lý `SIGTERM` và checkpoint an toàn.
- Không chạy long-running server bằng Job.

Tiếp tục với [CronJob](/workloads/cronjob/) để schedule Jobs định kỳ.

---

## Tài liệu tham khảo

- [Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/)
- [Automatic Cleanup for Finished Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/ttlafterfinished/)
- [Job Patterns](https://kubernetes.io/docs/concepts/workloads/controllers/job/#job-patterns)
