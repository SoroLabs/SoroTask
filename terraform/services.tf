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

# ── Keeper API: Blue/Green ingress with weighted canary routing (#1657) ──────
#
# Two target groups (blue, green) sit behind one HTTPS listener whose default
# action is a *weighted* forward. The live color carries weight 100 and the
# idle color 0. During a release the deploy pipeline
# (.github/workflows/deploy.yml -> keeper/scripts/blue-green-deploy.js)
# rewrites the weights 10 -> 50 -> 100 while watching the candidate's 5xx rate,
# and snaps back to 100% of the previous color if it breaches 0.5%.
#
# Pods are registered into the target groups by the AWS Load Balancer
# Controller (TargetGroupBinding in charts/sorotask-keeper), in IP mode, so a
# draining pod is deregistered the moment it starts terminating. The
# deregistration delay gives in-flight requests time to finish, and the
# keeper's own SIGTERM drain finishes in-flight transactions before exit.

locals {
  keeper_colors = toset(["blue", "green"])

  # Initial split only; the deploy pipeline shifts it at runtime.
  keeper_initial_weights = {
    for color in local.keeper_colors : color => color == var.keeper_live_color ? 100 : 0
  }
}

resource "aws_security_group" "keeper_alb" {
  name        = "sorotask-keeper-alb-${var.environment}"
  description = "Keeper API load balancer (blue/green)"
  vpc_id      = aws_vpc.primary.id

  tags = {
    Name = "sorotask-keeper-alb-${var.environment}"
  }
}

resource "aws_vpc_security_group_ingress_rule" "keeper_alb_https" {
  for_each = toset(var.keeper_alb_ingress_cidr_blocks)

  security_group_id = aws_security_group.keeper_alb.id
  description       = "HTTPS from the edge (restrict to Cloudflare ranges in production)"
  cidr_ipv4         = each.value
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "keeper_alb_to_pods" {
  security_group_id = aws_security_group.keeper_alb.id
  description       = "ALB to keeper pods (IP targets) inside the VPC"
  cidr_ipv4         = var.vpc_cidr
  from_port         = var.keeper_service_port
  to_port           = var.keeper_service_port
  ip_protocol       = "tcp"
}

# Let the ALB reach keeper pods, which use the EKS cluster security group.
resource "aws_vpc_security_group_ingress_rule" "keeper_pods_from_alb" {
  security_group_id            = aws_eks_cluster.primary.vpc_config[0].cluster_security_group_id
  description                  = "Keeper API traffic from the blue/green ALB"
  referenced_security_group_id = aws_security_group.keeper_alb.id
  from_port                    = var.keeper_service_port
  to_port                      = var.keeper_service_port
  ip_protocol                  = "tcp"
}

resource "aws_lb" "keeper_api" {
  name               = "sorotask-keeper-${var.environment}"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.keeper_alb.id]
  subnets            = aws_subnet.primary_public[*].id

  drop_invalid_header_fields = true
  enable_deletion_protection = true
  idle_timeout               = 60

  tags = {
    Name = "sorotask-keeper-${var.environment}"
  }
}

resource "aws_lb_target_group" "keeper" {
  for_each = local.keeper_colors

  # Target group names are limited to 32 characters.
  name        = substr("sorotask-keeper-${each.key}-${var.environment}", 0, 32)
  port        = var.keeper_service_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.primary.id

  # Connection draining: a deregistering (terminating) pod keeps serving its
  # in-flight requests for this long while receiving no new ones. Must stay
  # below the pod's terminationGracePeriodSeconds (45s in the Helm chart).
  deregistration_delay = var.keeper_deregistration_delay_seconds

  health_check {
    enabled             = true
    path                = "/readyz"
    matcher             = "200"
    interval            = 5
    timeout             = 2
    healthy_threshold   = 2
    unhealthy_threshold = 2
  }

  tags = {
    Name             = "sorotask-keeper-${each.key}-${var.environment}"
    DeploymentColor  = each.key
    ManagedTrafficBy = "deploy-pipeline"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_lb_listener" "keeper_https" {
  load_balancer_arn = aws_lb.keeper_api.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.keeper_api_certificate_arn

  default_action {
    type = "forward"

    forward {
      dynamic "target_group" {
        for_each = local.keeper_colors
        content {
          arn    = aws_lb_target_group.keeper[target_group.value].arn
          weight = local.keeper_initial_weights[target_group.value]
        }
      }
    }
  }

  lifecycle {
    # The deploy pipeline owns the weights at runtime; terraform only sets
    # the initial split and must not undo an in-progress or finished rollout.
    ignore_changes = [default_action]
  }
}

# Backstop alarm per color. The pipeline's controller enforces the 15-second
# rollback from 5s Prometheus telemetry; ALB metrics have 60s resolution, so
# this alarm catches anything that slips past (e.g. a breach after promotion).
resource "aws_cloudwatch_metric_alarm" "keeper_5xx_rate" {
  for_each = local.keeper_colors

  alarm_name          = "sorotask-keeper-${each.key}-5xx-rate-${var.environment}"
  alarm_description   = "Keeper ${each.key} target 5xx rate above ${var.keeper_canary_error_rate_threshold_percent}%"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = var.keeper_canary_error_rate_threshold_percent
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "error_rate"
    expression  = "IF(requests > 0, 100 * FILL(errors, 0) / requests, 0)"
    label       = "5xx rate (%)"
    return_data = true
  }

  metric_query {
    id = "errors"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "HTTPCode_Target_5XX_Count"
      period      = 60
      stat        = "Sum"
      dimensions = {
        LoadBalancer = aws_lb.keeper_api.arn_suffix
        TargetGroup  = aws_lb_target_group.keeper[each.key].arn_suffix
      }
    }
  }

  metric_query {
    id = "requests"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "RequestCount"
      period      = 60
      stat        = "Sum"
      dimensions = {
        LoadBalancer = aws_lb.keeper_api.arn_suffix
        TargetGroup  = aws_lb_target_group.keeper[each.key].arn_suffix
      }
    }
  }
}

# ── Least-privilege role the deploy pipeline assumes via GitHub OIDC ─────────
resource "aws_iam_role" "keeper_deployer" {
  count = var.github_oidc_provider_arn == "" ? 0 : 1

  name = "sorotask-keeper-deployer-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRoleWithWebIdentity"
        Effect = "Allow"
        Principal = {
          Federated = var.github_oidc_provider_arn
        }
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          }
          StringLike = {
            "token.actions.githubusercontent.com:sub" = "repo:${var.github_repository}:environment:production"
          }
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "keeper_deployer" {
  count = var.github_oidc_provider_arn == "" ? 0 : 1

  name = "sorotask-keeper-deployer-${var.environment}"
  role = aws_iam_role.keeper_deployer[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ShiftKeeperTraffic"
        Effect   = "Allow"
        Action   = ["elasticloadbalancing:ModifyListener"]
        Resource = aws_lb_listener.keeper_https.arn
      },
      {
        Sid    = "ReadRolloutState"
        Effect = "Allow"
        # Only the calls the rollout makes (deploy.yml: describe-listeners,
        # describe-target-health). These ELBv2 Describe* actions do not
        # support resource-level permissions, so "*" is required.
        Action = [
          "elasticloadbalancing:DescribeListeners",
          "elasticloadbalancing:DescribeTargetHealth",
        ]
        Resource = "*"
      },
      {
        Sid      = "ClusterAccess"
        Effect   = "Allow"
        Action   = ["eks:DescribeCluster"]
        Resource = aws_eks_cluster.primary.arn
      }
    ]
  })
}
