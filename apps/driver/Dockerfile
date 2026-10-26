# syntax=docker/dockerfile:1.10
# Build from the repo root:  docker build -f apps/driver/Dockerfile .
#
# Image contains the driver AND agent-persona (the driver spawns one
# `python -m agent_persona` process per agent inside this container).

ARG PYTHON_VERSION=3.14
ARG UV_VERSION=0.11

FROM ghcr.io/astral-sh/uv:${UV_VERSION} AS uv

# ---------------------------------------------------------------------------
FROM python:${PYTHON_VERSION}-alpine AS builder
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0 \
    UV_FROZEN=1 \
    UV_NO_DEV=1
WORKDIR /app

# 1) Third-party dependencies only — cached until uv.lock changes.
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    --mount=type=bind,source=packages/contracts/pyproject.toml,target=packages/contracts/pyproject.toml \
    --mount=type=bind,source=apps/driver/pyproject.toml,target=apps/driver/pyproject.toml \
    --mount=type=bind,source=apps/agent-persona/pyproject.toml,target=apps/agent-persona/pyproject.toml \
    --mount=type=bind,source=apps/firmware/pyproject.toml,target=apps/firmware/pyproject.toml \
    --mount=type=bind,source=scripts/pyproject.toml,target=scripts/pyproject.toml \
    uv sync --package infallible-driver --extra agents --no-install-workspace

# 2) Workspace members, installed as regular (non-editable) wheels so the
#    runtime stage needs nothing but the venv.
COPY pyproject.toml uv.lock ./
COPY packages/contracts packages/contracts
COPY apps/driver apps/driver
COPY apps/agent-persona apps/agent-persona
COPY apps/firmware/pyproject.toml apps/firmware/pyproject.toml
COPY scripts/pyproject.toml scripts/pyproject.toml
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --package infallible-driver --extra agents --no-editable

# ---------------------------------------------------------------------------
FROM python:${PYTHON_VERSION}-alpine AS runtime
# /state is world-writable: compose may run the driver as the host uid, which
# would otherwise be locked out of the named volume seeded from this directory.
RUN addgroup -S -g 10001 app && adduser -S -D -H -u 10001 -G app app \
 && mkdir -p /data /state && chown app:app /data /state && chmod 1777 /state
COPY --from=builder --chown=app:app /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DRIVER_HOST=0.0.0.0 \
    DRIVER_DATA_DIR=/data \
    DRIVER_DB_PATH=/state/driver.sqlite3
WORKDIR /app
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=2)"]
ENTRYPOINT ["python", "-m", "driver"]
