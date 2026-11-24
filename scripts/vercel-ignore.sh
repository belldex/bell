#!/bin/sh
# Vercel runs this from apps/web as the ignoreCommand. Exit 0 skips the build, exit 1 builds.
# It skips a commit only when nothing the web app reads changed; CI evidence commits (swaps, calendar state, health) touch none of these paths.
# If the diff cannot be computed (no parent commit in a shallow clone), git exits non-zero and the build runs, which is the safe side.
git diff --quiet HEAD^ HEAD -- . \
  ../../packages \
  ../../scripts/auction-cli \
  ../../scripts/deploy/mainnet-pool-config.mjs \
  ../../evidence/deploy/mainnet-4663.json \
  ../../evidence/deploy/mainnet-4663-asset-queue.json \
  ../../evidence/deploy/mainnet-4663-reference-adapters.json \
  ../../evidence/deploy/mainnet-4663-verification.json \
  ../../pnpm-lock.yaml ../../package.json ../../pnpm-workspace.yaml \
  && exit 0
exit 1
