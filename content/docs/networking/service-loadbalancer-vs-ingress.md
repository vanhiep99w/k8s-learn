---
title: "Service LoadBalancer và Ingress"
description: "So sánh Service type LoadBalancer với Ingress về kiến trúc, chi phí, routing, HTTPS, mức độ phụ thuộc controller và cách lựa chọn trong thực tế."
---

# Service LoadBalancer và Ingress

## Mục lục

- [Câu hỏi cần giải quyết](#câu-hỏi-cần-giải-quyết)
- [Hai cách expose ứng dụng](#hai-cách-expose-ứng-dụng)
- [Service type LoadBalancer hoạt động thế nào?](#service-type-loadbalancer-hoạt-động-thế-nào)
- [Ingress hoạt động thế nào?](#ingress-hoạt-động-thế-nào)
- [Khác biệt quan trọng nhất](#khác-biệt-quan-trọng-nhất)
- [So sánh khả năng cấu hình](#so-sánh-khả-năng-cấu-hình)
- [So sánh chi phí](#so-sánh-chi-phí)
- [Mức độ phụ thuộc vào cloud provider](#mức-độ-phụ-thuộc-vào-cloud-provider)
- [HTTPS và TLS](#https-và-tls)
- [Khi nào nên dùng Service LoadBalancer?](#khi-nào-nên-dùng-service-loadbalancer)
- [Khi nào nên dùng Ingress?](#khi-nào-nên-dùng-ingress)
- [Các hiểu lầm thường gặp](#các-hiểu-lầm-thường-gặp)
- [Bảng quyết định nhanh](#bảng-quyết-định-nhanh)
- [Câu trả lời phỏng vấn](#câu-trả-lời-phỏng-vấn)
- [Tóm tắt](#tóm-tắt)
- [Tài liệu tham khảo](#tài-liệu-tham-khảo)

## Câu hỏi cần giải quyết

Một Pod không nên được public trực tiếp ra Internet. Pod có thể bị tạo lại, đổi IP hoặc được thay thế trong lúc rollout. Kubernetes cung cấp `Service` để tạo endpoint ổn định cho một nhóm Pod, nhưng Service mặc định chỉ có thể truy cập bên trong cluster.

Khi cần nhận traffic từ bên ngoài, có hai lựa chọn thường bị nhầm lẫn:

1. Đổi Service thành `type: LoadBalancer`.
2. Giữ các Service backend ở dạng `ClusterIP` rồi dùng `Ingress` và Ingress Controller.

Cả hai cách đều có thể làm một website truy cập được từ Internet. Điểm khác nhau nằm ở **nơi ta mô tả routing**, **thành phần thực thi routing**, số lượng entry point và mức độ kiểm soát Load Balancer.

Nếu cần ôn lại các Service type trước, đọc [ClusterIP, NodePort và LoadBalancer](/networking/service-types/). Nếu muốn học chi tiết resource và controller của Ingress, xem [Ingress](/networking/ingress/).

## Hai cách expose ứng dụng

Giả sử cluster có ba ứng dụng:

```text
frontend-service
user-service
order-service
```

### Mỗi Service dùng một Load Balancer

Cách thứ nhất là expose từng Service:

```text
Internet
   |
   +--> Load Balancer 1 --> frontend-service --> frontend Pods
   |
   +--> Load Balancer 2 --> user-service     --> user Pods
   |
   +--> Load Balancer 3 --> order-service    --> order Pods
```

Trong manifest, phần khai báo có thể rất nhỏ:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: frontend
  namespace: production
spec:
  type: LoadBalancer
  selector:
    app: frontend
  ports:
    - name: http
      port: 80
      targetPort: 8080
```

Kubernetes hoặc controller của nền tảng sẽ xử lý yêu cầu này. Trên cloud, controller thường gọi API của cloud provider để provision một external hoặc internal Load Balancer rồi ghi địa chỉ vào `status.loadBalancer` của Service.

### Một entry point route đến nhiều Service

Cách thứ hai là giữ các backend là `ClusterIP` và khai báo luật HTTP/HTTPS bằng Ingress:

```text
Internet
   |
   v
Một entry point public
   |
   v
Ingress Controller
   |
   +--> /users  --> user-service
   +--> /orders --> order-service
   +--> /       --> frontend-service
```

Ví dụ rule:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: shop
  namespace: production
spec:
  ingressClassName: nginx-public
  rules:
    - host: shop.example.com
      http:
        paths:
          - path: /users
            pathType: Prefix
            backend:
              service:
                name: user
                port:
                  number: 80
          - path: /orders
            pathType: Prefix
            backend:
              service:
                name: order
                port:
                  number: 80
          - path: /
            pathType: Prefix
            backend:
              service:
                name: frontend
                port:
                  number: 80
```

`Ingress` chỉ là resource mô tả rule. Ingress Controller mới là thành phần đọc rule và cấu hình proxy hoặc cloud Load Balancer để nhận request thật. Vì vậy tạo Ingress mà không có controller phù hợp sẽ không public được ứng dụng.

## Service type LoadBalancer hoạt động thế nào?

Khi bạn tạo Service với:

```yaml
spec:
  type: LoadBalancer
```

luồng control plane thường là:

```text
Service manifest
      |
      v
Kubernetes API Server
      |
      v
Cloud/LB controller
      |
      v
Cloud provider API
      |
      v
External Load Balancer
```

Kiểm tra trạng thái provisioning bằng:

```bash
kubectl get service frontend -n production -o wide
kubectl describe service frontend -n production
```

Địa chỉ public hoặc hostname thường xuất hiện trong `EXTERNAL-IP` hoặc trường:

```bash
kubectl get service frontend -n production \
  -o jsonpath='{.status.loadBalancer.ingress}{{"\n"}}'
```

Quá trình này có thể bất đồng bộ. Nếu `EXTERNAL-IP` còn là `<pending>`, cần kiểm tra Events, controller, quota, permission, subnet, firewall và cấu hình provider thay vì kết luận rằng Service manifest sai.

### Service LoadBalancer mô tả được gì?

Kubernetes Service chuẩn mô tả được các thông tin như:

- Service name và Namespace.
- Selector của backend Pod.
- Service port và `targetPort`.
- Protocol như TCP hoặc UDP khi implementation hỗ trợ.
- Một số traffic policy như `externalTrafficPolicy`.
- Load Balancer class hoặc provider-specific option nếu cluster hỗ trợ.

Nhưng Service API không có một bộ field chung để mô tả toàn bộ tính năng của mọi cloud Load Balancer, chẳng hạn:

- Nhiều listener HTTP/HTTPS với rule phức tạp.
- Certificate và TLS policy.
- URL redirect hoặc URL rewrite.
- Routing theo hostname, path, header hoặc method.
- WAF, rate limit và authentication.
- Canary hoặc weighted traffic.
- Timeout, retry và backend protocol.

Cloud provider hoặc controller có thể cung cấp annotation, custom resource hoặc API riêng cho các tính năng đó. Những cấu hình này không portable giữa các provider.

> [!IMPORTANT]
> Không nên hiểu rằng `Service type: LoadBalancer` hoàn toàn không thể cấu hình bằng YAML. Nhiều provider hỗ trợ annotation hoặc field riêng để cấu hình nó. Điểm hạn chế là các cấu hình đó phụ thuộc provider/controller và Service API chuẩn không bao phủ toàn bộ khả năng của Load Balancer.

## Ingress hoạt động thế nào?

Ingress tách **ý định routing** khỏi **implementation xử lý traffic**:

```text
Ingress resource
      |
      v
Kubernetes API Server
      |
      v
Ingress Controller watch resource
      |
      +--> Cấu hình NGINX/Traefik/HAProxy
      +--> Cấu hình cloud ALB/NLB
      +--> Cấu hình appliance hoặc proxy khác
```

Một request ví dụ:

```text
https://shop.example.com/orders/42
```

có thể đi qua các bước:

1. DNS đưa `shop.example.com` tới entry point của controller.
2. Controller xử lý TLS hoặc chuyển TLS theo khả năng của implementation.
3. Controller đọc hostname `shop.example.com` và path `/orders/42`.
4. Rule `/orders` được match.
5. Request được route tới Service `order` port `80`.
6. Service chọn một EndpointSlice/backend Pod ready.

Ingress core API chủ yếu mô tả HTTP/HTTPS routing. Các tính năng như rewrite, retry, WAF, mTLS hoặc traffic splitting có thể là annotation, custom resource hoặc feature riêng của controller.

Điều này tạo ra một ranh giới quan trọng:

```text
Ingress resource = khai báo rule
Ingress Controller = thực thi rule
Service          = endpoint ổn định cho backend
Pod              = nơi chạy application
```

## Khác biệt quan trọng nhất

### Service LoadBalancer expose một Service

Với `Service type: LoadBalancer`, ý định chính là:

```text
Service này cần một external Load Balancer
```

Service thường là một entry point cho một backend cụ thể. Provider có thể có cơ chế tối ưu hoặc chia sẻ riêng, nhưng người dùng không nên giả định rằng nhiều Service sẽ tự động dùng chung một Load Balancer.

### Ingress route nhiều Service

Với Ingress, ý định chính là:

```text
Các request HTTP/HTTPS thỏa rule này phải được route tới Service tương ứng
```

Nhiều host hoặc path có thể dùng chung một entry point. Đây là lý do Ingress phù hợp với hệ thống có nhiều microservice HTTP/HTTPS.

### Ingress không thay thế Service

Ingress không gửi traffic trực tiếp tới Deployment theo cách chuẩn. Backend của Ingress vẫn thường là Service:

```text
Ingress --> Service --> EndpointSlice --> Pod
```

Vì vậy, triển khai Ingress thường cần cả:

- Service `ClusterIP` cho từng backend.
- Ingress resource chứa routing rule.
- Ingress Controller thực thi rule.
- Entry point và DNS tương ứng.

## So sánh khả năng cấu hình

| Nhu cầu | `Service type: LoadBalancer` | Ingress |
|---|---|---|
| Expose nhanh một Service | Rất phù hợp | Cần thêm controller và resource |
| Route theo hostname | Phụ thuộc provider/controller | Là chức năng cốt lõi |
| Route theo path | Không có trong Service API chuẩn | Là chức năng cốt lõi |
| TLS termination | Provider-specific | Được mô tả qua TLS và controller |
| Redirect HTTP sang HTTPS | Provider-specific | Thường có trong controller |
| URL rewrite | Provider-specific | Thường có trong controller |
| WAF, rate limit, authentication | Provider/controller-specific | Controller-specific |
| TCP/UDP | Phù hợp hơn | Không phải mục tiêu chính của Ingress |
| Port mapping tới một backend | Có | Thông qua Service |
| Tính portable | Phụ thuộc implementation khi dùng tính năng nâng cao | Rule cơ bản portable hơn, feature nâng cao vẫn phụ thuộc controller |

Ingress không làm mọi cấu hình trở thành portable. Phần `rules`, `paths`, `backend` và một số field TLS thuộc API Kubernetes. Annotation và hành vi nâng cao vẫn phải kiểm tra theo controller cụ thể.

## So sánh chi phí

### Mô hình nhiều Load Balancer

Nếu mỗi Service public tạo một Load Balancer riêng:

```text
frontend-service  --> LB 1
user-service      --> LB 2
order-service     --> LB 3
payment-service   --> LB 4
```

chi phí có thể tăng theo:

- Số lượng Load Balancer.
- Số lượng địa chỉ public hoặc listener.
- Data processing và request.
- Health check.
- WAF hoặc tính năng bảo mật đi kèm.
- Chi phí vận hành và quan sát từng entry point.

### Mô hình dùng chung entry point

Một Ingress Controller có thể route nhiều Service:

```text
Một entry point
      |
      +--> user-service
      +--> order-service
      +--> payment-service
```

Cách này **có thể** tiết kiệm hơn, nhưng không phải quy tắc tuyệt đối. Controller có thể tạo nhiều Load Balancer tùy cấu hình; một controller dùng chung cũng có chi phí tài nguyên, giới hạn throughput và blast radius lớn hơn.

Do đó, khi đánh giá cost cần kiểm tra implementation thực tế:

```bash
kubectl get service -A -o wide
kubectl get ingress -A
kubectl get gateway -A
```

Trên cloud, đối chiếu các resource thật trong cloud console hoặc API. Không suy luận chi phí chỉ từ số lượng file YAML.

## Mức độ phụ thuộc vào cloud provider

Bài học thường nói rằng `LoadBalancer` bị “tied to CCM” còn Ingress thì không. Cách nói này cần được làm rõ.

### Service LoadBalancer

Service cần một thành phần hiểu cách tạo Load Balancer trong môi trường hiện tại. Thành phần đó có thể là:

- Cloud Controller Manager.
- Cloud-specific controller.
- MetalLB hoặc implementation tương tự trên bare-metal.
- Integration do nhà cung cấp cluster cung cấp.

Nếu cluster không có implementation phù hợp, `EXTERNAL-IP` có thể luôn ở trạng thái `<pending>`.

### Ingress

Ingress cũng luôn cần Ingress Controller. Controller có thể:

- Chạy NGINX hoặc Traefik bên trong cluster.
- Cấu hình AWS ALB/NLB.
- Điều khiển một F5 hoặc appliance bên ngoài.
- Dùng một cơ chế public entry point của môi trường local.

Trên EKS, AWS Load Balancer Controller vẫn gọi AWS API và cần quyền IAM phù hợp. Vì vậy Ingress không hoàn toàn loại bỏ sự phụ thuộc vào cloud provider.

Điểm linh hoạt của Ingress là bạn có thể thay đổi controller theo nhu cầu:

```text
Ingress API
    |
    +--> NGINX Ingress Controller
    +--> Traefik
    +--> AWS Load Balancer Controller
    +--> F5/HAProxy/implementation khác
```

Khi đổi controller, cần kiểm tra lại annotation, TLS, source IP, health check, rewrite và các behavior implementation-specific.

## HTTPS và TLS

Với `Service type: LoadBalancer`, Service chuẩn chỉ thể hiện port và backend. Cách gắn certificate, mở listener `443` hoặc redirect HTTP sang HTTPS phụ thuộc provider/controller.

Với Ingress, ý định TLS có thể nằm trong manifest:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: shop
  namespace: production
spec:
  ingressClassName: nginx-public
  tls:
    - hosts:
        - shop.example.com
      secretName: shop-tls
  rules:
    - host: shop.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: frontend
                port:
                  number: 80
```

Manifest này khai báo hostname và Secret chứa certificate/private key. Controller quyết định cách triển khai TLS termination.

Trên cloud, controller có thể dùng certificate từ hệ thống như AWS Certificate Manager thông qua annotation hoặc custom resource. Vì vậy, Ingress làm ý định HTTPS dễ quản lý bằng code hơn, nhưng vẫn cần hiểu cơ chế của controller đang chạy.

Không commit private key vào Git. Trong production nên có quy trình cấp, rotate và kiểm tra expiry của certificate, chẳng hạn dùng certificate automation hoặc secret manager phù hợp với nền tảng.

## Khi nào nên dùng Service LoadBalancer?

Chọn `Service type: LoadBalancer` khi:

- Chỉ có một hoặc một vài Service cần public.
- Muốn expose nhanh với ít thành phần phải vận hành.
- Traffic là TCP/UDP hoặc không phù hợp với HTTP Ingress.
- Provider đã có integration ổn định và chi phí chấp nhận được.
- Backend cần một Load Balancer riêng vì yêu cầu isolation hoặc policy khác biệt.
- Bạn không cần host/path routing ở entry point đó.

Ví dụ phù hợp:

```text
Internet/VPC
     |
     v
Network Load Balancer
     |
     v
Service type LoadBalancer
     |
     v
TCP application
```

Đừng chọn cách này chỉ vì manifest ngắn nếu hệ thống có nhiều HTTP microservice và cần routing chung. Hãy tính số lượng Load Balancer, listener, quota, security boundary và chi phí data processing trước.

## Khi nào nên dùng Ingress?

Chọn Ingress khi:

- Có nhiều HTTP/HTTPS microservice.
- Muốn route theo host hoặc path.
- Muốn một entry point xử lý nhiều backend.
- Muốn quản lý host, path và TLS bằng resource trong Git.
- Cần các capability L7 do Ingress Controller cung cấp.
- Platform team muốn tập trung quản lý public entry point.

Ví dụ:

```text
api.example.com/users  --> user-service
api.example.com/orders --> order-service
web.example.com        --> frontend-service
```

Ingress không phải lựa chọn mặc định cho mọi protocol. Với thiết kế mới cần route và delegation phức tạp hơn, nên xem xét [Gateway API](/networking/gateway-api/). Ingress API vẫn stable nhưng đã frozen; controller hiện tại và nhu cầu migration vẫn là yếu tố quyết định.

## Các hiểu lầm thường gặp

### “Dùng Ingress thì không cần Load Balancer”

Không chính xác. Ingress Controller có thể cần một external Load Balancer để nhận traffic từ Internet:

```text
Internet --> External Load Balancer --> Ingress Controller --> Service
```

Một số môi trường local hoặc bare-metal dùng NodePort, host network, VIP hoặc cơ chế khác. Ingress chỉ mô tả routing; cách có được public entry point phụ thuộc controller và môi trường.

### “Mỗi Ingress luôn dùng chung một Load Balancer”

Không đảm bảo. Controller có thể:

- Tạo một Load Balancer cho từng Ingress.
- Gom nhiều Ingress vào một Load Balancer.
- Dùng một controller service làm entry point chung.
- Dùng behavior khác theo class hoặc annotation.

Hãy đọc tài liệu controller và quan sát resource thật.

### “Ingress thay thế Service LoadBalancer trong mọi trường hợp”

Không. Ingress chủ yếu dành cho HTTP/HTTPS. TCP, UDP, workload cần network isolation riêng hoặc Service cần external trực tiếp vẫn có thể phù hợp với `LoadBalancer`.

### “Ingress resource tự tạo Load Balancer”

Không. Cần Ingress Controller:

```bash
kubectl get ingressclass
kubectl get pods -A | grep -i ingress
kubectl get ingress -A
```

Nếu không có controller phù hợp, Ingress có thể tồn tại trong API nhưng không có data plane xử lý request.

### “Ingress hoàn toàn portable giữa các môi trường”

Rule cơ bản portable hơn annotation, nhưng các tính năng như rewrite, WAF, authentication, rate limit, source IP, backend TLS và canary thường phụ thuộc controller. Khi di chuyển từ NGINX sang AWS ALB, cần review lại các annotation và behavior.

### “LoadBalancer không thể quản lý bằng YAML”

Service và annotation có thể được quản lý bằng YAML. Vấn đề là Service API chuẩn không bao phủ toàn bộ thuộc tính của cloud Load Balancer; cấu hình nâng cao thường phụ thuộc provider-specific field hoặc annotation.

## Bảng quyết định nhanh

| Câu hỏi | Nếu câu trả lời là “có” | Hướng ưu tiên |
|---|---|---|
| Chỉ một Service cần public và cần triển khai nhanh? | Ít routing rule | `Service type: LoadBalancer` |
| Có nhiều HTTP/HTTPS Service dùng chung domain? | Cần host/path routing | Ingress hoặc Gateway API |
| Cần public TCP/UDP trực tiếp? | Không phải HTTP routing | `Service type: LoadBalancer` |
| Có cần quản lý TLS và rule trong Git? | Muốn declarative L7 config | Ingress/Gateway API |
| Cluster local không có cloud integration? | Không có provider LB | Cài controller phù hợp hoặc dùng phương án local |
| Cần isolation hoàn toàn giữa các workload? | Policy và failure domain riêng | Có thể dùng LB riêng |
| Cần feature L7 nâng cao hoặc delegation? | Ingress annotations không đủ | Xem xét Gateway API |

Đây là hướng dẫn lựa chọn, không phải quy tắc cứng. Quyết định cuối cùng cần dựa trên protocol, controller, mô hình bảo mật, reliability, cost và khả năng vận hành của platform.

## Câu trả lời phỏng vấn

Có thể trả lời ngắn gọn như sau:

> `Service type: LoadBalancer` là cách đơn giản để expose một Service ra bên ngoài. Cloud provider hoặc Load Balancer controller sẽ provision một external Load Balancer cho Service đó. Ưu điểm là dễ cấu hình và ít operational overhead. Nhược điểm là khi nhiều Service cùng public, mỗi Service có thể cần một Load Balancer riêng, làm tăng chi phí; routing theo host/path và các cấu hình nâng cao cũng phụ thuộc provider/controller.
>
> `Ingress` là resource mô tả luật HTTP/HTTPS để route request tới nhiều Service. Ingress Controller thực thi các luật đó. Nhờ host-based hoặc path-based routing, nhiều Service có thể dùng chung một entry point và quản lý routing, TLS bằng YAML. Tuy nhiên, Ingress vẫn cần controller, và các feature nâng cao vẫn phụ thuộc implementation cụ thể.

Nếu interviewer hỏi ưu điểm của `Service type: LoadBalancer`, có thể trả lời:

- Cấu hình đơn giản.
- Không cần tạo thêm Ingress resource.
- Không cần vận hành một Ingress Controller riêng.
- Phù hợp với một Service, TCP/UDP hoặc yêu cầu external Load Balancer riêng.

Nếu interviewer hỏi nhược điểm, nên nêu đủ bốn nhóm:

1. Có thể tạo nhiều Load Balancer và tăng cost.
2. L7 routing và cấu hình nâng cao không nằm trong Service API chuẩn.
3. Phụ thuộc cloud/LB controller.
4. Khó dùng nguyên trạng trên cluster không có Load Balancer integration.

## Tóm tắt

```text
Service type: LoadBalancer
= expose trực tiếp một Service
= đơn giản, phù hợp với một backend hoặc TCP/UDP
= có thể tạo nhiều Load Balancer nếu có nhiều Service

Ingress
= khai báo luật HTTP/HTTPS
= cần Ingress Controller thực thi
= có thể route nhiều Service theo host/path
= linh hoạt hơn nhưng cần thêm thành phần vận hành
```

Khác biệt cốt lõi có thể tóm tắt như sau:

```text
Service LoadBalancer:
Client --> Load Balancer --> một Service --> Pod

Ingress:
Client --> entry point --> Ingress Controller
       --> host/path rule --> Service --> Pod
```

Để học cách expose từng Service, xem [ClusterIP, NodePort và LoadBalancer](/networking/service-types/). Để học cách viết manifest, chọn `IngressClass`, cấu hình TLS và troubleshoot request, xem [Ingress](/networking/ingress/). Với thiết kế routing mới có delegation hoặc nhiều protocol hơn, tiếp tục với [Gateway API](/networking/gateway-api/).

## Tài liệu tham khảo

- [Service type LoadBalancer](https://kubernetes.io/docs/concepts/services-networking/service/#loadbalancer)
- [Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/)
- [Ingress Controllers](https://kubernetes.io/docs/concepts/services-networking/ingress-controllers/)
- [Gateway API](https://gateway-api.sigs.k8s.io/)
