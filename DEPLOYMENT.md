# Deployment Guide

This guide explains how to deploy the Presentation Generator application using Docker.

## Prerequisites

- Docker and Docker Compose installed
- Access to PostgreSQL databases (external)
- API keys for Anthropic Claude and Google Gemini
- Directus CMS access token

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/cryptonicsurfer/presentation-generator.git
cd presentation-generator
```

### 2. Configure environment variables

Copy the example environment file and fill in your credentials:

```bash
cp .env.example .env.local
```

Edit `.env.local` with your actual values:

```env
# PostgreSQL Database URLs
DATABASE_URL_FBG_ANALYTICS=postgresql://user:password@host:port/fbg_analytics
DATABASE_URL_SCB_DATA=postgresql://user:password@host:port/scb_data
DATABASE_URL_FOOD_PRODUCTION=postgresql://user:password@host:port/food_production_sweden

# Directus CMS
DIRECTUS_URL=https://cms.businessfalkenberg.se
DIRECTUS_ACCESS_TOKEN=your_token_here

# App URL (update for production)
NEXT_PUBLIC_APP_URL=https://yourdomain.com

# AI API Keys
ANTHROPIC_API_KEY=sk-ant-api03-...
GOOGLE_API_KEY=AIza...

# Model Configuration
GEMINI_MODELS=gemini-2.5-flash,gemini-3-pro-preview
CLAUDE_MODELS=claude-sonnet-4-5-20250929,claude-haiku-4-5-20251001
```

### 3. Build and run with Docker Compose

```bash
# Build the image
docker compose build

# Start the application
docker compose up -d

# Check logs
docker compose logs -f
```

The application will be available at http://localhost:3000

### 4. Stop the application

```bash
docker compose down
```

## Production Deployment

### Using Caddy as reverse proxy

For production with Caddy, add this to your Caddyfile:

```caddy
presgen.businessfalkenberg.se {
    reverse_proxy localhost:3000

    # Automatic HTTPS via Let's Encrypt
    tls {
        email your-email@example.com
    }

    # Optional: Add security headers
    header {
        # Enable HSTS
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        # Prevent clickjacking
        X-Frame-Options "SAMEORIGIN"
        # XSS Protection
        X-Content-Type-Options "nosniff"
    }
}
```

Then reload Caddy:
```bash
sudo systemctl reload caddy
# or
caddy reload
```

### Environment-specific configurations

Create separate environment files:

- `.env.local` - Local development
- `.env.production` - Production deployment
- `.env.staging` - Staging environment

Use the appropriate file when deploying:

```bash
docker-compose --env-file .env.production up -d
```

## Health Checks

The application includes a health check endpoint:

```bash
curl http://localhost:3000/api/models
```

Should return available AI models if the application is healthy.

## Troubleshooting

### Container won't start

Check logs:
```bash
docker-compose logs presentation-generator
```

### Database connection issues

Verify:
1. Database URLs are correct in `.env.local`
2. Database server is accessible from Docker container
3. Credentials are valid

### Port already in use

Change the port mapping in `docker-compose.yml`:

```yaml
ports:
  - "3001:3000"  # Use port 3001 instead
```

## Security Notes

- **Never commit `.env.local`** - It contains sensitive credentials
- **Rotate API keys regularly** - Especially after any security incident
- **Use secrets management** - For production, consider using Docker secrets or a secrets manager
- **Enable HTTPS** - Always use SSL/TLS in production

## Monitoring

Consider adding:
- **Log aggregation** (e.g., ELK stack, Loki)
- **Monitoring** (e.g., Prometheus, Grafana)
- **Uptime monitoring** (e.g., UptimeRobot, Pingdom)

## Backup

Important directories to backup:
- `.env.local` - Environment variables (encrypted backup)
- `public/workspaces/` - Generated presentations (if not using external storage)

## Updates

To update the application:

```bash
# Pull latest code
git pull origin main

# Rebuild and restart
docker-compose down
docker-compose build
docker-compose up -d
```

## Support

For issues or questions:
- GitHub Issues: https://github.com/cryptonicsurfer/presentation-generator/issues
