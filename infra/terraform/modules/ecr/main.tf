variable "deployables" {
  description = "Deployable image names (architecture.md §19: api, workers, ai-gateway, relay)"
  type        = list(string)
}

variable "environment" {
  type = string
}

resource "aws_ecr_repository" "deployable" {
  for_each             = toset(var.deployables)
  name                 = "constructionos/${var.environment}/${each.value}"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "expire_untagged" {
  for_each   = aws_ecr_repository.deployable
  repository = each.value.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "expire untagged images after 14 days"
      selection = {
        tagStatus   = "untagged"
        countType   = "sinceImagePushed"
        countUnit   = "days"
        countNumber = 14
      }
      action = { type = "expire" }
    }]
  })
}

output "repository_urls" {
  value = { for name, repo in aws_ecr_repository.deployable : name => repo.repository_url }
}
