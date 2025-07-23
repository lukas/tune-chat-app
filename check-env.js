#!/usr/bin/env node

console.log('=== Environment Variable Check ===');
console.log('');

console.log('WandB Credentials:');
console.log(`  WANDB_API_KEY: ${process.env.WANDB_API_KEY ? `Set (${process.env.WANDB_API_KEY.substring(0, 10)}...)` : 'NOT SET'}`);
console.log(`  WANDB_PROJECT: ${process.env.WANDB_PROJECT || 'NOT SET'}`);
console.log('');

console.log('Anthropic Credentials:');
console.log(`  ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? `Set (${process.env.ANTHROPIC_API_KEY.substring(0, 10)}...)` : 'NOT SET'}`);
console.log('');

console.log('Initialization Logic:');
const wandbApiKey = process.env.WANDB_API_KEY;
const wandbProject = process.env.WANDB_PROJECT;
const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

if (wandbApiKey && wandbProject) {
    console.log('✅ WandB will be auto-initialized (both API key and project found)');
} else if (wandbApiKey || wandbProject) {
    const missing = [];
    if (!wandbApiKey) missing.push('WANDB_API_KEY');
    if (!wandbProject) missing.push('WANDB_PROJECT');
    console.log(`⚠️  WandB partial credentials - Missing: ${missing.join(', ')}`);
    console.log('   Will show credentials modal with prefilled values');
} else {
    console.log('❌ WandB will not be auto-initialized');
}

if (anthropicApiKey) {
    console.log('✅ Anthropic will be auto-initialized');
} else {
    console.log('❌ Anthropic will not be auto-initialized');
}

if (!wandbApiKey && !wandbProject && !anthropicApiKey) {
    console.log('ℹ️  No environment variables found - will show credentials modal');
}

console.log('');
console.log('To set WandB environment variables:');
console.log('  export WANDB_API_KEY="your-api-key"');
console.log('  export WANDB_PROJECT="your-team/your-project"');
console.log('');
console.log('To set Anthropic environment variables:');
console.log('  export ANTHROPIC_API_KEY="sk-ant-your-key"');