#!/usr/bin/env bash
# One-shot bootstrap for Terraform remote state: S3 bucket, DynamoDB lock
# table, and KMS key. Replaces every manual cloud-console step.
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
BUCKET="${TF_STATE_BUCKET:-sorotask-tfstate}"
TABLE="${TF_LOCK_TABLE:-sorotask-tf-locks}"
KEY_ALIAS="alias/sorotask-tfstate"

aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
  $( [ "$REGION" != "us-east-1" ] && echo "--create-bucket-configuration LocationConstraint=$REGION" )

aws s3api put-bucket-versioning --bucket "$BUCKET" \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption --bucket "$BUCKET" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms"}}]}'

KEY_ID=$(aws kms create-key --region "$REGION" \
  --query 'KeyMetadata.KeyId' --output text)
aws kms create-alias --region "$REGION" \
  --alias-name "$KEY_ALIAS" --target-key-id "$KEY_ID"

aws dynamodb create-table --region "$REGION" \
  --table-name "$TABLE" \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST

echo "Remote state backend ready: s3://$BUCKET (locks: $TABLE, kms: $KEY_ALIAS)"
