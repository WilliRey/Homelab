import { expect, test, type Page } from '@playwright/test';

const audioState = (page: Page) =>
  page.evaluate(() => {
    const els = document.querySelectorAll('audio');
    const a = els[0] as HTMLAudioElement | undefined;
    return { count: els.length, paused: a?.paused ?? true, src: a?.src ?? '', time: a?.currentTime ?? 0 };
  });

async function login(page: Page) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Password').fill('e2e-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/);
}

test('log in, search, play, next, open and close the sheet', async ({ page }) => {
  await login(page);

  // Search: Songs is the default segment.
  await page.getByRole('link', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Songs' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('searchbox', { name: 'Search' }).fill('tones');
  await page.getByRole('searchbox', { name: 'Search' }).press('Enter');
  const rows = page.getByTestId('track-row');
  await expect(rows).toHaveCount(3);

  // Play: the single <audio> element is playing.
  await rows.first().getByRole('button').first().click();
  await expect.poll(async () => (await audioState(page)).paused).toBe(false);
  let st = await audioState(page);
  expect(st.count).toBe(1);
  expect(st.src).toContain('/api/stream/e2etrack001/audio');
  await expect.poll(async () => (await audioState(page)).time).toBeGreaterThan(0.2);
  await expect(page.getByTestId('mini-player')).toContainText('First Tone');

  // Radio tops up the queue; Next moves to the next track and keeps playing.
  await page.getByTestId('mini-player').getByRole('button', { name: 'Next' }).click();
  await expect.poll(async () => (await audioState(page)).src).toContain('/api/stream/e2etrack004/audio');
  await expect.poll(async () => (await audioState(page)).paused).toBe(false);
  await expect(page.getByTestId('mini-player')).toContainText('Radio One');

  // Open the sheet, check controls, close it with the chevron.
  await page.getByRole('button', { name: 'Open player' }).click();
  const sheet = page.getByTestId('player-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('heading', { name: 'Radio One' })).toBeVisible();
  await expect(sheet.getByTestId('queue')).toContainText('Radio Two');
  await sheet.getByRole('button', { name: 'Close player' }).click();
  await expect(sheet).toBeHidden();

  // Open again and close by swiping down.
  await page.getByRole('button', { name: 'Open player' }).click();
  await expect(sheet).toBeVisible();
  await swipeDown(page, '[data-testid="player-sheet"] header', 220);
  await expect(sheet).toBeHidden();

  // Navigating never creates a second <audio> or stops playback.
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  st = await audioState(page);
  expect(st.count).toBe(1);
  expect(st.paused).toBe(false);
});

test('a track that ends starts the next one by itself', async ({ page }) => {
  await login(page);
  await page.goto('/search?q=tones&type=songs');
  await page.getByTestId('track-row').first().getByRole('button').first().click();
  await expect.poll(async () => (await audioState(page)).paused).toBe(false);
  // Jump near the end of the 8 s tone and let `ended` advance the queue.
  await page.waitForFunction(() => Number.isFinite(document.querySelector('audio')!.duration));
  await page.evaluate(() => {
    const a = document.querySelector('audio')!;
    a.currentTime = a.duration - 0.5;
  });
  await expect.poll(async () => (await audioState(page)).src, { timeout: 10_000 }).toContain('e2etrack004');
  await expect.poll(async () => (await audioState(page)).paused).toBe(false);
});

test('shorts links are refused and touch targets are at least 44 px', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Search', exact: true }).click();
  await page.getByLabel('Paste a link').fill('https://youtube.com/shorts/abcdefghijk');
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByText('Shorts are disabled')).toBeVisible();

  await page.getByRole('searchbox', { name: 'Search' }).fill('tones');
  await page.getByRole('searchbox', { name: 'Search' }).press('Enter');
  await expect(page.getByTestId('track-row')).toHaveCount(3);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('button, a, [role="tab"]')]
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => ({ el: (el as HTMLElement).getAttribute('aria-label') ?? el.textContent?.trim(), r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width < 44 || r.height < 44)
      .map(({ el, r }) => `${el} ${Math.round(r.width)}x${Math.round(r.height)}`),
  );
  expect(small).toEqual([]);
});

async function swipeDown(page: Page, selector: string, distance: number) {
  await page.evaluate(
    ({ selector, distance }) => {
      const el = document.querySelector(selector)!;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const touch = (yy: number) => new Touch({ identifier: 1, target: el, clientX: x, clientY: yy });
      el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [touch(y)], changedTouches: [touch(y)] }));
      for (let i = 1; i <= 5; i++) {
        const t = touch(y + (distance * i) / 5);
        el.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, touches: [t], changedTouches: [t] }));
      }
      el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [touch(y + distance)] }));
    },
    { selector, distance },
  );
}
