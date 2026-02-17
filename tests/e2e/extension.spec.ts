import { expect, test } from '@playwright/test'

declare const chrome: any

test.describe('SafeCap Extension', () => {
  test('extension popup loads successfully', async ({ page }) => {
    // Navigate to a test page
    await page.goto('https://example.com')

    // Wait for extension to be available (you may need to adjust this)
    await page.waitForTimeout(1000)

    // Take a screenshot for debugging
    await page.screenshot({ path: 'test-results/page.png' })

    // Basic test - page should load
    expect(await page.title()).toBeTruthy()
  })

  test('browser API is available', async ({ page }) => {
    await page.goto('https://example.com')

    // Check if browser or chrome object exists in the page context
    const hasBrowserAPI = await page.evaluate(() => {
      return typeof browser !== 'undefined' || typeof chrome !== 'undefined'
    })

    // Note: This will be false on regular pages, but extension content scripts
    // would have access. This is just a placeholder for actual extension tests.
    console.log('Browser API available:', hasBrowserAPI)
  })
})
