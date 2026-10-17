---
title: "Job"
description: "Hiểu Kubernetes Job từ ví dụ đơn giản: Job tạo Pod ra sao, khi nào hoàn thành, cách retry, chạy song song, giới hạn thời gian và dọn dẹp kết quả."
---

# Job

## Mục lục

- [Job là gì?](#job-là-gì)
- [Job khác Pod, Deployment và CronJob như thế nào?](#job-khác-pod-deployment-và-cronjob-như-thế-nào)
- [Job hoạt động ra sao?](#job-hoạt-động-ra-sao)
- [Tạo Job đầu tiên](#tạo-job-đầu-tiên)
- [Đọc manifest Job](#đọc-manifest-job)
- [Theo dõi kết quả](#theo-dõi-kết-quả)
- [Job xử lý lỗi và retry như thế nào?](#job-xử-lý-lỗi-và-retry-như-thế-nào)
- [Chạy nhiều task bằng completions và parallelism](#chạy-nhiều-task-bằng-completions-và-parallelism)
- [Giới hạn thời gian chạy](#giới-hạn-thời-gian-chạy)
- [Vì sao task phải idempotent?](#vì-sao-task-phải-idempotent)
- [Indexed Job](#indexed-job)
- [Tự động dọn Job đã xong](#tự-động-dọn-job-đã-xong)
- [Thực hành hoàn chỉnh](#thực-hành-hoàn-chỉnh)
- [Troubleshooting](#troubleshooting)
- [Best practices](#best-practices)
- [Tóm tắt](#tóm-tắt)
- [Tài liệu tham khảo](#tài-liệu-tham-khảo)

---

## Job là gì?

`Job` là Kubernetes controller dành cho một công việc **chạy đến khi hoàn thành rồi dừng**.

Ví dụ, bạn cần chạy một chương trình để:

- tạo báo cáo cuối ngày;
- import một file dữ liệu;
- resize một nhóm ảnh;
- chạy database migration;
- gửi một batch message;
- thực hiện một script bảo trì một lần.

Các công việc này có điểm chung: process không cần chạy mãi. Khi làm xong, process thoát với exit code `0`.

```d2 title="Job là gì?"
direction: right
n1: "Job"
n2: "tạo Pod"
n3: "chạy task"
n4: "exit code 0"
n5: "thành công"
n6: "exit code khác"
n7: "thất bại, Job có thể thử lại"
n1 -> n2
n2 -> n3
n4 -> n5
n3 -> n4
n6 -> n7
n3 -> n6
```

Điểm quan trọng nhất cần nhớ:

> **Job không trực tiếp chạy chương trình. Job tạo Pod, theo dõi Pod và tạo Pod thay thế khi cần cho đến khi đạt số lần thành công yêu cầu.**

Ví dụ, một Job tạo báo cáo có thể diễn ra như sau:

```text
1. Bạn tạo Job "daily-report".
2. Job controller tạo một Pod.
3. Container trong Pod chạy chương trình tạo báo cáo.
4. Chương trình hoàn thành và exit 0.
5. Pod chuyển sang Succeeded.
6. Job chuyển sang Complete.
```

Pod đã `Succeeded` không restart để chạy lại task. Job và Pod cũng không tự biến mất ngay, nhờ vậy bạn còn có thể xem trạng thái và logs.

## Job khác Pod, Deployment và CronJob như thế nào?

Bốn resource này giải quyết bốn nhu cầu khác nhau.

| Resource | Khi nào dùng? | Process kết thúc thì sao? |
|---|---|---|
| Pod | Học tập, debug hoặc làm đơn vị chạy cơ bản | Không có controller đảm bảo task được chạy lại trên Pod mới |
| Deployment | Web server, API, worker chạy liên tục | Controller tạo Pod thay thế để ứng dụng tiếp tục chạy |
| Job | Task cần chạy xong một lần hoặc một số lần xác định | Job ghi nhận lần hoàn thành và dừng khi đạt mục tiêu |
| CronJob | Task cần chạy theo lịch | CronJob tạo một Job mới ở mỗi thời điểm trong lịch |

Có thể chọn nhanh bằng câu hỏi sau:

```d2 title="Job khác Pod, Deployment và CronJob như thế nào?"
direction: right
n1: "Process phải chạy liên tục?"
n2: "Có"
n3: "Deployment"
n4: "Không, chạy xong rồi dừng"
n5: "Chạy một lần"
n6: "Job"
n7: "Chạy theo lịch"
n8: "CronJob"
n2 -> n3
n1 -> n2
n1 -> n4
n5 -> n6
n4 -> n5
n7 -> n8
n4 -> n7
```

Ví dụ:

- API phục vụ HTTP cả ngày: dùng `Deployment`.
- Script import `customers.csv` một lần: dùng `Job`.
- Script backup chạy lúc 02:00 mỗi ngày: dùng `CronJob`; mỗi lần đến lịch, CronJob tạo một Job.

## Job hoạt động ra sao?

Job controller liên tục so sánh trạng thái mong muốn với trạng thái thật trong cluster.

```d2 title="Job hoạt động ra sao?"
direction: down
A: "Tạo Job"
B: "Job controller tạo Pod"
C: "Container chạy task"
D: "Process thoát thế nào?" {shape: diamond}
E: "Pod Succeeded"
F: "Pod hoặc container thất bại"
G: "Còn được retry?" {shape: diamond}
H: "Job Failed"
I: "Đủ số lần thành công?" {shape: diamond}
J: "Job Complete"
A -> B
B -> C
C -> D
D -> E: "Exit code 0"
D -> F: "Exit code khác"
F -> G
G -> B: "Có"
G -> H: "Không"
E -> I
I -> B: "Chưa"
I -> J: "Đủ"
```

Có ba trạng thái dễ bị nhầm:

- **Container hoàn thành:** process bên trong container đã thoát.
- **Pod `Succeeded`:** tất cả container cần thiết trong Pod đã hoàn thành thành công.
- **Job `Complete`:** Job đã có đủ số Pod thành công theo cấu hình.

Với Job đơn giản, chỉ cần một lần thành công nên ba sự kiện này xảy ra gần nhau. Với Job có `completions: 10`, một Pod thành công mới chỉ hoàn thành một phần công việc.

> [!NOTE]
> `kubectl apply` báo `created` hoặc `configured` chỉ có nghĩa API Server đã chấp nhận object. Nó không có nghĩa task bên trong Job đã chạy xong.

## Tạo Job đầu tiên

Ví dụ đầu tiên chỉ in hai dòng log, chờ 5 giây rồi kết thúc. Mục tiêu là quan sát rõ quan hệ `Job → Pod → container` trước khi thêm retry hoặc chạy song song.

### Điều kiện trước khi bắt đầu

Bạn cần:

- một Kubernetes cluster đang hoạt động;
- `kubectl` đã kết nối tới cluster;
- quyền tạo Namespace và Job.

Kiểm tra context hiện tại:

```bash
kubectl config current-context
kubectl get nodes
```

> [!WARNING]
> Các lệnh trong bài tạo và xóa Namespace. Không chạy trên cluster dùng chung hoặc production nếu chưa kiểm tra đúng context.

### Tạo manifest

Lưu nội dung sau vào file `job.yaml`:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: hello-job
  namespace: job-lab
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
              echo "Bắt đầu task"
              sleep 5
              echo "Task đã hoàn thành"
```

Tạo Namespace, kiểm tra manifest ở API Server rồi tạo Job:

```bash
kubectl create namespace job-lab
kubectl apply --dry-run=server -f job.yaml
kubectl apply -f job.yaml
```

Kết quả tạo object có dạng:

```text
job.batch/hello-job created
```

Đây mới là xác nhận Job đã được tạo. Phần tiếp theo sẽ kiểm tra task có thật sự thành công hay không.

## Đọc manifest Job

Manifest đầu tiên chỉ có vài phần quan trọng.

### `apiVersion`, `kind` và `metadata`

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: hello-job
  namespace: job-lab
```

- `apiVersion: batch/v1` là API ổn định của Job.
- `kind: Job` cho API Server biết loại resource cần tạo.
- `metadata.name` là tên Job.
- `metadata.namespace` là Namespace chứa Job và các Pod của nó.

### `spec.template` là mẫu Pod

```yaml
spec:
  template:
    spec:
      containers:
        - name: hello
          image: busybox:1.36
```

Job không chứa một Pod đã chạy sẵn. `spec.template` là **bản mẫu** để Job controller tạo Pod.

Phần bên trong gần giống manifest Pod thông thường, nhưng không có `apiVersion`, `kind` và `metadata.name` riêng. Kubernetes tự tạo tên Pod dựa trên tên Job, ví dụ:

```text
hello-job-z9m7q
```

Không nên phụ thuộc vào tên đầy đủ này vì Pod retry sẽ có tên khác.

### `command` phải kết thúc

```yaml
command:
  - sh
  - -c
  - |
    echo "Bắt đầu task"
    sleep 5
    echo "Task đã hoàn thành"
```

Sau lệnh `echo` cuối, shell không còn việc gì nên thoát với exit code `0`. Kubernetes hiểu lần chạy này đã thành công.

Nếu command là một vòng lặp vô hạn, Job sẽ không bao giờ `Complete`:

```sh
# Không phù hợp với Job vì process không kết thúc.
while true; do
  echo "still running"
  sleep 10
done
```

Process chạy mãi thường phù hợp với Deployment hoặc DaemonSet hơn.

### `restartPolicy` chỉ được dùng `Never` hoặc `OnFailure`

Pod template của Job chỉ chấp nhận:

```yaml
restartPolicy: Never
```

hoặc:

```yaml
restartPolicy: OnFailure
```

Khác biệt chính:

| Giá trị | Khi container lỗi | Điều dễ quan sát |
|---|---|---|
| `Never` | Pod chuyển sang `Failed`; Job có thể tạo Pod mới | Mỗi lần thử nằm trong một Pod riêng, dễ xem logs khi học và debug |
| `OnFailure` | kubelet restart container trong cùng Pod | Ít Pod hơn, nhưng cần xem restart count và logs của container trước |

Bài này dùng `Never` vì luồng retry dễ nhìn hơn.

## Theo dõi kết quả

Sau khi apply, xem cả Job và Pod:

```bash
kubectl get jobs,pods -n job-lab
```

Output minh họa khi task đã xong:

```text
NAME                  STATUS     COMPLETIONS   DURATION   AGE
job.batch/hello-job   Complete   1/1           5s         20s

NAME                  READY   STATUS      RESTARTS   AGE
pod/hello-job-z9m7q   0/1     Completed   0          20s
```

Cách đọc:

- `COMPLETIONS 1/1`: cần một lần thành công và đã có đủ một lần.
- Job có `STATUS Complete`: toàn bộ Job đã hoàn thành.
- Pod có `STATUS Completed`: process đã kết thúc; đây không phải lỗi.
- `READY 0/1` sau khi hoàn thành là bình thường vì container không còn chạy.

### Chờ Job hoàn thành

Trong script hoặc CI pipeline, dùng `kubectl wait` thay vì tự `sleep` một khoảng cố định:

```bash
kubectl wait --for=condition=complete job/hello-job \
  -n job-lab --timeout=120s
```

Nếu thành công, lệnh trả về:

```text
job.batch/hello-job condition met
```

Nếu Job thất bại, lệnh chờ condition `complete` sẽ không tự đổi sang kiểm tra `failed`; nó thường chờ đến hết timeout. Khi đó hãy xem status và Events:

```bash
kubectl get job hello-job -n job-lab
kubectl describe job hello-job -n job-lab
```

### Xem logs

Xem log thông qua Job:

```bash
kubectl logs job/hello-job -n job-lab
```

Output:

```text
Bắt đầu task
Task đã hoàn thành
```

Hoặc liệt kê Pod thuộc Job rồi xem một Pod cụ thể:

```bash
kubectl get pods -n job-lab \
  -l batch.kubernetes.io/job-name=hello-job

kubectl logs <pod-name> -n job-lab
```

Cách thứ hai hữu ích khi Job có nhiều Pod hoặc có Pod thất bại.

## Job xử lý lỗi và retry như thế nào?

Một task có thể thất bại vì command sai, input không hợp lệ, dependency tạm thời không truy cập được, container hết memory hoặc Node gặp sự cố.

Với `restartPolicy: Never`, luồng đơn giản là:

```d2 title="Job xử lý lỗi và retry như thế nào?"
direction: right
p1: Pod 1
f1: exit 1 / Failed
p2: Job tạo Pod 2
f2: exit 1 / Failed
p3: Job tạo Pod 3
ok: exit 0 / Succeeded
complete: Job Complete
p1 -> f1 -> p2 -> f2 -> p3 -> ok -> complete
```

### Giới hạn retry bằng `backoffLimit`

Thêm field sau vào `spec` của Job:

```yaml
spec:
  backoffLimit: 3
```

`backoffLimit` giới hạn số lần lỗi mà Job chấp nhận trước khi kết luận thất bại. Nếu không khai báo, giá trị mặc định thông thường là `6`.

Kubernetes không retry liên tục không nghỉ. Job controller tăng khoảng chờ giữa các lần thử để tránh một task lỗi tạo Pod quá nhanh.

Không có một giá trị `backoffLimit` phù hợp cho mọi Job:

- Lỗi mạng tạm thời có thể đáng retry vài lần.
- File input sai định dạng thường sẽ tiếp tục sai dù retry bao nhiêu lần.
- Task có side effect như trừ tiền hoặc gửi email cần đặc biệt cẩn thận vì retry có thể lặp hành động.

### Thử một Job luôn thất bại

Không sửa `hello-job` đang tồn tại vì phần lớn Pod template của Job là immutable. Hãy tạo file `failing-job.yaml` với tên Job khác:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: failing-job
  namespace: job-lab
spec:
  backoffLimit: 2
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: fail
          image: busybox:1.36
          command:
            - sh
            - -c
            - |
              echo "Giả lập lỗi"
              exit 2
```

Apply và quan sát:

```bash
kubectl apply -f failing-job.yaml
kubectl get jobs,pods -n job-lab --watch
```

Sau khi Job ngừng retry, thu thập evidence:

```bash
kubectl describe job failing-job -n job-lab
kubectl get pods -n job-lab \
  -l batch.kubernetes.io/job-name=failing-job
kubectl logs <failed-pod-name> -n job-lab
kubectl describe pod <failed-pod-name> -n job-lab
```

Hãy xem logs và exit code trước khi xóa Job. Xóa quá sớm sẽ làm mất Pod và evidence cần để debug.

### Retry của Kubernetes không hiểu nghiệp vụ

Job controller chỉ thấy Pod thành công hay thất bại. Nó không biết chương trình đã ghi được 500 trong 1.000 bản ghi vào database hay đã gửi email trước khi crash.

Vì vậy, ứng dụng phải tự xử lý:

- transaction chưa hoàn thành;
- file tạm từ lần chạy trước;
- lock còn sót;
- một phần output đã được ghi;
- request bên ngoài đã thành công nhưng chưa kịp lưu trạng thái.

Đây là lý do task chạy trong Job phải được thiết kế để retry an toàn.

## Chạy nhiều task bằng completions và parallelism

Hai field thường bị nhầm là `completions` và `parallelism`.

```yaml
spec:
  completions: 6
  parallelism: 2
```

Có thể hiểu như sau:

- `completions: 6`: Job cần **tổng cộng 6 lần thành công**.
- `parallelism: 2`: tại một thời điểm, Job yêu cầu chạy **tối đa khoảng 2 Pod**.

```d2 title="Chạy nhiều task bằng completions và parallelism"
direction: right
goal: "Mục tiêu: 6 lần thành công"
batch1: "Đợt 1: Pod A + Pod B\n2 lần thành công"
batch2: "Đợt 2: Pod C + Pod D\n2 lần thành công"
batch3: "Đợt 3: Pod E + Pod F\n2 lần thành công"
complete: tổng 6/6 → Complete
goal -> batch1 -> batch2 -> batch3 -> complete
```

`completions` trả lời câu hỏi **“cần làm xong bao nhiêu phần?”**. `parallelism` trả lời câu hỏi **“cho phép làm đồng thời bao nhiêu phần?”**.

| Cấu hình | Hành vi |
|---|---|
| Không đặt cả hai | Job đơn giản: mặc định cần 1 lần thành công, chạy 1 Pod |
| `completions: 10` | Cần 10 lần thành công, mặc định chạy lần lượt từng Pod |
| `completions: 10`, `parallelism: 3` | Cần 10 lần thành công, yêu cầu tối đa khoảng 3 Pod cùng lúc |
| `parallelism: 0` | Tạm không chạy Pod mới cho đến khi tăng giá trị |

> [!IMPORTANT]
> Sáu Pod giống nhau không tự biết mỗi Pod phải xử lý dữ liệu nào. Ứng dụng vẫn cần chia việc bằng queue, partition, database claim hoặc completion index. Nếu tất cả Pod cùng đọc một file và làm toàn bộ công việc, dữ liệu có thể bị xử lý lặp.

### Có nên tăng `parallelism` thật cao?

Không phải lúc nào chạy nhiều Pod hơn cũng nhanh hơn. Parallelism thực tế còn phụ thuộc vào:

- CPU và memory còn trống trong cluster;
- `ResourceQuota` của Namespace;
- tốc độ database, API hoặc storage phía sau;
- số work item thật sự còn lại;
- thời gian Job controller và Scheduler tạo, đặt Pod;
- các Pod trước đó có đang lỗi hay không.

Ví dụ database chỉ chịu được 10 kết nối batch đồng thời, đặt `parallelism: 100` có thể làm database quá tải và khiến toàn bộ Job chậm hơn.

Chọn `parallelism` theo capacity của cả cluster **và dependency**, không chỉ theo số Node.

## Giới hạn thời gian chạy

Retry có giới hạn số lần nhưng chưa giới hạn tổng thời gian. Một Pod có thể bị treo rất lâu mà không exit. Dùng `activeDeadlineSeconds` để đặt thời gian active tối đa cho toàn Job:

```yaml
spec:
  activeDeadlineSeconds: 300
```

Sau 300 giây, Kubernetes dừng các Pod còn chạy và đánh dấu Job thất bại. Deadline này áp dụng cho toàn Job, bao gồm các lần retry; nó không phải timeout riêng cho từng request HTTP hoặc query database.

Một thiết kế thường có nhiều lớp timeout:

```text
Timeout của một request tới dependency
        < timeout của toàn bộ chương trình
        < activeDeadlineSeconds của Job
        < timeout của pipeline bên ngoài
```

Ví dụ:

- request tới API: 10 giây;
- chương trình tự dừng sau: 4 phút;
- Job `activeDeadlineSeconds`: 5 phút;
- CI pipeline timeout: 10 phút.

Nếu chỉ đặt deadline cho Job, một request bị treo vẫn có thể giữ Pod đến gần hết deadline. Ứng dụng nên có timeout cho từng dependency và xử lý `SIGTERM` để lưu checkpoint hoặc dọn trạng thái tạm khi bị dừng.

## Vì sao task phải idempotent?

`Idempotent` trong ngữ cảnh này nghĩa là chạy lại cùng một task không tạo thêm hậu quả sai ngoài ý muốn.

Giả sử Job gửi hóa đơn:

```text
1. Pod gọi API gửi hóa đơn thành công.
2. Pod crash trước khi ghi trạng thái "đã gửi" vào database.
3. Job thấy Pod thất bại và tạo Pod mới.
4. Pod mới gửi lại cùng hóa đơn.
```

Nếu API không chống trùng, khách hàng có thể nhận hai hóa đơn. Ngay cả Job có `completions: 1` và `parallelism: 1`, chương trình vẫn có thể được bắt đầu nhiều hơn một lần trong một số tình huống lỗi.

Một số cách làm task retry-safe:

- gửi `idempotency key` khi gọi external API;
- đặt unique constraint cho business key trong database;
- claim work item bằng transaction;
- lưu checkpoint sau từng partition;
- ghi file tạm rồi atomic rename khi hoàn tất;
- kiểm tra trạng thái hiện tại trước khi chuyển sang trạng thái mới;
- dùng transactional outbox cho thao tác ghi database rồi phát event.

Ví dụ business key nên gắn với dữ liệu thật:

```text
job_type=daily-report
business_date=2026-04-15
```

Không nên dùng Pod name làm business key. Pod retry có tên mới, còn cùng một task nghiệp vụ vẫn là task cũ.

> [!IMPORTANT]
> Kubernetes giúp **chạy lại Pod**. Kubernetes không tự đảm bảo transaction nghiệp vụ của bạn chỉ xảy ra đúng một lần.

## Indexed Job

Phần này chỉ cần khi mỗi Pod phải nhận một phần việc cố định. Nếu bạn mới học Job, hãy nắm chắc `completions` và `parallelism` trước.

Với Job thông thường, các lần completion có vai trò giống nhau. Indexed Job gán cho mỗi completion một số từ `0` đến `completions - 1`.

```yaml
spec:
  completionMode: Indexed
  completions: 5
  parallelism: 2
```

Job trên có năm index:

```text
0, 1, 2, 3, 4
```

Mỗi Pod đọc index của mình qua biến môi trường `JOB_COMPLETION_INDEX`. Ví dụ:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: indexed-demo
  namespace: job-lab
spec:
  completionMode: Indexed
  completions: 5
  parallelism: 2
  backoffLimit: 3
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
              echo "Đang xử lý partition $JOB_COMPLETION_INDEX"
```

Indexed Job phù hợp khi có thể ánh xạ rõ:

```text
index 0 → partition 0
index 1 → partition 1
index 2 → partition 2
...
```

Một index vẫn có thể được thử nhiều lần nếu Pod lỗi. Vì vậy task của từng index vẫn phải idempotent.

Các field nâng cao như `backoffLimitPerIndex`, `maxFailedIndexes`, `podFailurePolicy` và `successPolicy` phụ thuộc vào phiên bản Kubernetes. Trước khi dùng, kiểm tra API trên cluster mục tiêu:

```bash
kubectl version
kubectl explain job.spec.backoffLimitPerIndex
kubectl explain job.spec.podFailurePolicy
kubectl explain job.spec.successPolicy
```

Không cần dùng các field này cho Job cơ bản.

## Tự động dọn Job đã xong

Job và Pod hoàn thành được giữ lại để bạn xem status, Events và logs. Nếu tạo nhiều Job, các object cũ sẽ tích lũy trong API Server.

Dùng `ttlSecondsAfterFinished` để yêu cầu tự xóa Job sau khi nó kết thúc:

```yaml
spec:
  ttlSecondsAfterFinished: 3600
```

`3600` nghĩa là Job đủ điều kiện bị xóa sau một giờ kể từ khi chuyển sang `Complete` hoặc `Failed`. Khi Job bị xóa theo cơ chế này, các Pod phụ thuộc cũng bị xóa.

Đừng đặt TTL quá ngắn trước khi có hệ thống log tập trung. Sau khi Pod bị xóa, `kubectl logs` không còn lấy được log của Pod đó.

Phân biệt hai mục tiêu:

- `backoffLimit`: kiểm soát Job thử lại bao nhiêu lần khi lỗi.
- `ttlSecondsAfterFinished`: kiểm soát giữ Job đã kết thúc bao lâu.

## Thực hành hoàn chỉnh

Lab này tạo một Job cần sáu lần thành công và chạy hai Pod đồng thời. Qua đó bạn sẽ quan sát rõ `completions`, `parallelism`, status và logs.

### 1. Tạo manifest

Lưu file `batch-job.yaml`:

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
  activeDeadlineSeconds: 180
  ttlSecondsAfterFinished: 600
  template:
    metadata:
      labels:
        app: batch-demo
    spec:
      restartPolicy: Never
      containers:
        - name: worker
          image: busybox:1.36
          command:
            - sh
            - -c
            - |
              set -eu
              echo "pod=$HOSTNAME bắt đầu lúc $(date -Iseconds)"
              sleep 5
              echo "pod=$HOSTNAME hoàn thành lúc $(date -Iseconds)"
          resources:
            requests:
              cpu: 10m
              memory: 16Mi
            limits:
              memory: 32Mi
```

Các field được chọn có chủ đích:

| Field | Ý nghĩa trong lab |
|---|---|
| `completions: 6` | Cần sáu Pod thành công |
| `parallelism: 2` | Chạy tối đa khoảng hai Pod cùng lúc |
| `backoffLimit: 2` | Không retry vô hạn nếu task lỗi |
| `activeDeadlineSeconds: 180` | Dừng toàn Job nếu vượt ba phút |
| `ttlSecondsAfterFinished: 600` | Giữ Job và Pod khoảng mười phút để xem logs |
| `restartPolicy: Never` | Mỗi lần thử lỗi nằm trong một Pod riêng |

### 2. Kiểm tra và apply

Nếu đã xóa Namespace từ phần trước, tạo lại nó:

```bash
kubectl get namespace job-lab >/dev/null 2>&1 || \
  kubectl create namespace job-lab
```

Kiểm tra schema trên API Server rồi apply:

```bash
kubectl apply --dry-run=server -f batch-job.yaml
kubectl apply -f batch-job.yaml
```

### 3. Quan sát Pod được tạo theo từng đợt

```bash
kubectl get jobs,pods -n job-lab --watch
```

Bạn sẽ thấy khoảng hai Pod chạy cùng lúc. Khi hai Pod đầu hoàn thành, Job tạo thêm Pod cho đến khi đủ sáu lần thành công.

Ở terminal khác, xem status gọn hơn:

```bash
kubectl get job batch-demo -n job-lab -w
```

Giá trị `COMPLETIONS` tăng dần từ `0/6` đến `6/6`.

### 4. Chờ completion và kiểm tra kết quả

```bash
kubectl wait --for=condition=complete job/batch-demo \
  -n job-lab --timeout=180s

kubectl get job batch-demo -n job-lab
kubectl describe job batch-demo -n job-lab
```

Liệt kê tất cả Pod của Job:

```bash
kubectl get pods -n job-lab \
  -l batch.kubernetes.io/job-name=batch-demo \
  -o custom-columns='NAME:.metadata.name,PHASE:.status.phase,NODE:.spec.nodeName'
```

Kết quả đúng là có sáu Pod `Succeeded`. Nếu thấy nhiều hơn sáu Pod, hãy kiểm tra xem có Pod cũ từng thất bại hay không.

Xem logs của tất cả Pod:

```bash
kubectl logs job/batch-demo -n job-lab \
  --all-pods=true --prefix
```

Tên Pod khác nhau cho thấy sáu lần completion được thực hiện bởi các Pod riêng.

### 5. Cleanup

Sau khi quan sát xong, xóa Namespace lab:

```bash
kubectl config current-context
kubectl delete namespace job-lab
```

Xóa Namespace sẽ xóa cả Job và Pod bên trong. Nếu không xóa thủ công, `batch-demo` vẫn được TTL controller dọn sau thời gian đã cấu hình, nhưng các Job khác không có TTL vẫn còn.

## Troubleshooting

Khi Job không hoàn thành, debug theo thứ tự `Job → Pod → container`, không xóa ngay rồi tạo lại.

```d2 title="Troubleshooting"
direction: right
n1: "Job có tạo Pod không?"
n2: "Không"
n3: "xem Job Events, quota, admission và\nquyền"
n4: "Có"
n5: "Pod Pending"
n6: "xem scheduling, resource, image pull,\nvolume"
n7: "Pod Running quá lâu"
n8: "xem logs, dependency và timeout"
n9: "Pod Failed"
n10: "xem exit code, OOM, command và logs"
n11: "Pod Succeeded nhưng Job chưa Complete"
n12: "xem completions còn thiếu"
n2 -> n3
n1 -> n2
n1 -> n4
n5 -> n6
n4 -> n5
n7 -> n8
n4 -> n7
n9 -> n10
n4 -> n9
n11 -> n12
n4 -> n11
```

### Job không tạo Pod

Thu thập trạng thái và Events:

```bash
kubectl describe job <job-name> -n <namespace>
kubectl get events -n <namespace> \
  --sort-by=.metadata.creationTimestamp
```

Kiểm tra:

- `ResourceQuota` hoặc `LimitRange` có chặn Pod không;
- admission policy có từ chối image, security context hoặc resource không;
- ServiceAccount có liên quan tới cấu hình Pod không;
- Job có đang `suspend: true` hoặc `parallelism: 0` không;
- manifest có selector/template bất thường không.

Trong hầu hết trường hợp, không nên tự khai báo `spec.selector` cho Job; Kubernetes tự tạo selector phù hợp.

### Pod ở `Pending`

```bash
kubectl get pods -n <namespace> \
  -l batch.kubernetes.io/job-name=<job-name>
kubectl describe pod <pod-name> -n <namespace>
```

Đọc phần `Events`. Nguyên nhân thường gặp:

- thiếu CPU hoặc memory;
- Pod không tolerate taint;
- node selector hoặc affinity không match;
- PVC chưa bind hoặc volume không mount được;
- image không pull được;
- quota hoặc admission policy chặn.

Pod `Pending` không phải lỗi retry của ứng dụng; tăng `backoffLimit` thường không giải quyết được.

### Job retry liên tục

Lấy danh sách Pod theo thời gian:

```bash
kubectl get pods -n <namespace> \
  -l batch.kubernetes.io/job-name=<job-name> \
  --sort-by=.metadata.creationTimestamp
```

Xem logs và trạng thái Pod lỗi gần nhất:

```bash
kubectl logs <failed-pod-name> -n <namespace>
kubectl describe pod <failed-pod-name> -n <namespace>
```

Kiểm tra:

- command hoặc argument có sai không;
- ConfigMap, Secret và environment variable có đủ không;
- process trả exit code nào;
- container có bị `OOMKilled` không;
- dependency có timeout hoặc từ chối kết nối không;
- task retry có tạo side effect trùng không.

Nếu side effect không an toàn, cân nhắc suspend hoặc xóa Job sau khi đã thu thập evidence, thay vì để retry tiếp.

### Pod `Running` quá lâu

```bash
kubectl logs <pod-name> -n <namespace> --timestamps
kubectl describe pod <pod-name> -n <namespace>
kubectl get job <job-name> -n <namespace> -o yaml
```

Xác định task đang xử lý chậm hay bị treo. Kiểm tra timeout của network/database, deadlock, lock cũ và `activeDeadlineSeconds`.

Không nên kết luận Job lỗi chỉ vì chạy lâu hơn dự kiến. So sánh với metric tiến độ, số item còn lại hoặc checkpoint của ứng dụng.

### Job `Complete` nhưng kết quả nghiệp vụ bị thiếu

Kubernetes coi exit code `0` là thành công. Nó không tự kiểm tra số record, checksum hoặc file output.

Ứng dụng phải tự validate kết quả trước khi exit `0`, ví dụ:

- số bản ghi output bằng số mong đợi;
- file đã upload thành công và checksum đúng;
- database transaction đã commit;
- report đã được ghi vào nơi lưu trữ bền vững.

Nếu validation thất bại, process nên trả exit code khác `0` và ghi log đủ rõ để chẩn đoán.

### Không xem được logs

Kiểm tra Job và Pod còn tồn tại không:

```bash
kubectl get job,pods -n <namespace>
```

Pod có thể đã bị xóa do:

- `ttlSecondsAfterFinished`;
- history/cleanup của CronJob;
- operator hoặc pipeline xóa Job;
- Namespace đã bị xóa.

Logs cần giữ lâu phải được gửi ra hệ thống log tập trung. Completed Pod không phải nơi lưu logs bền vững.

### Sửa manifest nhưng `kubectl apply` báo field immutable

Pod template và một số field của Job không thể sửa sau khi Job đã được tạo. Với một lần chạy mới, hãy tạo Job mới bằng tên mới hoặc xóa Job cũ rồi tạo lại sau khi đã lưu evidence cần thiết.

Trong automation, có thể dùng `generateName` để Kubernetes tạo tên duy nhất:

```yaml
metadata:
  generateName: report-
```

`generateName` thường dùng với `kubectl create`, không dùng như cách update một Job cũ.

## Best practices

- Dùng Job cho process chạy đến khi xong; không dùng cho server chạy vô hạn.
- Để chương trình chỉ exit `0` khi kết quả nghiệp vụ thật sự hoàn thành.
- Thiết kế task idempotent vì Pod có thể được chạy lại.
- Khai báo `backoffLimit` thay vì để task lỗi retry mà không có chủ đích.
- Dùng timeout trong ứng dụng và `activeDeadlineSeconds` cho toàn Job.
- Bắt đầu với `restartPolicy: Never` nếu cần debug từng lần thử.
- Chọn `parallelism` theo capacity của database, API và storage phía sau.
- Khai báo resource `requests` và `limits` để batch workload không chiếm tài nguyên không kiểm soát.
- Dùng Indexed Job khi mỗi worker cần một partition cố định.
- Gửi logs, metrics và kết quả sang nơi lưu trữ bền vững trước khi TTL xóa Pod.
- Theo dõi cả `Complete`, `Failed`, duration, số lần retry và tuổi của lần thành công gần nhất.
- Không lưu Secret trực tiếp trong manifest; dùng Secret và ServiceAccount với quyền tối thiểu.
- Không xóa Pod lỗi trước khi lấy logs, Events và exit code cần cho troubleshooting.

## Tóm tắt

Mental model ngắn nhất của Job là:

```d2 title="Tóm tắt"
direction: right
n1: "Job"
n2: "tạo và theo dõi Pod"
n3: "Pod thành công đủ số lần"
n4: "Job Complete"
n5: "Pod thất bại"
n6: "còn retry"
n7: "tạo/chạy lại"
n8: "hết retry hoặc quá deadline"
n9: "Job Failed"
n1 -> n2
n3 -> n4
n2 -> n3
n2 -> n5
n6 -> n7
n5 -> n6
n8 -> n9
n5 -> n8
```

Các field chính:

| Field | Câu hỏi mà field trả lời |
|---|---|
| `spec.template` | Pod sẽ chạy image và command nào? |
| `restartPolicy` | Container lỗi được xử lý trong Pod ra sao? |
| `completions` | Cần bao nhiêu lần thành công? |
| `parallelism` | Muốn chạy đồng thời tối đa khoảng bao nhiêu Pod? |
| `backoffLimit` | Cho phép lỗi và retry đến mức nào? |
| `activeDeadlineSeconds` | Toàn Job được active tối đa bao lâu? |
| `ttlSecondsAfterFinished` | Giữ Job đã kết thúc bao lâu trước khi dọn? |

Điểm quan trọng nhất về độ tin cậy: Job có thể chạy lại Pod, nhưng ứng dụng vẫn phải tự đảm bảo retry không làm hỏng hoặc nhân đôi dữ liệu.

Tiếp tục với [CronJob](/workloads/cronjob/) để chạy Job theo lịch.

## Tài liệu tham khảo

- [Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/)
- [Automatic Cleanup for Finished Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/ttlafterfinished/)
- [Job Patterns](https://kubernetes.io/docs/concepts/workloads/controllers/job/#job-patterns)
- [Pod Lifecycle](/workloads/pod-lifecycle/)
