# ── KMS: cluster secrets + state encryption ──────────────────────────────────
resource "aws_kms_key" "cluster" {
  description             = "SoroTask ${var.environment} secrets"
  deletion_window_in_days = 14
  enable_key_rotation     = true
}

resource "aws_kms_alias" "cluster" {
  name          = "alias/sorotask-${var.environment}"
  target_key_id = aws_kms_key.cluster.key_id
}

# ── EKS control plane (private API endpoint) ─────────────────────────────────
resource "aws_iam_role" "eks" {
  name = "sorotask-eks-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "eks.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "eks_cluster" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
  role       = aws_iam_role.eks.name
}

resource "aws_eks_cluster" "primary" {
  name     = "sorotask-${var.environment}"
  role_arn = aws_iam_role.eks.arn
  version  = "1.30"

  enabled_cluster_log_types = ["api", "audit", "authenticator"]

  encryption_config {
    provider {
      key_arn = aws_kms_key.cluster.arn
    }
    resources = ["secrets"]
  }

  vpc_config {
    subnet_ids              = concat(aws_subnet.primary_private[*].id)
    endpoint_public_access  = false
    endpoint_private_access = true
  }

  depends_on = [aws_iam_role_policy_attachment.eks_cluster]
}

resource "aws_iam_role" "eks_node" {
  name = "sorotask-eks-node-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "eks_node" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy"
  role       = aws_iam_role.eks_node.name
}

resource "aws_eks_node_group" "primary" {
  cluster_name    = aws_eks_cluster.primary.name
  node_group_name = "default"
  node_role_arn   = aws_iam_role.eks_node.arn
  subnet_ids      = aws_subnet.primary_private[*].id

  instance_types = ["m6i.large"]

  scaling_config {
    desired_size = 3
    max_size     = 6
    min_size     = 2
  }

  depends_on = [aws_iam_role_policy_attachment.eks_node]
}
