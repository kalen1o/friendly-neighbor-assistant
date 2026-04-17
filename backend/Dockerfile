# ── Stage 1: Build dependencies ──
FROM python:3.12-slim AS builder

WORKDIR /build

# System deps needed for building Python packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# Long timeout + retries so a slow mirror or a stalled TCP read doesn't kill the build
ENV PIP_DEFAULT_TIMEOUT=300 PIP_RETRIES=5
RUN pip install --no-cache-dir --prefix=/install --timeout=300 --retries=5 -r requirements.txt

# ── Stage 2: Production image ──
FROM python:3.12-slim

# System deps for runtime (PDF parsing, OCR)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmagic-dev \
    poppler-utils \
    tesseract-ocr \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN groupadd -r app && useradd -r -g app -d /app -s /sbin/nologin app

WORKDIR /app

# Copy installed Python packages from builder
COPY --from=builder /install /usr/local

# Copy application code
COPY . .

# Create uploads directory
RUN mkdir -p /app/uploads && chown -R app:app /app

USER app

EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

# Production: no --reload, multiple workers
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
