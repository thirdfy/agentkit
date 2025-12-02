#!/bin/bash

# Script to publish AgentKit packages to GitHub Packages
# Usage: GITHUB_TOKEN=your_token ./publish-packages.sh

set -e

if [ -z "$GITHUB_TOKEN" ]; then
  echo "❌ Error: GITHUB_TOKEN environment variable is required"
  echo "   Get a token from: https://github.com/settings/tokens"
  echo "   Required scopes: write:packages, read:packages"
  exit 1
fi

export NPM_CONFIG_REGISTRY=https://npm.pkg.github.com

echo "📦 Publishing packages to GitHub Packages..."

# Publish agentkit
echo ""
echo "1️⃣  Publishing @thirdfy/agentkit..."
cd typescript/agentkit
npm run build
npm publish --access public
cd ../..

# Publish langchain extension
echo ""
echo "2️⃣  Publishing @thirdfy/agentkit-langchain..."
cd typescript/framework-extensions/langchain
npm run build
npm publish --access public
cd ../../..

# Publish vercel-ai-sdk extension
echo ""
echo "3️⃣  Publishing @thirdfy/agentkit-vercel-ai-sdk..."
cd typescript/framework-extensions/vercel-ai-sdk
npm run build
npm publish --access public
cd ../../..

echo ""
echo "✅ All packages published successfully!"
echo ""
echo "To use these packages, add to your .npmrc:"
echo "  @thirdfy:registry=https://npm.pkg.github.com"
echo "  //npm.pkg.github.com/:_authToken=\${GITHUB_TOKEN}"

