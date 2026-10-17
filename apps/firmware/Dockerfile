# syntax=docker/dockerfile:1.10
# Build from the repo root:  docker build -f apps/firmware/Dockerfile .
# Multi-arch (linux/amd64 + linux/arm64) so the same image runs on the Raspberry Pi.

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

RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    --mount=type=bind,source=packages/contracts/pyproject.toml,target=packages/contracts/pyproject.toml \
    --mount=type=bind,source=apps/driver/pyproject.toml,target=apps/driver/pyproject.toml \
    --mount=type=bind,source=apps/agent-persona/pyproject.toml,target=apps/agent-persona/pyproject.toml \
    --mount=type=bind,source=apps/firmware/pyproject.toml,target=apps/firmware/pyproject.toml \
    --mount=type=bind,source=scripts/pyproject.toml,target=scripts/pyproject.toml \
    uv sync --package infallible-firmware --no-install-workspace

COPY pyproject.toml uv.lock ./
COPY packages/contracts packages/contracts
COPY apps/firmware apps/firmware
COPY apps/driver/pyproject.toml apps/driver/pyproject.toml
COPY apps/agent-persona/pyproject.toml apps/agent-persona/pyproject.toml
COPY scripts/pyproject.toml scripts/pyproject.toml
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --package infallible-firmware --no-editable

# ---------------------------------------------------------------------------
FROM python:${PYTHON_VERSION}-alpine AS runtime
RUN addgroup -S -g 10001 app && adduser -S -D -H -u 10001 -G app app
COPY --from=builder --chown=app:app /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    FIRMWARE_HOST=0.0.0.0 \
    FIRMWARE_INSTANCE_BIND_HOST=0.0.0.0
WORKDIR /app
USER 10001:10001
EXPOSE 8100
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8100/healthz', timeout=2)"]
ENTRYPOINT ["python", "-m", "firmware.host"]
