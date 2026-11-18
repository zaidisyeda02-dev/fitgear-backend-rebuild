"use strict";

/* Real rendered browser check for the FitGear backend rebuild.
   Run the server first (node server.js), then start Chrome for Testing
   with remote debugging and run: node scripts/browser-check.js
   It needs no extra npm package: it drives Chrome over CDP with the
   built in WebSocket client. It visits every page at 390px and 1280px,
   measures horizontal overflow, collects console errors and failed
   requests, and saves a screenshot per page. It exits non-zero if any
   page overflows or has a console error that is not the expected
   sandbox block of Google Fonts. Screenshots and results.json go to
   browser-check-2026-11-18/ in the project root. */

const fs = require("fs");
const path = require("path");

const BASE = process.env.BASE_URL || "http://127.0.0.1:3005";
const CDP_PORT = Number(process.env.CDP_PORT || "9222");
const OUT = path.join(__dirname, "..", "browser-check-2026-11-18");

const PAGES = [
  { name: "home", url: "/" },
  { name: "shop", url: "/shop" },
  { name: "product-forge", url: "/product/forge-power-rack-pro" },
  { name: "cart", url: "/cart" },
  { name: "checkout", url: "/checkout" },
  { name: "about", url: "/about" },
  { name: "contact", url: "/contact" },
  { name: "admin", url: "/admin.html" },
];

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let msgId = 0;
const pending = new Map();
let ws = null;
let loadFired = false;
let pageErrors = [];
let failedReqs = [];
const requestUrls = new Map();

function isFontBlock(url) {
  return String(url || "").indexOf("fonts.g") !== -1;
}

function send(method, params, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id: id, method: method, params: params || {}, sessionId: sessionId }));
  });
}

function onMessage(data) {
  let msg;
  try {
    msg = JSON.parse(String(data));
  } catch (e) {
    return;
  }
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
    else p.resolve(msg.result || {});
    return;
  }
  if (!msg.method) return;
  if (msg.method === "Page.loadEventFired") loadFired = true;
  if (msg.method === "Runtime.exceptionThrown") {
    const d = (msg.params.exceptionDetails || {}).exception || {};
    pageErrors.push("exception: " + String(d.description || d.text || "unknown"));
  }
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
    pageErrors.push("console.error: " + msg.params.args.map(function (a) { return String(a.value !== undefined ? a.value : (a.description || "")); }).join(" "));
  }
  if (msg.method === "Log.entryAdded") {
    const e = msg.params.entry || {};
    if (e.level === "error") pageErrors.push("log: " + String(e.text || "") + " " + String((e.url || "")));
  }
  if (msg.method === "Network.requestWillBeSent") {
    requestUrls.set(msg.params.requestId, ((msg.params.request || {}).url || ""));
  }
  if (msg.method === "Network.loadingFailed") {
    const p = msg.params || {};
    const u = requestUrls.get(p.requestId) || "";
    failedReqs.push((u ? u + " :: " : "") + String(p.errorText || "failed"));
  }
  if (msg.method === "Network.responseReceived") {
    const r = (msg.params.response || {});
    if (r.status >= 400) failedReqs.push(r.url + " :: HTTP " + r.status);
  }
}

async function evalJs(sessionId, expression) {
  const res = await send("Runtime.evaluate", { expression: expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (res.exceptionDetails) throw new Error("evaluate failed: " + JSON.stringify(res.exceptionDetails));
  return res.result ? res.result.value : undefined;
}

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (await fn()) return true;
    } catch (e) {}
    await sleep(250);
  }
  throw new Error("timed out waiting for " + label);
}

async function checkPage(browserWsUrl, page, viewport) {
  const target = await send("Target.createTarget", { url: "about:blank" });
  const targetId = target.targetId;
  const attached = await send("Target.attachToTarget", { targetId: targetId, flatten: true });
  const sessionId = attached.sessionId;
  const result = {
    viewport: String(viewport.width),
    page: page.name,
    url: page.url,
    scrollWidth: null,
    innerWidth: viewport.width,
    overflow: false,
    overflowingElements: [],
    consoleErrors: [],
    failedRequests: [],
  };
  try {
    loadFired = false;
    pageErrors = [];
    failedReqs = [];
    requestUrls.clear();
    await send("Page.enable", {}, sessionId);
    await send("Runtime.enable", {}, sessionId);
    await send("Log.enable", {}, sessionId);
    await send("Network.enable", {}, sessionId);
    await send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.width < 500,
    }, sessionId);
    await send("Page.navigate", { url: BASE + page.url }, sessionId);
    await waitFor(function () { return loadFired; }, 20000, "page load " + page.url);
    /* The intro overlay closes by itself; wait until it is gone so the
       screenshot and the overflow reading show the real page. */
    await waitFor(async function () {
      return await evalJs(sessionId, "!document.querySelector('#intro-overlay')");
    }, 10000, "intro close " + page.url);
    await sleep(500);
    const measure = await evalJs(sessionId,
      "({ docSW: document.documentElement.scrollWidth, iw: window.innerWidth, " +
      "wide: Array.from(document.querySelectorAll('body *')).filter(function (el) { " +
      "var r = el.getBoundingClientRect(); return r.right > " + viewport.width + " + 1 || r.left < -1; }).slice(0, 5).map(function (el) { " +
      "var r = el.getBoundingClientRect(); return el.tagName + '.' + String(el.className && el.className.baseVal === undefined ? el.className : '').split(' ')[0] + ' left=' + Math.round(r.left) + ' right=' + Math.round(r.right); }) })");
    result.scrollWidth = measure.docSW;
    result.innerWidth = measure.iw;
    result.overflowingElements = measure.wide;
    /* Compare against the emulated viewport width, not innerWidth: on
       phones Chrome expands the layout viewport to fit wide content,
       so innerWidth grows with the overflow and hides it. */
    result.overflow = measure.docSW > viewport.width + 1;
    /* Scroll to the bottom and back, then measure again. */
    await evalJs(sessionId, "window.scrollTo(0, document.body.scrollHeight); true");
    await sleep(500);
    const afterScroll = await evalJs(sessionId, "({ docSW: document.documentElement.scrollWidth, iw: window.innerWidth })");
    if (afterScroll.docSW > viewport.width + 1) result.overflow = true;
    result.scrollWidth = Math.max(result.scrollWidth, afterScroll.docSW);
    await evalJs(sessionId, "window.scrollTo(0, 0); true");
    await sleep(300);
    const shot = await send("Page.captureScreenshot", { format: "png" }, sessionId);
    if (shot.data) {
      fs.writeFileSync(path.join(OUT, viewport.width + "-" + page.name + ".png"), Buffer.from(shot.data, "base64"));
    }
    result.consoleErrors = pageErrors.slice();
    result.failedRequests = failedReqs.slice();
  } finally {
    try { await send("Target.closeTarget", { targetId: targetId }); } catch (e) {}
  }
  return result;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const versionRes = await fetch("http://127.0.0.1:" + CDP_PORT + "/json/version");
  if (!versionRes.ok) throw new Error("Chrome DevTools port " + CDP_PORT + " is not reachable. Start Chrome with --remote-debugging-port=" + CDP_PORT + " first.");
  const version = await versionRes.json();
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = function (e) { reject(new Error("WebSocket to Chrome failed")); };
  });
  ws.onmessage = function (event) { onMessage(event.data); };
  const results = [];
  let failures = 0;
  for (const viewport of VIEWPORTS) {
    for (const page of PAGES) {
      try {
        const r = await checkPage(version.webSocketDebuggerUrl, page, viewport);
        results.push(r);
        const realErrors = r.consoleErrors.filter(function (e) { return !isFontBlock(e); });
        const realFailed = r.failedRequests.filter(function (u) { return !isFontBlock(u); });
        const status = (r.overflow || realErrors.length > 0 || realFailed.length > 0) ? "FAIL" : "PASS";
        if (status === "FAIL") failures++;
        console.log(status + "  " + viewport.width + "px " + page.name + " scrollWidth=" + r.scrollWidth + " innerWidth=" + r.innerWidth +
          " overflow=" + r.overflow + " consoleErrors=" + realErrors.length + " failedReqs(non-font)=" + realFailed.length +
          (r.overflowingElements.length ? " wide: " + r.overflowingElements.join(" | ") : ""));
        if (realErrors.length) console.log("      errors: " + realErrors.slice(0, 3).join(" ; "));
        if (realFailed.length) console.log("      failed: " + realFailed.slice(0, 3).join(" ; "));
      } catch (e) {
        failures++;
        console.log("FAIL  " + viewport.width + "px " + page.name + "  " + e.message);
        results.push({ viewport: String(viewport.width), page: page.name, url: page.url, error: e.message });
      }
    }
  }
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  console.log("\n" + results.length + " page checks, " + failures + " failed. Screenshots and results.json in " + OUT);
  ws.close();
  process.exit(failures ? 1 : 0);
}

main().catch(function (e) { console.log("Browser check failed: " + e.message); process.exit(1); });
