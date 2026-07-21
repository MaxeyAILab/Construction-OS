terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "constructionos-tfstate-staging"
    key            = "staging/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "constructionos-tflock-staging"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "constructionos"
      Environment = "staging"
      ManagedBy   = "terraform"
    }
  }
}

module "ecr" {
  source      = "../../modules/ecr"
  environment = "staging"
  deployables = var.deployables
}
