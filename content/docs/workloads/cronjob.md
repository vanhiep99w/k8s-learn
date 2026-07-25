---
title: "CronJob"
description: "Hiểu Kubernetes CronJob từ ví dụ chạy mỗi phút: cách đọc cron schedule, chọn timezone, tạo Job theo lịch, tránh chạy chồng, xử lý lịch bị lỡ và kiểm tra lỗi."
---

# CronJob

## Mục lục

- [CronJob là gì?](#cronjob-là-gì)
- [Quan hệ giữa CronJob, Job và Pod](#quan-hệ-giữa-cronjob-job-và-pod)
- [Khi nào nên dùng CronJob?](#khi-nào-nên-dùng-cronjob)
- [Tạo CronJob đầu tiên](#tạo-cronjob-đầu-tiên)
- [Theo dõi một lần chạy](#theo-dõi-một-lần-chạy)
- [Cách đọc cron schedule](#cách-đọc-cron-schedule)
- [Chọn timezone](#chọn-timezone)
- [Đọc manifest CronJob](#đọc-manifest-cronjob)
- [Điều gì xảy ra khi lần chạy trước chưa xong?](#điều-gì-xảy-ra-khi-lần-chạy-trước-chưa-xong)
- [Lịch bị lỡ và startingDeadlineSeconds](#lịch-bị-lỡ-và-startingdeadlineseconds)
- [Tạm dừng và chạy lại CronJob](#tạm-dừng-và-chạy-lại-cronjob)
- [Chạy thủ công để kiểm tra](#chạy-thủ-công-để-kiểm-tra)
- [Giữ history và dọn Job cũ](#giữ-history-và-dọn-job-cũ)
- [Vì sao task phải idempotent?](#vì-sao-task-phải-idempotent)
- [Cập nhật CronJob](#cập-nhật-cronjob)
- [Thực hành hoàn chỉnh](#thực-hành-hoàn-chỉnh)
- [Troubleshooting](#troubleshooting)
- [Best practices](#best-practices)
- [Tóm tắt](#tóm-tắt)
- [Tài liệu tham khảo](#tài-liệu-tham-khảo)

---

## CronJob là gì?

`CronJob` là Kubernetes controller dùng để **tạo Job theo một lịch lặp lại**.

Ví dụ, bạn cần chạy một chương trình để:

- backup database lúc 02:00 mỗi ngày;
- tạo báo cáo vào đầu mỗi giờ;
- xóa dữ liệu tạm mỗi đêm;
- đồng bộ dữ liệu mỗi 15 phút;
- gửi email tổng hợp vào sáng thứ Hai;
- kiểm tra certificate sắp hết hạn mỗi ngày.

Bạn không cần tự tạo Job vào từng thời điểm. CronJob controller đọc lịch và tạo một Job mới khi đến giờ.

```text
CronJob: chạy mỗi ngày lúc 02:00
│
├── Thứ Hai 02:00  → Job A → Pod → Complete
├── Thứ Ba 02:00   → Job B → Pod → Complete
└── Thứ Tư 02:00   → Job C → Pod → Running
```

Điểm quan trọng nhất cần nhớ:

> **CronJob chỉ chịu trách nhiệm tạo Job theo lịch. Job mới là controller tạo Pod, retry khi lỗi và quyết định task đã hoàn thành hay chưa.**

CronJob trong Kubernetes tương tự một dòng trong `crontab` trên Linux, nhưng command không chạy trực tiếp trên máy control plane. Mỗi lần đến lịch, Kubernetes tạo một Job và Job đó tạo Pod để chạy command trong cluster.

## Quan hệ giữa CronJob, Job và Pod

Ba resource tạo thành chuỗi ownership:

```text
CronJob
└── Job của lần chạy 10:00
    └── Pod
        └── Container chạy task
```

Mỗi tầng có một trách nhiệm riêng:

| Tầng | Trách nhiệm |
|---|---|
| CronJob | Khi nào cần tạo một lần chạy mới? |
| Job | Cần bao nhiêu lần thành công, retry thế nào và deadline bao lâu? |
| Pod | Chạy image, command, volume, environment variable và resource nào? |
| Container | Thực hiện logic nghiệp vụ và trả exit code |

Ví dụ CronJob chạy mỗi giờ:

```text
09:00 → CronJob tạo Job report-09h → Job tạo Pod → task exit 0
10:00 → CronJob tạo Job report-10h → Job tạo Pod → task exit 0
11:00 → CronJob tạo Job report-11h → Job tạo Pod → task exit 1
                                          │
                                          └── Job xử lý retry
```

CronJob không trực tiếp retry container. Cấu hình retry nằm trong `spec.jobTemplate.spec`, tức phần Job template.

Vì vậy, khi debug cần đi từ ngoài vào trong:

```text
CronJob có tạo Job đúng lịch không?
└── Job có tạo Pod và đạt completion không?
    └── Container có chạy command thành công không?
```

Các command tương ứng:

```bash
kubectl describe cronjob <cronjob-name> -n <namespace>
kubectl describe job <job-name> -n <namespace>
kubectl describe pod <pod-name> -n <namespace>
kubectl logs <pod-name> -n <namespace>
```

Nếu chưa hiểu cách Job hoàn thành, retry và quản lý Pod, hãy đọc [Job](/workloads/job/) trước.

## Khi nào nên dùng CronJob?

CronJob phù hợp khi task có hai đặc điểm:

1. Task chạy đến khi hoàn thành rồi dừng.
2. Task cần bắt đầu theo một lịch lặp lại.

Chọn controller bằng mental model sau:

```text
Process cần chạy liên tục?
├── Có → Deployment hoặc controller chạy lâu dài khác
└── Không
    ├── Chỉ chạy một lần → Job
    └── Chạy lặp theo lịch → CronJob
```

CronJob không phải lựa chọn tốt cho mọi bài toán liên quan đến thời gian.

| Nhu cầu | Có nên dùng CronJob? | Lý do |
|---|---|---|
| Backup mỗi đêm | Có | Task hữu hạn và có lịch rõ |
| API phải luôn sẵn sàng | Không | Process cần chạy liên tục; dùng Deployment |
| Task chỉ chạy một lần khi deploy | Thường dùng Job | Không cần lịch lặp |
| Workflow gồm nhiều bước phụ thuộc phức tạp | Có thể không | CronJob không phải workflow engine đầy đủ |
| Chạy chính xác đến từng giây | Không | CronJob scheduling mang tính gần đúng |
| Consumer xử lý message ngay khi queue có dữ liệu | Thường không | Worker chạy liên tục hoặc event-driven phù hợp hơn |

## Tạo CronJob đầu tiên

Ví dụ đầu tiên tạo một Job mỗi phút. Mỗi Job in thời gian hiện tại rồi kết thúc. Lịch mỗi phút chỉ dùng để quan sát nhanh trong lab; production thường dùng lịch thưa hơn.

### Điều kiện trước khi bắt đầu

Bạn cần:

- một Kubernetes cluster đang hoạt động;
- `kubectl` đã kết nối tới cluster;
- quyền tạo Namespace, CronJob, Job và Pod.

Kiểm tra context:

```bash
kubectl config current-context
kubectl get nodes
```

> [!WARNING]
> Các lệnh trong bài tạo và xóa Namespace. Không chạy trên cluster dùng chung hoặc production nếu chưa kiểm tra đúng context.

### Tạo manifest

Lưu nội dung sau vào file `cronjob.yaml`:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: hello-cron
  namespace: cron-lab
spec:
  schedule: "* * * * *"
  timeZone: "Etc/UTC"
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: hello
              image: busybox:1.36
              command:
                - sh
                - -c
                - |
                  echo "CronJob chạy lúc $(date -Iseconds)"
                  echo "Tên Pod là $HOSTNAME"
```

Tạo Namespace, kiểm tra manifest ở API Server rồi apply:

```bash
kubectl create namespace cron-lab
kubectl apply --dry-run=server -f cronjob.yaml
kubectl apply -f cronjob.yaml
```

Kết quả tạo object:

```text
cronjob.batch/hello-cron created
```

Lúc này CronJob đã tồn tại, nhưng Job đầu tiên có thể chưa được tạo. Controller phải chờ đến mốc phút tiếp theo theo schedule.

## Theo dõi một lần chạy

Xem CronJob:

```bash
kubectl get cronjob hello-cron -n cron-lab
```

Output minh họa ngay sau khi tạo:

```text
NAME         SCHEDULE    TIMEZONE   SUSPEND   ACTIVE   LAST SCHEDULE   AGE
hello-cron   * * * * *   Etc/UTC    False     0        <none>          10s
```

Cách đọc các cột chính:

- `SCHEDULE`: chuỗi lịch đã cấu hình.
- `TIMEZONE`: múi giờ dùng để hiểu lịch.
- `SUSPEND`: `False` nghĩa là lịch đang hoạt động.
- `ACTIVE`: số Job của CronJob hiện vẫn đang chạy.
- `LAST SCHEDULE`: lần gần nhất controller tạo Job theo lịch.

Tên và số cột có thể khác theo phiên bản `kubectl`.

### Chờ Job được tạo

Mở watch:

```bash
kubectl get cronjob,jobs,pods -n cron-lab --watch
```

Sau mốc phút tiếp theo, bạn sẽ thấy:

```text
CronJob hello-cron
└── Job hello-cron-<suffix>
    └── Pod hello-cron-<suffix>-<suffix>
```

Job name khác Pod name. Không nên đoán tên đầy đủ vì Kubernetes tự thêm suffix.

Liệt kê Job theo thời gian tạo:

```bash
kubectl get jobs -n cron-lab \
  --sort-by=.metadata.creationTimestamp
```

Xem ownership của từng Job:

```bash
kubectl get jobs -n cron-lab \
  -o custom-columns='JOB:.metadata.name,OWNER_KIND:.metadata.ownerReferences[0].kind,OWNER:.metadata.ownerReferences[0].name,SUCCEEDED:.status.succeeded'
```

Bạn sẽ thấy owner của Job là `CronJob/hello-cron`.

### Xem logs của lần chạy gần nhất

Trong Namespace lab chỉ có Job của ví dụ, có thể lấy Job mới nhất như sau:

```bash
JOB="$(kubectl get jobs -n cron-lab \
  --sort-by=.metadata.creationTimestamp \
  -o name | tail -n 1)"

echo "$JOB"
kubectl logs "$JOB" -n cron-lab
```

Output có dạng:

```text
CronJob chạy lúc 2026-04-15T10:30:00+00:00
Tên Pod là hello-cron-...
```

Đây là output minh họa; timestamp và tên Pod thực tế sẽ khác.

## Cách đọc cron schedule

Field `spec.schedule` dùng cron expression gồm năm vị trí:

```text
┌──────────── phút        0-59
│ ┌────────── giờ         0-23
│ │ ┌──────── ngày/tháng  1-31
│ │ │ ┌────── tháng       1-12
│ │ │ │ ┌──── thứ         0-6, Chủ nhật là 0
│ │ │ │ │
* * * * *
```

Đọc từ trái sang phải: **phút → giờ → ngày trong tháng → tháng → thứ trong tuần**.

### Ý nghĩa của các ký hiệu thường gặp

| Ký hiệu | Ý nghĩa | Ví dụ |
|---|---|---|
| `*` | Mọi giá trị hợp lệ | `* * * * *` là mỗi phút |
| `,` | Liệt kê nhiều giá trị | `0 8,17 * * *` là 08:00 và 17:00 |
| `-` | Một khoảng liên tục | `0 9 * * 1-5` là 09:00 từ thứ Hai đến thứ Sáu |
| `/` | Bước nhảy | `*/15 * * * *` là mỗi 15 phút |

### Đọc từng ví dụ

| Schedule | Cách đọc |
|---|---|
| `* * * * *` | Mỗi phút |
| `*/5 * * * *` | Mỗi 5 phút |
| `0 * * * *` | Phút 0 của mỗi giờ |
| `30 2 * * *` | 02:30 mỗi ngày |
| `0 9 * * 1-5` | 09:00 từ thứ Hai đến thứ Sáu |
| `0 0 1 * *` | 00:00 ngày đầu tiên mỗi tháng |
| `0 3 * * 1` | 03:00 mỗi thứ Hai |

Ví dụ `30 2 * * *`:

```text
30  → phút 30
2   → giờ 2
*   → mọi ngày trong tháng
*   → mọi tháng
*   → mọi thứ

Kết quả: 02:30 mỗi ngày
```

### Macro có sẵn

Kubernetes cũng hỗ trợ một số macro dễ đọc:

| Macro | Tương đương | Ý nghĩa |
|---|---|---|
| `@hourly` | `0 * * * *` | Đầu mỗi giờ |
| `@daily` hoặc `@midnight` | `0 0 * * *` | 00:00 mỗi ngày |
| `@weekly` | `0 0 * * 0` | 00:00 sáng Chủ nhật |
| `@monthly` | `0 0 1 * *` | 00:00 ngày đầu tháng |
| `@yearly` hoặc `@annually` | `0 0 1 1 *` | 00:00 ngày 1 tháng 1 |

CronJob dùng lịch theo phút, không có trường giây. Nếu cần chạy chính xác đến từng giây hoặc độ trễ cực thấp, CronJob không phù hợp.

> [!TIP]
> Khi review schedule, luôn viết lại thành câu đầy đủ kèm timezone, ví dụ: “Chạy lúc 02:30 mỗi ngày theo `Asia/Ho_Chi_Minh`”. Cách này dễ phát hiện lỗi hơn việc chỉ nhìn chuỗi `30 2 * * *`.

## Chọn timezone

Một schedule chỉ có giờ và phút nhưng chưa nói rõ múi giờ. `30 2 * * *` có thể là 02:30 UTC hoặc 02:30 tại Việt Nam tùy cấu hình.

Khai báo rõ bằng `spec.timeZone`:

```yaml
spec:
  schedule: "30 2 * * *"
  timeZone: "Asia/Ho_Chi_Minh"
```

Khi đó task chạy lúc 02:30 theo giờ Việt Nam.

Nếu muốn chuẩn hóa UTC:

```yaml
spec:
  schedule: "30 2 * * *"
  timeZone: "Etc/UTC"
```

Nếu không đặt `timeZone`, kube-controller-manager hiểu schedule theo timezone local của chính nó. Behavior đó dễ gây nhầm khi chuyển cluster hoặc thay cấu hình control plane, vì vậy nên khai báo timezone rõ.

`spec.timeZone` ổn định từ Kubernetes v1.27. Kiểm tra cluster mục tiêu:

```bash
kubectl version
kubectl explain cronjob.spec.timeZone
```

Không viết timezone vào chuỗi schedule theo dạng sau:

```yaml
# Sai: Kubernetes không hỗ trợ TZ hoặc CRON_TZ trong schedule.
schedule: "CRON_TZ=Asia/Ho_Chi_Minh 30 2 * * *"
```

API Server sẽ từ chối cách cấu hình đó. Hãy dùng field `timeZone` riêng.

### Timezone và daylight saving time

`Asia/Ho_Chi_Minh` hiện không dùng daylight saving time, nhưng nhiều timezone khác có đổi đồng hồ theo mùa. Khi đồng hồ nhảy tới hoặc lùi lại, một giờ local có thể không tồn tại hoặc xuất hiện hai lần.

Với task nhạy cảm như settlement hoặc billing:

- xác định business date theo timezone nào;
- tạo idempotency key theo kỳ nghiệp vụ;
- test thời điểm chuyển daylight saving time;
- cân nhắc UTC nếu nghiệp vụ không bắt buộc theo giờ địa phương.

## Đọc manifest CronJob

CronJob có hai phần cốt lõi:

```text
spec.schedule     → khi nào tạo Job?
spec.jobTemplate  → Job mới sẽ chạy như thế nào?
```

Manifest rút gọn:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: hello-cron
spec:
  schedule: "* * * * *"
  timeZone: "Etc/UTC"
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: hello
              image: busybox:1.36
              command:
                - sh
                - -c
                - echo "hello"
```

### `spec.schedule`

Đây là cron expression bắt buộc. Controller dựa vào nó để tính các thời điểm cần tạo Job.

```yaml
schedule: "0 3 * * *"
```

Dòng trên có nghĩa 03:00 mỗi ngày theo `timeZone` đã chọn.

### `spec.jobTemplate`

`jobTemplate` là bản mẫu của các Job trong tương lai:

```yaml
jobTemplate:
  spec:
    backoffLimit: 2
    template:
      spec:
        restartPolicy: Never
        containers:
          - name: task
            image: example.com/task:1.0.0
```

Hãy đọc theo từng lớp:

```text
CronJob spec
└── jobTemplate.spec              # cấu hình của Job
    ├── backoffLimit              # Job retry thế nào
    └── template.spec             # cấu hình của Pod
        ├── restartPolicy
        └── containers
```

Sự lồng nhau dài vì CronJob chứa Job template, còn Job template lại chứa Pod template.

### Phân biệt các field dễ đặt sai tầng

```yaml
spec:
  schedule: "0 3 * * *"              # CronJob
  concurrencyPolicy: Forbid           # CronJob
  startingDeadlineSeconds: 300        # CronJob
  successfulJobsHistoryLimit: 3       # CronJob
  jobTemplate:
    spec:
      backoffLimit: 2                 # Job
      activeDeadlineSeconds: 600      # Job
      ttlSecondsAfterFinished: 3600   # Job
      template:
        spec:
          restartPolicy: Never        # Pod
          containers:                 # Pod
            - name: task
              image: example.com/task:1.0.0
```

Có thể nhớ:

- CronJob field điều khiển **lịch và quan hệ giữa các lần chạy**.
- Job field điều khiển **completion, retry và thời gian của một lần chạy**.
- Pod field điều khiển **container thực tế**.

## Điều gì xảy ra khi lần chạy trước chưa xong?

Giả sử CronJob chạy mỗi 5 phút nhưng một Job cần 8 phút. Đến phút thứ 5, Job cũ vẫn còn chạy. Field `concurrencyPolicy` quyết định xử lý tình huống này.

```yaml
spec:
  concurrencyPolicy: Forbid
```

CronJob hỗ trợ ba giá trị:

| Policy | Khi lịch mới đến nhưng Job cũ còn chạy |
|---|---|
| `Allow` | Tạo Job mới để chạy song song; đây là mặc định |
| `Forbid` | Không tạo lần chạy mới tại thời điểm đó |
| `Replace` | Dừng/thay Job cũ bằng một Job mới |

Policy chỉ áp dụng giữa các Job do **cùng một CronJob** tạo ra. Nó không ngăn Job từ CronJob khác hoặc Job chạy thủ công hoạt động đồng thời.

### `Allow`: cho phép chạy chồng

```text
10:00 → Job A bắt đầu ─────────────── xong 10:08
10:05 →      Job B bắt đầu ─────────────── xong 10:13
10:10 →           Job C bắt đầu ─────────────── xong 10:18
```

Dùng khi:

- mỗi lần chạy độc lập;
- task chịu được concurrency;
- database, API và storage đủ capacity;
- chạy chồng không tạo dữ liệu trùng hoặc lock conflict.

Rủi ro là số Job active có thể tăng nếu task chậm hơn tần suất schedule.

### `Forbid`: không chạy chồng

```text
10:00 → Job A bắt đầu ─────────────── xong 10:08
10:05 → lần chạy bị bỏ qua vì Job A còn active
10:10 → Job B bắt đầu
```

Dùng khi task không được overlap, ví dụ một script maintenance chỉ cho phép một phiên chạy.

`Forbid` không tạo queue để đảm bảo mọi kỳ đều được chạy lần lượt. Một thời điểm schedule có thể bị bỏ qua và được tính là missed schedule. Tùy `startingDeadlineSeconds`, controller có thể còn cơ hội tạo Job trễ sau khi Job cũ hoàn thành.

### `Replace`: ưu tiên lần chạy mới

```text
10:00 → Job A bắt đầu ───── bị dừng lúc 10:05
10:05 → Job B bắt đầu ───── bị dừng lúc 10:10
10:10 → Job C bắt đầu ...
```

Dùng khi kết quả mới làm kết quả cũ không còn giá trị, ví dụ task liên tục tính snapshot mới nhất.

`Replace` có thể dừng task giữa lúc đang ghi dữ liệu. Ứng dụng phải xử lý `SIGTERM`, transaction dang dở, file tạm và checkpoint. Không chọn `Replace` chỉ để che việc task chạy quá chậm.

### Cách chọn policy

```text
Hai lần chạy có thể an toàn cùng tồn tại?
├── Có → Allow
└── Không
    ├── Muốn lần cũ chạy xong, chấp nhận bỏ/trễ kỳ mới → Forbid
    └── Kết quả mới quan trọng hơn kết quả cũ → Replace
```

Nếu nghiệp vụ bắt buộc singleton trên toàn hệ thống, `Forbid` chưa đủ. Bạn vẫn cần idempotency hoặc distributed lock ở tầng dữ liệu vì có thể tồn tại CronJob thứ hai, manual Job hoặc scheduler bên ngoài.

## Lịch bị lỡ và `startingDeadlineSeconds`

CronJob không phải lúc nào cũng tạo Job đúng ngay thời điểm trong schedule. Một lần chạy có thể bị trễ vì:

- CronJob controller hoặc control plane tạm ngừng;
- API Server không khả dụng;
- CronJob đang `suspend`;
- `concurrencyPolicy: Forbid` chặn do Job cũ còn chạy;
- controller đang xử lý backlog;
- clock của hệ thống có vấn đề.

`startingDeadlineSeconds` trả lời câu hỏi:

> **Nếu đã qua thời điểm trong lịch, Job còn giá trị nếu bắt đầu trễ tối đa bao lâu?**

Ví dụ:

```yaml
spec:
  schedule: "0 * * * *"
  startingDeadlineSeconds: 300
```

CronJob chạy đầu mỗi giờ và cho phép bắt đầu trễ tối đa 300 giây, tức 5 phút.

```text
Lịch dự kiến:      10:00
Controller trở lại: 10:03  → còn trong 5 phút → có thể tạo Job
Controller trở lại: 10:07  → đã quá 5 phút   → bỏ qua lần 10:00
```

Lần 10:00 bị bỏ không làm mất các lịch tương lai. CronJob vẫn có thể tiếp tục xử lý lần 11:00.

### Đừng nhầm với `activeDeadlineSeconds`

Hai field có tên gần giống nhưng giải quyết hai giai đoạn khác nhau:

| Field | Nằm ở đâu? | Giới hạn điều gì? |
|---|---|---|
| `startingDeadlineSeconds` | `CronJob.spec` | Một Job được phép **bắt đầu trễ** bao lâu so với schedule |
| `activeDeadlineSeconds` | `CronJob.spec.jobTemplate.spec` | Một Job sau khi bắt đầu được **active tối đa** bao lâu |

Ví dụ:

```yaml
spec:
  startingDeadlineSeconds: 300
  jobTemplate:
    spec:
      activeDeadlineSeconds: 1800
```

- Nếu trễ hơn 5 phút, bỏ qua lần chạy.
- Nếu đã bắt đầu, Job được active tối đa 30 phút.

Ứng dụng vẫn cần timeout cho từng request database hoặc API; hai deadline trên không thay thế timeout bên trong process.

### Không đặt deadline quá nhỏ

CronJob controller thường kiểm tra lịch theo chu kỳ khoảng 10 giây. Official documentation cảnh báo `startingDeadlineSeconds` nhỏ hơn 10 giây có thể khiến CronJob không được schedule như mong muốn.

Chọn deadline theo giá trị nghiệp vụ:

- Backup hằng ngày có thể vẫn hữu ích nếu trễ một giờ.
- Report theo khung giờ có thể vô nghĩa nếu trễ sang kỳ tiếp theo.
- Cleanup có thể chấp nhận chạy muộn nhưng cần giới hạn để tránh dồn nhiều lần chạy.

Không copy một giá trị cố định cho mọi CronJob.

### Quá nhiều lịch bị lỡ

CronJob controller không cố catch up vô hạn. Nếu phát hiện hơn 100 missed schedules trong khoảng nó kiểm tra, controller không khởi động catch-up Job và ghi lỗi tương tự:

```text
too many missed start times. Set or decrease .spec.startingDeadlineSeconds or check clock skew
```

Điều này không nhất thiết có nghĩa CronJob bị hỏng vĩnh viễn; các schedule tương lai vẫn có thể tiếp tục. Hãy kiểm tra thời gian suspend, controller downtime, clock skew, tần suất schedule và `startingDeadlineSeconds`.

## Tạm dừng và chạy lại CronJob

Đặt `spec.suspend: true` để ngăn CronJob tạo Job mới theo lịch:

```bash
kubectl patch cronjob hello-cron -n cron-lab --type=merge \
  -p '{"spec":{"suspend":true}}'
```

Xác minh:

```bash
kubectl get cronjob hello-cron -n cron-lab
```

Cột `SUSPEND` phải chuyển thành `True`.

Suspend chỉ ảnh hưởng đến những lần chạy trong tương lai. Nó **không dừng Job đang active**:

```text
Job A đang chạy
      │
      ├── suspend CronJob
      │
      └── Job A vẫn tiếp tục; CronJob không tạo Job theo lịch mới
```

Muốn dừng Job đang chạy, phải xử lý Job riêng và đánh giá tác động nghiệp vụ trước khi xóa.

Resume CronJob:

```bash
kubectl patch cronjob hello-cron -n cron-lab --type=merge \
  -p '{"spec":{"suspend":false}}'
```

> [!CAUTION]
> Các lịch đi qua trong thời gian suspend được tính là missed schedules. Nếu resume một CronJob không có `startingDeadlineSeconds`, controller có thể tạo các Job bị lỡ ngay lập tức. Với CronJob tần suất cao, hãy đánh giá backlog trước khi resume.

Trước khi resume sau thời gian dài:

1. Kiểm tra `schedule` và CronJob đã bị suspend bao lâu.
2. Xác định các kỳ cũ còn giá trị nghiệp vụ không.
3. Đặt `startingDeadlineSeconds` phù hợp nếu không muốn catch up quá xa.
4. Kiểm tra `concurrencyPolicy` và capacity của dependency.
5. Resume rồi theo dõi số Job active.

## Chạy thủ công để kiểm tra

Không cần chờ đến lịch để test Job template. Tạo một Job thủ công từ CronJob:

```bash
kubectl create job \
  --from=cronjob/hello-cron \
  hello-cron-manual-001 \
  -n cron-lab
```

Chờ Job hoàn thành và xem logs:

```bash
kubectl wait --for=condition=complete \
  job/hello-cron-manual-001 \
  -n cron-lab --timeout=120s

kubectl logs job/hello-cron-manual-001 -n cron-lab
```

Đây là cách hữu ích để:

- smoke test image và command;
- kiểm tra ConfigMap, Secret, volume và ServiceAccount;
- chạy lại một kỳ nghiệp vụ có kiểm soát;
- xác nhận template mới trước lần schedule tiếp theo.

Manual Job không còn được CronJob quản lý như một lần chạy theo lịch. `concurrencyPolicy` của CronJob cũng không ngăn manual Job chạy chồng với Job do schedule tạo. Nếu overlap nguy hiểm, hãy suspend CronJob hoặc dùng lock/idempotency ở tầng nghiệp vụ.

Tên manual Job phải unique. Nếu tên đã tồn tại, dùng tên khác hoặc xóa Job cũ sau khi lưu evidence cần thiết.

## Giữ history và dọn Job cũ

Mỗi lần chạy tạo một Job và ít nhất một Pod. Nếu CronJob chạy thường xuyên, số object cũ sẽ tăng nhanh.

Hai field của CronJob giới hạn số Job đã kết thúc cần giữ:

```yaml
spec:
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 1
```

Giá trị mặc định là:

- giữ 3 Job thành công gần nhất;
- giữ 1 Job thất bại gần nhất.

Đặt `0` nếu không muốn giữ loại history đó:

```yaml
spec:
  successfulJobsHistoryLimit: 0
  failedJobsHistoryLimit: 0
```

Tuy nhiên, xóa history quá sớm làm troubleshooting khó hơn.

### History limit khác TTL như thế nào?

Bạn cũng có thể đặt TTL trong Job template:

```yaml
spec:
  jobTemplate:
    spec:
      ttlSecondsAfterFinished: 3600
```

Hai cơ chế trả lời hai câu hỏi khác nhau:

| Cơ chế | Câu hỏi |
|---|---|
| `successfulJobsHistoryLimit` / `failedJobsHistoryLimit` | Giữ tối đa bao nhiêu Job cũ của CronJob? |
| `ttlSecondsAfterFinished` | Một Job đã kết thúc được giữ khoảng bao lâu? |

Có thể dùng cả hai. Job cũ sẽ bị dọn khi một trong các cơ chế làm nó đủ điều kiện bị xóa.

Completed Job và Pod không phải nơi lưu audit lâu dài. Trước khi cleanup, hãy gửi:

- logs tới hệ thống log tập trung;
- duration, success/failure và số item xử lý tới monitoring;
- report hoặc output tới storage bền vững;
- trạng thái nghiệp vụ tới database.

## Vì sao task phải idempotent?

CronJob scheduling mang tính gần đúng trong hệ thống phân tán. Trong một số tình huống, một thời điểm schedule có thể tạo hai Job hoặc không tạo Job nào. Ngoài ra, Job bên dưới còn có thể retry Pod.

Ví dụ task tạo settlement hằng ngày:

```text
Kỳ nghiệp vụ: 2026-04-15

Job A → tạo settlement thành công nhưng mất phản hồi
Job B → retry hoặc duplicate run
      → cố tạo lại settlement cho cùng ngày
```

Nếu không có chống trùng, cùng một kỳ có thể bị xử lý hai lần.

Thiết kế idempotency key theo kỳ nghiệp vụ:

```text
job_type=daily-settlement
business_date=2026-04-15
timezone=Asia/Ho_Chi_Minh
```

Database có thể dùng unique constraint:

```sql
UNIQUE (job_type, business_date)
```

Lần chạy sau kiểm tra record đã tồn tại và tiếp tục, trả kết quả cũ hoặc dừng an toàn thay vì tạo settlement thứ hai.

Một số pattern khác:

- idempotency key cho external API;
- transaction khi claim work item;
- checkpoint để resume task dài;
- transactional outbox khi ghi database rồi phát event;
- distributed lock có lease/expiry và fencing token khi thật sự cần singleton;
- atomic rename khi tạo file output.

Không dùng Pod start time làm business date nếu CronJob có thể chạy trễ. Hãy tính kỳ nghiệp vụ từ schedule dự kiến và timezone đã chọn.

Từ Kubernetes v1.32, Job do CronJob tạo có annotation `batch.kubernetes.io/cronjob-scheduled-timestamp` chứa thời điểm dự kiến ban đầu theo RFC3339. Nếu ứng dụng phụ thuộc vào annotation này, hãy kiểm tra phiên bản cluster và truyền giá trị vào container bằng cơ chế phù hợp; không giả định mọi cluster đều có.

> [!IMPORTANT]
> `concurrencyPolicy: Forbid` giảm overlap giữa các Job của cùng một CronJob, nhưng không thay thế idempotency.

## Cập nhật CronJob

Khi sửa CronJob, template mới chỉ áp dụng cho **Job được tạo sau thay đổi**.

```text
Job A đã chạy từ template v1 ───────── tiếp tục dùng v1
                  │
                  └── cập nhật CronJob thành template v2
                                      │
                                      └── Job B tạo sau đó dùng v2
```

CronJob không update Job hoặc Pod đã tồn tại.

Sau khi apply thay đổi:

```bash
kubectl apply -f cronjob.yaml
kubectl get cronjob hello-cron -n cron-lab -o yaml
```

Có hai cách xác minh template mới:

1. Chờ schedule tiếp theo và kiểm tra Job mới.
2. Tạo manual Job mới bằng `kubectl create job --from=cronjob/...`.

Nếu rollback manifest CronJob, các Job đã tạo từ template lỗi vẫn không tự đổi lại. Bạn phải xử lý chúng riêng, sau đó sửa source of truth để hệ thống GitOps không đưa cấu hình lỗi trở lại.

## Thực hành hoàn chỉnh

Lab này tạo CronJob chạy mỗi phút, không cho hai Job của cùng CronJob chạy chồng và giữ history đủ để xem kết quả.

### 1. Tạo manifest

Lưu file `scheduled-report.yaml`:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: scheduled-report
  namespace: cron-lab
spec:
  schedule: "* * * * *"
  timeZone: "Etc/UTC"
  concurrencyPolicy: Forbid
  startingDeadlineSeconds: 30
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 2
  jobTemplate:
    spec:
      backoffLimit: 2
      activeDeadlineSeconds: 120
      ttlSecondsAfterFinished: 600
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
                  echo "Bắt đầu report lúc $(date -Iseconds)"
                  sleep 10
                  echo "Report hoàn thành lúc $(date -Iseconds)"
              resources:
                requests:
                  cpu: 10m
                  memory: 16Mi
                limits:
                  memory: 32Mi
```

Cách đọc các field:

| Field | Ý nghĩa trong lab |
|---|---|
| `schedule: "* * * * *"` | Tạo một lần chạy mỗi phút |
| `timeZone: "Etc/UTC"` | Đọc schedule theo UTC |
| `concurrencyPolicy: Forbid` | Không chạy chồng hai Job của cùng CronJob |
| `startingDeadlineSeconds: 30` | Nếu trễ hơn 30 giây thì bỏ lần chạy đó |
| `backoffLimit: 2` | Một Job không retry vô hạn |
| `activeDeadlineSeconds: 120` | Một Job được active tối đa hai phút |
| `ttlSecondsAfterFinished: 600` | Giữ Job khoảng mười phút để xem logs |

### 2. Kiểm tra và apply

Nếu Namespace chưa tồn tại:

```bash
kubectl get namespace cron-lab >/dev/null 2>&1 || \
  kubectl create namespace cron-lab
```

Kiểm tra manifest trên API Server:

```bash
kubectl apply --dry-run=server -f scheduled-report.yaml
kubectl apply -f scheduled-report.yaml
```

Xem cấu hình:

```bash
kubectl get cronjob scheduled-report -n cron-lab
kubectl describe cronjob scheduled-report -n cron-lab
```

### 3. Quan sát CronJob tạo Job và Pod

```bash
kubectl get cronjob,jobs,pods -n cron-lab --watch
```

Chờ qua mốc phút tiếp theo. Một lần chạy thành công có luồng:

```text
scheduled-report
└── scheduled-report-<timestamp-suffix>    Job
    └── scheduled-report-...-<suffix>      Pod
```

Ở terminal khác, xem Jobs theo thứ tự tạo:

```bash
kubectl get jobs -n cron-lab \
  --sort-by=.metadata.creationTimestamp
```

### 4. Kiểm tra lần chạy gần nhất

```bash
JOB="$(kubectl get jobs -n cron-lab \
  --sort-by=.metadata.creationTimestamp \
  -o name | tail -n 1)"

echo "$JOB"
kubectl describe "$JOB" -n cron-lab
kubectl logs "$JOB" -n cron-lab
```

Một Job thành công phải có completion `1/1`. Logs phải có cả dòng bắt đầu và hoàn thành.

Xem Pod của Job bằng label chuẩn của Job:

```bash
JOB_NAME="${JOB#job.batch/}"

kubectl get pods -n cron-lab \
  -l batch.kubernetes.io/job-name="$JOB_NAME"
```

### 5. Test manual run

Manual run giúp kiểm tra template mà không chờ một phút:

```bash
kubectl create job \
  --from=cronjob/scheduled-report \
  scheduled-report-manual-001 \
  -n cron-lab

kubectl wait --for=condition=complete \
  job/scheduled-report-manual-001 \
  -n cron-lab --timeout=120s

kubectl logs job/scheduled-report-manual-001 -n cron-lab
```

Nhớ rằng manual Job có thể chạy chồng với lần schedule bình thường.

### 6. Test suspend và resume

Suspend:

```bash
kubectl patch cronjob scheduled-report -n cron-lab \
  --type=merge -p '{"spec":{"suspend":true}}'

kubectl get cronjob scheduled-report -n cron-lab
```

Chờ qua một mốc phút và xác minh không có Job theo lịch mới. Sau đó resume:

```bash
kubectl patch cronjob scheduled-report -n cron-lab \
  --type=merge -p '{"spec":{"suspend":false}}'
```

Lab đã đặt `startingDeadlineSeconds: 30`, nên những kỳ quá cũ không được catch up vô hạn.

### 7. Cleanup

Kiểm tra context rồi xóa Namespace lab:

```bash
kubectl config current-context
kubectl delete namespace cron-lab
```

Xóa Namespace sẽ xóa CronJob, Jobs và Pods trong lab.

## Troubleshooting

Debug theo chuỗi `CronJob → Job → Pod → container`. Đầu tiên xác định tầng nào không tạo được resource tiếp theo.

```text
Không thấy kết quả?
├── Không có Job → kiểm tra CronJob, schedule, timezone, suspend, deadline
└── Có Job
    ├── Không có Pod → kiểm tra Job Events, quota, admission
    └── Có Pod
        ├── Pending → kiểm tra scheduling, image, volume
        ├── Failed → kiểm tra exit code và logs
        └── Succeeded → kiểm tra output nghiệp vụ
```

### CronJob không tạo Job

```bash
kubectl get cronjob <name> -n <namespace> -o yaml
kubectl describe cronjob <name> -n <namespace>
kubectl get events -n <namespace> \
  --sort-by=.metadata.creationTimestamp
```

Kiểm tra theo thứ tự:

1. `spec.suspend` có đang là `true` không?
2. `schedule` có đúng năm trường và đúng thời điểm mong đợi không?
3. `timeZone` có đúng không?
4. Đã qua mốc schedule tiếp theo chưa?
5. `startingDeadlineSeconds` có quá nhỏ không?
6. `concurrencyPolicy: Forbid` có đang gặp Job cũ còn active không?
7. Có thông báo `too many missed start times` hoặc clock skew không?
8. Control plane và CronJob controller có hoạt động không?

`LAST SCHEDULE` bằng `<none>` ngay sau khi tạo chưa chắc là lỗi; có thể đơn giản là chưa tới mốc lịch đầu tiên.

### CronJob có Job nhưng không có Pod

Đi xuống tầng Job:

```bash
kubectl get jobs -n <namespace> \
  --sort-by=.metadata.creationTimestamp
kubectl describe job <job-name> -n <namespace>
kubectl get events -n <namespace> \
  --sort-by=.metadata.creationTimestamp
```

Kiểm tra quota, admission policy, ServiceAccount và cấu hình Job template. CronJob đã hoàn thành trách nhiệm tạo Job; lỗi hiện nằm ở Job hoặc Pod template.

### Pod `Pending`, `ImagePullBackOff` hoặc `Failed`

```bash
kubectl get pods -n <namespace> \
  -l batch.kubernetes.io/job-name=<job-name>
kubectl describe pod <pod-name> -n <namespace>
kubectl logs <pod-name> -n <namespace>
```

Nếu container đã restart với `restartPolicy: OnFailure`, xem logs lần trước:

```bash
kubectl logs <pod-name> -n <namespace> --previous
```

Các nguyên nhân thường gặp:

- thiếu CPU hoặc memory;
- image/tag sai hoặc registry authentication lỗi;
- ConfigMap, Secret hoặc PVC không tồn tại;
- command trả exit code khác `0`;
- container bị `OOMKilled`;
- dependency không truy cập được;
- permission hoặc ServiceAccount không đủ.

### Nhiều Job chạy chồng nhau

```bash
kubectl get jobs -n <namespace> \
  -o custom-columns='NAME:.metadata.name,ACTIVE:.status.active,START:.status.startTime,OWNER:.metadata.ownerReferences[0].name'
kubectl get cronjob <name> -n <namespace> \
  -o jsonpath='{.spec.concurrencyPolicy}{"\n"}'
```

Kiểm tra:

- policy có đang là `Allow` không;
- Job có chạy lâu hơn khoảng cách giữa hai schedule không;
- có CronJob thứ hai chạy cùng task không;
- có manual Job hoặc scheduler bên ngoài không;
- task có retry tạo side effect trùng không.

Đổi sang `Forbid` chỉ ngăn overlap trong tương lai giữa Job của cùng một CronJob. Nó không dừng các Job đang chạy và không thay thế idempotency.

### Task không chạy sau khi resume

Kiểm tra:

```bash
kubectl describe cronjob <name> -n <namespace>
kubectl get cronjob <name> -n <namespace> -o yaml
kubectl get jobs -n <namespace> \
  --sort-by=.metadata.creationTimestamp
```

Các khả năng:

- `suspend` chưa thực sự chuyển về `false`;
- missed schedule đã quá `startingDeadlineSeconds`;
- có hơn 100 lịch bị lỡ;
- `Forbid` đang thấy một Job active;
- chưa tới schedule tương lai tiếp theo.

Không nên liên tục bật/tắt suspend để thử vì mỗi lần thay đổi có thể làm behavior catch-up khó quan sát hơn.

### Job mới vẫn dùng image hoặc command cũ

CronJob chỉ áp dụng template mới cho Job được tạo sau thay đổi. Xác minh Job được tạo trước hay sau thời điểm apply:

```bash
kubectl get cronjob <name> -n <namespace> \
  -o jsonpath='{.metadata.generation}{"\n"}'

kubectl get jobs -n <namespace> \
  --sort-by=.metadata.creationTimestamp

kubectl get job <job-name> -n <namespace> -o yaml
```

Tạo manual Job mới từ CronJob để test template hiện tại. Đừng kỳ vọng Job cũ tự update.

### `LAST SCHEDULE` mới nhưng không có kết quả nghiệp vụ

`LAST SCHEDULE` chỉ cho biết controller đã tạo một Job. Nó không chứng minh Job thành công.

Kiểm tra lần lượt:

```bash
kubectl get jobs -n <namespace> \
  --sort-by=.metadata.creationTimestamp
kubectl describe job <job-name> -n <namespace>
kubectl logs job/<job-name> -n <namespace>
```

Ngay cả Job `Complete` cũng chỉ chứng minh process exit `0`. Ứng dụng phải tự xác minh số record, checksum, transaction hoặc file output trước khi exit thành công.

### Không còn Job hoặc logs để kiểm tra

History limit hoặc TTL có thể đã xóa Job và Pod. Kiểm tra cấu hình:

```bash
kubectl get cronjob <name> -n <namespace> \
  -o jsonpath='{.spec.successfulJobsHistoryLimit}{" "}{.spec.failedJobsHistoryLimit}{"\n"}'

kubectl get cronjob <name> -n <namespace> \
  -o jsonpath='{.spec.jobTemplate.spec.ttlSecondsAfterFinished}{"\n"}'
```

Nếu cần điều tra lâu hơn, tăng thời gian giữ evidence và gửi logs/metrics tới hệ thống tập trung. Không dùng completed Pods làm hệ thống audit.

## Best practices

- Dùng CronJob cho task hữu hạn cần chạy theo lịch, không dùng cho process chạy liên tục.
- Khai báo `timeZone` rõ ràng; dùng UTC khi nghiệp vụ không phụ thuộc giờ địa phương.
- Review cron expression bằng một câu đầy đủ gồm thời gian, tần suất và timezone.
- Chọn `concurrencyPolicy` theo behavior nghiệp vụ khi hai lần chạy overlap.
- Thiết kế task idempotent vì duplicate run và Pod retry vẫn có thể xảy ra.
- Đặt `startingDeadlineSeconds` theo thời gian một kỳ cũ còn giá trị.
- Đặt `activeDeadlineSeconds` và timeout trong ứng dụng để task không treo vô hạn.
- Khai báo `backoffLimit`; phân biệt lỗi tạm thời với input/config sai không đáng retry.
- Chọn history limit và TTL đủ dài để troubleshooting, nhưng không để object tích lũy không kiểm soát.
- Gửi logs, metrics và kết quả sang hệ thống lưu trữ bền vững trước cleanup.
- Monitor tuổi của lần thành công gần nhất, duration, failures, retries, active Jobs và missed business window.
- Smoke test template bằng manual Job, đồng thời kiểm soát nguy cơ chạy chồng với schedule thật.
- Kiểm tra backlog và dependency capacity trước khi resume CronJob bị suspend lâu.
- Khai báo resource requests/limits cho Pod để batch task không chiếm tài nguyên không kiểm soát.
- Dùng Secret và ServiceAccount với quyền tối thiểu; không ghi credential trực tiếp trong manifest.
- Với workflow nhiều bước, dependency phức tạp hoặc cần backfill có điều phối, cân nhắc workflow controller chuyên dụng.

## Tóm tắt

Mental model ngắn nhất:

```text
CronJob quyết định KHI NÀO
└── Job quyết định CHẠY ĐẾN KHI NÀO THÌ XONG
    └── Pod chạy IMAGE VÀ COMMAND NÀO
```

Các field chính:

| Field | Câu hỏi mà field trả lời |
|---|---|
| `schedule` | Khi nào tạo Job? |
| `timeZone` | Đọc schedule theo múi giờ nào? |
| `concurrencyPolicy` | Nếu Job cũ chưa xong thì xử lý kỳ mới thế nào? |
| `startingDeadlineSeconds` | Một kỳ được phép bắt đầu trễ bao lâu? |
| `suspend` | Có tạm ngừng tạo Job mới không? |
| `jobTemplate` | Mỗi Job và Pod sẽ chạy như thế nào? |
| `successfulJobsHistoryLimit` | Giữ bao nhiêu Job thành công? |
| `failedJobsHistoryLimit` | Giữ bao nhiêu Job thất bại? |

Bốn điều quan trọng nhất:

1. CronJob tạo Job; Job tạo và theo dõi Pod.
2. Cron schedule phải được đọc cùng timezone.
3. `Forbid` không phải distributed lock và không thay thế idempotency.
4. Một schedule có thể bị trễ, bị lỡ hoặc hiếm khi chạy trùng; monitoring phải kiểm tra kết quả nghiệp vụ, không chỉ kiểm tra CronJob tồn tại.

Tiếp tục với [Garbage Collection và Workload Cleanup](/workloads/workload-cleanup/) để quản lý lifecycle resource sau khi workload kết thúc.

## Tài liệu tham khảo

- [CronJob](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/)
- [Running Automated Tasks with a CronJob](https://kubernetes.io/docs/tasks/job/automated-tasks-with-cron-jobs/)
- [Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/)
- [Automatic Cleanup for Finished Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/ttlafterfinished/)
- [Job](/workloads/job/)
