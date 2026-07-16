---
title: "Cài đặt môi trường học tập"
description: "Hướng dẫn cài kubectl, Docker và kind để tạo local Kubernetes cluster trên Linux, macOS hoặc Windows."
---

# Cài đặt môi trường học tập

## Mục lục

- [Tổng quan](#tổng-quan)
- [1. Chọn môi trường học](#1-chọn-môi-trường-học)
- [2. Yêu cầu hệ thống](#2-yêu-cầu-hệ-thống)
- [3. Cài Container Engine](#3-cài-container-engine)
- [4. Cài kubectl](#4-cài-kubectl)
- [5. Cài kind](#5-cài-kind)
- [6. Tạo local cluster](#6-tạo-local-cluster)
- [7. Tạo cluster nhiều Node](#7-tạo-cluster-nhiều-node)
- [8. Cấu hình shell và editor](#8-cấu-hình-shell-và-editor)
- [9. Xác minh môi trường](#9-xác-minh-môi-trường)
- [10. Troubleshooting](#10-troubleshooting)
- [11. Cleanup](#11-cleanup)
- [Tài liệu tham khảo](#tài-liệu-tham-khảo)

---

## Tổng quan

Môi trường được khuyến nghị cho phần lớn lab trong repo:

```text
Laptop → Docker hoặc Podman → kind nodes → Kubernetes cluster
                                      ↑
                                   kubectl
```

`kind` là viết tắt của **Kubernetes IN Docker**. Mỗi Kubernetes Node được chạy dưới dạng Container. Cách này nhanh, dễ tạo lại và phù hợp để học API, workloads, networking cơ bản, security và troubleshooting.

> [!IMPORTANT]
> Local cluster không mô phỏng hoàn toàn cloud production. LoadBalancer, persistent storage, IAM, multi-zone failure và network implementation có thể khác. Dùng local cluster để học primitive trước, sau đó mới chuyển sang managed Kubernetes.

---

## 1. Chọn môi trường học

| Công cụ | Cách hoạt động | Phù hợp |
|---------|----------------|---------|
| **kind** | Kubernetes Nodes chạy trong Container | Lab nhanh, CI, multi-node local |
| **minikube** | Local cluster dùng VM hoặc Container driver | Người mới, addon tích hợp |
| **k3d** | Chạy k3s trong Docker | Local development nhẹ |
| **Docker Desktop Kubernetes** | Cluster tích hợp trong Docker Desktop | macOS/Windows, setup GUI |
| **Managed Kubernetes** | Cluster do cloud provider quản lý | Học tích hợp cloud và production |
| **kubeadm** | Tự bootstrap cluster trên máy/VM | Học cluster administration |

Repo dùng `kind` làm đường dẫn chính vì cluster có thể tạo và xóa bằng command, không phụ thuộc GUI và dễ dùng trong CI.

---

## 2. Yêu cầu hệ thống

### 2.1 Phần cứng gợi ý

| Môi trường | CPU | RAM trống | Disk trống |
|------------|-----|-----------|------------|
| Single-node lab | 2 cores | 4 GB | 10 GB |
| Multi-node lab | 4 cores | 8 GB | 20 GB |
| Observability stack | 6+ cores | 12+ GB | 30+ GB |

### 2.2 Phần mềm

- Linux, macOS hoặc Windows 11 với WSL2.
- Docker Engine, Docker Desktop hoặc Podman.
- `kubectl`.
- `kind`.
- `curl` và Git.
- Code editor hỗ trợ YAML.

Kiểm tra kiến trúc CPU:

```bash
uname -m
```

Giá trị thường gặp:

- `x86_64`: AMD64.
- `aarch64` hoặc `arm64`: ARM64.

Chọn đúng binary theo OS và CPU architecture.

---

## 3. Cài Container Engine

### 3.1 Linux

Cài Docker Engine theo repository chính thức của Docker cho distribution đang dùng. Sau khi cài, xác minh:

```bash
docker version
docker run --rm hello-world
```

Nếu chỉ chạy được với `sudo`, có thể thêm user vào group `docker` theo tài liệu Docker:

```bash
sudo usermod -aG docker "$USER"
newgrp docker
```

> [!WARNING]
> Thành viên group `docker` gần tương đương quyền root trên host. Chỉ thêm user tin cậy và hiểu rủi ro bảo mật.

### 3.2 macOS

Cài Docker Desktop hoặc một Container runtime tương thích. Với Homebrew:

```bash
brew install --cask docker
```

Mở Docker Desktop và chờ Engine sẵn sàng, sau đó chạy:

```bash
docker version
```

### 3.3 Windows

Cách đơn giản là Docker Desktop với WSL2 backend:

1. Bật WSL2 và cài một Linux distribution.
2. Cài Docker Desktop.
3. Bật **Use the WSL 2 based engine**.
4. Bật integration cho distribution đang dùng.
5. Chạy command trong WSL terminal.

```bash
docker version
docker run --rm hello-world
```

Nên đặt source code trong filesystem của WSL, ví dụ `~/projects`, thay vì mount thường xuyên từ `C:\` để có hiệu năng filesystem tốt hơn.

---

## 4. Cài kubectl

`kubectl` là CLI gửi request đến Kubernetes API Server. Client nên nằm trong phạm vi tương thích được Kubernetes hỗ trợ so với version của cluster; tránh dùng client quá cũ hoặc quá mới.

### 4.1 Linux AMD64

```bash
KUBECTL_VERSION="$(curl -L -s https://dl.k8s.io/release/stable.txt)"
curl -LO "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl"
curl -LO "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl.sha256"
echo "$(cat kubectl.sha256)  kubectl" | sha256sum --check
sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl
rm kubectl kubectl.sha256
```

Với ARM64, thay `amd64` bằng `arm64`.

### 4.2 macOS

```bash
brew install kubectl
```

### 4.3 Windows

PowerShell với WinGet:

```powershell
winget install -e --id Kubernetes.kubectl
```

Nếu làm lab trong WSL, hãy cài Linux binary của `kubectl` bên trong WSL để đường dẫn và shell behavior nhất quán.

### 4.4 Xác minh

```bash
kubectl version --client
```

Lệnh này không cần cluster. Nếu shell báo `command not found`, kiểm tra file executable có nằm trong `$PATH` hay không:

```bash
command -v kubectl
echo "$PATH"
```

---

## 5. Cài kind

### 5.1 Dùng package manager

macOS:

```bash
brew install kind
```

Windows:

```powershell
winget install Kubernetes.kind
```

Linux có Go toolchain:

```bash
go install sigs.k8s.io/kind@latest
```

Đảm bảo `$(go env GOPATH)/bin` nằm trong `$PATH` nếu cài bằng Go.

### 5.2 Dùng release binary

Tải release ổn định mới nhất từ trang chính thức của kind, chọn đúng binary cho OS/architecture, đặt tên thành `kind`, cấp quyền execute và chuyển vào `/usr/local/bin`.

Ví dụ quy trình Linux sau khi đã tải đúng file:

```bash
chmod +x ./kind
sudo mv ./kind /usr/local/bin/kind
kind version
```

Không copy một version cố định từ blog cũ. Hãy dùng release page chính thức và kiểm tra checksum nếu release cung cấp.

---

## 6. Tạo local cluster

### 6.1 Tạo cluster

```bash
kind create cluster --name k8s-learn --wait 5m
```

`kind` sẽ:

1. Pull node image.
2. Tạo Container làm Node.
3. Bootstrap Kubernetes components.
4. Ghi cluster, user và context vào kubeconfig.
5. Chờ Control Plane Ready nếu có `--wait`.

### 6.2 Kiểm tra context

```bash
kubectl config current-context
kubectl config get-contexts
```

Context mặc định của cluster trên là:

```text
kind-k8s-learn
```

Chọn đúng context trước mọi thao tác:

```bash
kubectl config use-context kind-k8s-learn
```

> [!CAUTION]
> Luôn kiểm tra context trước `apply`, `delete` hoặc thay đổi cluster-scoped resource. Dùng nhầm context là lỗi vận hành phổ biến và nguy hiểm.

### 6.3 Kiểm tra cluster

```bash
kubectl cluster-info
kubectl get nodes -o wide
kubectl get pods -A
```

Kết quả mong đợi:

- Node có trạng thái `Ready`.
- Các Pod hệ thống trong `kube-system` chuyển về `Running`.
- CoreDNS có thể mất một khoảng ngắn trước khi Ready.

---

## 7. Tạo cluster nhiều Node

Tạo file `kind-multi-node.yaml`:

```yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
  - role: worker
  - role: worker
```

Tạo cluster:

```bash
kind create cluster \
  --name k8s-multi \
  --config kind-multi-node.yaml \
  --wait 5m
```

Xác minh:

```bash
kubectl config use-context kind-k8s-multi
kubectl get nodes
```

Multi-node cluster giúp thực hành:

- Node selectors và affinity.
- Taints và tolerations.
- Pod topology spread.
- Drain và rescheduling.
- DaemonSet.

Không cần dùng multi-node cho các bài đầu tiên vì tốn thêm RAM.

---

## 8. Cấu hình shell và editor

### 8.1 Bash autocomplete

```bash
source <(kubectl completion bash)
echo 'source <(kubectl completion bash)' >> ~/.bashrc
```

Alias tùy chọn:

```bash
alias k=kubectl
complete -o default -F __start_kubectl k
```

### 8.2 Zsh autocomplete

```bash
source <(kubectl completion zsh)
echo '[[ $commands[kubectl] ]] && source <(kubectl completion zsh)' >> ~/.zshrc
```

### 8.3 Editor

Nên bật:

- YAML language support.
- Kubernetes schema validation.
- Hiển thị whitespace và indentation.
- Format on save có kiểm soát.

Editor validation giúp bắt typo, nhưng API Server mới là nguồn xác thực cuối cùng. Dùng server-side dry run trước khi apply:

```bash
kubectl apply --dry-run=server -f manifest.yaml
```

---

## 9. Xác minh môi trường

Chạy toàn bộ checklist:

```bash
docker version
kind version
kubectl version --client
kubectl config current-context
kubectl cluster-info
kubectl get nodes
kubectl get pods -A
kubectl api-resources | head
kubectl auth can-i get pods
```

Test API bằng một Pod tạm:

```bash
kubectl run environment-check \
  --image=nginx:1.27-alpine \
  --restart=Never

kubectl wait \
  --for=condition=Ready \
  pod/environment-check \
  --timeout=90s

kubectl get pod environment-check -o wide
kubectl delete pod environment-check
```

Nếu `wait` thành công, cluster có thể schedule Pod, pull image và khởi động Container.

---

## 10. Troubleshooting

### 10.1 `Cannot connect to the Docker daemon`

```bash
docker info
```

Kiểm tra Docker service/Desktop đang chạy và user có quyền truy cập socket. Trên Linux:

```bash
systemctl status docker
```

### 10.2 `kubectl` kết nối sai cluster

```bash
kubectl config get-contexts
kubectl config current-context
kubectl config use-context kind-k8s-learn
```

Kiểm tra biến `KUBECONFIG` nếu config không nằm ở vị trí mặc định:

```bash
echo "$KUBECONFIG"
kubectl config view --minify
```

### 10.3 Node `NotReady`

```bash
kubectl describe node
kubectl get pods -n kube-system
kind export logs --name k8s-learn ./kind-logs
```

Nguyên nhân thường gặp: thiếu RAM, Container Engine lỗi, networking của host hoặc image pull chưa hoàn thành.

### 10.4 Pod `ImagePullBackOff`

```bash
kubectl describe pod <pod-name>
```

Đọc Events cuối output. Kiểm tra image name, tag, registry connectivity, rate limit và credentials.

### 10.5 Port đã được sử dụng

Nếu kind config map host port, kiểm tra process đang giữ port:

```bash
sudo ss -lntp | grep ':80 '
```

Đổi `hostPort` hoặc dừng process xung đột.

### 10.6 Cluster quá chậm

- Tăng CPU/RAM cho Docker Desktop hoặc VM.
- Xóa cluster và Container/Image không dùng.
- Chỉ chạy single-node ở bài cơ bản.
- Không cài observability stack nặng trên máy ít RAM.

---

## 11. Cleanup

Liệt kê cluster:

```bash
kind get clusters
```

Xóa cluster:

```bash
kind delete cluster --name k8s-learn
kind delete cluster --name k8s-multi
```

Tạo lại cluster thường nhanh và an toàn hơn cố sửa một local cluster đã thay đổi quá nhiều. Manifest phải được lưu trong Git để môi trường có thể tái tạo.

Bước tiếp theo: [kubectl cơ bản](/gioi-thieu/kubectl-co-ban/) và [Triển khai ứng dụng đầu tiên](/gioi-thieu/first-application/).

---

## Tài liệu tham khảo

- [Kubernetes Install Tools](https://kubernetes.io/docs/tasks/tools/)
- [Install kubectl](https://kubernetes.io/docs/tasks/tools/install-kubectl-linux/)
- [kind Quick Start](https://kind.sigs.k8s.io/docs/user/quick-start/)
- [minikube Start](https://minikube.sigs.k8s.io/docs/start/)
- [Docker Engine Installation](https://docs.docker.com/engine/install/)
- [Configure Access to Multiple Clusters](https://kubernetes.io/docs/tasks/access-application-cluster/configure-access-multiple-clusters/)
