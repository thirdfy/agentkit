# Publishing AgentKit Packages to GitHub Packages

## Step 1: Create GitHub Personal Access Token

1. Go to: https://github.com/settings/tokens
2. Click "Generate new token" → "Generate new token (classic)"
3. Name it: `GitHub Packages Token`
4. Select scopes:
   - ✅ `write:packages` (to publish)
   - ✅ `read:packages` (to install)
5. Click "Generate token"
6. **Copy the token immediately** (you won't see it again!)

## Step 2: Publish Packages

Run the publish script with your token:

```bash
cd vendor/agentkit
GITHUB_TOKEN=your_token_here ./publish-packages.sh
```

Or set it as an environment variable:

```bash
export GITHUB_TOKEN=your_token_here
cd vendor/agentkit
./publish-packages.sh
```

## Step 3: Update Main Project to Use Published Packages

### 3.1 Create `.npmrc` in project root

Create `/Users/feliperieger/ThirdfyAPI/thirdfy-api-v2/.npmrc`:

```
@thirdfy:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

### 3.2 Update `package.json`

Replace the `file:` dependencies with published packages:

```json
{
  "dependencies": {
    "@thirdfy/agentkit": "^0.10.3",
    "@thirdfy/agentkit-langchain": "^0.3.0",
    "@thirdfy/agentkit-vercel-ai-sdk": "^0.1.0"
  }
}
```

### 3.3 Set GITHUB_TOKEN in Vercel

1. Go to your Vercel project settings
2. Navigate to "Environment Variables"
3. Add:
   - **Name**: `GITHUB_TOKEN`
   - **Value**: Your GitHub token
   - **Environment**: Production, Preview, Development (all)

### 3.4 Remove Old Setup

You can now remove:
- `setup-agentkit.js`
- `vendor/agentkit` directory (or keep it for local dev)
- `installCommand` from `vercel.json`
- `postinstall` script from `package.json`

## Step 4: Install and Test

```bash
# Remove old file dependencies
rm -rf node_modules vendor/agentkit

# Install from GitHub Packages
yarn install

# Test that it works
npm run build
```

## Benefits

✅ No more cloning/building during install  
✅ Faster Vercel builds  
✅ Version management via npm  
✅ Works the same locally and in CI  
✅ No submodule complexity  

## Updating Packages

When you make changes to AgentKit:

1. Make changes in `vendor/agentkit`
2. Commit and push to `thirdfy/agentkit` repo
3. Update version in `package.json` (e.g., `0.10.3` → `0.10.4`)
4. Run `./publish-packages.sh` again
5. Update version in main project's `package.json`

