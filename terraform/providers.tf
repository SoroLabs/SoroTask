# Primary region (us-east-1) uses the default provider.
provider "aws" {
  region = var.primary_region

  default_tags {
    tags = {
      Project     = "SoroTask"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# Disaster-recovery region (eu-west-1).
provider "aws" {
  alias  = "dr"
  region = var.dr_region

  default_tags {
    tags = {
      Project     = "SoroTask"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
