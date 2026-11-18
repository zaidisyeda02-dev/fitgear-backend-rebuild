"use strict";

/* DOM execution check for the FitGear backend rebuild. Run the server
   first (node server.js), then run: node scripts/dom-check.js
   It loads the real public/app.js in jsdom against the running server
   and drives the real pages, the same way a visitor would. It needs
   jsdom installed locally (npm install jsdom --no-save). It exits
   non-zero if any check fails. */

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const { JSDOM } = require("jsdom");

let failures = 0;
let checks = 0;
const jsErrors = [];

function check(name, ok, detail) {
  checks++;
  if (ok) {
    console.log("PASS  " + name);
  } else {
    failures++;
    console.log("FAIL  " + name + (detail ? "  " + detail : ""));
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < (timeoutMs || 5000)) {
    try {
      const v = fn();
      if (v) return v;
    } catch (e) {}
    await sleep(100);
  }
  throw new Error("timed out waiting for " + label);
}

function makeDom(html, url) {
  return new JSDOM(html, {
    url: url || BASE + "/",
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (path, opts) => {
        const full = String(path).startsWith("http") ? String(path) : BASE + String(path);
        return global.fetch(full, opts);
      };
      window.addEventListener("error", (e) => jsErrors.push(String(e.message || e.error)));
    },
  });
}

function text(dom) {
  return dom.window.document.body ? dom.window.document.body.innerText || dom.window.document.body.textContent : "";
}

function click(dom, selector) {
  const el = dom.window.document.querySelector(selector);
  if (!el) throw new Error("missing element " + selector);
  el.click();
}

/* Strip external stylesheet and preconnect links before jsdom loads the
   page. The sandbox proxy hangs Google Fonts requests unpredictably,
   and jsdom holds script execution behind a pending stylesheet, which
   made this check flaky. The live site still loads Google Fonts in a
   real browser, with system font fallbacks. */
function stripExternal(html) {
  return String(html).replace(/<link[^>]+href="https?:[^>]*>/gi, "");
}

async function main() {
  const indexRes = await fetch(BASE + "/");
  const indexHtml = await indexRes.text();
  const dom = makeDom(stripExternal(indexHtml), BASE + "/");
  const doc = dom.window.document;

  await waitFor(() => {
    const t = text(dom);
    return t.indexOf("RISE AND GRIND") !== -1 || t.indexOf("RISE and GRIND") !== -1;
  }, 8000, "home page render");
  await sleep(300);

  check("intro overlay shows with Skip intro", !!doc.querySelector("#intro-skip"));
  const skip = doc.querySelector("#intro-skip");
  if (skip) skip.click();
  await sleep(900);
  check("intro closes on Skip intro", !doc.querySelector("#intro-overlay") || doc.querySelector("#intro-overlay").classList.contains("intro-leaving"));

  const homeText = text(dom);
  check("hero RISE AND GRIND, EQUIP YOUR DRIVE", homeText.indexOf("RISE AND GRIND") !== -1 && homeText.indexOf("EQUIP YOUR DRIVE") !== -1);
  const heroEl = doc.querySelector(".hero");
  check("home hero uses the hero photo", !!heroEl && (heroEl.getAttribute("style") || "").indexOf("/images/hero.jpg") !== -1);
  check("home shows Featured Equipment", homeText.indexOf("Featured Equipment") !== -1);
  check("home featured cards present", doc.querySelectorAll(".grid-featured .card").length === 4, "found " + doc.querySelectorAll(".grid-featured .card").length);

  click(dom, '[data-nav="shop"]');
  await waitFor(() => text(dom).indexOf("Showing 12 of 12 products") !== -1, 5000, "shop 12 of 12");
  check("Shop 12 of 12", text(dom).indexOf("Showing 12 of 12 products") !== -1);
  check("shop grid has 12 cards", doc.querySelectorAll(".grid-shop .card").length === 12, "found " + doc.querySelectorAll(".grid-shop .card").length);
  check("shop cards show 12 product photos", doc.querySelectorAll(".grid-shop .photo-img").length === 12, "found " + doc.querySelectorAll(".grid-shop .photo-img").length);

  const chip = (name) => doc.querySelector('[data-category="' + name + '"]');
  chip("Strength").click();
  await waitFor(() => text(dom).indexOf("Showing 4 of 12 products") !== -1, 5000, "Strength 4");
  check("Strength filter 4 of 12", text(dom).indexOf("Showing 4 of 12 products") !== -1);
  chip("Cardio").click();
  await waitFor(() => text(dom).indexOf("Showing 4 of 12 products") !== -1, 5000, "Cardio 4");
  check("Cardio filter 4 of 12", text(dom).indexOf("Showing 4 of 12 products") !== -1);
  chip("Free Weights").click();
  await waitFor(() => text(dom).indexOf("Showing 4 of 12 products") !== -1, 5000, "Free Weights 4");
  check("Free Weights filter 4 of 12", text(dom).indexOf("Showing 4 of 12 products") !== -1);

  chip("Cardio").click();
  await sleep(200);
  let shopSearch = doc.querySelector("#shop-search");
  shopSearch.value = "Power rack";
  shopSearch.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await waitFor(() => text(dom).indexOf("Showing 1 of 12 products") !== -1, 5000, "search resets category, Power rack 1");
  check("new search resets category, Power rack 1 of 12", text(dom).indexOf("Showing 1 of 12 products") !== -1 && text(dom).indexOf("Forge Power Rack Pro") !== -1);

  shopSearch = doc.querySelector("#shop-search");
  shopSearch.value = "dumbbells";
  shopSearch.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await waitFor(() => text(dom).indexOf("Showing 2 of 12 products") !== -1, 5000, "dumbbells 2");
  check("search dumbbells 2 of 12", text(dom).indexOf("Showing 2 of 12 products") !== -1);

  /* The Show All button only exists in the empty state, so reach it
     through a search with no match, then it must return all 12. */
  shopSearch = doc.querySelector("#shop-search");
  shopSearch.value = "zzzznope";
  shopSearch.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await waitFor(() => text(dom).indexOf("Nothing matches that search") !== -1, 5000, "empty state");
  check("empty state shows for no match", text(dom).indexOf("Nothing matches that search") !== -1);
  const showAll = doc.querySelector("#show-all-empty");
  if (showAll) showAll.click();
  await waitFor(() => text(dom).indexOf("Showing 12 of 12 products") !== -1, 5000, "show all 12");
  check("empty state Show All returns 12 of 12", text(dom).indexOf("Showing 12 of 12 products") !== -1);
  const sortSel = doc.querySelector("#sort-select");
  sortSel.value = "price-asc";
  sortSel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await sleep(300);
  const firstLow = doc.querySelector(".grid-shop .card-name");
  check("sort price low to high starts Hex Dumbbell Pair 10 kg", firstLow && firstLow.textContent.indexOf("Hex Dumbbell Pair 10 kg") !== -1, firstLow && firstLow.textContent);
  sortSel.value = "price-desc";
  sortSel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await sleep(300);
  const firstHigh = doc.querySelector(".grid-shop .card-name");
  check("sort price high to low starts Stride Treadmill T900", firstHigh && firstHigh.textContent.indexOf("Stride Treadmill T900") !== -1, firstHigh && firstHigh.textContent);

  const forgeBtn = doc.querySelector('[data-nav-product="forge-power-rack-pro"]');
  forgeBtn.click();
  await waitFor(() => text(dom).indexOf("Forge Power Rack Pro") !== -1 && text(dom).indexOf("Specifications") !== -1, 5000, "Forge detail");
  check("Forge Power Rack Pro detail PKR 145,000 with Specifications", text(dom).indexOf("PKR 145,000") !== -1 && text(dom).indexOf("Specifications") !== -1);
  check("detail page has its own photo panel", !!doc.querySelector(".photo-panel") && text(dom).indexOf("Forge Power Rack Pro") !== -1);
  const forgeImg = doc.querySelector(".photo-panel .photo-img");
  check("detail page shows the Forge photo", !!forgeImg && forgeImg.getAttribute("src") === "/images/forge-power-rack-pro.jpg", forgeImg && forgeImg.getAttribute("src"));

  /* Volt is Free Weights, not a Strength related product of Forge, so it
     is not on the Forge detail page. Go back to Shop and open it there. */
  click(dom, '[data-nav="shop"]');
  await waitFor(() => text(dom).indexOf("Showing 12 of 12 products") !== -1, 5000, "back to shop");
  const voltBtn = doc.querySelector('[data-nav-product="volt-adjustable-dumbbell-24kg"]');
  if (voltBtn) voltBtn.click();
  await waitFor(() => text(dom).indexOf("Volt Adjustable Dumbbell 24 kg") !== -1 && !!doc.querySelector("#add-to-cart"), 5000, "Volt detail");
  check("Volt detail PKR 58,500, Add to Cart and Buy Now", text(dom).indexOf("PKR 58,500") !== -1 && !!doc.querySelector("#add-to-cart") && !!doc.querySelector("#buy-now"));

  doc.querySelector("#add-to-cart").click();
  await sleep(400);
  /* The bag count is a visible badge; "Your bag, 1 items" is only the
     button aria-label, so check the badge, not the page text. */
  check("Add to Bag shows toast and bag count 1", text(dom).indexOf("added to your bag") !== -1 && !!doc.querySelector(".bag-count") && doc.querySelector(".bag-count").textContent === "1");

  click(dom, '[data-nav="cart"]');
  await waitFor(() => text(dom).indexOf("Your Cart") !== -1, 5000, "cart page");
  check("cart subtotal PKR 58,500, free shipping, total PKR 58,500", text(dom).indexOf("PKR 58,500") !== -1 && text(dom).indexOf("Free") !== -1);

  click(dom, '[data-nav="checkout"]');
  await waitFor(() => !!doc.querySelector("#checkout-form"), 5000, "checkout form");
  doc.querySelector("#co-name").value = "Verify Test";
  doc.querySelector("#co-email").value = "verify@example.com";
  doc.querySelector("#co-phone").value = "03001234567";
  doc.querySelector("#co-address").value = "1 Test Street";
  doc.querySelector("#co-city").value = "Karachi";
  doc.querySelector("#checkout-form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await waitFor(() => text(dom).indexOf("Thank you for your order") !== -1, 8000, "order confirmation");
  check("checkout confirmation shows an FG order number", /FG-\d+/.test(text(dom)), text(dom).slice(0, 200));

  click(dom, '[data-nav="about"]');
  await waitFor(() => text(dom).indexOf("WE FORGE THE BEST") !== -1, 5000, "about page");
  check("About page WE FORGE THE BEST", text(dom).indexOf("WE FORGE THE BEST") !== -1);

  click(dom, '[data-nav="contact"]');
  await waitFor(() => text(dom).indexOf("Contact Us") !== -1, 5000, "contact page");
  check("Contact page shows placeholder details", text(dom).indexOf("to be added soon (placeholder)") !== -1);

  doc.querySelector("#ct-name").value = "Verify Test";
  doc.querySelector("#ct-subject").value = "Verify";
  doc.querySelector("#ct-message").value = "This is a verification message.";
  doc.querySelector("#contact-form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await waitFor(() => text(dom).indexOf("Message sent") !== -1, 8000, "contact sent");
  check("contact form sends a message", text(dom).indexOf("Message sent") !== -1);

  doc.querySelector("#newsletter-email").value = "dom-" + Date.now() + "@example.com";
  doc.querySelector("#newsletter-form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await waitFor(() => text(dom).indexOf("you are on the list") !== -1, 8000, "newsletter");
  check("newsletter subscribe confirms", text(dom).indexOf("you are on the list") !== -1);

  const adminRes = await fetch(BASE + "/admin.html");
  const adminHtml = await adminRes.text();
  const adminDom = makeDom(stripExternal(adminHtml), BASE + "/admin.html");
  const adminDoc = adminDom.window.document;
  /* Wait for the email field itself: "Admin Panel" is static heading text
     in admin.html, so it is present before admin.js renders the form. */
  await waitFor(() => adminDoc.querySelector("#admin-email"), 8000, "admin setup form");
  const adminEmail = adminDom.window.document.querySelector("#admin-email");
  check("Admin Panel first use setup form present", !!adminEmail);
  if (adminEmail) {
    adminEmail.value = "dom-admin-" + Date.now() + "@example.com";
    adminDom.window.document.querySelector("#admin-password").value = "verify-pass-123";
    adminDom.window.document.querySelector("#admin-auth-form").dispatchEvent(new adminDom.window.Event("submit", { bubbles: true, cancelable: true }));
    await waitFor(() => adminDom.window.document.body.textContent.indexOf("Orders") !== -1 && adminDom.window.document.body.textContent.indexOf("Revenue") !== -1, 8000, "admin dashboard");
    check("Admin Panel sign in shows dashboard with stats", adminDom.window.document.body.textContent.indexOf("Revenue") !== -1);
  }

  check("no JS errors during the DOM run", jsErrors.length === 0, jsErrors.slice(0, 3).join(" | "));

  console.log("\n" + checks + " checks, " + failures + " failed.");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error("DOM check failed:", err.message);
  process.exit(1);
});
