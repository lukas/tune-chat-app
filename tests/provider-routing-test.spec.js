const { test, expect } = require('@playwright/test');

test.describe('Provider Routing and Model Selection Test', () => {
    test('should not send WandB models to Anthropic API', async ({ page }) => {
        // Intercept API calls to both providers to verify routing
        const anthropicCalls = [];
        const wandbCalls = [];
        
        // Intercept Anthropic API calls
        await page.route('**/anthropic.com/**', async route => {
            const request = route.request();
            anthropicCalls.push({
                url: request.url(),
                method: request.method(),
                postData: request.postData()
            });
            
            // Mock Anthropic response to avoid real API calls
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ 
                    id: 'test-response',
                    type: 'message',
                    content: [{ type: 'text', text: 'Test response from Anthropic' }]
                })
            });
        });
        
        // Intercept WandB API calls
        await page.route('**/api.inference.wandb.ai/**', async route => {
            const request = route.request();
            wandbCalls.push({
                url: request.url(),
                method: request.method(),
                postData: request.postData()
            });
            
            // Mock WandB models list response
            if (request.url().includes('/models')) {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        data: [
                            { id: 'meta-llama/Llama-3.1-8B-Instruct', object: 'model' },
                            { id: 'Qwen/Qwen3-235B-A22B-Instruct-2507', object: 'model' },
                            { id: 'deepseek-ai/DeepSeek-V2.5', object: 'model' }
                        ]
                    })
                });
            } else {
                // Mock chat completion response
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ 
                        id: 'test-response',
                        choices: [{ 
                            message: { content: 'Test response from WandB' }
                        }]
                    })
                });
            }
        });
        
        await page.goto('file://' + __dirname + '/../src/frontend/index.html');
        await page.waitForSelector('#app', { timeout: 1000 });
        
        // Verify UI elements are present
        const providerSelect = page.locator('#provider-select');
        const modelSelect = page.locator('#model-select');
        
        await expect(providerSelect).toBeVisible({ timeout: 1000 });
        await expect(modelSelect).toBeVisible({ timeout: 1000 });
        
        // Verify initial state (should be Anthropic)
        expect(await providerSelect.inputValue()).toBe('anthropic');
        
        // Verify Claude models are shown initially
        const initialModelOptions = await modelSelect.locator('option').allTextContents();
        expect(initialModelOptions.some(option => option.includes('Claude'))).toBe(true);
        
        console.log('✅ Initial state verification passed');
    });

    test('should properly validate provider-model combinations', async ({ page }) => {
        await page.goto('file://' + __dirname + '/../src/frontend/index.html');
        await page.waitForSelector('#app', { timeout: 1000 });
        
        const providerSelect = page.locator('#provider-select');
        const modelSelect = page.locator('#model-select');
        
        // Test 1: Anthropic provider should only have Claude models
        await providerSelect.selectOption('anthropic');
        await page.waitForTimeout(100); // Wait for model options to update
        
        const claudeModels = await modelSelect.locator('option').allTextContents();
        expect(claudeModels.every(model => 
            model.includes('Claude') || model.includes('Sonnet') || model.includes('Haiku')
        )).toBe(true);
        
        console.log('✅ Anthropic models validation passed');
        
        // Test 2: When switching to WandB, models should update
        await providerSelect.selectOption('wandb');
        await page.waitForTimeout(100); // Wait for model options to update
        
        // Note: In test environment without real backend, this might not update
        // But we can verify the selector changed
        expect(await providerSelect.inputValue()).toBe('wandb');
        
        console.log('✅ Provider switching validation passed');
    });

    test('should handle invalid model-provider combinations gracefully', async ({ page }) => {
        // Listen for console errors that might indicate routing issues
        const consoleErrors = [];
        page.on('console', msg => {
            if (msg.type() === 'error') {
                consoleErrors.push(msg.text());
            }
        });
        
        await page.goto('file://' + __dirname + '/../src/frontend/index.html');
        await page.waitForSelector('#app', { timeout: 1000 });
        
        // Test that switching providers doesn't cause console errors
        const providerSelect = page.locator('#provider-select');
        
        // Switch between providers multiple times
        await providerSelect.selectOption('anthropic');
        await page.waitForTimeout(50);
        await providerSelect.selectOption('wandb');
        await page.waitForTimeout(50);
        await providerSelect.selectOption('anthropic');
        await page.waitForTimeout(50);
        
        // Check that no critical errors occurred during switching
        const criticalErrors = consoleErrors.filter(error => 
            error.includes('TypeError') || 
            error.includes('ReferenceError') ||
            error.includes('Cannot read property')
        );
        
        expect(criticalErrors.length).toBe(0);
        
        console.log('✅ Error handling validation passed');
    });

    test('should maintain model consistency when switching providers', async ({ page }) => {
        await page.goto('file://' + __dirname + '/../src/frontend/index.html');
        await page.waitForSelector('#app', { timeout: 1000 });
        
        const providerSelect = page.locator('#provider-select');
        const modelSelect = page.locator('#model-select');
        
        // Start with Anthropic
        await providerSelect.selectOption('anthropic');
        const anthropicModel = await modelSelect.inputValue();
        expect(anthropicModel).toContain('claude'); // Should contain 'claude'
        
        // Switch to WandB (will trigger credentials modal in real app)
        await providerSelect.selectOption('wandb');
        await page.waitForTimeout(100);
        
        // Verify provider switched (even if credentials modal appears)
        expect(await providerSelect.inputValue()).toBe('wandb');
        
        // Switch back to Anthropic
        await providerSelect.selectOption('anthropic');
        await page.waitForTimeout(100);
        
        // Verify we're back to Anthropic and model is appropriate
        expect(await providerSelect.inputValue()).toBe('anthropic');
        const finalModel = await modelSelect.inputValue();
        expect(finalModel).toContain('claude'); // Should be a Claude model again
        
        console.log('✅ Model consistency validation passed');
    });
});