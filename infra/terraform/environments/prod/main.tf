terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "constructionos-tfstate-prod"
    key            = "prod/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "constructionos-tflock-prod"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "constructionos"
      Environment = "prod"
      ManagedBy   = "terraform"
    }
  }
}

module "ecr" {
  source      = "../../modules/ecr"
  environment = "prod"
  deployables = var.deployables
}
