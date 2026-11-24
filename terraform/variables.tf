variable "environment" {
  description = "Deployment environment name."
  type        = string
  default     = "production"
}

variable "primary_region" {
  description = "Primary AWS region for the production cluster."
  type        = string
  default     = "us-east-1"
}

variable "dr_region" {
  description = "Disaster-recovery AWS region."
  type        = string
  default     = "eu-west-1"
}

variable "vpc_cidr" {
  description = "CIDR block for the primary VPC."
  type        = string
  default     = "10.0.0.0/16"
}

variable "dr_vpc_cidr" {
  description = "CIDR block for the disaster-recovery VPC."
  type        = string
  default     = "10.1.0.0/16"
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token used for DNS records."
  type        = string
  sensitive   = true
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone id hosting the production domain."
  type        = string
}

variable "origin_hostname" {
  description = "Hostname the public API record points at (load balancer or CDN)."
  type        = string
}

variable "db_username" {
  description = "Master username for the RDS instance."
  type        = string
  default     = "sorotask"
}

variable "db_password" {
  description = "Master password for the RDS instance."
  type        = string
  sensitive   = true
}

# ── Keeper blue/green deployment (#1657) ─────────────────────────────────────
variable "keeper_api_certificate_arn" {
  description = "ACM certificate ARN for the keeper API HTTPS listener."
  type        = string
}

variable "keeper_service_port" {
  description = "Container port the keeper serves HTTP (health/metrics/API) on."
  type        = number
  default     = 3001
}

variable "keeper_live_color" {
  description = "Color that receives 100% of traffic when the listener is first created (blue or green). The deploy pipeline owns the weights afterwards."
  type        = string
  default     = "blue"

  validation {
    condition     = contains(["blue", "green"], var.keeper_live_color)
    error_message = "keeper_live_color must be \"blue\" or \"green\"."
  }
}

variable "keeper_deregistration_delay_seconds" {
  description = "ALB connection-draining window for a terminating keeper pod. Must be below the pod terminationGracePeriodSeconds (45s)."
  type        = number
  default     = 30

  validation {
    condition     = var.keeper_deregistration_delay_seconds >= 5 && var.keeper_deregistration_delay_seconds < 45
    error_message = "keeper_deregistration_delay_seconds must be between 5 and 44 seconds."
  }
}

variable "keeper_canary_error_rate_threshold_percent" {
  description = "5xx rate (percent) above which a canary is rolled back and the backstop alarm fires."
  type        = number
  default     = 0.5

  validation {
    condition     = var.keeper_canary_error_rate_threshold_percent > 0 && var.keeper_canary_error_rate_threshold_percent < 100
    error_message = "keeper_canary_error_rate_threshold_percent must be between 0 and 100."
  }
}

variable "keeper_alb_ingress_cidr_blocks" {
  description = "CIDR blocks allowed to reach the keeper ALB on 443. Restrict to Cloudflare edge ranges in production."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "github_oidc_provider_arn" {
  description = "ARN of the account's GitHub Actions OIDC provider. Leave empty to skip creating the deploy role."
  type        = string
  default     = ""
}

variable "github_repository" {
  description = "owner/repo allowed to assume the keeper deploy role."
  type        = string
  default     = "SoroLabs/SoroTask"
}
