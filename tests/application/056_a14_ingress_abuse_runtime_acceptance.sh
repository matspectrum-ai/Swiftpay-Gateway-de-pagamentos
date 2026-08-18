#!/usr/bin/env bash
set -euo pipefail

: "${SWIFTPAY_API_DATABASE_URL:?SWIFTPAY_API_DATABASE_URL is required}"

node tests/application/056_a14_ingress_abuse_runtime_driver.mjs
