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
