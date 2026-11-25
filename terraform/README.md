# SoroTask Production Deployment Runbook

This runbook provisions the AWS infrastructure and deploys the keeper chart to
a multi-node EKS cluster. The EKS API is private; run Kubernetes commands from
a host with network access to the cluster VPC.

## Infrastructure

| File | Purpose |
| --- | --- |
| `versions.tf` | Terraform + provider version pins |
| `backend.tf` | S3 remote state with DynamoDB locking |
| `providers.tf` | Primary/DR AWS providers + Cloudflare |
| `network.tf` | VPCs and private subnets in two availability zones |
| `cluster.tf` | KMS keys + private EKS cluster and three-or-more node group |
| `services.tf` | RDS PostgreSQL + ElastiCache Redis (encrypted) |
| `dns.tf` | Cloudflare API record |
| `bootstrap.sh` | Creates state bucket/table/KMS key |

### Provision or update

1. Configure AWS credentials with permissions to manage the resources in this
   Terraform project, plus network access to the private EKS endpoint.
2. Set `AWS_REGION` and `TF_STATE_BUCKET`/`TF_LOCK_TABLE` as needed, then run
   `./terraform/bootstrap.sh` once for a new state backend.
3. Copy `terraform/terraform.tfvars.example` to
   `terraform/terraform.tfvars` and provide the Cloudflare and database values.
   Never commit the `.tfvars` file or plaintext credentials.
4. Run:

   ```bash
   terraform -chdir=terraform init
   terraform -chdir=terraform plan
   terraform -chdir=terraform apply
   ```

The managed node group spans both private subnets, keeps at least three nodes,
and replaces at most one node at a time during updates. Keep at least three
available nodes for the keeper's disruption budget.

## Keeper GitOps deployment

Install Argo CD and the Bitnami Sealed Secrets controller in the cluster using
your organization's approved installation process. The Sealed Secrets
controller must be ready before syncing the keeper chart.

Create a Kubernetes Secret locally using production values for
`SOROBAN_RPC_URL`, `NETWORK_PASSPHRASE`, `CONTRACT_ID`, `KEEPER_SECRET`, and
`REDIS_URL`, then seal it for the target namespace and name. Do not commit the
plaintext Secret:

```bash
kubectl create secret generic sorotask-keeper-secrets --namespace sorotask \
  --from-literal=SOROBAN_RPC_URL='<mainnet-rpc-url>' \
  --from-literal=NETWORK_PASSPHRASE='Public Global Stellar Network ; September 2015' \
  --from-literal=CONTRACT_ID='<production-contract-id>' \
  --from-literal=KEEPER_SECRET='<keeper-secret>' \
  --from-literal=REDIS_URL='<redis-url>' \
  --dry-run=client -o yaml | kubeseal --format yaml --scope strict \
  > charts/sorotask-keeper/templates/sealedsecret-production.yaml
```

Commit the resulting `SealedSecret` manifest at the shown chart template path.
Its metadata name and namespace must be `sorotask-keeper-secrets` and
`sorotask`. This keeps only encrypted values in Git; the chart's
`values-production.yaml` references the generated Secret and disables
plaintext Secret creation.

Apply the Argo CD application once:

```bash
kubectl apply -f charts/sorotask-keeper/examples/argocd-application.yaml
```

Argo CD then installs/updates the chart from `main`, creates the `sorotask`
namespace, and automatically reconciles drift. For another Git branch or fork,
update `repoURL` and `targetRevision` in the Application manifest first.

## Verification and rolling updates

After Argo CD reports the application Synced and Healthy, verify the rollout
and check that the replicas are spread across nodes and zones:

```bash
kubectl -n sorotask rollout status deployment/sorotask-keeper-sorotask-keeper
kubectl -n sorotask get pods -o wide
kubectl -n sorotask get pdb
kubectl -n sorotask get deployment sorotask-keeper-sorotask-keeper
```

The Deployment uses startup, readiness, and liveness probes on `/health`, a
zero-unavailable rolling update, preferred node anti-affinity, and required
zone spread. The PodDisruptionBudget requires at least two available pods.
Confirm all pods are Ready, the PDB reports healthy allowed disruptions, and
replicas occupy both availability zones before declaring the deployment
verified. During a failure, inspect `kubectl -n sorotask describe pods` and the
Argo CD application health before changing replica or disruption settings.

CI runs `terraform fmt -check`, `tflint`, and `checkov` on every PR.
