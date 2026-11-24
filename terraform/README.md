# SoroTask Terraform

Multi-region infrastructure as code for the production deployment:

| File | Purpose |
| --- | --- |
| `versions.tf` | Terraform + provider version pins |
| `backend.tf` | S3 remote state with DynamoDB locking |
| `providers.tf` | Primary/dr AWS providers + Cloudflare |
| `network.tf` | VPC, subnets, IGW for both regions |
| `cluster.tf` | KMS keys + EKS cluster/node group (private API) |
| `services.tf` | RDS PostgreSQL + ElastiCache Redis (encrypted); keeper API ALB with blue/green target groups, weighted listener and 5xx backstop alarms |
| `tests/` | `terraform test` suites (mocked providers, no cloud access) |
| `dns.tf` | Cloudflare API record |
| `bootstrap.sh` | Creates state bucket/table/KMS key (no console steps) |

## Usage

```bash
./terraform/bootstrap.sh                 # one-shot remote-state setup
cp terraform/terraform.tfvars.example terraform/terraform.tfvars
terraform -chdir=terraform init
terraform -chdir=terraform plan
terraform -chdir=terraform apply
```

CI runs `terraform fmt -check`, `tflint`, and `checkov` on every PR.

`.github/workflows/deploy.yml` also runs `terraform fmt -check`, `terraform validate`
and `terraform test` (mocked providers):

```bash
terraform -chdir=terraform init -backend=false
terraform -chdir=terraform test
```

## Blue/Green keeper deployments

`services.tf` provisions the keeper API load balancer used for zero-downtime
releases: one HTTPS listener with a weighted forward to a `blue` and a `green`
target group. Terraform sets only the initial 100/0 split (`keeper_live_color`)
and ignores later weight changes, which belong to the deploy pipeline. See
[`docs/BLUE_GREEN_DEPLOYMENT.md`](../docs/BLUE_GREEN_DEPLOYMENT.md) for the
rollout, rollback, and drain behaviour.
