output "vpc_id" {
  description = "Primary VPC id."
  value       = aws_vpc.primary.id
}

output "dr_vpc_id" {
  description = "Disaster-recovery VPC id."
  value       = aws_vpc.dr.id
}

output "eks_cluster_name" {
  description = "Primary EKS cluster name."
  value       = aws_eks_cluster.primary.name
}

output "db_endpoint" {
  description = "RDS instance endpoint."
  value       = aws_db_instance.primary.endpoint
}

output "redis_endpoint" {
  description = "Redis primary endpoint."
  value       = aws_elasticache_replication_group.primary.primary_endpoint_address
}

output "keeper_alb_dns_name" {
  description = "Keeper API load balancer hostname (use as origin_hostname)."
  value       = aws_lb.keeper_api.dns_name
}

output "keeper_listener_arn" {
  description = "HTTPS listener whose weighted forward action the deploy pipeline shifts."
  value       = aws_lb_listener.keeper_https.arn
}

output "keeper_target_group_arns" {
  description = "Target group ARN per deployment color."
  value       = { for color, tg in aws_lb_target_group.keeper : color => tg.arn }
}

output "keeper_deployer_role_arn" {
  description = "IAM role the deploy pipeline assumes via GitHub OIDC (empty when not configured)."
  value       = try(aws_iam_role.keeper_deployer[0].arn, "")
}

output "keeper_initial_traffic_weights" {
  description = "Traffic weight per color when the listener is created (runtime weights are owned by the deploy pipeline)."
  value       = local.keeper_initial_weights
}
