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
