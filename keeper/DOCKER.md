# Docker Deployment Guide

This guide provides detailed information about deploying the SoroTask Keeper using Docker.

## Architecture

The Keeper Docker setup uses a multi-stage build process:

1. **deps stage**: Installs production dependencies only
2. **runner stage**: Copies application code and dependencies, runs as non-root user

## Security Features

- **Non-root user**: Container runs as the `node` user (UID 1000)
- **Minimal base image**: Uses `node:20-alpine` for smallest attack surface
- **Production dependencies only**: No dev dependencies in final image
- **Read-only application**: Application code is immutable at runtime
- **Volume isolation**: Only `/app/data` is writable for persistence

## Image Details

**Base Image**: `node:20-alpine`
**Final Image Size**: ~150MB (optimized with multi-stage build)
**Exposed Ports**: 3001 (metrics and health check)
**Working Directory**: `/app`
**User**: `node` (non-root)

## Volume Management

### Data Persistence

The keeper uses a volume mount for task registry persistence:

```yaml
volumes:
  - ./keeper/data:/app/data
```

This ensures that task state survives container restarts. The directory structure:

```
keeper/data/
└── tasks.json          # Task registry (created at runtime)
```

### Backup and Restore

**Backup task data:**
```bash
# Create backup
docker compose exec keeper tar czf - /app/data | cat > keeper-backup-$(date +%Y%m%d).tar.gz

# Or simply copy the data directory
cp -r keeper/data keeper/data.backup
```

**Restore task data:**
```bash
# Stop the keeper
docker compose down

# Restore data
tar xzf keeper-backup-20240115.tar.gz -C keeper/

# Start the keeper
docker compose up -d
```

## Health Checks

The container includes built-in health monitoring:

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/health', ...)"
```

**Check container health:**
```bash
docker compose ps
docker inspect sorotask-keeper --format='{{.State.Health.Status}}'
```

**Health states:**
- `starting`: Container is starting up (grace period)
- `healthy`: Health check passing
- `unhealthy`: Health check failing (after 3 retries)

## Environment Variables

All configuration is passed via environment variables. See `.env.example` for the complete list.

**Required variables:**
- `SOROBAN_RPC_URL`: RPC endpoint URL
- `NETWORK_PASSPHRASE`: Network identifier
- `KEEPER_SECRET`: Keeper account secret key
- `CONTRACT_ID`: SoroTask contract address

**Optional variables:**
- `METRICS_PORT`: Metrics server port (default: 3001)
- `POLLING_INTERVAL_MS`: Task polling interval (default: 10000)
- `MAX_CONCURRENT_EXECUTIONS`: Concurrent task limit (default: 3)
- `HEALTH_STALE_THRESHOLD_MS`: Health check threshold (default: 60000)

## Logging

Logs are configured with rotation to prevent disk space issues:

```yaml
logging:
  driver: "json-file"
  options:
    max-size: "10m"    # Maximum log file size
    max-file: "3"      # Keep 3 rotated files
```

**View logs:**
```bash
# Follow logs
docker compose logs -f keeper

# Last 100 lines
docker compose logs --tail=100 keeper

# Since specific time
docker compose logs --since=1h keeper

# Export logs
docker compose logs keeper > keeper-logs.txt
```

## Resource Limits

For production deployments, consider adding resource limits:

```yaml
services:
  keeper:
    # ... other config ...
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M
```

## Networking

The keeper exposes port 3001 for metrics and health checks:

```yaml
ports:
  - "3001:3001"
```

**Custom port mapping:**
```yaml
ports:
  - "8080:3001"  # Map host port 8080 to container port 3001
```

**Internal network only (no external access):**
```yaml
# Remove ports section, access via docker network only
# ports:
#   - "3001:3001"
```

## Production Deployment Checklist

- [ ] Configure `.env` with production credentials
- [ ] Set `restart: unless-stopped` in docker-compose.yml
- [ ] Configure log rotation (max-size, max-file)
- [ ] Set up volume backups for `./keeper/data`
- [ ] Configure resource limits (CPU, memory)
- [ ] Set up monitoring alerts for health check failures
- [ ] Secure the metrics endpoint (firewall, reverse proxy)
- [ ] Use secrets management for `KEEPER_SECRET` (Docker secrets, vault)
- [ ] Enable TLS for RPC connections
- [ ] Set up log aggregation (ELK, Loki, CloudWatch)

## Troubleshooting

### Container won't start

**Check logs:**
```bash
docker compose logs keeper
```

**Common issues:**
- Missing or invalid `.env` file
- Invalid `KEEPER_SECRET` format
- Network connectivity to RPC endpoint
- Port 3001 already in use

### Health check failing

**Check health endpoint manually:**
```bash
docker compose exec keeper wget -O- http://localhost:3001/health
```

**Common causes:**
- RPC connection issues
- Polling loop stalled
- Application crash

### High memory usage

**Check container stats:**
```bash
docker stats sorotask-keeper
```

**Solutions:**
- Reduce `MAX_CONCURRENT_EXECUTIONS`
- Increase `POLLING_INTERVAL_MS`
- Add memory limits in docker-compose.yml

### Data not persisting

**Verify volume mount:**
```bash
docker compose exec keeper ls -la /app/data
```

**Check volume permissions:**
```bash
ls -la keeper/data
# Should be writable by UID 1000 (node user)
```

## Advanced Configuration

### Using Docker Secrets

For sensitive data like `KEEPER_SECRET`, use Docker secrets:

```yaml
services:
  keeper:
    secrets:
      - keeper_secret
    environment:
      KEEPER_SECRET_FILE: /run/secrets/keeper_secret

secrets:
  keeper_secret:
    file: ./keeper_secret.txt
```

### Multi-Keeper Setup

Run multiple keepers with different configurations:

```yaml
services:
  keeper-1:
    build: ./keeper
    env_file: ./keeper/.env.keeper1
    volumes:
      - ./keeper/data1:/app/data
    ports:
      - "3001:3001"

  keeper-2:
    build: ./keeper
    env_file: ./keeper/.env.keeper2
    volumes:
      - ./keeper/data2:/app/data
    ports:
      - "3002:3001"
```

### Custom Network

Create a custom network for better isolation:

```yaml
networks:
  sorotask:
    driver: bridge

services:
  keeper:
    networks:
      - sorotask
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Deploy Keeper

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Build Docker image
        run: docker build -t sorotask-keeper:${{ github.sha }} ./keeper
      
      - name: Push to registry
        run: |
          echo ${{ secrets.DOCKER_PASSWORD }} | docker login -u ${{ secrets.DOCKER_USERNAME }} --password-stdin
          docker push sorotask-keeper:${{ github.sha }}
      
      - name: Deploy to server
        run: |
          ssh deploy@server "cd /opt/sorotask && docker compose pull && docker compose up -d"
```

## Monitoring Integration

### Prometheus

The keeper exposes metrics at `/metrics`. Configure Prometheus to scrape:

```yaml
scrape_configs:
  - job_name: 'sorotask-keeper'
    static_configs:
      - targets: ['localhost:3001']
```

### Grafana Dashboard

Create alerts based on metrics:
- `tasksFailedTotal` increasing
- `avgFeePaidXlm` exceeding threshold
- Health check failures

## Support

For issues or questions:
- GitHub Issues: https://github.com/your-org/sorotask/issues
- Documentation: https://docs.sorotask.io
