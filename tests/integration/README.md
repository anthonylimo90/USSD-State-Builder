# Integration Tests

These tests require running external services (Redis, PostgreSQL, MongoDB).

## Prerequisites

### Docker Setup (Recommended)

```bash
# Start all services
docker-compose up -d

# Or start individually:
docker run -d --name ussd-redis -p 6379:6379 redis:7-alpine
docker run -d --name ussd-postgres -p 5432:5432 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=ussd_test postgres:15-alpine
docker run -d --name ussd-mongo -p 27017:27017 mongo:7
```

### docker-compose.yml

```yaml
version: '3.8'
services:
  redis:
    image: redis:7-alpine
    ports: ['6379:6379']
  postgres:
    image: postgres:15-alpine
    ports: ['5432:5432']
    environment:
      POSTGRES_PASSWORD: test
      POSTGRES_DB: ussd_test
  mongodb:
    image: mongo:7
    ports: ['27017:27017']
```

## Running Tests

```bash
# Run all integration tests
npm run test:integration

# Run specific adapter tests
npx jest tests/integration/RedisStorage.integration.test.js
npx jest tests/integration/PostgreSQLStorage.integration.test.js
```

## Environment Variables

- `REDIS_URL` - Redis connection URL (default: `redis://localhost:6379`)
- `POSTGRES_URL` - PostgreSQL connection URL (default: `postgresql://postgres:test@localhost:5432/ussd_test`)
- `MONGODB_URL` - MongoDB connection URL (default: `mongodb://localhost:27017/ussd_test`)
