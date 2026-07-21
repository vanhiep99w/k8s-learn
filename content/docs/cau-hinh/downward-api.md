---
title: "Downward API"
description: "Expose metadata, Pod/Node identity và resource requests/limits vào container qua fieldRef, resourceFieldRef hoặc downwardAPI volume mà không gọi API Server."
---

# Downward API

## Mục lục

- [Tổng quan](#tổng-quan)
- [1. Downward API giải quyết vấn đề gì?](#1-downward-api-giải-quyết-vấn-đề-gì)
- [2. Hai cơ chế: environment và volume](#2-hai-cơ-chế-environment-và-volume)
- [3. fieldRef: metadata và identity](#3-fieldref-metadata-và-identity)
- [4. resourceFieldRef: requests và limits](#4-resourcefieldref-requests-và-limits)
- [5. Downward API volume](#5-downward-api-volume)
- [6. Giá trị có cập nhật khi Pod đang chạy không](#6-giá-trị-có-cập-nhật-khi-pod-đang-chạy-không)
- [7. Use cases và anti-patterns](#7-use-cases-và-anti-patterns)
- [8. Manifest hoàn chỉnh](#8-manifest-hoàn-chỉnh)
- [9. Thực hành](#9-thực-hành)
- [10. Troubleshooting](#10-troubleshooting)
- [11. Best practices](#11-best-practices)
- [Tài liệu tham khảo](#tài-liệu-tham-khảo)

---

## Tổng quan

Downward API cho container biết thông tin về **chính Pod/container của nó** mà không cần Kubernetes client, ServiceAccount token hoặc gọi API server.

```text
Pod metadata/spec/status
├── metadata.name
├── metadata.namespace
├── metadata.uid
├── labels / annotations
├── Pod IP / Node name
└── container requests / limits
          ↓
   fieldRef / resourceFieldRef
          ↓
 environment variables hoặc files
```

Tên “downward” mô tả dữ liệu đi từ Kubernetes control plane/kubelet **xuống** workload.

> [!IMPORTANT]
> Downward API chỉ expose một tập field được whitelist, không phải toàn bộ Pod object. Nếu cần watch resource khác hoặc status phức tạp, application mới cần Kubernetes API client và RBAC.

## 1. Downward API giải quyết vấn đề gì?

Use cases phổ biến:

- Gắn `POD_NAME`, `POD_NAMESPACE`, `POD_UID` vào log/traces.
- Application tạo unique instance identifier.
- Agent biết Node hoặc Pod IP.
- Chuyển labels/annotations thành file cho telemetry agent.
- Runtime tự tính worker/heap theo CPU/memory limit.
- Script biết resource request để cấu hình concurrency.

Không có Downward API, application có thể phải:

- Hard-code thông tin không tồn tại trước khi schedule.
- Gọi API server, cần token/RBAC/network/retry.
- Parse hostname với giả định hostname luôn bằng Pod name.

Downward API giảm coupling và quyền cần cấp.

## 2. Hai cơ chế: environment và volume

| Cơ chế | Field | Update khi Pod metadata/resource đổi | Phù hợp |
|---|---|---|---|
| Environment | `env.valueFrom` | Không đổi đến khi container restart | Identity cố định, startup config |
| Volume file | `volumes.downwardAPI.items` | Một số field được cập nhật dần | Labels/annotations/resource cần reread |

Không phải field nào cũng dùng được qua cả hai cơ chế.

## 3. fieldRef: metadata và identity

### 3.1 Các field dùng qua environment hoặc volume

- `metadata.name`
- `metadata.namespace`
- `metadata.uid`
- Một label cụ thể: `metadata.labels['key']`
- Một annotation cụ thể: `metadata.annotations['key']`

```yaml
env:
  - name: POD_NAME
    valueFrom:
      fieldRef:
        fieldPath: metadata.name
  - name: APP_VERSION
    valueFrom:
      fieldRef:
        fieldPath: metadata.labels['app.kubernetes.io/version']
```

Quote key bên trong `fieldPath` đúng cú pháp, nhất là key chứa `/` hoặc `.`.

### 3.2 Field chỉ phổ biến qua environment

- `spec.serviceAccountName`
- `spec.nodeName`
- `status.hostIP`, `status.hostIPs`
- `status.podIP`, `status.podIPs`

```yaml
env:
  - name: NODE_NAME
    valueFrom:
      fieldRef:
        fieldPath: spec.nodeName
  - name: POD_IP
    valueFrom:
      fieldRef:
        fieldPath: status.podIP
```

Pod IP chưa tồn tại trước network setup; kubelet tạo environment tại container start sau khi thông tin cần thiết có sẵn.

### 3.3 Toàn bộ labels/annotations qua volume

Volume có thể expose:

- `metadata.labels`
- `metadata.annotations`

Mỗi dòng có dạng key="escaped-value". Đây không phải JSON/YAML; agent cần parse format đúng hoặc chỉ chọn key riêng.

## 4. resourceFieldRef: requests và limits

`resourceFieldRef` expose resource của một container:

```yaml
env:
  - name: CPU_REQUEST_MILLICORES
    valueFrom:
      resourceFieldRef:
        containerName: api
        resource: requests.cpu
        divisor: 1m
  - name: MEMORY_LIMIT_MIB
    valueFrom:
      resourceFieldRef:
        containerName: api
        resource: limits.memory
        divisor: 1Mi
```

Các resource phổ biến:

- `requests.cpu`, `limits.cpu`
- `requests.memory`, `limits.memory`
- `requests.ephemeral-storage`, `limits.ephemeral-storage`
- `requests.hugepages-*`, `limits.hugepages-*`

### 4.1 `divisor`

Kubernetes quantity được chia cho divisor để tạo integer/string dễ dùng:

| Resource | Giá trị | Divisor | Kết quả ý tưởng |
|---|---:|---:|---:|
| CPU limit | `500m` | `1m` | `500` millicores |
| CPU limit | `2` | `1` | `2` cores |
| Memory limit | `512Mi` | `1Mi` | `512` MiB |
| Memory limit | `1Gi` | `1Mi` | `1024` MiB |

Luôn đặt divisor để application không phải parse Kubernetes quantity phức tạp.

### 4.2 `containerName`

Trong Pod nhiều container, resource thuộc từng container. `containerName` nên khai báo tường minh, nhất là khi source nằm trong volume hoặc template dùng chung.

### 4.3 Không có limit

Nếu CPU/memory limit không khai báo nhưng Downward API yêu cầu limit, kubelet có thể expose giá trị fallback dựa trên Node allocatable. Đây hiếm khi là application contract tốt: giá trị phụ thuộc Node và có thể rất lớn. Production nên khai báo resources rõ thay vì dựa vào fallback.

## 5. Downward API volume

```yaml
volumes:
  - name: podinfo
    downwardAPI:
      defaultMode: 0444
      items:
        - path: name
          fieldRef:
            fieldPath: metadata.name
        - path: namespace
          fieldRef:
            fieldPath: metadata.namespace
        - path: labels
          fieldRef:
            fieldPath: metadata.labels
        - path: memory_limit_mib
          resourceFieldRef:
            containerName: api
            resource: limits.memory
            divisor: 1Mi
```

Mount:

```yaml
volumeMounts:
  - name: podinfo
    mountPath: /etc/podinfo
    readOnly: true
```

Container thấy:

```text
/etc/podinfo/name
/etc/podinfo/namespace
/etc/podinfo/labels
/etc/podinfo/memory_limit_mib
```

### 5.1 Projected volume kết hợp nhiều nguồn

Có thể kết hợp Downward API, ConfigMap, Secret và ServiceAccount token trong `projected` volume:

```yaml
volumes:
  - name: runtime-data
    projected:
      sources:
        - downwardAPI:
            items:
              - path: pod/name
                fieldRef:
                  fieldPath: metadata.name
        - configMap:
            name: app-config
            items:
              - key: application.yaml
                path: config/application.yaml
```

Giữ path không collision và permission phù hợp.

## 6. Giá trị có cập nhật khi Pod đang chạy không

### 6.1 Environment là snapshot

Label/annotation/resource đổi sau container start không đổi environment. Pod name/UID/namespace vốn bất biến nên env phù hợp.

### 6.2 Volume cập nhật eventual-consistently

Labels/annotations và resource fields được project qua volume có thể được kubelet cập nhật. Độ trễ phụ thuộc sync/watch/cache. Application phải reopen file hoặc watch directory đúng cách.

Với in-place resource resize trên cluster hỗ trợ, Downward API volume có thể cập nhật CPU/memory mới; environment không cập nhật đến khi restart.

### 6.3 `subPath` caveat

Như ConfigMap/Secret, file mounted qua `subPath` thường không nhận update projection. Mount cả directory nếu cần metadata động.

### 6.4 Metadata churn

Nếu controller cập nhật annotation liên tục, mọi Pod volume liên quan có thể nhận nhiều projection updates. Không dùng Pod annotations như high-frequency message bus.

## 7. Use cases và anti-patterns

### 7.1 Telemetry resource attributes

Inject:

```yaml
env:
  - name: K8S_POD_NAME
    valueFrom:
      fieldRef:
        fieldPath: metadata.name
  - name: K8S_NAMESPACE_NAME
    valueFrom:
      fieldRef:
        fieldPath: metadata.namespace
  - name: K8S_NODE_NAME
    valueFrom:
      fieldRef:
        fieldPath: spec.nodeName
```

Agent/application đưa vào structured logs/traces. Tránh label có cardinality quá cao làm nổ chi phí metrics.

### 7.2 Heap sizing

Application có thể tính heap bằng phần trăm memory limit. Nhưng phải chừa native memory, thread stack, JIT, page cache và side process. `heap = 100% limit` gần như đảm bảo OOM.

### 7.3 Worker concurrency

CPU limit millicores có thể giúp default worker count, nhưng CPU request đôi khi phản ánh guaranteed capacity tốt hơn limit. Chọn theo workload và CPU throttling policy.

### 7.4 Anti-patterns

- Dùng Pod name làm durable business identity cho Deployment; Pod bị thay sẽ có tên/UID mới.
- Dựa vào Node name để gọi node-local service mà không có discovery/failure handling.
- Đưa toàn bộ labels vào metric labels không kiểm soát.
- Gọi API server chỉ để lấy Pod name trong khi Downward API đủ.
- Dùng annotations để phân phối config lớn/tần suất cao.

## 8. Manifest hoàn chỉnh

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: runtime
spec:
  replicas: 2
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
        app.kubernetes.io/version: "2.1.0"
      annotations:
        owner.example.com/team: platform-api
    spec:
      containers:
        - name: api
          image: example.com/api:2.1.0
          resources:
            requests:
              cpu: 250m
              memory: 256Mi
            limits:
              cpu: "1"
              memory: 512Mi
          env:
            - name: POD_NAME
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name
            - name: POD_NAMESPACE
              valueFrom:
                fieldRef:
                  fieldPath: metadata.namespace
            - name: POD_IP
              valueFrom:
                fieldRef:
                  fieldPath: status.podIP
            - name: MEMORY_LIMIT_MIB
              valueFrom:
                resourceFieldRef:
                  containerName: api
                  resource: limits.memory
                  divisor: 1Mi
          volumeMounts:
            - name: podinfo
              mountPath: /etc/podinfo
              readOnly: true
      volumes:
        - name: podinfo
          downwardAPI:
            items:
              - path: labels
                fieldRef:
                  fieldPath: metadata.labels
              - path: team
                fieldRef:
                  fieldPath: metadata.annotations['owner.example.com/team']
```

## 9. Thực hành

```bash
kubectl create namespace downward-lab
cat <<'EOF' > downward-demo.yaml
apiVersion: v1
kind: Pod
metadata:
  name: downward-demo
  namespace: downward-lab
  labels:
    app: demo
    version: v1
  annotations:
    owner: learning-team
spec:
  containers:
    - name: demo
      image: busybox:1.36
      resources:
        requests: {cpu: 50m, memory: 16Mi}
        limits: {cpu: 100m, memory: 32Mi}
      env:
        - name: POD_NAME
          valueFrom:
            fieldRef:
              fieldPath: metadata.name
        - name: MEMORY_LIMIT_MIB
          valueFrom:
            resourceFieldRef:
              containerName: demo
              resource: limits.memory
              divisor: 1Mi
      command: ["/bin/sh", "-c"]
      args: ['while true; do echo "pod=$POD_NAME memoryMi=$MEMORY_LIMIT_MIB"; cat /podinfo/labels; sleep 10; done']
      volumeMounts:
        - name: podinfo
          mountPath: /podinfo
          readOnly: true
  volumes:
    - name: podinfo
      downwardAPI:
        items:
          - path: labels
            fieldRef:
              fieldPath: metadata.labels
          - path: annotations
            fieldRef:
              fieldPath: metadata.annotations
EOF
kubectl apply -f downward-demo.yaml
kubectl logs downward-demo -n downward-lab
```

Sửa label:

```bash
kubectl label pod downward-demo -n downward-lab version=v2 --overwrite
kubectl exec downward-demo -n downward-lab -- cat /podinfo/labels
```

Sau propagation delay, file phản ánh `version="v2"`; environment identity không đổi.

Cleanup:

```bash
kubectl delete namespace downward-lab
rm -f downward-demo.yaml
```

## 10. Troubleshooting

### 10.1 `fieldPath` không được hỗ trợ

API server validation từ chối field ngoài whitelist. Kiểm tra:

```bash
kubectl explain pod.spec.containers.env.valueFrom.fieldRef
kubectl explain pod.spec.volumes.downwardAPI.items.fieldRef
```

Không thể dùng JSONPath tùy ý trong `fieldPath`.

### 10.2 Label/annotation env rỗng hoặc Pod không tạo

Kiểm tra key tồn tại trên **Pod metadata**, không chỉ Deployment metadata. Label phải nằm trong `spec.template.metadata` để xuất hiện trên Pod.

### 10.3 Resource value bất ngờ

Kiểm tra `containerName`, resource, divisor và resources sau admission. Limit thiếu có thể trả fallback theo Node.

### 10.4 File không cập nhật

Kiểm tra `subPath`, kubelet sync và application có reopen file không. Update eventual, không tức thời.

### 10.5 Pod IP không phù hợp cho client bên ngoài

Pod IP là runtime identity có thể đổi khi Pod thay. Không publish nó như stable endpoint; dùng Service/DNS.

## 11. Best practices

- Dùng Downward API thay API client khi chỉ cần self-metadata.
- Dùng environment cho field bất biến; volume cho labels/annotations/resource cần reread.
- Đặt `divisor` rõ ràng cho resourceFieldRef.
- Khai báo `containerName` trong Pod nhiều container.
- Không coi Pod name/IP là durable identity ngoài lifecycle Pod.
- Kiểm soát cardinality khi đưa metadata vào metrics/traces.
- Mount read-only và tránh `subPath` nếu cần update.
- Không dùng annotation như high-frequency config bus.
- Test manifest trên Kubernetes version/platform mục tiêu vì field support thay đổi.

Tiếp tục với [ResourceQuota và LimitRange](/cau-hinh/resource-quota-limitrange/) để áp guardrail ở cấp Namespace.

---

## Tài liệu tham khảo

- [Downward API](https://kubernetes.io/docs/concepts/workloads/pods/downward-api/)
- [Expose Pod Information through Environment Variables](https://kubernetes.io/docs/tasks/inject-data-application/environment-variable-expose-pod-information/)
- [Expose Pod Information through Files](https://kubernetes.io/docs/tasks/inject-data-application/downward-api-volume-expose-pod-information/)
