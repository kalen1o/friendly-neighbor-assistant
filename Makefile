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

build: ## Build all images from scratch
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

# ── Setup ──
init: ## First-time setup: copy .env, build, start, migrate
	@test -f .env || cp .env.example .env
	@echo "📝 Edit .env with your API keys, then run: make up"

# ── Cleanup ──
clean: ## Stop services and remove containers
	docker compose down --remove-orphans

nuke: ## Stop services, remove containers, volumes, and images (DESTRUCTIVE)
	@echo "⚠️  This will delete all data (DB, uploads). Press Ctrl+C to cancel."
	@sleep 3
	docker compose down -v --rmi local --remove-orphans
