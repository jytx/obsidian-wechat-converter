#!/bin/bash
# 构建插件产物 main.js（生产模式）
# 用法: ./scripts/run-build.sh
set -e
cd "$(dirname "$0")/.."
npm run build
