---
title: "Static Pods"
description: "Cách kubelet trực tiếp quản lý Static Pod từ manifest trên Node, mirror Pod trên API Server, use case control plane và quy trình vận hành an toàn."
---

# Static Pods

## Mục lục

- [Tổng quan](#tổng-quan)
- [1. Static Pod khác Pod thông thường](#1-static-pod-khác-pod-thông-thường)
- [2. Manifest source và reconciliation](#2-manifest-source-và-reconciliation)
- [3. Mirror Pod](#3-mirror-pod)
- [4. Use case và giới hạn](#4-use-case-và-giới-hạn)
- [5. Static Pod trong kubeadm control plane](#5-static-pod-trong-kubeadm-control-plane)
- [6. Tạo Static Pod](#6-tạo-static-pod)
- [7. Update, rollback và cleanup](#7-update-rollback-và-cleanup)
- [8. Troubleshooting](#8-troubleshooting)
- [9. Security và best practices](#9-security-và-best-practices)
- [Tài liệu tham khảo](#tài-liệu-tham-khảo)

---

## Tổng quan

Static Pod là Pod do **một kubelet cụ thể** quản lý trực tiếp từ manifest cục bộ hoặc nguồn cấu hình được kubelet theo dõi. API Server và scheduler không tạo hay đặt Static Pod. Kubelet bảo đảm container của manifest tiếp tục chạy và có thể tạo một **mirror Pod** trên API Server để cluster quan sát.

```text
Manifest trên Node
      │ kubelet watch
      ▼
Static Pod containers ────── chạy trên chính Node đó
      │
      └──── mirror Pod ───── hiển thị qua API Server
```

Static Pod thường xuất hiện trong control plane dựng bằng `kubeadm`, nơi `kube-apiserver`, `kube-controller-manager`, `kube-scheduler` và local etcd chạy từ manifest trong `/etc/kubernetes/manifests`.

## 1. Static Pod khác Pod thông thường

| Khía cạnh | Pod thông thường | Static Pod |
|---|---|---|
| Source of truth | Pod/Controller object trên API Server | Manifest do kubelet theo dõi |
| Placement | Scheduler chọn Node | Cố định vào kubelet đọc manifest |
| Lifecycle owner | Deployment, StatefulSet, DaemonSet, Job... | kubelet trên Node |
| API representation | Pod thật | Mirror Pod để quan sát, nếu API khả dụng |
| Xóa bằng `kubectl` | Xóa object và controller có thể tạo lại | Xóa mirror không dừng static workload; kubelet tạo mirror lại |
| Reschedule khi Node mất | Controller có thể tạo Pod nơi khác | Không; manifest nằm trên Node đó |

Static Pod không đi qua scheduler. Do đó Node Affinity, topology spread, PriorityClass và preemption không thực hiện placement cho nó. Resource requests/limits vẫn hữu ích cho kubelet/runtime enforcement và local resource management, nhưng không có scheduler kiểm tra cluster capacity trước khi start.

## 2. Manifest source và reconciliation

Kubelet có thể được cấu hình với static Pod path, thường qua `staticPodPath` trong kubelet configuration hoặc flag tương ứng. Kubelet định kỳ scan directory và phản ứng khi file được thêm, sửa hoặc xóa.

Mental model:

1. File xuất hiện trong manifest directory.
2. Kubelet parse Pod spec.
3. Kubelet tạo static Pod cục bộ.
4. Nếu API Server reachable, kubelet tạo mirror Pod.
5. File thay đổi làm kubelet reconcile phiên bản mới.
6. File bị xóa làm kubelet dừng Static Pod và xóa mirror khi có thể.

> [!WARNING]
> Kubelet đọc mọi file không bắt đầu bằng dấu chấm trong static Pod directory. Đặt file backup như `kube-apiserver.yaml.bak` ngay trong directory có thể làm kubelet thử chạy thêm manifest. Lưu backup ở directory khác.

Kiểm tra kubelet configuration tùy distribution:

```bash
sudo grep -R "staticPodPath" /var/lib/kubelet /etc/kubernetes 2>/dev/null
```

Path và service arguments phụ thuộc cách cài cluster; không giả định `/etc/kubernetes/manifests` trên mọi hệ thống.

## 3. Mirror Pod

Mirror Pod có tên thường gồm static Pod name và Node name, cho phép:

```bash
kubectl get pods -A -o wide
kubectl describe pod MIRROR_POD -n NAMESPACE
kubectl logs MIRROR_POD -n NAMESPACE
```

Mirror Pod không phải source of truth. Xóa nó:

```bash
kubectl delete pod MIRROR_POD -n NAMESPACE
```

không xóa manifest hay dừng static workload; kubelet có thể tạo mirror lại. Muốn dừng Static Pod, phải thay đổi source manifest trên Node.

Khi API Server down, Static Pod vẫn có thể được kubelet quản lý, nhưng mirror/API-based observability không khả dụng. Dùng CRI tooling và journal trên Node:

```bash
sudo crictl pods
sudo crictl ps
sudo journalctl -u kubelet
```

## 4. Use case và giới hạn

### 4.1 Use case phù hợp

- Bootstrap control-plane component trước khi API Server sẵn sàng.
- Chạy component gắn chặt với một Node trong mô hình cluster bootstrap đã được distribution hỗ trợ.
- Phục hồi/diagnostic có runbook node-level rõ, trong môi trường kiểm soát.

### 4.2 Khi nên dùng DaemonSet thay thế

Dùng DaemonSet cho log agent, network agent, storage node plugin và monitoring agent khi API Server khả dụng. DaemonSet có rollout, selector, desired state cluster-wide, scheduling semantics và quản trị tập trung tốt hơn.

### 4.3 Giới hạn quan trọng

Static Pod không phù hợp với spec phụ thuộc vào API object khác như ConfigMap, Secret hoặc ServiceAccount. Static Pod cũng không hỗ trợ ephemeral containers. Không dùng nó cho application thông thường cần controller rollout, autoscaling, rescheduling hoặc declarative API lifecycle.

Secrets đặt trực tiếp trong manifest trên Node tạo rủi ro file disclosure và phân phối/rotation khó. Với control-plane static manifests, certificate/key thường được mount từ host path và phải được bảo vệ bằng file permission cùng node access control.

## 5. Static Pod trong kubeadm control plane

Trên kubeadm cluster, kiểm tra:

```bash
sudo ls -la /etc/kubernetes/manifests
```

Thường thấy:

```text
etcd.yaml
kube-apiserver.yaml
kube-controller-manager.yaml
kube-scheduler.yaml
```

Mỗi control-plane Node có manifest riêng. “Ba replicas API Server” thực tế là ba kubelet độc lập, mỗi kubelet quản lý một local Static Pod. Không có Deployment đứng phía sau.

Điều này ảnh hưởng vận hành:

- Sửa file trên một Node chỉ đổi instance đó.
- Update nên thực hiện từng control-plane Node và xác minh quorum/availability.
- Lỗi YAML hoặc flag có thể làm component trên Node đó biến mất.
- API Server hỏng không ngăn kubelet tiếp tục restart static control-plane containers.

> [!CAUTION]
> Không dùng editor tạo temporary file trong manifest directory khi sửa control plane. Copy manifest ra directory khác, validate, rồi thay file atomically theo runbook của distribution. Luôn giữ rollback copy ngoài watched directory.

## 6. Tạo Static Pod

Lab yêu cầu SSH/root trên một disposable worker Node và biết `staticPodPath`. Managed Kubernetes thường không cho phép hoặc không hỗ trợ thao tác này. Không chạy lab trên production control-plane Node.

### Bước 1: Xác định path

Trên Node:

```bash
sudo grep -R "staticPodPath" /var/lib/kubelet/config.yaml /etc/kubernetes 2>/dev/null
```

Giả sử path là `/etc/kubernetes/manifests`. Tạo manifest:

```bash
sudo tee /etc/kubernetes/manifests/static-web.yaml >/dev/null <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: static-web
  namespace: default
  labels:
    app: static-web
spec:
  containers:
    - name: web
      image: nginx:1.27-alpine
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
        limits:
          memory: 64Mi
EOF
```

Không đặt `spec.nodeName`; kubelet gắn workload vào chính Node của nó.

### Bước 2: Xác minh local runtime

```bash
sudo crictl pods --name static-web
sudo crictl ps --name web
```

Nếu `crictl` chưa biết endpoint, cấu hình theo container runtime của distribution.

### Bước 3: Xác minh mirror Pod

Từ máy có `kubectl`:

```bash
kubectl get pods -l app=static-web -o wide
```

Tên mirror có suffix Node. Cột `NODE` phải là Node chứa manifest.

### Bước 4: Chứng minh mirror không phải owner

Xóa mirror rồi quan sát:

```bash
kubectl delete pod -l app=static-web
kubectl get pods -l app=static-web -o wide --watch
```

Kubelet tiếp tục chạy Static Pod và tạo mirror mới. Dừng watch bằng `Ctrl+C`.

## 7. Update, rollback và cleanup

### Update

1. Copy manifest hiện tại ra ngoài watched directory.
2. Validate YAML/API fields.
3. Thay manifest.
4. Theo dõi kubelet log, CRI container và health endpoint/component.
5. Chỉ tiếp tục Node kế tiếp sau khi instance hiện tại healthy.

Kubelet có thể recreate Pod khi manifest hash đổi; đây là restart, không phải rolling update do Deployment quản lý.

### Rollback

Khôi phục file tốt đã lưu **ngoài** watched directory, rồi xác minh container/mirror/health. Với API Server hoặc etcd, dùng runbook của distribution và kiểm tra quorum trước thao tác tiếp.

### Cleanup lab

Trên Node:

```bash
sudo rm /etc/kubernetes/manifests/static-web.yaml
sudo crictl pods --name static-web
```

Từ client:

```bash
kubectl get pods -l app=static-web
```

Kubelet phải dừng container; mirror biến mất khi API communication hoạt động.

## 8. Troubleshooting

### Không thấy mirror Pod

Mirror absence không chứng minh container không chạy. Kiểm tra local:

```bash
sudo crictl pods
sudo journalctl -u kubelet --since "15 minutes ago"
```

Sau đó kiểm tra kubelet credential, Node registration, API connectivity và namespace trong manifest.

### Manifest sửa nhưng workload không đổi

- Xác nhận đúng `staticPodPath` và đúng Node.
- Kiểm tra file permission và YAML parse error trong kubelet log.
- Không dùng symlink hoặc cách atomic update mà distribution/kubelet setup không theo dõi như dự kiến nếu chưa test.
- So sánh manifest hash/annotations trên mirror Pod và local file.

### Container crash loop

```bash
sudo crictl ps -a --name COMPONENT
sudo crictl logs CONTAINER_ID
sudo journalctl -u kubelet
```

Với control plane, kiểm tra hostPath, certificate expiry/path, command flags, port conflict và dependency như etcd.

### `kubectl delete` không có tác dụng

Đây là behavior dự kiến. Xóa hoặc sửa manifest source trên Node. Nếu không có node access, escalate cho cluster operator; không lặp delete mirror.

## 9. Security và best practices

- Chỉ dùng Static Pod khi cần bootstrap/node-local lifecycle; ưu tiên controller cho application.
- Hạn chế SSH/root và quyền sửa manifest directory.
- Version-control/generate manifest từ automation, nhưng giữ secret/key ngoài repository.
- Backup bên ngoài watched directory và dùng atomic, canary update từng Node.
- Đặt requests/limits và health checks phù hợp dù scheduler không tham gia.
- Theo dõi cả mirror Pod lẫn node-local CRI/kubelet signal.
- Không đặt file tạm/backup trong manifest directory.
- Với control plane, bảo vệ HA/quorum và dùng upgrade workflow của distribution thay vì sửa ad hoc.

## Tài liệu tham khảo

- [Create static Pods](https://kubernetes.io/docs/tasks/configure-pod-container/static-pod/)
- [kubelet và Container Runtime](/kien-truc/kubelet-container-runtime/)
- [DaemonSet](/workloads/daemonset/)
