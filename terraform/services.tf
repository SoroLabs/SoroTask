# ── Data-service subnet groups (private only) ────────────────────────────────
resource "aws_db_subnet_group" "primary" {
  name       = "sorotask-${var.environment}"
  subnet_ids = aws_subnet.primary_private[*].id
}

resource "aws_elasticache_subnet_group" "primary" {
  name       = "sorotask-${var.environment}"
  subnet_ids = aws_subnet.primary_private[*].id
}

# ── RDS (PostgreSQL) encrypted at rest with KMS ──────────────────────────────
resource "aws_db_instance" "primary" {
  identifier     = "sorotask-${var.environment}"
  engine         = "postgres"
  engine_version = "16"
  instance_class = "db.t4g.medium"

  allocated_storage       = 100
  backup_retention_period = 7
  db_name                 = "sorotask"
  deletion_protection     = true
  multi_az                = true
  password                = var.db_password
  username                = var.db_username

  db_subnet_group_name      = aws_db_subnet_group.primary.name
  final_snapshot_identifier = "sorotask-${var.environment}-final"
  kms_key_id                = aws_kms_key.cluster.arn
  skip_final_snapshot       = false
  storage_encrypted         = true

  tags = {
    Name = "sorotask-${var.environment}"
  }
}

# ── Redis (ElastiCache) encrypted in transit and at rest ─────────────────────
resource "aws_elasticache_replication_group" "primary" {
  replication_group_id = "sorotask-${var.environment}"
  description          = "SoroTask ${var.environment} cache"
  node_type            = "cache.t4g.small"
  num_cache_clusters   = 2
  parameter_group_name = "default.redis7"
  port                 = 6379

  at_rest_encryption_enabled = true
  subnet_group_name          = aws_elasticache_subnet_group.primary.name
  transit_encryption_enabled = true

  tags = {
    Name = "sorotask-${var.environment}"
  }
}
