---
title: "Curriculum and content map"
description: "The Kubernetes learning sequence, domain boundaries, content maturity, navigation metadata, and authoring source of truth."
---

# Curriculum and content map

## Product model

The repository's product is a staged Kubernetes curriculum for Vietnamese-speaking learners. Categories move from prerequisite container knowledge through Kubernetes architecture and workload primitives, then toward platform operation, production concerns, labs, and certification preparation.

The curriculum structure is intentionally broader than the currently completed material. Most categories were scaffolded in the initial commit so page names and sidebar order could be planned before every lesson was written. A filename or navigation entry therefore proves that a topic is planned, not that its lesson is complete.

## Navigation is the curriculum contract

`content/docs/meta.json` defines the root sidebar order:

```text
index
→ gioi-thieu
→ kien-truc
→ workloads
→ cau-hinh
→ networking
→ storage
→ scheduling
→ security
→ observability
→ delivery
→ cluster-administration
→ troubleshooting
→ ecosystem
→ production
→ labs-projects
→ certifications
```

Each category has its own `meta.json` with:

- `title`: the sidebar label;
- `pages`: ordered Markdown basenames without `.md`.

The ordering is pedagogical rather than alphabetical. For example, `gioi-thieu/meta.json` starts with container fundamentals, compares Docker and containerd, introduces Kubernetes, then proceeds through environment setup, `kubectl`, YAML, API resources, and the first application lab.

Treat these files as a public navigation contract:

- A new page needs a category `pages` entry in the intended learning position.
- A renamed or deleted page needs its old entry removed and all inbound links reviewed.
- A new category needs both its own `meta.json` and a root `content/docs/meta.json` entry.
- Public page URLs derive from directory and basename, for example `content/docs/kien-truc/etcd.md` becomes `/kien-truc/etcd/`.

The current inventory has no category metadata entries missing on disk and no category Markdown files omitted from `pages`.

## Curriculum domains and current maturity

The table follows root navigation order. “Placeholder” means the page still contains the standard notice and generic planned-content outline rather than a repository-specific lesson.

| Directory | Pages | Learner question | Current state |
|---|---:|---|---|
| `gioi-thieu/` | 8 | What are containers and Kubernetes, how do I set up tools, and how do I deploy a first application? | **Substantive:** all 8 pages are developed lessons. |
| `kien-truc/` | 10 | How do API Server, etcd, Scheduler, controllers, kubelet, runtime, and reconciliation cooperate? | **Substantive:** all 10 pages were completed in the latest architecture-writing commit. |
| `workloads/` | 14 | How are Pods and controllers such as Deployment, StatefulSet, DaemonSet, Job, and CronJob managed? | **Substantive:** all 14 pages form a complete workload learning path with manifests, operational trade-offs, troubleshooting, and labs. |
| `cau-hinh/` | 10 | How do environment data, ConfigMap, Secret, probes, requests, limits, quotas, QoS, and disruption budgets shape workloads? | **Substantive:** all 10 pages form a detailed application-configuration path with manifests, runtime semantics, security and capacity trade-offs, troubleshooting, and labs. |
| `networking/` | 12 | How do Pod networking, Service, DNS, Ingress, Gateway API, CNI, kube-proxy, and NetworkPolicy work? | **Substantive:** all 12 pages form a complete network learning path from the Kubernetes network model and Pod data plane through discovery, exposure, policy, service routing, and layered troubleshooting. |
| `storage/` | 11 | How do volumes, PV/PVC, StorageClass, CSI, snapshots, backup, and stateful storage fit together? | Placeholder curriculum. |
| `scheduling/` | 10 | How do selectors, affinity, taints, priority, preemption, topology, and device resources affect placement? | Placeholder curriculum. |
| `security/` | 16 | How do identity, authentication, authorization, RBAC, policy, Secret handling, and runtime hardening work? | Placeholder curriculum. |
| `observability/` | 10 | How should operators use Events, logs, metrics, dashboards, traces, SLI/SLOs, and alerts? | Placeholder curriculum. |
| `delivery/` | 13 | How are manifests packaged, promoted, rolled out, rolled back, reconciled by GitOps, and autoscaled? | Placeholder curriculum. |
| `cluster-administration/` | 15 | How is a cluster bootstrapped, networked, upgraded, made highly available, backed up, and managed? | Placeholder curriculum. |
| `troubleshooting/` | 11 | What investigation method and layer-specific checks isolate workload, network, storage, node, and control-plane failures? | Placeholder curriculum. |
| `ecosystem/` | 12 | How do CRDs, Operators, controllers, certificate/DNS/Secret integrations, policy engines, and service mesh extend Kubernetes? | Placeholder curriculum. |
| `production/` | 11 | What makes a platform production-ready across HA, DR, tenancy, cost, security, identity, and change management? | Placeholder curriculum. |
| `labs-projects/` | 12 | How can learners integrate concepts in guided labs and a production-platform capstone? | Placeholder curriculum. |
| `certifications/` | 6 | How should learners prepare for CKA, CKAD, and CKS and practice efficient `kubectl` usage? | Placeholder curriculum. |

`content/docs/index.md` is the additional root page. It is short and still states that all pages are placeholders. `README.md` repeats that statement. Both are stale in light of the completed `gioi-thieu/`, `kien-truc/`, and `workloads/` content and should not be used to assess individual lesson maturity.

### Inventory snapshot

In the current source tree:

| Measure | Count |
|---|---:|
| Markdown pages | 182 |
| Pages with required `title` and `description` frontmatter | 182 |
| Substantive pages in completed categories | 54 |
| Placeholder category pages | 127 |
| Files containing a placeholder marker, including root `index.md` | 128 |
| Category metadata registrations missing files | 0 |
| Category Markdown files missing registrations | 0 |

These figures are useful orientation, not permanent policy. Recalculate them before making planning claims after content changes.

## Completed learning path

The currently usable end-to-end path is concentrated in five areas.

### Getting started (`gioi-thieu/`)

The eight registered pages cover:

1. container images, runtime isolation, lifecycle, registries, storage, and networking;
2. Docker versus containerd and their layers of responsibility;
3. Kubernetes motivation and core resource concepts;
4. local setup using a container engine, `kind`, and `kubectl`;
5. basic `kubectl` inspection and mutation;
6. YAML manifests;
7. API resources; and
8. an NGINX lab with Namespace, Deployment, Service, scaling, rollout, rollback, troubleshooting, and cleanup.

`content/docs/gioi-thieu/first-application.md` is the best representative page for practical lesson structure because it combines architecture, manifests, verification commands, failure investigation, and cleanup.

### Kubernetes architecture (`kien-truc/`)

The ten registered pages cover cluster overview, component boundaries, Control Plane, Worker Node, API Server, etcd, Scheduler, Controller Manager, kubelet/container runtime, and declarative reconciliation.

These pages teach Kubernetes as a distributed reconciliation system rather than a list of commands. `content/docs/kien-truc/tong-quan-cluster.md` provides the cross-component request flow; `content/docs/kien-truc/declarative-reconciliation.md` is the conceptual anchor for desired state, observed state, eventual convergence, ownership, and drift.

All ten architecture placeholders have been replaced with long-form material. Future content should link to these canonical explanations rather than duplicate control-plane and reconciliation fundamentals in every domain page.

### Workloads (`workloads/`)

The fourteen registered pages now form a complete progression from the Pod execution model through lifecycle, init and multi-container patterns, metadata and Namespace boundaries, then ReplicaSet, Deployment, rollout strategies, StatefulSet, DaemonSet, Job, CronJob, and workload cleanup.

Every lesson includes operational semantics, manifests or command examples, failure analysis, production trade-offs, and a cluster-neutral practice flow. `content/docs/workloads/deployment.md` is the main stateless-controller reference; `content/docs/workloads/statefulset.md` covers stable identity and storage; `content/docs/workloads/workload-cleanup.md` closes the section with ownership, finalizers, propagation policies, and safe deletion.

### Application configuration (`cau-hinh/`)

The ten registered pages now cover process commands and arguments, environment injection, ConfigMap and Secret delivery, CPU/memory requests and limits, health probes, Pod QoS, the Downward API, namespace-level quota and defaults, and voluntary-disruption protection with PodDisruptionBudget.

The section follows the configuration lifecycle from container startup inputs through runtime resource enforcement and health signaling to platform guardrails and maintenance availability. Each lesson explains control-plane and kubelet behavior, update semantics, security or capacity trade-offs, production failure modes, troubleshooting commands, and an isolated practice flow. `content/docs/cau-hinh/configmap.md` and `content/docs/cau-hinh/secret.md` are the canonical data-injection references; `content/docs/cau-hinh/resource-requests-limits.md` anchors scheduling and cgroup behavior; `content/docs/cau-hinh/pod-disruption-budget.md` closes the sequence with eviction-aware maintenance.

### Networking (`networking/`)

The twelve registered pages now form a complete progression from the Kubernetes network model, Pod network namespaces and CNI through Service virtual IPs, Service types, EndpointSlice discovery, CoreDNS, Ingress, Gateway API, NetworkPolicy, kube-proxy, and end-to-end troubleshooting.

The section separates control-plane intent from packet-processing data planes and repeatedly traces direct Pod, Service, DNS, and north-south request paths. Lessons include current API lifecycle guidance such as the deprecation of legacy Endpoints and IPVS mode, the frozen status of Ingress, Gateway API role delegation, traffic locality, dual-stack considerations, production security and capacity trade-offs, isolated labs, and symptom-driven diagnostics. `content/docs/networking/networking-model.md` is the conceptual entry point; `content/docs/networking/service.md` and `content/docs/networking/endpoints-endpointslices.md` anchor service discovery; `content/docs/networking/network-policy.md` covers portable L3/L4 isolation; and `content/docs/networking/network-troubleshooting.md` closes the sequence with a layered incident runbook.

## Placeholder semantics

Representative placeholder pages such as `content/docs/troubleshooting/troubleshooting-methodology.md` and `content/docs/labs-projects/capstone-production-platform.md` contain:

- valid frontmatter and a page title;
- a notice that detailed content will be added later;
- generic objectives;
- a planned-content list;
- an empty practice promise; and
- a generic Kubernetes documentation link.

Do not quote their “planned content” as implemented behavior, a tested runbook, or an available lab. Completing a placeholder means replacing generic promises with verified explanations and exercises, not merely expanding the objective list.

## Source-of-truth hierarchy

When repository evidence conflicts, use this order:

1. **Current page content** for what a lesson actually teaches.
2. **Category and root `meta.json`** for public navigation and learning order.
3. **Runtime source** for routing, rendering, and component behavior.
4. **`AGENTS.md` and `.agents/skills/write-docs/`** for contribution requirements and writing conventions.
5. **Git history** for why important navigation or content transitions occurred.
6. **`README.md` and root `content/docs/index.md`** for a high-level introduction only; their maturity statements are currently stale.

## Choosing where to make a content change

Use domain ownership rather than keyword matching alone:

- Put resource lifecycle and controller behavior in `workloads/`; put values injected into those workloads in `cau-hinh/`.
- Put packet flow, service discovery, and traffic policy in `networking/`; put diagnosis procedures in `troubleshooting/` and link back to the canonical networking concept.
- Put Kubernetes-native storage contracts in `storage/`; put recovery planning that spans the platform in `production/` or `cluster-administration/` as appropriate.
- Put built-in scheduling mechanics in `scheduling/`; put cluster capacity operations in `cluster-administration/`.
- Put identity and policy primitives in `security/`; put production hardening decisions in `production/` and reuse the primitive explanations.
- Put tool-specific extension behavior in `ecosystem/`; put delivery process and GitOps workflow in `delivery/`.
- Put executable, integrated exercises in `labs-projects/`, but link to canonical concept pages instead of recreating all theory inside each lab.

Before creating a page, inspect the target category's `meta.json` and adjacent pages. The curriculum was scaffolded broadly, so the intended slug may already exist as a placeholder.

## Content page contract

Every curriculum page must:

- be written in Vietnamese, preserving English technical terms where translation would reduce accuracy;
- begin with frontmatter containing `title` and `description`;
- use heading levels consistently;
- label fenced code blocks with a language;
- use trailing-slash internal URLs;
- be registered in category metadata; and
- pass `npm run build`.

The repository-specific skill at `.agents/skills/write-docs/SKILL.md` and its references document the preferred structure and supported Fumadocs components. `source.config.ts` and `src/app/[[...slug]]/page.tsx` remain the authority on what the renderer actually supports.

For the implementation checklist and validation strategy, continue with [Development and operations](development.md).
