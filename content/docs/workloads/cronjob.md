---
title: "CronJob"
description: "Schedule Jobs định kỳ bằng CronJob; hiểu cron/timezone, missed schedules, concurrency policy, deadlines, idempotency và vận hành production."
---

# CronJob

## Mục lục

- [Tổng quan](#tổng-quan)
- [1. Quan hệ CronJob, Job và Pod](#1-quan-hệ-cronjob-job-và-pod)
- [2. Cron schedule và timezone](#2-cron-schedule-và-timezone)
- [3. Manifest production-minded](#3-manifest-production-minded)
- [4. Concurrency policy](#4-concurrency-policy)
- [5. Missed schedules và deadline](#5-missed-schedules-và-deadline)
- [6. History và cleanup](#6-history-và-cleanup)
- [7. Suspend và chạy thủ công](#7-suspend-và-chạy-thủ-công)
- [8. Idempotency và distributed scheduling](#8-idempotency-và-distributed-scheduling)
- [9. Thực hành](#9-thực-hành)
- [10. Troubleshooting](#10-troubleshooting)
- [11. Best practices](#11-best-practices)
- [Tài liệu tham khảo](#tài-liệu-tham-khảo)

---

## Tổng quan

CronJob tạo Job theo lịch. Job tạo Pods và theo dõi completion.

```text
CronJob report: "*/15 * * * *"
   ├── Job report-... → Pod → Complete
   ├── Job report-... → Pod → Complete
   └── Job report-... → Pod → Running
```

CronJob phù hợp với report định kỳ, backup orchestration, cleanup, đồng bộ dữ liệu và maintenance task.

> [!IMPORTANT]
> Scheduling của CronJob mang tính gần đúng trong hệ thống phân tán. Có trường hợp một lịch bị bỏ lỡ hoặc Job được tạo nhiều lần. Task phải idempotent và có monitoring cho cả **không chạy** lẫn **chạy thất bại**.

---

## 1. Quan hệ CronJob, Job và Pod

Ownership chain:

```text
CronJob → Job → Pod
```

CronJob controller chỉ quyết định khi nào tạo Job. Mọi semantics completion, retry, parallelism và Pod failure nằm trong `jobTemplate.spec`.

Vì vậy debug đi theo ba tầng:

```bash
kubectl describe cronjob <name> -n <namespace>
kubectl describe job <job> -n <namespace>
kubectl describe pod <pod> -n <namespace>
```

Sửa CronJob chỉ ảnh hưởng Jobs tạo trong tương lai; Jobs/Pods đã chạy giữ template cũ.

---

## 2. Cron schedule và timezone

CronJob dùng 5 trường:

```text
┌──────── minute (0-59)
│ ┌────── hour (0-23)
│ │ ┌──── day of month (1-31)
│ │ │ ┌── month (1-12)
│ │ │ │ ┌ day of week (0-6)
│ │ │ │ │
* * * * *
```

Ví dụ:

| Schedule | Ý nghĩa |
|---|---|
| `*/5 * * * *` | Mỗi 5 phút |
| `0 * * * *` | Đầu mỗi giờ |
| `30 2 * * *` | 02:30 mỗi ngày |
| `0 9 * * 1-5` | 09:00 từ thứ Hai đến thứ Sáu |

### 2.1 Timezone

Khai báo timezone bằng field chuyên dụng nếu cluster hỗ trợ:

```yaml
spec:
  schedule: "0 2 * * *"
  timeZone: "Asia/Ho_Chi_Minh"
```

Không nhét `TZ=` hoặc `CRON_TZ=` vào chuỗi schedule. Validate API:

```bash
kubectl explain cronjob.spec.timeZone
```

Timezone có daylight saving có thể tạo giờ lặp hoặc thiếu. Với workflow nhạy thời gian, lưu business window rõ, idempotency key theo kỳ và test DST. UTC thường đơn giản hơn cho hệ thống toàn cầu.

---

## 3. Manifest production-minded

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: report
  namespace: cron-lab
spec:
  schedule: "*/5 * * * *"
  timeZone: "Etc/UTC"
  concurrencyPolicy: Forbid
  startingDeadlineSeconds: 120
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 5
  jobTemplate:
    spec:
      backoffLimit: 2
      activeDeadlineSeconds: 240
      ttlSecondsAfterFinished: 3600
      template:
        metadata:
          labels:
            app: scheduled-report
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
                  echo "scheduled_at=$(date -Iseconds)"
                  sleep 10
                  echo "completed_at=$(date -Iseconds)"
              resources:
                requests:
                  cpu: 25m
                  memory: 16Mi
                limits:
                  memory: 32Mi
```

Các lớp timeout:

- `startingDeadlineSeconds`: được phép bắt đầu trễ bao lâu.
- `activeDeadlineSeconds`: một Job được active tối đa bao lâu.
- Timeout trong process: mỗi network/database operation.

---

## 4. Concurrency policy

`concurrencyPolicy` chỉ điều khiển Jobs của **cùng một CronJob**.

| Policy | Khi lịch mới đến nhưng Job cũ còn chạy |
|---|---|
| `Allow` | Tạo Job mới; chạy song song |
| `Forbid` | Bỏ qua lần chạy mới |
| `Replace` | Dừng Job cũ và tạo Job mới |

### 4.1 Chọn policy

- `Allow`: task độc lập, có thể overlap và dependency chịu được tải.
- `Forbid`: task không được overlap; chấp nhận bỏ một kỳ.
- `Replace`: kết quả mới làm kết quả cũ không còn giá trị và task xử lý termination tốt.

`Forbid` không phải distributed lock giữa hai CronJobs khác nhau hoặc một scheduler ngoài Kubernetes. Nếu singleton business action bắt buộc, dùng lock/lease/idempotency ở tầng data.

`Replace` có thể dừng task giữa transaction. App phải xử lý `SIGTERM` và dữ liệu partial.

---

## 5. Missed schedules và deadline

CronJob có thể miss schedule khi:

- Control Plane/controller downtime.
- CronJob bị suspend.
- Controller backlog hoặc API outage.
- `Forbid` chặn vì Job cũ chạy lâu.

`startingDeadlineSeconds` giới hạn độ trễ được chấp nhận. Nếu deadline quá nhỏ, jitter/control-plane delay có thể làm mất job. Nếu quá lớn, cluster phục hồi có thể chạy task đã hết giá trị.

Ví dụ report mỗi giờ:

```text
Scheduled 10:00
Controller recovers 10:07
startingDeadlineSeconds=300 → quá 5 phút → skip
```

Chọn deadline theo business semantics, không theo giá trị copy từ Internet.

Theo dõi `.status.lastScheduleTime` và `.status.lastSuccessfulTime` nếu API/version cung cấp, nhưng đừng chỉ dựa vào object còn tồn tại vì history/TTL có thể cleanup.

---

## 6. History và cleanup

```yaml
successfulJobsHistoryLimit: 3
failedJobsHistoryLimit: 5
```

History limits giới hạn số Jobs cũ CronJob giữ. `ttlSecondsAfterFinished` trên Job template có thể tiếp tục cleanup theo thời gian.

Trade-off:

- Giữ ít: giảm API objects, nhưng ít evidence tại cluster.
- Giữ nhiều: debug thuận tiện, nhưng tăng object/log metadata.

Central logs, metrics và result store phải giữ bằng chứng lâu dài. Không dùng completed Pods như hệ thống audit.

---

## 7. Suspend và chạy thủ công

Suspend lịch mới:

```bash
kubectl patch cronjob report -n cron-lab --type=merge \
  -p '{"spec":{"suspend":true}}'
```

Suspend không dừng Jobs đã active. Muốn dừng, phải xử lý Job riêng và đánh giá side effect.

Resume:

```bash
kubectl patch cronjob report -n cron-lab --type=merge \
  -p '{"spec":{"suspend":false}}'
```

Tạo một Job thủ công từ template:

```bash
kubectl create job --from=cronjob/report report-manual-001 -n cron-lab
```

Đây là cách tốt để smoke test template. Tên Job phải unique. Manual run có thể overlap schedule; cân nhắc suspend hoặc business lock.

---

## 8. Idempotency và distributed scheduling

Tạo idempotency key theo kỳ nghiệp vụ, ví dụ:

```text
job_type=daily-settlement
business_date=2026-04-15
```

Database unique constraint:

```sql
UNIQUE (job_type, business_date)
```

Nếu cùng kỳ chạy hai lần, attempt sau nhận biết đã xử lý thay vì tạo settlement trùng.

Các lưu ý:

- Dùng business time theo timezone đã chọn, không chỉ Pod start timestamp.
- Ghi trạng thái `started/completed/failed` có transaction rõ.
- Cho phép resume/checkpoint với task dài.
- Không giữ lock vô hạn khi Pod chết; dùng lease/expiry và fencing token nếu cần.
- Tách “scheduler đã tạo Job” khỏi “business task thành công”.

---

## 9. Thực hành

Apply manifest với schedule mỗi phút để quan sát nhanh:

```bash
kubectl create namespace cron-lab
kubectl apply -f cronjob.yaml
kubectl get cronjob -n cron-lab
kubectl get jobs,pods -n cron-lab --watch
```

Nếu file đang dùng `*/5`, đổi tạm thành `*/1` cho lab.

Xem lịch và Jobs:

```bash
kubectl describe cronjob report -n cron-lab
kubectl get jobs -n cron-lab \
  -o custom-columns='NAME:.metadata.name,START:.status.startTime,SUCCEEDED:.status.succeeded,FAILED:.status.failed'
kubectl logs -n cron-lab job/<job-name>
```

Chạy thủ công:

```bash
kubectl create job --from=cronjob/report report-manual-001 -n cron-lab
kubectl wait --for=condition=complete job/report-manual-001 \
  -n cron-lab --timeout=120s
kubectl logs job/report-manual-001 -n cron-lab
```

Suspend và xác minh không có Job mới:

```bash
kubectl patch cronjob report -n cron-lab --type=merge \
  -p '{"spec":{"suspend":true}}'
kubectl get cronjob report -n cron-lab
```

Cleanup:

```bash
kubectl delete namespace cron-lab
```

---

## 10. Troubleshooting

### 10.1 Không có Job mới

```bash
kubectl describe cronjob <name> -n <namespace>
kubectl get cronjob <name> -n <namespace> -o yaml
kubectl get events -n <namespace> --sort-by=.metadata.creationTimestamp
```

Kiểm tra schedule, timezone, `suspend`, deadline và `Forbid` với Job active.

### 10.2 Job tồn tại nhưng task không chạy

Đi xuống Job/Pod:

```bash
kubectl describe job <job> -n <namespace>
kubectl get pods -n <namespace> -l job-name=<job>
kubectl describe pod <pod> -n <namespace>
kubectl logs <pod> -n <namespace>
```

### 10.3 Task chạy trùng

Không chỉ đổi `Forbid`. Kiểm tra có CronJob thứ hai, manual run, retry Pod hoặc external scheduler. Bổ sung idempotency/lock ở business layer.

### 10.4 Job mới không dùng template vừa sửa

Jobs đã tạo là snapshots của template cũ. Xác minh timestamp/owner và chờ lần tạo tiếp hoặc manual run mới.

---

## 11. Best practices

- Khai báo `timeZone` rõ hoặc chuẩn hóa UTC.
- Chọn concurrency policy theo business semantics.
- Thiết kế task idempotent vì duplicate/missed schedule có thể xảy ra.
- Đặt starting deadline, Job active deadline và operation timeout.
- Monitor last success age, duration, failures và missed business windows.
- Ship logs/results trước cleanup.
- Dùng resource requests/limits và giới hạn parallelism.
- Test suspend/resume, manual run và controller downtime scenario.
- Không coi CronJob là scheduler chính xác tuyệt đối hoặc workflow engine đầy đủ.
- Với workflow nhiều bước/dependency phức tạp, cân nhắc workflow controller chuyên dụng.

Tiếp tục với [Garbage Collection và Workload Cleanup](/workloads/workload-cleanup/) để quản lý lifecycle resources sau khi workload kết thúc.

---

## Tài liệu tham khảo

- [CronJob](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/)
- [Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/)
- [Automatic Cleanup for Finished Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/ttlafterfinished/)
