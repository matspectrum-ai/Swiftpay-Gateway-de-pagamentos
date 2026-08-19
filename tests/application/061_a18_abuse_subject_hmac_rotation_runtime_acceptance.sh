#!/usr/bin/env bash
set -euo pipefail

: "${SWIFTPAY_API_DATABASE_URL:?SWIFTPAY_API_DATABASE_URL is required}"

node tests/application/061_a18_abuse_subject_hmac_rotation_runtime_driver.mjs
