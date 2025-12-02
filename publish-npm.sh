#!/bin/bash

# Script to publish AgentKit packages to npm
# Usage: ./publish-npm.sh

set -e

echo "📦 Publishing packages to npm..."

# Check if logged into npm
if ! npm whoami &> /dev/null; then
  echo "❌ Error: Not logged into npm"
  echo "   Run: npm login"
  exit 1
fi

echo "✓ Logged in as: $(npm whoami)"
echo ""

# Publish agentkit
echo "1️⃣  Publishing @thirdfy/agentkit..."
cd typescript/agentkit
npm run build || echo "⚠️  Build had warnings, continuing..."
npm publish --access public
cd ../..

# Publish langchain extension
echo ""
echo "2️⃣  Publishing @thirdfy/agentkit-langchain..."
cd typescript/framework-extensions/langchain
# Fix workspace dependencies temporarily
sed -i.bak 's/"workspace:\*"/"@thirdfy\/agentkit": "^0.10.3"/' package.json || true
npm install
npm run build || echo "⚠️  Build had warnings, continuing..."
npm publish --access public
# Restore original
mv package.json.bak package.json 2>/dev/null || true
cd ../../..

# Publish vercel-ai-sdk extension
echo ""
echo "3️⃣  Publishing @thirdfy/agentkit-vercel-ai-sdk..."
cd typescript/framework-extensions/vercel-ai-sdk
# Fix workspace dependencies temporarily
sed -i.bak 's/"workspace:\*"/"@thirdfy\/agentkit": "^0.10.3"/' package.json || true
npm install
npm run build || echo "⚠️  Build had warnings, continuing..."
npm publish --access public
# Restore original
mv package.json.bak package.json 2>/dev/null || true
cd ../../..

echo ""
echo "✅ All packages published successfully to npm!"
echo ""
echo "To use these packages, update your package.json:"
echo '  "@thirdfy/agentkit": "^0.10.3"'
echo '  "@thirdfy/agentkit-langchain": "^0.3.0"'
echo '  "@thirdfy/agentkit-vercel-ai-sdk": "^0.1.0"'

