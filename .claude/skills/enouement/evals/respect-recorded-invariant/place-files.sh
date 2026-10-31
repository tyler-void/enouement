#!/usr/bin/env bash
set -eu
cp -R "$(dirname "$0")/files/." .
git init -q -b main
git -c user.name=Test -c user.email=test@example.invalid add -A
git -c user.name=Test -c user.email=test@example.invalid commit -q -m "initial"
