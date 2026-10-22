# Public API record managed via Cloudflare (no console steps).
resource "cloudflare_record" "api" {
  zone_id = var.cloudflare_zone_id
  name    = "api"
  type    = "CNAME"
  value   = var.origin_hostname
  proxied = true
  ttl     = 1
}
