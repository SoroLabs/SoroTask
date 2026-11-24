# Tests for the keeper blue/green ingress (#1657).
# Providers are mocked and every run is a plan, so no cloud credentials or
# real resources are needed:
#   terraform -chdir=terraform init -backend=false
#   terraform -chdir=terraform test

mock_provider "aws" {}
mock_provider "aws" {
  alias = "dr"
}
mock_provider "cloudflare" {}

variables {
  cloudflare_api_token       = "test-token"
  cloudflare_zone_id         = "test-zone"
  origin_hostname            = "lb.example.com"
  db_password                = "test-password"
  keeper_api_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/test"
}

run "blue_is_live_by_default" {
  command = plan

  assert {
    condition     = output.keeper_initial_traffic_weights == { blue = 100, green = 0 }
    error_message = "blue must start with 100% of traffic and green with 0%"
  }

  # Target group ARNs are unknown at plan time, so the per-color split is
  # asserted through the output that feeds the listener's weights.
  assert {
    condition     = aws_lb_listener.keeper_https.default_action[0].type == "forward" && aws_lb_listener.keeper_https.port == 443
    error_message = "listener must be a weighted forward on 443"
  }

  assert {
    condition     = sum(values(output.keeper_initial_traffic_weights)) == 100
    error_message = "blue/green weights must sum to 100"
  }

  assert {
    condition     = length(aws_lb_target_group.keeper) == 2
    error_message = "expected one target group per color"
  }
}

run "connection_draining_and_health_checks" {
  command = plan

  assert {
    condition     = alltrue([for tg in aws_lb_target_group.keeper : tg.deregistration_delay == "30"])
    error_message = "target groups must drain connections for 30s by default"
  }

  assert {
    condition     = alltrue([for tg in aws_lb_target_group.keeper : tg.health_check[0].path == "/readyz" && tg.health_check[0].interval == 5])
    error_message = "health checks must hit /readyz every 5s so a draining keeper leaves rotation fast"
  }

  assert {
    condition     = alltrue([for tg in aws_lb_target_group.keeper : tg.target_type == "ip" && tg.port == 3001])
    error_message = "targets must be pod IPs on the keeper port"
  }

  assert {
    condition     = aws_lb_listener.keeper_https.protocol == "HTTPS" && aws_lb.keeper_api.drop_invalid_header_fields
    error_message = "listener must terminate TLS and drop invalid headers"
  }
}

run "five_xx_alarm_threshold_is_half_a_percent" {
  command = plan

  assert {
    condition     = alltrue([for a in aws_cloudwatch_metric_alarm.keeper_5xx_rate : a.threshold == 0.5 && a.comparison_operator == "GreaterThanThreshold"])
    error_message = "backstop alarm must fire when 5xx rate exceeds 0.5%"
  }

  assert {
    condition     = length(aws_cloudwatch_metric_alarm.keeper_5xx_rate) == 2
    error_message = "expected one alarm per color"
  }
}

run "green_can_be_initial_live_color" {
  command = plan

  variables {
    keeper_live_color = "green"
  }

  assert {
    condition     = output.keeper_initial_traffic_weights == { blue = 0, green = 100 }
    error_message = "green must carry 100% of traffic when it is the initial live color"
  }
}

run "deploy_role_only_with_oidc_provider" {
  command = plan

  assert {
    condition     = length(aws_iam_role.keeper_deployer) == 0
    error_message = "deploy role must not be created without an OIDC provider"
  }
}

run "deploy_role_with_oidc_provider" {
  command = plan

  variables {
    github_oidc_provider_arn = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
  }

  assert {
    condition     = length(aws_iam_role.keeper_deployer) == 1
    error_message = "deploy role must be created when an OIDC provider is given"
  }
}

run "rejects_unknown_color" {
  command = plan

  variables {
    keeper_live_color = "red"
  }

  expect_failures = [var.keeper_live_color]
}

run "rejects_drain_longer_than_grace_period" {
  command = plan

  variables {
    keeper_deregistration_delay_seconds = 60
  }

  expect_failures = [var.keeper_deregistration_delay_seconds]
}
