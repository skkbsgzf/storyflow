import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { OAuthPastePanel } = await jiti.import("./OAuthPastePanel.tsx");
const modelsSource = await readFile(new URL("./ModelsConfig.tsx", import.meta.url), "utf8");

function render(props) {
  return renderToStaticMarkup(React.createElement(OAuthPastePanel, {
    message: "Paste the redirected address below.",
    placeholder: "http://localhost:1455/auth/callback?code=…",
    submitLabel: "Submit",
    onValueChange() {},
    onSubmit() {},
    ...props,
  }));
}

test("the paste box is always shown, with the submit button off until there is a value", () => {
  const empty = render({ value: "  " });
  assert.match(empty, /<p class="oauth-paste-message">Paste the redirected address below\.<\/p>/);
  assert.match(empty, /<input class="oauth-paste-input" placeholder="http:\/\/localhost:1455\/auth\/callback\?code=…" value="  "\/>/);
  assert.match(empty, /<button type="button" class="oauth-paste-submit" disabled="">Submit<\/button>/);
  assert.doesNotMatch(empty, /oauth-paste-hint/);

  const filled = render({ value: "http://localhost:1455/auth/callback?code=abc" });
  assert.match(filled, /<button type="button" class="oauth-paste-submit">Submit<\/button>/);
});

test("the hint line carries the caller's link to the sign-in page", () => {
  const html = render({
    value: "",
    hint: React.createElement("a", { href: "https://example.test/authorize" }, "open the login page"),
  });
  assert.match(html, /<p class="oauth-paste-hint"><a href="https:\/\/example\.test\/authorize">open the login page<\/a><\/p>/);
});

test("the Models subscription sign-in uses the shared paste panel", () => {
  const oauthDetail = modelsSource.slice(
    modelsSource.indexOf("function OAuthDetail"),
    modelsSource.indexOf("// ── API Key detail"),
  );
  assert.match(oauthDetail, /<OAuthPastePanel[\s\S]*?inputRef=\{inputRef\}[\s\S]*?onSubmit=\{\(\) => void submitCode\(loginState\.token, inputValue\)\}/);
  assert.doesNotMatch(oauthDetail, /<input\b/);
});
