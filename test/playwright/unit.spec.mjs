import { test, expect } from "playwright/test";

test("CRText emits changes and reflects edits", async ({ page }) => {
  await page.goto("/test/playwright/index.html");

  const result = await page.evaluate(async () => {
    const { CRText } = await window.__dacumentReady;
    const text = new CRText();
    const changes = [];
    const stop = text.onChange((nodes) => changes.push(...nodes));

    text.insertAt(0, "H");
    text.insertAt(1, "i");
    text.deleteAt(1);
    stop();

    return {
      value: text.toString(),
      length: text.length,
      changeCount: changes.length,
    };
  });

  expect(result.value).toBe("H");
  expect(result.length).toBe(1);
  expect(result.changeCount).toBe(3);
});
