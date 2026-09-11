import { expect, test } from "../fixtures/extension";

/**
 * Full end-to-end proof of the architecture:
 *
 *  1. Open the demo desktop website.
 *  2. Click "Verify using phone".
 *  3. The Chrome extension's content script relays the request to the
 *     background worker, which creates a real session against the real API.
 *  4. The extension popup shows the QR/mobile link for that session.
 *  5. Open the mobile link (as the phone would).
 *  6. Grant camera access (a fake device - see fixtures/extension.ts).
 *  7. Trigger the demo provider's "Complete demo verification".
 *  8. The backend marks the session VERIFIED and pushes it over the
 *     WebSocket to the extension.
 *  9. The extension's content script notifies the demo page.
 * 10. The demo page shows "Identity verified" with no reload, and the
 *     popup reflects VERIFIED too.
 */
test("desktop -> extension -> phone -> backend -> extension -> desktop", async ({
  context,
  extensionId,
}) => {
  const demoPage = await context.newPage();
  await demoPage.goto("http://localhost:5175");

  await expect(demoPage.getByRole("heading", { name: "Identity Verification" })).toBeVisible();
  await demoPage.getByRole("button", { name: "Verify using phone" }).click();

  // Confirms the extension is installed, received the request, and the
  // background successfully created a session against the real API -
  // otherwise the demo site's own extension-detection timeout would fire.
  await expect(demoPage.getByText(/waiting for phone verification/i)).toBeVisible({
    timeout: 10_000,
  });

  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popupPage.getByText("Waiting for phone")).toBeVisible();

  const shortLink = await popupPage.locator("code").first().innerText();
  const mobileUrl = `http://${shortLink}`;

  const mobilePage = await context.newPage();
  await mobilePage.goto(mobileUrl);

  await expect(mobilePage.getByRole("heading", { name: "Verify your identity" })).toBeVisible();
  await mobilePage.getByRole("button", { name: "Continue" }).click();

  await mobilePage.getByRole("button", { name: "Allow Camera" }).click();
  await expect(mobilePage.getByText("Keep your face clearly visible")).toBeVisible();

  // Granting camera access is purely local - the server (and therefore the
  // popup) only advances once "Continue" here calls startMobileVerification,
  // which moves MOBILE_OPENED -> CAMERA_GRANTED -> VERIFYING in one request.
  await mobilePage.getByRole("button", { name: "Continue" }).click();
  await expect(mobilePage.getByRole("button", { name: /complete demo verification/i })).toBeVisible({
    timeout: 10_000,
  });
  await popupPage.bringToFront();
  await expect(popupPage.getByText("Verifying…")).toBeVisible({ timeout: 10_000 });

  await mobilePage.getByRole("button", { name: /complete demo verification/i }).click();
  await expect(mobilePage.getByText(/verification complete/i)).toBeVisible({ timeout: 10_000 });

  // The demo page updates live - no page.reload() anywhere in this test.
  await demoPage.bringToFront();
  await expect(demoPage.getByText(/identity verified/i)).toBeVisible({ timeout: 10_000 });

  await popupPage.bringToFront();
  await expect(popupPage.getByText(/verification complete/i)).toBeVisible({ timeout: 10_000 });
});
