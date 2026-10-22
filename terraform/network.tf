# ── Primary region networking ─────────────────────────────────────────────────
resource "aws_vpc" "primary" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "sorotask-primary"
  }
}

resource "aws_internet_gateway" "primary" {
  vpc_id = aws_vpc.primary.id

  tags = {
    Name = "sorotask-primary"
  }
}

resource "aws_subnet" "primary_public" {
  count                   = 2
  vpc_id                  = aws_vpc.primary.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, count.index)
  availability_zone       = "${var.primary_region}${char(97 + count.index)}"
  map_public_ip_on_launch = false

  tags = {
    Name = "sorotask-primary-public-${count.index}"
    Tier = "public"
  }
}

resource "aws_subnet" "primary_private" {
  count             = 2
  vpc_id            = aws_vpc.primary.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, count.index + 8)
  availability_zone = "${var.primary_region}${char(97 + count.index)}"

  tags = {
    Name = "sorotask-primary-private-${count.index}"
    Tier = "private"
  }
}

# ── Disaster-recovery region networking ──────────────────────────────────────
resource "aws_vpc" "dr" {
  provider = aws.dr

  cidr_block           = var.dr_vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "sorotask-dr"
  }
}

resource "aws_subnet" "dr_private" {
  provider = aws.dr

  count             = 2
  vpc_id            = aws_vpc.dr.id
  cidr_block        = cidrsubnet(var.dr_vpc_cidr, 4, count.index + 8)
  availability_zone = "${var.dr_region}${char(97 + count.index)}"

  tags = {
    Name = "sorotask-dr-private-${count.index}"
    Tier = "private"
  }
}


# ── VPC flow logs (CloudWatch, KMS-encrypted) ────────────────────────────────
resource "aws_cloudwatch_log_group" "flow_primary" {
  name              = "/aws/vpc/flowlogs/sorotask-${var.environment}"
  retention_in_days = 90
  kms_key_id        = aws_kms_key.cluster.arn
}

resource "aws_cloudwatch_log_group" "flow_dr" {
  provider = aws.dr

  name              = "/aws/vpc/flowlogs/sorotask-${var.environment}-dr"
  retention_in_days = 90
  kms_key_id        = aws_kms_key.cluster.arn
}

resource "aws_iam_role" "flow_logs" {
  name = "sorotask-vpc-flow-logs-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "vpc-flow-logs.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "flow_logs" {
  name = "sorotask-vpc-flow-logs-${var.environment}"
  role = aws_iam_role.flow_logs.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams"
        ]
        Effect   = "Allow"
        Resource = "${aws_cloudwatch_log_group.flow_primary.arn}:*"
      }
    ]
  })
}

resource "aws_flow_log" "primary" {
  vpc_id               = aws_vpc.primary.id
  traffic_type         = "ALL"
  log_destination_type = "cloud-watch-logs"
  log_destination      = aws_cloudwatch_log_group.flow_primary.arn
  iam_role_arn         = aws_iam_role.flow_logs.arn
}

resource "aws_flow_log" "dr" {
  provider = aws.dr

  vpc_id               = aws_vpc.dr.id
  traffic_type         = "ALL"
  log_destination_type = "cloud-watch-logs"
  log_destination      = aws_cloudwatch_log_group.flow_dr.arn
  iam_role_arn         = aws_iam_role.flow_logs.arn
}
