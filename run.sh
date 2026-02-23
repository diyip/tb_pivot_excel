#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

export PYTHONPATH="$ROOT_DIR/core:$ROOT_DIR"
export APP_BASE_DIR="$ROOT_DIR"

source "$ROOT_DIR/.venv/bin/activate"

PAYLOAD="${1:-test_widget_payload.json}"
TENANT="${2:?Usage: run.sh [payload.json] <tenant_id>}"

python "$SCRIPT_DIR/main.py" "$PAYLOAD" "$TENANT"
