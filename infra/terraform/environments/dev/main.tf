terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "constructionos-tfstate-dev"
    key            = "dev/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "constructionos-tflock-dev"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "constructionos"
      Environment = "dev"
      ManagedBy   = "terraform"
    }
  }
}

module "ecr" {
  source      = "../../modules/ecr"
  environment = "dev"
  deployables = var.deployables
}
