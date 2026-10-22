# Remote state in S3 with DynamoDB state locking.
# The bucket, table, and KMS key are created by bootstrap.sh (no console steps).
terraform {
  backend "s3" {
    bucket         = "sorotask-tfstate"
    key            = "prod/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "sorotask-tf-locks"
    encrypt        = true
    kms_key_id     = "alias/sorotask-tfstate"
  }
}
