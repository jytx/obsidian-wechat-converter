#!/bin/bash
# 运行全部单元测试（vitest 单次运行模式）
# 用法: ./scripts/run-test.sh
set -e
cd "$(dirname "$0")/.."
npx vitest run "$@"
