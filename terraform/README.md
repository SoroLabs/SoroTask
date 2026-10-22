# SoroTask Terraform

Multi-region infrastructure as code for the production deployment:

| File | Purpose |
| --- | --- |
| `versions.tf` | Terraform + provider version pins |
| `backend.tf` | S3 remote state with DynamoDB locking |
| `providers.tf` | Primary/dr AWS providers + Cloudflare |
| `network.tf` | VPC, subnets, IGW for both regions |
| `cluster.tf` | KMS keys + EKS cluster/node group (private API) |
| `services.tf` | RDS PostgreSQL + ElastiCache Redis (encrypted) |
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
