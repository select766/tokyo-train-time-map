import { expect, test, type Page } from '@playwright/test';

/** SVG 上のある駅の点の中心座標（ビューポート基準） */
async function dotCenter(page: Page, name: string): Promise<{ x: number; y: number }> {
  const box = await page
    .locator(`svg.map .dot`)
    .filter({ has: page.locator('title', { hasText: new RegExp(`^${name}$`) }) })
    .first()
    .boundingBox();
  if (!box) throw new Error(`${name} の点が見つかりません`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** テスト中に出たコンソールエラー・未捕捉例外 */
const pageErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await page.waitForSelector('svg.map .label');
});

test.afterEach(({ page }) => {
  expect(pageErrors.get(page) ?? [], 'コンソールエラーが出ていないこと').toEqual([]);
});

test('初期表示で地図と統計が出る', async ({ page }) => {
  await expect(page.locator('svg.map')).toBeVisible();
  await expect(page.locator('.stats__headline')).toContainText('30分以内に');
  // 全駅ぶんの点が描かれている
  await expect(page.locator('svg.map .dot')).toHaveCount(248);
});

test('2020年以降に開業した駅が地図に載っている', async ({ page }) => {
  await expect(page.locator('svg.map .dot title', { hasText: '虎ノ門ヒルズ' })).toHaveCount(1);
  await expect(page.locator('svg.map .dot title', { hasText: '高輪ゲートウェイ' })).toHaveCount(1);
});

test('駅名検索で中心駅を切り替えると統計と URL が追随する', async ({ page }) => {
  await page.fill('#station-search', '新宿');
  await page.keyboard.press('Enter');
  await expect(page.locator('.stats__headline')).toContainText('新宿');
  await expect(page).toHaveURL(/center=%E6%96%B0%E5%AE%BF/);
});

test('URL の center パラメータが復元される', async ({ page }) => {
  await page.goto('/?center=' + encodeURIComponent('渋谷'));
  await page.waitForSelector('svg.map .label');
  await expect(page.locator('.stats__headline')).toContainText('渋谷');
});

test('中心駅は原点にあり、所要時間が距離に比例する', async ({ page }) => {
  await page.goto('/?center=' + encodeURIComponent('東京') + '&scale=20');
  await page.waitForSelector('svg.map .label');
  await page.waitForTimeout(900);

  const center = await dotCenter(page, '東京');
  // 東京→新橋 は山手線で4分。scale=20 なので中心から 80px の位置に来るはず
  const shimbashi = await dotCenter(page, '新橋');
  const r = Math.hypot(shimbashi.x - center.x, shimbashi.y - center.y);
  expect(r).toBeGreaterThan(80 - 6);
  expect(r).toBeLessThan(80 + 6);
});

test('駅をクリックするとその駅が中心になる', async ({ page }) => {
  await page.goto('/?center=' + encodeURIComponent('東京') + '&scale=20');
  await page.waitForSelector('svg.map .label');
  await page.waitForTimeout(900);

  const target = await dotCenter(page, '銀座');
  await page.mouse.click(target.x, target.y);
  await expect(page.locator('.stats__headline')).toContainText('銀座');
});

test('全体表示で最も遠い駅まで画面に収まる', async ({ page }) => {
  await page.getByRole('button', { name: '全体表示' }).click();
  await page.waitForTimeout(1000);

  const farthest = await page.locator('.stats__cell').last().locator('dd').innerText();
  const name = farthest.split(' ')[0]!;
  const mapBox = (await page.locator('.map-holder').boundingBox())!;
  const dot = await dotCenter(page, name);
  expect(dot.x).toBeGreaterThanOrEqual(mapBox.x);
  expect(dot.x).toBeLessThanOrEqual(mapBox.x + mapBox.width);
  expect(dot.y).toBeGreaterThanOrEqual(mapBox.y);
  expect(dot.y).toBeLessThanOrEqual(mapBox.y + mapBox.height);
});

test('ホイールで拡大縮小できる', async ({ page }) => {
  await page.goto('/?center=' + encodeURIComponent('東京') + '&scale=20');
  await page.waitForSelector('svg.map .label');
  await page.waitForTimeout(900);
  const before = await dotCenter(page, '新橋');
  const center = await dotCenter(page, '東京');

  await page.mouse.move(center.x, center.y);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(300);

  const after = await dotCenter(page, '新橋');
  const rBefore = Math.hypot(before.x - center.x, before.y - center.y);
  const rAfter = Math.hypot(after.x - center.x, after.y - center.y);
  expect(rAfter).toBeGreaterThan(rBefore);
});
