import { canvasToClient, createProjectWithImages, getDoc, test } from './fixtures';

// 目視確認用のスクリーンショット（SHOTS=1 のときのみ実行）
test.skip(!process.env.SHOTS, 'screenshots only');
test('screenshots', async ({ page, fixtures }) => {
  const out = process.env.SHOTS!;
  await page.goto('./');
  await page.screenshot({ path: out + '/1-home-empty.png' });
  await createProjectWithImages(page, [fixtures['red-landscape.jpg'], fixtures['blue-portrait.png'], fixtures['green-square.webp'], fixtures['exif-rotated.jpg']]);
  await page.screenshot({ path: out + '/3-editor.png' });
  const { doc } = await getDoc(page);
  const l = doc.imageLayers[1];
  const c = await canvasToClient(page, l.x, l.y);
  await page.touchscreen.tap(c.x, c.y);
  await page.waitForTimeout(300);
  await page.screenshot({ path: out + '/4-editor-selected.png' });
  await page.getByRole('button', { name: 'レイアウト' }).click();
  await page.getByRole('tab', { name: 'モザイク' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: out + '/5-mosaic.png' });
  await page.getByRole('button', { name: '背景', exact: true }).click();
  await page.screenshot({ path: out + '/6-background.png' });
  await page.getByRole('button', { name: 'プレビュー' }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: out + '/7-preview-lock.png' });
  await page.getByRole('tab', { name: 'ホーム画面' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: out + '/8-preview-home.png' });
  await page.getByRole('button', { name: '書き出し' }).click();
  await page.getByTestId('export-result').waitFor();
  await page.screenshot({ path: out + '/9-export.png' });
  await page.goto('./#/');
  await page.waitForTimeout(3500);
  await page.reload();
  await page.waitForTimeout(500);
  await page.screenshot({ path: out + '/2-home.png' });
});
