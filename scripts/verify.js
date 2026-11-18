"use strict";

/* End to end check for the FitGear backend rebuild. Run the server
   first (node server.js), then run: node scripts/verify.js
   It uses only the public API and pages, the same way a visitor and
   the owner would. It exits non-zero if any check fails. */

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";

let failures = 0;
let checks = 0;

function check(name, ok, detail) {
  checks++;
  if (ok) {
    console.log("PASS  " + name);
  } else {
    failures++;
    console.log("FAIL  " + name + (detail ? "  " + detail : ""));
  }
}

async function req(path, options) {
  const res = await fetch(BASE + path, options);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  return { status: res.status, text, json };
}

async function main() {
  const health = await req("/api/health");
  check("health endpoint", health.status === 200 && health.json && health.json.ok);

  for (const page of ["/", "/shop", "/about", "/contact", "/cart", "/checkout"]) {
    const r = await req(page);
    check("page loads " + page, r.status === 200 && r.text.indexOf('<div id="app">') !== -1 && r.text.indexOf('<script src="/app.js">') !== -1, "status " + r.status);
  }

  const products = await req("/api/products");
  check("products endpoint returns 12", products.status === 200 && Array.isArray(products.json) && products.json.length === 12, products.status + " count " + (products.json && products.json.length));
  const byId = {};
  if (Array.isArray(products.json)) {
    for (const p of products.json) byId[p.id] = p;
  }
  check("Volt Adjustable Dumbbell 24 kg PKR 58,500", byId["volt-adjustable-dumbbell-24kg"] && byId["volt-adjustable-dumbbell-24kg"].price === 58500);
  check("Stride Treadmill T900 PKR 189,000", byId["stride-treadmill-t900"] && byId["stride-treadmill-t900"].price === 189000);
  check("Forge Power Rack Pro PKR 145,000", byId["forge-power-rack-pro"] && byId["forge-power-rack-pro"].price === 145000);
  check("Hex Dumbbell Pair 10 kg PKR 18,500", byId["hex-dumbbell-pair-10kg"] && byId["hex-dumbbell-pair-10kg"].price === 18500);
  check("Air Rower Glide Pro PKR 98,500", byId["air-rower-glide-pro"] && byId["air-rower-glide-pro"].price === 98500);
  check("Cable Crossover Home Station PKR 165,000", byId["cable-crossover-home-station"] && byId["cable-crossover-home-station"].price === 165000);
  check("4 Strength, 4 Cardio, 4 Free Weights",
    Array.isArray(products.json) &&
    products.json.filter((p) => p.category === "Strength").length === 4 &&
    products.json.filter((p) => p.category === "Cardio").length === 4 &&
    products.json.filter((p) => p.category === "Free Weights").length === 4);
  check("every product has details and a single fixed configuration",
    Array.isArray(products.json) && products.json.every((p) => p.details && p.details.length > 0 && p.short_line && p.description));

  check("every product has its own photo from the fitgear-live export",
    Array.isArray(products.json) && products.json.every((p) => typeof p.img === "string" && p.img.indexOf("/images/") === 0 && p.img.length > 9));
  for (const p of products.json || []) {
    const im = await req(p.img);
    check("photo serves 200 " + p.id, im.status === 200, "status " + im.status);
  }
  check("hero photo serves 200", (await req("/images/hero.jpg")).status === 200);
  check("about photo serves 200", (await req("/images/about.jpg")).status === 200);

  const detail = await req("/api/products/forge-power-rack-pro");
  check("product detail endpoint", detail.status === 200 && detail.json && detail.json.name === "Forge Power Rack Pro");
  check("detail page route loads", (await req("/product/forge-power-rack-pro")).status === 200);

  const order = await req("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: "Verify Test",
      email: "verify@example.com",
      phone: "03001234567",
      address: "1 Test Street",
      city: "Karachi",
      notes: "verify run",
      paymentMethod: "Cash on Delivery",
      items: [
        { productId: "volt-adjustable-dumbbell-24kg", variant: "Standard", qty: 1 },
        { productId: "hex-dumbbell-pair-10kg", variant: "Standard", qty: 2 },
      ],
    }),
  });
  check("checkout saves an order", order.status === 201 && order.json && /^FG-\d+$/.test(order.json.orderNumber), order.status + " " + order.text.slice(0, 120));
  check("order total is 58500 + 2 x 18500 = 95500, free shipping", order.json && order.json.total === 95500 && order.json.shipping === 0, "got " + JSON.stringify(order.json));

  const badOrder = await req("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: "Verify Test",
      email: "verify@example.com",
      phone: "03001234567",
      address: "1 Test Street",
      city: "Karachi",
      total: 1,
      paymentMethod: "Cash on Delivery",
      items: [{ productId: "volt-adjustable-dumbbell-24kg", variant: "Standard", qty: 1 }],
    }),
  });
  check("order total is not trusted from the client (server prices only)", badOrder.status === 201 && badOrder.json && badOrder.json.total === 58500, "got " + (badOrder.json && badOrder.json.total));

  const badVariant = await req("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: "Verify Test",
      email: "verify@example.com",
      phone: "03001234567",
      address: "1 Test Street",
      city: "Karachi",
      paymentMethod: "Cash on Delivery",
      items: [{ productId: "volt-adjustable-dumbbell-24kg", variant: "Large", qty: 1 }],
    }),
  });
  check("invalid variant is rejected", badVariant.status === 400);

  const news = await req("/api/newsletter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "verify-" + Date.now() + "@example.com" }),
  });
  check("newsletter saves", news.status === 200 && news.json && news.json.subscribed);

  const contact = await req("/api/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Verify Test", subject: "Verify", message: "This is a verification message." }),
  });
  check("contact message saves", contact.status === 201 && contact.json && contact.json.saved);

  const status = await req("/api/admin/status");
  check("admin status endpoint", status.status === 200 && typeof status.json.hasAdmin === "boolean", JSON.stringify(status.json));

  const email = "admin-" + Date.now() + "@example.com";
  let token = null;
  if (status.json && !status.json.hasAdmin) {
    const setup = await req("/api/admin/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "verify-pass-123" }),
    });
    check("admin first use setup", setup.status === 201 && setup.json && setup.json.token, setup.status + " " + setup.text.slice(0, 120));
    token = setup.json && setup.json.token;
    const second = await req("/api/admin/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "other@example.com", password: "verify-pass-123" }),
    });
    check("second admin setup is refused", second.status === 409);
  } else {
    console.log("NOTE  admin already exists in this database, setup checks skipped");
  }

  const wrong = await req("/api/admin/signin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "wrong-password" }),
  });
  if (token) check("wrong admin password is rejected", wrong.status === 401);

  if (token) {
    const ok = await req("/api/admin/signin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "verify-pass-123" }),
    });
    check("correct admin password signs in", ok.status === 200 && ok.json && ok.json.token);
    token = ok.json.token;
  }

  const noAuth = await req("/api/admin/data");
  check("admin data without a token is refused", noAuth.status === 401);

  if (token) {
    const data = await req("/api/admin/data", {
      headers: { Authorization: "Bearer " + token },
    });
    check("admin data loads", data.status === 200 && data.json && data.json.stats, data.status);
    check("admin stats count the saved order, message and subscriber",
      data.json && data.json.stats.orders >= 1 && data.json.stats.messages >= 1 && data.json.stats.subscribers >= 1,
      JSON.stringify(data.json && data.json.stats));
    const firstOrder = data.json && data.json.orders && data.json.orders[0];
    if (firstOrder) {
      const patch = await req("/api/admin/orders/" + firstOrder.id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ status: "Confirmed" }),
      });
      check("order status change saves", patch.status === 200);
      const again = await req("/api/admin/data", {
        headers: { Authorization: "Bearer " + token },
      });
      const same = again.json.orders.find((o) => o.id === firstOrder.id);
      check("order status change persists", same && same.status === "Confirmed");
    }
    const firstMessage = data.json && data.json.messages && data.json.messages[0];
    if (firstMessage) {
      const patch = await req("/api/admin/messages/" + firstMessage.id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ status: "Read" }),
      });
      check("message status change saves", patch.status === 200);
    }
  }

  console.log("\n" + checks + " checks, " + failures + " failed.");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error("Verify run failed:", err.message);
  process.exit(1);
});
