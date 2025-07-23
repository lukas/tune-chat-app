const { test, expect } = require('@playwright/test');

test.describe('Model Selector Test', () => {
    test('should show provider and model selectors in sidebar', async ({ page }) => {
        await page.goto('file://' + __dirname + '/../src/frontend/index.html');
        
        // Wait for the app to load
        await page.waitForSelector('#app', { timeout: 1000 });
        
        // Check if provider selector exists
        const providerSelect = page.locator('#provider-select');
        await expect(providerSelect).toBeVisible({ timeout: 1000 });
        
        // Check if model selector exists
        const modelSelect = page.locator('#model-select');
        await expect(modelSelect).toBeVisible({ timeout: 1000 });
        
        // Verify provider options
        const providerOptions = await providerSelect.locator('option').allTextContents();
        expect(providerOptions).toContain('Claude (Anthropic)');
        expect(providerOptions).toContain('WandB Inference');
        
        // Verify initial model options (should be Claude models by default)
        const modelOptions = await modelSelect.locator('option').allTextContents();
        expect(modelOptions).toContain('Claude 3.5 Sonnet');
        expect(modelOptions).toContain('Claude 3 Sonnet');
        expect(modelOptions).toContain('Claude 3 Haiku');
    });

    test('should have proper styling for selectors', async ({ page }) => {
        await page.goto('file://' + __dirname + '/../src/frontend/index.html');
        
        // Wait for the app to load
        await page.waitForSelector('#app', { timeout: 1000 });
        
        const providerSelect = page.locator('#provider-select');
        const modelSelect = page.locator('#model-select');
        
        // Check that selectors have proper classes
        await expect(providerSelect).toHaveClass(/provider-dropdown/);
        await expect(modelSelect).toHaveClass(/model-dropdown/);
        
        // Check that labels exist
        const providerLabel = page.locator('label[for="provider-select"]');
        const modelLabel = page.locator('label[for="model-select"]');
        
        await expect(providerLabel).toBeVisible({ timeout: 1000 });
        await expect(modelLabel).toBeVisible({ timeout: 1000 });
        
        // Verify label text
        await expect(providerLabel).toHaveText('Provider:');
        await expect(modelLabel).toHaveText('Model:');
        
        // Check that both selectors are in the provider-selector container
        const providerSelectorContainer = page.locator('.provider-selector');
        await expect(providerSelectorContainer).toBeVisible({ timeout: 1000 });
        await expect(providerSelectorContainer.locator('#provider-select')).toBeVisible({ timeout: 1000 });
        await expect(providerSelectorContainer.locator('#model-select')).toBeVisible({ timeout: 1000 });
    });
});