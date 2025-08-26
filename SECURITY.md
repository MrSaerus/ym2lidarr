# SECURITY.md

## Overview

This document describes how the **YM2LIDARR** project team and contributors handle security issues and how to report vulnerabilities. The project is a **Node.js/TypeScript monorepo**, including **API (Express + Prisma)** and **Web (Next.js)** services, using containerization (Docker) and GitHub Actions CI. It integrates with third‑party services (e.g., **Lidarr** and **Yandex Music**) and stores settings in a database via Prisma.

> Important: Do not disclose vulnerabilities in public issues or discussions.

---

## Supported Versions

We only support the active development branch and the latest release. Security fixes are provided for these only.

| Component           | Branch / Version | Status          |
|---------------------|------------------|-----------------|
| Monorepo (Web/API)  | `main`           | Supported       |
| Latest release      | latest           | Supported       |
| Older releases      | < latest         | At discretion, not guaranteed |

---

## Reporting a Vulnerability

**Preferred method:** Use **[GitHub Security Advisories](https://github.com/mrsaerus/ym2lidarr/security/advisories/new)** (`Security` → `Report a vulnerability`) — this creates a private notification for maintainers.

Alternative resources:
- [GitHub Security Advisories documentation](https://docs.github.com/en/code-security/security-advisories)

**Please include:**
- Detailed description of the issue and potential impact.
- Minimal PoC (local or as a patch/test).
- Affected versions/components.
- Any known workarounds or mitigations.

We acknowledge reports within **3 business days**, assess the impact, and coordinate a timeline for fixing and disclosure.

---

## Disclosure Policy (Coordinated Disclosure)

- By default, we follow **coordinated disclosure (CD)**.  
- Fixes and release notes are published in coordination with the reporter; then the vulnerability details are disclosed.  
- Typical timelines (may vary depending on severity/complexity):  
  - Initial acknowledgement: **≤ 3 days**  
  - Fix and release: **7–30 days**  
  - Advisory publication: immediately after release

---

## Scope

This SECURITY.md applies to:
- Backend API (Express/TypeScript, Prisma).
- Frontend (Next.js/React).
- Build, packaging, and container configuration (Docker).
- CI/CD in GitHub Actions.
- Third‑party integrations within repo code (Lidarr, Yandex Music).

Out of scope: vulnerabilities in third‑party services and infrastructure not controlled by this project (e.g., bugs in external APIs, issues in your Kubernetes cluster). We may provide guidance but do not guarantee fixes.

---

## Security Best Practices for Contributors & Operators

### 1) Secrets and Configuration
- Never commit secrets (Lidarr/Yandex tokens, DB connection strings).  
- Use `.env`/CI secrets with an example `.env.example` file (without real values).  
- Restrict token privileges (least privilege principle).  
- Logs must **never** include secrets or PII.

### 2) Dependencies (Node.js/TypeScript)
- Commit and use **lockfiles** (`package-lock.json`) and `npm ci` in CI.  
- Regularly update dependencies (Dependabot/Renovate).  
- Run `npm audit`/SCA tools and remediate high/critical issues.  
- Avoid unmaintained/untrusted packages.

### 3) Backend (Express)
- Enable **helmet** and configure **CORS** (whitelist origins explicitly).  
- Validate all external inputs (e.g., **zod**/**joi**).  
- Add rate‑limiting and brute‑force protection for sensitive endpoints.  
- Explicitly serialize responses (avoid leaking DB internals).  
- For external API calls (Lidarr/Yandex): use timeouts, retries with jitter, and rate limits.

### 4) Database / Prisma
- Store connection strings in environment variables; use least privilege DB roles.  
- Review migrations via PRs; avoid destructive schema changes without review.  
- Handle `null`/`undefined` properly; avoid N+1 queries.  
- Ensure backups (see `/app/data/backups`) and test restore procedures.

### 5) Frontend (Next.js)
- Enforce strict **security headers** (CSP, HSTS, X‑Content‑Type‑Options, Referrer‑Policy).  
- Avoid `dangerouslySetInnerHTML`; sanitize all external data.  
- Restrict script/style sources in CSP; avoid `unsafe-inline`.

### 6) Docker/Containers
- Use multi‑stage builds; keep final image minimal.  
- Run as **non‑root**; enable `readOnlyRootFilesystem: true`; `no-new-privileges`.  
- Drop unnecessary Linux capabilities; use `seccomp`/`AppArmor` (or `RuntimeDefault`).  
- Pin base images by **digest**; scan images (Trivy/Grype).  
- Apply resource limits and secure logging.

### 7) Kubernetes/Orchestration (if applicable)
- Use `runAsNonRoot`, `allowPrivilegeEscalation: false`, `readOnlyRootFilesystem: true`.  
- Apply **NetworkPolicies** to restrict ingress/egress.  
- Store secrets in `Secret`/KMS, not ConfigMaps.  
- Expose only required ports/services.

### 8) CI/CD (GitHub Actions)
- Minimize permissions:  
  ```yaml
  permissions: read-all
  jobs:
    build:
      permissions:
        contents: read
        packages: write   # only if publishing
        id-token: write   # for OIDC if used
  ```
- **Pin** third‑party actions by **commit SHA**, not `@vX`:  
  ```yaml
  - uses: actions/checkout@44c2b7a8...   # example SHA
  - uses: docker/login-action@f4efc8b9...
  ```
- Add **StepSecurity Harden‑Runner** for egress control/monitoring:  
  ```yaml
  - uses: step-security/harden-runner@<pinned-SHA>
    with:
      egress-policy: audit   # or block once stable
  ```
- Run CodeQL/scanners, publish SARIF reports.  
- Store secrets only in **GitHub Encrypted Secrets**.

---

## Supply Chain Security

- Packages/images are only published from trusted CI pipelines on protected branches.  
- (Optional) Sign container images with **cosign**, publish SLSA provenance.  
- Avoid unstable mirrors; lock down registries.

---

## Third‑Party Integrations (Lidarr, Yandex)

- Keep API tokens/keys in environment variables or secret stores.  
- Restrict privileges (read‑only when possible).  
- Mask tokens and sensitive fields in logs.  
- Limit and filter egress traffic from CI runners and production pods.

---

## Logging, Privacy & Data Retention

- Logs must not contain PII/secrets; always mask.  
- Define retention periods for logs and backups; keep minimal data.  
- Follow jurisdictional/legal requirements when exporting data.

---

## Security Fix Workflow

1. Receive and acknowledge report.  
2. Assess CVSS/impact and set priority.  
3. Develop fix in a private branch/fork if needed.  
4. Review, test (including regression/e2e).  
5. Release fix and publish advisory.  
6. Provide migration/workaround guidance.

---

## Acknowledgements

We appreciate responsible disclosure and may acknowledge contributions in **release notes** or a dedicated page (upon reporter's request).


## References

- [Responsible Disclosure Guidelines (GitHub Docs)](https://docs.github.com/en/code-security/getting-started/adding-a-security-policy-to-your-repository)
- [OSV.dev Vulnerability Database](https://osv.dev/)

---

## Policy Change History

- **2025‑08‑25** — Initial SECURITY.md version.

---

