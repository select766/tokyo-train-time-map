import { expect, test, type Page } from '@playwright/test';

/** 駅名で駅の点を指すロケータ */
function dot(page: Page, name: string) {
  return page
    .locator('svg.map .dot')
    .filter({ has: page.locator('title', { hasText: new RegExp(`^${escapeRe(name)}$`) }) });
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
  // 開業済みの全駅ぶんの点が描かれている（未開業のおまけ路線の駅は非表示）
  await expect(page.locator('svg.map .dot:not([style*="display: none"])')).toHaveCount(248);
});

test('注釈に地図の読み方と前提が並ぶ', async ({ page }) => {
  const caveats = page.locator('.footer__caveats');
  await expect(caveats).toContainText('方角は実際の地理どおり');
  await expect(caveats).toContainText('中心駅以外の駅どうしの所要時間は正しく表現されません');
  await expect(caveats).toContainText('快速・急行は考慮していません');
  await expect(caveats).toContainText('乗換・徒歩連絡は一律5分');
  await expect(caveats.locator('li')).toHaveCount(4);
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

test.describe('ゆがみの背景色', () => {
  const toggle = (page: Page) => page.getByRole('button', { name: 'ゆがみを色で表示' });

  test('既定では出ておらず、ボタンで出せる', async ({ page }) => {
    await expect(page.locator('svg.map image.field')).toBeHidden();
    await expect(page.locator('.legend')).toHaveCount(0);

    await toggle(page).click();
    await expect(page.locator('svg.map image.field')).toBeVisible();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/field=1/);
  });

  test('凡例に数値の目盛が並ぶ（色だけに意味を持たせない）', async ({ page }) => {
    await toggle(page).click();
    const legend = page.locator('.legend');
    await expect(legend).toBeVisible();
    await expect(legend).toContainText('実効速度');
    await expect(legend).toContainText('直線距離 ÷ 所要時間');
    await expect(legend.locator('.legend__swatch')).toHaveCount(5);
    for (const tick of ['13未満', '13〜18', '18〜24', '24〜30', '30以上']) {
      await expect(legend, tick).toContainText(tick);
    }
  });

  test('もう一度押すと消える', async ({ page }) => {
    await toggle(page).click();
    await expect(page.locator('svg.map image.field')).toBeVisible();
    await toggle(page).click();
    await expect(page.locator('svg.map image.field')).toBeHidden();
    await expect(page.locator('.legend')).toHaveCount(0);
    await expect(page).not.toHaveURL(/field=1/);
  });

  test('URL の field=1 で最初から出せる', async ({ page }) => {
    await page.goto('/?field=1');
    await page.waitForSelector('svg.map .label');
    await expect(page.locator('svg.map image.field')).toBeVisible();
    await expect(page.locator('.legend')).toBeVisible();
  });

  test('中心駅を変えると場が作り直される', async ({ page }) => {
    await page.goto('/?field=1&center=' + encodeURIComponent('東京'));
    await page.waitForSelector('svg.map .label');
    await page.waitForTimeout(900);
    const before = await page.locator('svg.map image.field').getAttribute('href');

    await page.fill('#station-search', '西船橋');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1200);

    const after = await page.locator('svg.map image.field').getAttribute('href');
    expect(before).toBeTruthy();
    expect(after).not.toBe(before);
  });

  test('拡大しても場は駅と一緒に伸縮する', async ({ page }) => {
    await page.goto('/?field=1&center=' + encodeURIComponent('東京') + '&scale=20');
    await page.waitForSelector('svg.map .label');
    await page.waitForTimeout(900);
    const image = page.locator('svg.map image.field');
    const w0 = Number(await image.getAttribute('width'));
    const href0 = await image.getAttribute('href');

    const center = await dotCenter(page, '東京');
    await page.mouse.move(center.x, center.y);
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(400);

    const w1 = Number(await image.getAttribute('width'));
    expect(w1).toBeGreaterThan(w0 * 1.1);
    // 倍率が変わっただけなら画像を作り直す必要はない
    expect(await image.getAttribute('href')).toBe(href0);
  });
});

test.describe('おまけモード', () => {
  test('ボタンでモーダルが開き、計画路線が並ぶ', async ({ page }) => {
    await page.getByRole('button', { name: /おまけモード/ }).click();
    const dialog = page.locator('dialog.dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('都心部・臨海地域地下鉄');
    await expect(dialog).toContainText('有楽町線延伸');
    await expect(dialog).toContainText('南北線延伸');
    await expect(dialog.locator('input[type=checkbox]')).toHaveCount(3);
    // 厳密な値ではないことを断っている
    await expect(dialog).toContainText('目安');

    await page.getByRole('button', { name: '閉じる' }).click();
    await expect(dialog).not.toBeVisible();
  });

  test('既定では未開業駅は地図に出ない', async ({ page }) => {
    for (const name of ['晴海', '豊洲市場', '有明', '新銀座', '枝川', '千石(江東)']) {
      await expect(dot(page, name), name).toHaveCount(1);
      await expect(dot(page, name), name).toBeHidden();
    }
    await expect(page.locator('.stats__headline')).toContainText('248 駅');
  });

  test('臨海地下鉄を有効にすると勝どきが東京駅に近づく', async ({ page }) => {
    await page.goto('/?center=' + encodeURIComponent('東京') + '&scale=20');
    await page.waitForSelector('svg.map .label');
    await page.waitForTimeout(900);
    const center = await dotCenter(page, '東京');
    const before = await dotCenter(page, '勝どき');
    const rBefore = Math.hypot(before.x - center.x, before.y - center.y);

    await page.getByRole('button', { name: /おまけモード/ }).click();
    await page.locator('dialog.dialog input[type=checkbox]').first().check();
    await page.getByRole('button', { name: '閉じる' }).click();
    await page.waitForTimeout(1000);

    const after = await dotCenter(page, '勝どき');
    const rAfter = Math.hypot(after.x - center.x, after.y - center.y);
    // 18分 → 7分。scale=20 なので半径は 360px → 140px になるはず
    expect(rBefore).toBeGreaterThan(330);
    expect(rAfter).toBeLessThan(170);
  });

  test('有効にすると未開業駅と対象駅数が増え、URL にも残る', async ({ page }) => {
    await page.getByRole('button', { name: /おまけモード/ }).click();
    const boxes = page.locator('dialog.dialog input[type=checkbox]');
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await page.getByRole('button', { name: '閉じる' }).click();
    await page.waitForTimeout(1000);

    await expect(page.locator('.stats__headline')).toContainText('255 駅');
    await expect(dot(page, '晴海')).toBeVisible();
    await expect(dot(page, '千石(江東)')).toBeVisible();
    await expect(dot(page, '有明')).toBeVisible();
    await expect(page).toHaveURL(/extra=/);
  });

  test('URL の extra パラメータで最初から有効にできる', async ({ page }) => {
    await page.goto('/?extra=rinkai,toyosumi');
    await page.waitForSelector('svg.map .label');
    await expect(page.locator('.stats__headline')).toContainText('255 駅');
    await expect(page.getByRole('button', { name: /おまけモード/ })).toContainText('2');
  });

  test('外すと元の248駅に戻る', async ({ page }) => {
    await page.goto('/?extra=rinkai,toyosumi');
    await page.waitForSelector('svg.map .label');
    await expect(page.locator('.stats__headline')).toContainText('255 駅');

    await page.getByRole('button', { name: /おまけモード/ }).click();
    const boxes = page.locator('dialog.dialog input[type=checkbox]');
    await boxes.nth(0).uncheck();
    await boxes.nth(1).uncheck();
    await page.getByRole('button', { name: '閉じる' }).click();
    await page.waitForTimeout(1000);
    await expect(page.locator('.stats__headline')).toContainText('248 駅');
  });

  test('南北線品川支線は新駅がないので駅数は変わらないが品川が近くなる', async ({ page }) => {
    await page.goto('/?center=' + encodeURIComponent('品川') + '&scale=20');
    await page.waitForSelector('svg.map .label');
    await page.waitForTimeout(900);
    const center = await dotCenter(page, '品川');
    const before = await dotCenter(page, '六本木一丁目');
    const rBefore = Math.hypot(before.x - center.x, before.y - center.y);
    await expect(page.locator('.stats__headline')).toContainText('248 駅');

    await page.getByRole('button', { name: /おまけモード/ }).click();
    await page.locator('dialog.dialog input[type=checkbox]').nth(2).check();
    await page.getByRole('button', { name: '閉じる' }).click();
    await page.waitForTimeout(1000);

    // 21分 → 9分。scale=20 なので半径は 420px → 180px
    const after = await dotCenter(page, '六本木一丁目');
    const rAfter = Math.hypot(after.x - center.x, after.y - center.y);
    expect(rBefore).toBeGreaterThan(390);
    expect(rAfter).toBeLessThan(210);
    // 白金高輪と品川はどちらも既存駅なので対象駅数は増えない
    await expect(page.locator('.stats__headline')).toContainText('248 駅');
  });

  test('未開業駅を中心にしたままおまけを外しても壊れない', async ({ page }) => {
    await page.goto('/?extra=rinkai&center=' + encodeURIComponent('晴海'));
    await page.waitForSelector('svg.map .label');
    await expect(page.locator('.stats__headline')).toContainText('晴海');

    await page.getByRole('button', { name: /おまけモード/ }).click();
    await page.locator('dialog.dialog input[type=checkbox]').first().uncheck();
    await page.getByRole('button', { name: '閉じる' }).click();
    await page.waitForTimeout(1000);
    // 中心が消えるので東京へ退避する
    await expect(page.locator('.stats__headline')).toContainText('東京');
    await expect(page.locator('.stats__headline')).toContainText('248 駅');
  });
});

test('ホイールはカーソル位置を固定したまま拡大縮小する', async ({ page }) => {
  await page.goto('/?center=' + encodeURIComponent('東京') + '&scale=20');
  await page.waitForSelector('svg.map .label');
  await page.waitForTimeout(900);

  // 中心駅から離れた駅にカーソルを合わせる。ここが動かないことを確かめたい
  const before = await dotCenter(page, '新橋');
  await page.mouse.move(before.x, before.y);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(300);

  const after = await dotCenter(page, '新橋');
  expect(Math.abs(after.x - before.x), 'カーソル下の駅の x 移動量').toBeLessThan(3);
  expect(Math.abs(after.y - before.y), 'カーソル下の駅の y 移動量').toBeLessThan(3);

  // 縮小方向でも同じ
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(300);
  const zoomedOut = await dotCenter(page, '新橋');
  expect(Math.abs(zoomedOut.x - before.x)).toBeLessThan(3);
  expect(Math.abs(zoomedOut.y - before.y)).toBeLessThan(3);
});

test('拡大するとカーソル位置以外の駅は外側へ広がる', async ({ page }) => {
  await page.goto('/?center=' + encodeURIComponent('東京') + '&scale=20');
  await page.waitForSelector('svg.map .label');
  await page.waitForTimeout(900);

  const anchor = await dotCenter(page, '新橋');
  const centerBefore = await dotCenter(page, '東京');
  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(300);

  const centerAfter = await dotCenter(page, '東京');
  const dBefore = Math.hypot(centerBefore.x - anchor.x, centerBefore.y - anchor.y);
  const dAfter = Math.hypot(centerAfter.x - anchor.x, centerAfter.y - anchor.y);
  expect(dAfter).toBeGreaterThan(dBefore * 1.05);
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
