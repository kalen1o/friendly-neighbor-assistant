.PHONY: help up down build restart logs logs-backend logs-frontend logs-db \
       backend frontend db migrate seed clean nuke shell-backend shell-db \
       lint test

# ── Default ──
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ── Docker Compose ──
up: ## Start all services (detached)
	docker compose up -d

down: ## Stop all services
	docker compose down

build: ## Build images (uses Docker layer cache)
	docker compose build

build-clean: ## Build images from scratch (no cache)
	docker compose build --no-cache

restart: ## Restart all services
	docker compose restart

# ── Logs ──
logs: ## Tail logs from all services
	docker compose logs -f

logs-backend: ## Tail backend logs
	docker compose logs -f backend

logs-frontend: ## Tail frontend logs
	docker compose logs -f frontend

logs-db: ## Tail database logs
	docker compose logs -f db

# ── Individual services ──
backend: ## Start backend only
	docker compose up -d db backend

frontend: ## Start frontend only
	docker compose up -d frontend

db: ## Start database only
	docker compose up -d db

# ── Database ──
migrate: ## Run Alembic migrations
	docker compose exec backend alembic upgrade head

migrate-new: ## Create a new migration (usage: make migrate-new msg="add users table")
	docker compose exec backend alembic revision --autogenerate -m "$(msg)"

seed: ## Seed database with sample data
	docker compose exec backend python -m app.db.seed

# ── Development ──
shell-backend: ## Open a shell in the backend container
	docker compose exec backend bash

shell-db: ## Open psql in the database container
	docker compose exec db psql -U $${POSTGRES_USER:-friendly} -d $${POSTGRES_DB:-friendly_neighbor}

lint: ## Run linting on backend
	docker compose exec backend ruff check .

test: ## Run tests
	docker compose exec backend pytest -v

# ── Local Development (native, with HMR) ──
local-db: ## Start only PostgreSQL in Docker
	docker compose -f docker-compose.local.yml up -d

local-db-down: ## Stop local PostgreSQL
	docker compose -f docker-compose.local.yml down

local-redis: ## Start Redis for local dev
	docker compose -f docker-compose.local.yml up -d redis

local-backend: ## Run backend natively (requires local Python + deps)
	cd backend && DATABASE_URL=postgresql+asyncpg://friendly:friendly_secret@localhost:5432/friendly_neighbor uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

local-frontend: ## Run frontend natively with HMR (requires local Node)
	cd frontend && NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev

local-migrate: ## Run Alembic migrations locally
	cd backend && DATABASE_URL=postgresql+asyncpg://friendly:friendly_secret@localhost:5432/friendly_neighbor alembic upgrade head

local-test: ## Run backend tests locally
	cd backend && python3 -m pytest tests/ -v

# ── Setup ──
init: ## First-time setup: copy .env, build, start, migrate
	@test -f .env || cp .env.example .env
	@echo "📝 Edit .env with your API keys, then run: make up"

# ── Production ──
prod-build: ## Build production images
	docker compose -f docker-compose.prod.yml build

prod-up: ## Start production stack (detached)
	docker compose -f docker-compose.prod.yml up -d

prod-down: ## Stop production stack
	docker compose -f docker-compose.prod.yml down

prod-logs: ## Tail production logs
	docker compose -f docker-compose.prod.yml logs -f

prod-migrate: ## Run migrations in production
	docker compose -f docker-compose.prod.yml exec backend alembic upgrade head

prod-restart: ## Restart production services
	docker compose -f docker-compose.prod.yml restart

# ── Cleanup ──
clean: ## Stop services and remove containers
	docker compose down --remove-orphans

nuke: ## Stop services, remove containers, volumes, and images (DESTRUCTIVE)
	@echo "⚠️  This will delete all data (DB, uploads). Press Ctrl+C to cancel."
	@sleep 3
	docker compose down -v --rmi local --remove-orphans
