variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "deployables" {
  description = "Deployable image names (architecture.md §19: api, workers, ai-gateway, relay)"
  type        = list(string)
  default     = ["api", "workers", "ai-gateway", "relay"]
}
