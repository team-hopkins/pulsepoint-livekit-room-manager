# CI/CD Pipeline Setup

## GitHub Actions Pipeline

This repository has a CI/CD pipeline that automatically builds and pushes Docker images to DigitalOcean Container Registry.

### Setup Instructions

#### 1. Create a DigitalOcean API Token

1. Go to [DigitalOcean API Tokens](https://cloud.digitalocean.com/account/api/tokens)
2. Click "Generate New Token"
3. Name it something like "GitHub Actions - nexhacks-livekit"
4. Select both **Read** and **Write** scopes
5. Click "Generate Token"
6. **Copy the token immediately** (you won't be able to see it again)

#### 2. Add the Token to GitHub Secrets

1. Go to your GitHub repository: `https://github.com/team-hopkins/nexhacks-livekit`
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **"New repository secret"**
4. Name: `DIGITALOCEAN_ACCESS_TOKEN`
5. Value: Paste the DigitalOcean API token you copied
6. Click **"Add secret"**

### How It Works

The pipeline is triggered automatically when:
- You push code to the `main` branch
- You manually trigger it from the Actions tab

**What it does:**
1. ✅ Checks out your code
2. ✅ Installs `doctl` (DigitalOcean CLI)
3. ✅ Logs into DigitalOcean Container Registry
4. ✅ Builds the Docker image for `linux/amd64` platform
5. ✅ Pushes two tags:
   - `latest` (always points to the most recent build)
   - `<commit-sha>` (specific version for rollbacks)
6. ✅ Uses GitHub Actions cache to speed up builds

### Manual Trigger

You can also manually trigger the pipeline:
1. Go to **Actions** tab in GitHub
2. Select **"Build and Push to DigitalOcean Registry"**
3. Click **"Run workflow"**
4. Select the branch and click **"Run workflow"**

### After the Pipeline Runs

After a successful build and push, you need to deploy the new image:

#### Option 1: Auto-deploy (Recommended)
Configure your DigitalOcean App to auto-deploy when a new image is pushed:
```bash
doctl apps update <APP_ID> --spec .do/app.yaml
```

#### Option 2: Manual deploy via Dashboard
1. Go to [DigitalOcean Apps](https://cloud.digitalocean.com/apps)
2. Select your app
3. Click **"Deploy"**

#### Option 3: Manual deploy via CLI
```bash
doctl apps create-deployment <APP_ID>
```

### Viewing Pipeline Status

- View pipeline runs: `https://github.com/team-hopkins/nexhacks-livekit/actions`
- Check build logs for any errors
- Green checkmark ✅ = successful build and push
- Red X ❌ = build failed (check logs for details)

### Troubleshooting

**Pipeline fails with "unauthorized" error:**
- Check that `DIGITALOCEAN_ACCESS_TOKEN` secret is set correctly
- Ensure the token has both Read and Write permissions

**Pipeline fails at build step:**
- Check the Dockerfile for syntax errors
- Ensure all required files are committed to the repository

**Image pushed but app not updated:**
- DigitalOcean Apps don't auto-deploy by default
- Trigger a manual deployment after the pipeline completes

### Files

- `.github/workflows/deploy.yml` - The CI/CD pipeline configuration
- `Dockerfile` - Docker image build instructions
- `.dockerignore` - Files to exclude from Docker builds
