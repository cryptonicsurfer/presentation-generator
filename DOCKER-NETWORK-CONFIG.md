# Docker Network Configuration

## Ändringar 2025-12-11

### Problem
Presentation-generator kunde inte ansluta till PostgreSQL-databasen. Appen visade "unhealthy" status.

### Orsak
1. **Isolerade nätverk**: presentation-generator körde i sitt eget nätverk (`presentation-network`), medan postgres körde i `postgres_default`
2. **Extern IP i connection string**: Databasanslutningen pekade på `46.246.38.24:5433` (extern IP)
3. **PostgreSQL endast på localhost**: Postgres lyssnade bara på `127.0.0.1:5433`, inte på extern IP

### Lösning
1. **Lade till postgres-nätverket** till presentation-generator i `docker-compose.yml`:
   ```yaml
   networks:
     - presentation-network
     - postgres_default

   networks:
     presentation-network:
       driver: bridge
     postgres_default:
       external: true
   ```

2. **Ändrade connection strings** i `.env.local` från extern IP till intern Docker DNS:
   ```
   # Före (osäkert - extern trafik)
   DATABASE_URL=postgresql://...@46.246.38.24:5433/dbname

   # Efter (säkert - intern docker-trafik)
   DATABASE_URL=postgresql://...@postgres:5432/dbname
   ```

3. **Fixade healthcheck** från `wget` till `node` (wget fanns inte i node:20-slim):
   ```yaml
   healthcheck:
     test: ["CMD-SHELL", "node -e \"fetch('http://localhost:3000/api/models')...\""]
   ```

---

## Varför detta är säkrare

### Före (osäkert)
```
┌─────────────────┐     extern IP      ┌──────────────┐
│ presentation-   │ ───46.246.38.24───▶│   postgres   │
│ generator       │      :5433         │ (127.0.0.1)  │
└─────────────────┘                    └──────────────┘
         │
         ▼
    Trafik exponerad för:
    - Nätverkssniffning
    - Man-in-the-middle
    - Brute force om port öppen
```

### Efter (säkert)
```
┌──────────────────────────────────────────────────────┐
│                 Docker Network                        │
│              (postgres_default)                       │
│                                                       │
│  ┌─────────────────┐           ┌──────────────┐      │
│  │ presentation-   │──postgres:5432──▶│  postgres  │  │
│  │ generator       │  (intern DNS)    │            │  │
│  └─────────────────┘                  └──────────────┘│
│                                                       │
└──────────────────────────────────────────────────────┘
         │
         ▼
    All databastrafik stannar
    inom Docker-nätverket
```

### Säkerhetsfördelar

| Aspekt | Före | Efter |
|--------|------|-------|
| Trafik exponerad externt | ✗ Ja | ✓ Nej |
| Kräver öppen port på host | ✗ Ja (5433) | ✓ Nej |
| Sårbar för nätverksattacker | ✗ Ja | ✓ Nej |
| Lösenord kan sniffas | ✗ Risk | ✓ Isolerat |
| Container-till-container | Via host | Direkt |

---

## Best Practices för Docker-nätverk

### 1. Använd aldrig extern IP för intern kommunikation
```yaml
# FEL ❌
DATABASE_URL=postgresql://user:pass@46.246.38.24:5433/db

# RÄTT ✓
DATABASE_URL=postgresql://user:pass@postgres:5432/db
```

### 2. Dela nätverk mellan relaterade tjänster
```yaml
# I app som behöver postgres
networks:
  - app-network
  - postgres_default  # extern referens

networks:
  app-network:
    driver: bridge
  postgres_default:
    external: true
```

### 3. Bind databaser endast till localhost
```yaml
# postgres docker-compose.yml
ports:
  - "127.0.0.1:5433:5432"  # Endast localhost, inte 0.0.0.0
```

### 4. Använd container-namn som hostname
- `postgres` → postgres-containern
- `qdrant` → qdrant-containern
- `directus` → directus-containern

### 5. Portar: intern vs extern
- **Intern port** (i Docker-nätverket): Använd containerns ursprungliga port (t.ex. `5432` för postgres)
- **Extern port** (på host): Kan vara annorlunda (t.ex. `5433`)

---

## Felsökning

### Kontrollera att containrar är på samma nätverk
```bash
docker network inspect postgres_default | grep -A5 "container-name"
```

### Testa anslutning från container
```bash
docker exec container-name sh -c 'nc -zv postgres 5432'
```

### Lista alla nätverk
```bash
docker network ls
```

### Se vilka nätverk en container använder
```bash
docker inspect container-name --format '{{json .NetworkSettings.Networks}}' | jq
```
