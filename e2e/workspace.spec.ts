import { test, expect } from '@playwright/test';
test('request editor, real transport, history and response view', async ({ page }) => {
  await page.route('https://example.com/users**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ users: [{ id: 1, name: 'Ada' }] }),
    }),
  );
  await page.goto('/');
  await expect(page.getByText('Ready when you are')).toBeVisible();
  await page.getByLabel('Request URL').fill('https://example.com/users');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('200 OK')).toBeVisible();
  await expect(page.getByText('"Ada"')).toBeVisible();
  await page.getByRole('button', { name: /History/ }).click();
  await page.screenshot({ path: 'test-results/req-response.png', fullPage: true });
  await page
    .getByRole('tablist', { name: 'Response sections' })
    .getByRole('tab', { name: /Headers/ })
    .click();
  await expect(page.getByText('content-type', { exact: true })).toBeVisible();
});
test('keyboard, save dialog, escape and unsaved tab recovery', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New Request', exact: true }).click();
  await page.getByLabel('Request URL').fill('https://example.com/');
  await page.getByRole('button', { name: 'Save request', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Close Untitled request' }).click();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByLabel('Request URL')).toHaveValue('https://example.com/');
});
