# Environment Variable Setup for WandB Integration

## Quick Diagnosis

Run this command to check your current environment variables:
```bash
node check-env.js
```

## The Issue You're Experiencing

You mentioned that `WANDB_API_KEY` is set but you're still getting a popup. This happens when:

1. **Missing WANDB_PROJECT**: Both `WANDB_API_KEY` and `WANDB_PROJECT` are required for automatic initialization
2. **Environment variables not available to the Electron app**
3. **Variables set in a different terminal session**

## Solution Steps

### Step 1: Check Your Current Environment
```bash
# Check if variables are set in your current shell
echo "WANDB_API_KEY: $WANDB_API_KEY"
echo "WANDB_PROJECT: $WANDB_PROJECT"
```

### Step 2: Set Both Required Variables
```bash
# Set both WandB variables (required for auto-initialization)
export WANDB_API_KEY="your-wandb-api-key"
export WANDB_PROJECT="your-team/your-project"

# Verify they're set
node check-env.js
```

### Step 3: Launch the App from the Same Terminal
```bash
# Launch the app from the terminal where you set the variables
npm run dev
```

## Alternative: Use Your Shell Profile

To make the variables permanent, add them to your shell profile:

### For Bash (~/.bashrc or ~/.bash_profile):
```bash
echo 'export WANDB_API_KEY="your-wandb-api-key"' >> ~/.bashrc
echo 'export WANDB_PROJECT="your-team/your-project"' >> ~/.bashrc
source ~/.bashrc
```

### For Zsh (~/.zshrc):
```bash
echo 'export WANDB_API_KEY="your-wandb-api-key"' >> ~/.zshrc
echo 'export WANDB_PROJECT="your-team/your-project"' >> ~/.zshrc
source ~/.zshrc
```

## What the App Does Now

- **Auto-prefill**: Even if auto-initialization fails, the credentials modal will be prefilled with any available environment variables
- **Helpful logging**: Check the console for messages like "WandB partial credentials found. Missing: WANDB_PROJECT"
- **Priority**: WandB gets priority over Anthropic if both environment variables are set

## Expected Behavior

✅ **Both variables set**: App auto-initializes WandB as default provider
⚠️ **Only WANDB_API_KEY set**: Shows WandB modal with API key prefilled
⚠️ **Only WANDB_PROJECT set**: Shows WandB modal with project prefilled  
❌ **Neither set**: Shows Anthropic credentials modal (default behavior)

## Cleanup

When you're done testing, you can remove the debug script:
```bash
rm check-env.js
```