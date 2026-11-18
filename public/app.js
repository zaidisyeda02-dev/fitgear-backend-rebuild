"use strict";

/* FitGear shop frontend, Design 08 Matte Black and Volt. Products load
   from GET /api/products. Orders, newsletter and contact messages save
   to the server. Canonical FitGear products have no size or variant
   options, so every product is one fixed configuration at one fixed
   PKR price, with a quantity stepper from 1 to 50. Product photos:
   the 12 product photos plus hero and about photos are files in
   public/images/, taken from the fitgear-live static export of the
   canonical build. No stock photo was hotlinked as a product photo. */

var PRODUCTS = [];
var PRODUCTS_LOADED = false;
var PRODUCTS_ERROR = false;
var CATEGORIES = ["Strength", "Cardio", "Free Weights"];

function byId(id) { for (var i = 0; i < PRODUCTS.length; i++) { if (PRODUCTS[i].id === id) return PRODUCTS[i]; } return null; }
function formatPrice(v) { return "PKR " + Number(v).toLocaleString("en-PK"); }
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function storageGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
function storageSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }

/* State, kept in memory for this visit only. */
var cart = [];
var lastOrder = null;
var shopState = { category: "All", search: "", sort: "featured", showAllMatches: false };
var productState = { qty: 1 };
var menuOpen = false;
var searchOpen = false;
var headerQuery = "";
var subscribed = false;
var contactSent = false;
var contactName = "";
var introDone = false;

/* Shipping, same rule as the server: free at PKR 50,000 or more,
   otherwise PKR 1,500. */
function shippingFor(subtotal) { return subtotal >= 50000 ? 0 : 1500; }

/* Routing with pushState, real paths. */
function parseRoute(pathname) {
  var clean = pathname.replace(/\/+$/, "") || "/";
  if (clean === "/shop") return { page: "shop" };
  if (clean.indexOf("/product/") === 0) return { page: "product", id: decodeURIComponent(clean.slice(9)) };
  if (clean === "/cart") return { page: "cart" };
  if (clean === "/checkout") return { page: "checkout" };
  if (clean === "/confirmation") return { page: "confirmation" };
  if (clean === "/about") return { page: "about" };
  if (clean === "/contact") return { page: "contact" };
  return { page: "home" };
}
function routePath(r) {
  if (r.page === "shop") return "/shop";
  if (r.page === "product") return "/product/" + r.id;
  if (r.page === "cart") return "/cart";
  if (r.page === "checkout") return "/checkout";
  if (r.page === "confirmation") return "/confirmation";
  if (r.page === "about") return "/about";
  if (r.page === "contact") return "/contact";
  return "/";
}
var route = parseRoute(window.location.pathname);
function navigate(r, search) {
  var url = routePath(r) + (search || "");
  if (window.location.pathname + window.location.search !== url) {
    window.history.pushState({}, "", url);
  }
  if (r.page === "shop") {
    var params = new URLSearchParams(search || window.location.search);
    var cat = params.get("category") || "All";
    var q = params.get("search") || "";
    shopState = { category: cat, search: q, sort: shopState.sort, showAllMatches: false };
  }
  if (r.page === "product") productState = { qty: 1 };
  menuOpen = false;
  searchOpen = false;
  route = r;
  render();
  window.scrollTo({ top: 0 });
}
window.addEventListener("popstate", function () {
  route = parseRoute(window.location.pathname);
  if (route.page === "shop") {
    var params = new URLSearchParams(window.location.search);
    shopState = { category: params.get("category") || "All", search: params.get("search") || "", sort: shopState.sort, showAllMatches: false };
  }
  if (route.page === "product") productState = { qty: 1 };
  menuOpen = false;
  searchOpen = false;
  render();
  window.scrollTo({ top: 0 });
});

/* Logo: a volt lightning bolt in a thin volt outline, drawn for FitGear. */
function logoMark(size) {
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 48 48" role="img" aria-label="FitGear logo" style="flex-shrink:0">' +
    '<rect x="4" y="4" width="40" height="40" fill="none" stroke="#c8f31d" stroke-width="2"/>' +
    '<path d="M27 8 L13 27 L22 27 L20 40 L35 20 L25 20 Z" fill="#c8f31d"/></svg>';
}

function cartCount() { var n = 0; for (var i = 0; i < cart.length; i++) n += cart[i].qty; return n; }
function cartLines() {
  var out = [];
  for (var i = 0; i < cart.length; i++) {
    var p = byId(cart[i].productId);
    if (p) out.push({ productId: cart[i].productId, qty: cart[i].qty, product: p });
  }
  return out;
}
function cartSubtotal() { var t = 0; cartLines().forEach(function (l) { t += l.product.price * l.qty; }); return t; }
function addToCart(product, qty) {
  var found = false;
  for (var i = 0; i < cart.length; i++) {
    if (cart[i].productId === product.id) { cart[i].qty = Math.min(50, cart[i].qty + qty); found = true; }
  }
  if (!found) cart.push({ productId: product.id, qty: qty });
  renderHeader();
  showToast(product.name + " added to your bag.");
}
function setLineQty(productId, qty) {
  if (qty <= 0) { removeLine(productId); return; }
  for (var i = 0; i < cart.length; i++) { if (cart[i].productId === productId) cart[i].qty = Math.min(50, qty); }
  render();
}
function removeLine(productId) {
  cart = cart.filter(function (i) { return i.productId !== productId; });
  render();
}

var toastTimer = null;
function showToast(text) {
  var root = document.getElementById("toast-root");
  root.innerHTML = '<div class="toast toast-in" role="status">' + esc(text) +
    '<button type="button" id="toast-bag">View Bag</button></div>';
  document.getElementById("toast-bag").addEventListener("click", function () {
    root.innerHTML = "";
    navigate({ page: "cart" });
  });
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(function () { root.innerHTML = ""; }, 2600);
}

/* Search: match name, category, short line, description and specs,
   word by word, with plural words folded to singular. A new search
   resets the category filter to All, so a result is never hidden
   behind a category. */
function foldWord(w) {
  w = String(w).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (w.length > 3 && w.slice(-1) === "s") w = w.slice(0, -1);
  return w;
}
function searchText(p) {
  return [p.name, p.category, p.short_line, p.description].concat(p.details || []).join(" ").toLowerCase();
}
function matchesSearch(p, query) {
  var words = String(query).split(/\s+/).map(foldWord).filter(function (w) { return w.length > 0; });
  if (words.length === 0) return true;
  var hay = searchText(p);
  var foldedHay = hay.split(/[^a-z0-9]+/).map(foldWord).join(" ");
  for (var i = 0; i < words.length; i++) {
    if (foldedHay.indexOf(words[i]) === -1) return false;
  }
  return true;
}
function searchResults(query) {
  return PRODUCTS.filter(function (p) { return matchesSearch(p, query); });
}

/* Product photo. Each product shows its own photo from public/images/,
   taken from the fitgear-live static export. If a photo fails to load,
   the dark panel with the product initial and name shows instead. */
function photoPanel(p, big) {
  var initial = esc(p.name.charAt(0));
  var size = big ? "64px" : "44px";
  var fallback = '<span class="photo-fallback"><span class="photo-mark" style="font-size:' + size + '">' + initial + '</span>' +
    '<span class="photo-name">' + esc(p.name) + '</span></span>';
  if (!p.img) {
    return '<div class="photo-panel" role="img" aria-label="' + esc(p.name) + '">' +
      fallback.replace('class="photo-fallback"', 'class="photo-fallback" style="display:flex"') + '</div>';
  }
  return '<div class="photo-panel" role="img" aria-label="' + esc(p.name) + '">' +
    '<img class="photo-img" src="' + esc(p.img) + '" alt="' + esc(p.name) + '" loading="lazy" onerror="this.style.display=\'none\';var f=this.parentNode.querySelector(\'.photo-fallback\');if(f){f.style.display=\'flex\';}" />' +
    fallback + '</div>';
}

function productCard(p) {
  var tag = p.tag ? '<span class="card-tag">' + esc(p.tag) + '</span>' : "";
  return '<article class="card">' +
    '<button type="button" class="card-photo-btn" data-nav-product="' + p.id + '" aria-label="View details of ' + esc(p.name) + '">' +
      photoPanel(p, false) +
    '</button>' +
    '<div class="card-body">' +
      '<h3 class="card-name">' + esc(p.name) + '</h3>' +
      '<p class="card-cat">' + esc(p.category) + '</p>' +
      '<p class="card-price">' + formatPrice(p.price) + '</p>' +
      tag +
      '<div class="card-actions">' +
        '<button type="button" class="btn-card-outline" data-nav-product="' + p.id + '">View Details</button>' +
        '<button type="button" class="btn-card-solid" data-quick-add="' + p.id + '" aria-label="Add ' + esc(p.name) + ' to bag">Add to Bag</button>' +
      '</div>' +
    '</div></article>';
}

/* Pages */
function homePage() {
  var featured = PRODUCTS.filter(function (p) { return p.featured; }).map(productCard).join("");
  var cats = [
    { name: "Strength", blurb: "Power racks, barbells, benches and cable stations for serious strength training." },
    { name: "Cardio", blurb: "Treadmills, rowers, spin bikes and ellipticals to keep your heart working." },
    { name: "Free Weights", blurb: "Dumbbells, kettlebells and plates, the free weights every home gym needs." }
  ];
  var catCards = cats.map(function (c) {
    return '<article class="card"><div style="padding:1.25rem">' +
      '<h3 class="font-display" style="font-size:24px;font-weight:600;margin:0;text-transform:uppercase">' + c.name + '</h3>' +
      '<p style="margin:0.5rem 0 0;font-size:14px;line-height:1.6;color:var(--dim)">' + c.blurb + '</p>' +
      '<button type="button" class="btn-card-solid" style="margin-top:0.75rem;padding:0.5rem 1.25rem;flex:none" data-nav-shop-cat="' + c.name + '">Shop ' + c.name + '</button>' +
      '</div></article>';
  }).join("");
  return '<main>' +
    '<section class="container" style="padding-top:1.5rem">' +
      '<div class="hero" style="background-image:linear-gradient(rgba(10,10,10,0.85),rgba(10,10,10,0.85)),url(/images/hero.jpg);background-size:cover;background-position:center">' +
        '<p style="margin:0;font-size:13px;letter-spacing:0.3em;text-transform:uppercase;color:var(--volt)">FitGear</p>' +
        '<h1 class="font-display">RISE AND GRIND<br /><span>EQUIP YOUR DRIVE</span></h1>' +
        '<p>Gym and fitness equipment for training at home and in the gym. Strength, cardio and free weights, built to work hard.</p>' +
        '<button type="button" class="btn-primary" style="margin-top:1.5rem" data-nav="shop">Shop Now</button>' +
      '</div>' +
    '</section>' +
    '<section class="container" style="padding-top:3rem">' +
      '<div style="text-align:center"><h2 class="font-display" style="font-size:30px;font-weight:600;letter-spacing:0.08em;margin:0;text-transform:uppercase">Featured Equipment</h2><div class="volt-rule"></div></div>' +
      '<div class="grid-featured">' + featured + '</div>' +
      '<div style="margin-top:1.75rem;text-align:center"><button type="button" class="btn-outline" data-nav="shop">View All Products</button></div>' +
    '</section>' +
    '<section class="container" style="padding-top:3.5rem">' +
      '<div style="text-align:center"><h2 class="font-display" style="font-size:30px;font-weight:600;letter-spacing:0.08em;margin:0;text-transform:uppercase">Shop by Category</h2><div class="volt-rule"></div></div>' +
      '<div class="grid-cats">' + catCards + '</div>' +
    '</section></main>';
}

function shopPage() {
  var q = shopState.search;
  var filtered = PRODUCTS.filter(function (p) {
    var inCat = shopState.showAllMatches ? true : (shopState.category === "All" || p.category === shopState.category);
    return inCat && matchesSearch(p, q);
  });
  var sorted = filtered.slice();
  if (shopState.sort === "price-asc") sorted.sort(function (a, b) { return a.price - b.price; });
  else if (shopState.sort === "price-desc") sorted.sort(function (a, b) { return b.price - a.price; });
  else if (shopState.sort === "name") sorted.sort(function (a, b) { return a.name.localeCompare(b.name); });
  var status = "Showing " + sorted.length + " of " + PRODUCTS.length + " products" + (q ? " for " + q : "");
  var chips = ["All"].concat(CATEGORIES).map(function (c) {
    return '<button type="button" class="radio-chip' + (shopState.category === c && !shopState.showAllMatches ? " active" : "") + '" data-category="' + c + '" aria-pressed="' + (shopState.category === c) + '">' + c + '</button>';
  }).join("");
  var body;
  if (sorted.length === 0) {
    body = '<div class="panel" style="padding:3rem 1.5rem;text-align:center">' +
      '<p class="font-display" style="font-size:24px;font-weight:600;margin:0">Nothing matches that search</p>' +
      '<p style="margin:0.5rem 0 0;font-size:14px;color:var(--dim)">Try a different word, or show matches in all categories.</p>' +
      '<button type="button" class="btn-primary" style="margin-top:1rem;padding:0.625rem 1.5rem;font-size:12px" id="show-all-cats">Show matches in all categories</button>' +
      '<button type="button" class="btn-outline" style="margin-top:1rem;margin-left:0.5rem;padding:0.625rem 1.5rem;font-size:12px" id="show-all-empty">Show All</button></div>';
  } else {
    body = '<div class="grid-shop">' + sorted.map(productCard).join("") + '</div>';
  }
  return '<main class="container" style="padding-top:2rem">' +
    '<h1 class="font-display" style="font-size:36px;font-weight:600;letter-spacing:0.08em;text-align:center;margin:0;text-transform:uppercase">Shop</h1>' +
    '<p style="margin:0.5rem 0 0;text-align:center;font-size:15px;color:var(--dim)">Strength, cardio and free weights, all in one place.</p>' +
    '<div style="margin-top:1.5rem"><label for="shop-search" class="field-label">Search</label>' +
      '<input id="shop-search" type="search" class="field-input" placeholder="Search dumbbells, treadmill, plates" value="' + esc(q) + '" aria-label="Search products" /></div>' +
    '<div style="margin-top:1rem;display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center">' + chips + '</div>' +
    '<div style="margin-top:1rem;display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;justify-content:space-between">' +
      '<p style="margin:0;font-size:14px;color:var(--dim)" role="status">' + esc(status) + '</p>' +
      '<label style="font-size:13px;color:var(--dim)">Sort <select id="sort-select" class="field-input" style="width:auto;display:inline-block;margin-top:0" aria-label="Sort products">' +
        '<option value="featured"' + (shopState.sort === "featured" ? " selected" : "") + '>Featured</option>' +
        '<option value="price-asc"' + (shopState.sort === "price-asc" ? " selected" : "") + '>Price, low to high</option>' +
        '<option value="price-desc"' + (shopState.sort === "price-desc" ? " selected" : "") + '>Price, high to low</option>' +
        '<option value="name"' + (shopState.sort === "name" ? " selected" : "") + '>Name, A to Z</option>' +
      '</select></label>' +
    '</div>' +
    '<div style="margin-top:1.5rem">' + body + '</div></main>';
}

function productPage(p) {
  var tag = p.tag ? '<p style="margin:0.5rem 0 0"><span class="card-tag">' + esc(p.tag) + '</span></p>' : "";
  var specs = (p.details || []).map(function (d) { return "<li>" + esc(d) + "</li>"; }).join("");
  var related = PRODUCTS.filter(function (o) { return o.category === p.category && o.id !== p.id; }).slice(0, 3);
  var relatedHtml = "";
  if (related.length > 0) {
    relatedHtml = '<section style="margin-top:3.5rem">' +
      '<h2 class="font-display" style="font-size:30px;font-weight:600;letter-spacing:0.06em;margin:0;text-transform:uppercase">You may also need</h2><div class="volt-rule-left"></div>' +
      '<div class="grid-related">' + related.map(productCard).join("") + '</div></section>';
  }
  return '<main class="container" style="padding-top:1.5rem">' +
    '<nav aria-label="Breadcrumb" style="font-size:13px;color:var(--dim)">' +
      '<button type="button" style="padding:0.25rem 0;min-height:2rem" data-nav="home">Home</button>' +
      '<span aria-hidden="true"> / </span>' +
      '<button type="button" style="padding:0.25rem 0;min-height:2rem" data-nav-shop-cat="' + p.category + '">' + p.category + '</button>' +
      '<span aria-hidden="true"> / </span><span style="color:var(--text)">' + esc(p.name) + '</span>' +
    '</nav>' +
    '<button type="button" data-nav-shop-cat="' + p.category + '" style="margin-top:0.25rem;padding:0.25rem 0;font-size:13px;letter-spacing:0.14em;text-transform:uppercase;color:var(--volt);text-decoration:underline;text-underline-offset:4px">Back to ' + p.category + '</button>' +
    '<div class="split-2-top" style="margin-top:1rem;align-items:start">' +
      '<div>' + photoPanel(p, true) + '</div>' +
      '<div>' +
        '<h1 class="font-display" style="font-size:36px;font-weight:600;line-height:1.15;margin:0">' + esc(p.name) + '</h1>' +
        '<p style="margin:0.25rem 0 0;font-size:13px;letter-spacing:0.18em;text-transform:uppercase;color:var(--dim)">' + p.category + '</p>' +
        '<p style="margin:0.75rem 0 0;font-size:24px;font-weight:700;color:var(--volt)">' + formatPrice(p.price) + '</p>' +
        tag +
        '<p style="margin:1rem 0 0;font-size:15px;line-height:1.75;color:var(--dim)">' + esc(p.description) + '</p>' +
        '<p style="margin:0.75rem 0 0;font-size:15px;line-height:1.6;color:var(--dim)">' + esc(p.short_line) + '</p>' +
        '<h2 class="font-display" style="font-size:20px;font-weight:600;margin:1.5rem 0 0;text-transform:uppercase">Specifications</h2>' +
        '<ul style="margin:0.5rem 0 0;padding-left:1.25rem;font-size:14px;line-height:1.6;color:var(--dim)">' + specs + '</ul>' +
        '<div style="margin-top:1.5rem;display:flex;align-items:center;gap:0.75rem">' +
          '<span class="field-label">Quantity</span>' +
          '<div class="qty-control">' +
            '<button type="button" class="qty-btn" id="qty-minus" aria-label="Decrease quantity">-</button>' +
            '<span class="qty-value" aria-live="polite">' + productState.qty + '</span>' +
            '<button type="button" class="qty-btn" id="qty-plus" aria-label="Increase quantity">+</button>' +
          '</div></div>' +
        '<button type="button" class="btn-primary btn-block" style="margin-top:1.5rem;max-width:28rem;padding:0.875rem 2rem" id="add-to-cart">Add to Cart</button>' +
        '<button type="button" class="btn-outline btn-block" style="margin-top:0.5rem;max-width:28rem;padding:0.875rem 2rem" id="buy-now">Buy Now</button>' +
        '<p style="margin:0.75rem 0 0;font-size:13px;color:var(--dim)">Cash on delivery. Pay when your order arrives.</p>' +
      '</div>' +
    '</div>' + relatedHtml + '</main>';
}

function cartPage() {
  var lines = cartLines();
  if (lines.length === 0) {
    return '<main class="container-narrow" style="padding-top:2rem">' +
      '<h1 class="font-display" style="font-size:36px;font-weight:600;letter-spacing:0.1em;text-align:center;text-transform:uppercase;margin:0">Your Cart</h1>' +
      '<div class="panel" style="margin-top:2rem;padding:3rem 1.5rem;text-align:center">' +
        '<p class="font-display" style="font-size:24px;font-weight:600;margin:0">Your cart is empty</p>' +
        '<p style="margin:0.5rem 0 0;font-size:14px;color:var(--dim)">Add some equipment to begin.</p>' +
        '<button type="button" class="btn-primary" style="margin-top:1.25rem;padding:0.75rem 1.75rem;font-size:12px" data-nav="shop">Continue Shopping</button>' +
      '</div></main>';
  }
  var subtotal = cartSubtotal();
  var shipping = shippingFor(subtotal);
  var total = subtotal + shipping;
  var items = lines.map(function (l) {
    var thumb = l.product.img ? '<img src="' + esc(l.product.img) + '" alt="" />' : esc(l.product.name.charAt(0));
    return '<li class="cart-line">' +
      '<div class="cart-thumb" aria-hidden="true">' + thumb + '</div>' +
      '<div style="min-width:0;flex:1">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:0.75rem">' +
          '<div><h2 class="font-display" style="font-size:19px;font-weight:600;line-height:1.3;margin:0">' + esc(l.product.name) + '</h2>' +
          '<p style="margin:0.125rem 0 0;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:var(--dim)">' + l.product.category + '</p></div>' +
          '<button type="button" data-remove="' + l.productId + '" aria-label="Remove ' + esc(l.product.name) + ' from cart" style="padding:0.25rem 0.5rem;font-size:20px;line-height:1;color:var(--dim);min-width:2.5rem;min-height:2.5rem">x</button>' +
        '</div>' +
        '<div style="margin-top:0.75rem;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:0.75rem">' +
          '<div class="qty-control">' +
            '<button type="button" class="qty-btn-sm" data-dec="' + l.productId + '" aria-label="Decrease quantity of ' + esc(l.product.name) + '">-</button>' +
            '<span class="qty-value">' + l.qty + '</span>' +
            '<button type="button" class="qty-btn-sm" data-inc="' + l.productId + '" aria-label="Increase quantity of ' + esc(l.product.name) + '">+</button>' +
          '</div>' +
          '<p style="margin:0;font-size:15px;font-weight:700">' + formatPrice(l.product.price * l.qty) + '</p>' +
        '</div>' +
      '</div></li>';
  }).join("");
  return '<main class="container-narrow" style="padding-top:2rem">' +
    '<h1 class="font-display" style="font-size:36px;font-weight:600;letter-spacing:0.1em;text-align:center;text-transform:uppercase;margin:0">Your Cart</h1>' +
    '<ul class="cart-list">' + items + '</ul>' +
    '<div class="panel" style="margin-top:1.5rem;padding:1.25rem">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;font-size:16px"><span style="letter-spacing:0.08em">Subtotal</span><span style="font-weight:600">' + formatPrice(subtotal) + '</span></div>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;font-size:14px;color:var(--dim);margin-top:0.5rem"><span>Delivery</span><span>' + (shipping === 0 ? "Free" : formatPrice(shipping)) + '</span></div>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;font-size:17px;margin-top:0.5rem"><span style="letter-spacing:0.06em">Total</span><span style="font-weight:700;color:var(--volt)">' + formatPrice(total) + '</span></div>' +
      '<p style="margin:0.25rem 0 0;font-size:13px;color:var(--dim)">Delivery is free on orders of PKR 50,000 or more. Cash on delivery.</p>' +
      '<button type="button" class="btn-primary btn-block" style="margin-top:1rem;padding:0.875rem 2rem" data-nav="checkout">Proceed to Checkout</button>' +
      '<button type="button" class="btn-outline-block" style="margin-top:0.5rem" data-nav="shop">Continue Shopping</button>' +
    '</div></main>';
}

function checkoutPage() {
  var lines = cartLines();
  if (lines.length === 0) {
    return '<main class="container-narrow" style="padding-top:2rem">' +
      '<h1 class="font-display" style="font-size:36px;font-weight:600;letter-spacing:0.1em;text-align:center;text-transform:uppercase;margin:0">Checkout</h1>' +
      '<div class="panel" style="margin-top:2rem;padding:3rem 1.5rem;text-align:center">' +
        '<p class="font-display" style="font-size:24px;font-weight:600;margin:0">Your cart is empty</p>' +
        '<p style="margin:0.5rem 0 0;font-size:14px;color:var(--dim)">Add some equipment first, then come back to checkout.</p>' +
        '<button type="button" class="btn-primary" style="margin-top:1.25rem;padding:0.75rem 1.75rem;font-size:12px" data-nav="shop">Go to Shop</button>' +
      '</div></main>';
  }
  var subtotal = cartSubtotal();
  var shipping = shippingFor(subtotal);
  var total = subtotal + shipping;
  var summary = lines.map(function (l) {
    return '<li style="display:flex;align-items:flex-start;justify-content:space-between;gap:0.75rem;font-size:14px;margin-top:0.75rem"><span>' + esc(l.product.name) +
      '<span style="display:block;font-size:12px;color:var(--dim)">Qty ' + l.qty + '</span></span>' +
      '<span style="font-weight:500">' + formatPrice(l.product.price * l.qty) + '</span></li>';
  }).join("");
  return '<main class="container-mid" style="padding-top:2rem">' +
    '<h1 class="font-display" style="font-size:36px;font-weight:600;letter-spacing:0.1em;text-align:center;text-transform:uppercase;margin:0">Checkout</h1>' +
    '<form id="checkout-form" class="checkout-layout" novalidate>' +
      '<section aria-label="Shipping address" class="panel" style="padding:1.5rem 1.25rem;height:fit-content">' +
        '<h2 class="font-display" style="font-size:24px;font-weight:600;margin:0;text-transform:uppercase">Shipping Address</h2>' +
        '<div style="margin-top:1rem"><label for="co-name" class="field-label">Full name</label><input id="co-name" aria-label="Full name" class="field-input" required autocomplete="name" /></div>' +
        '<div style="margin-top:1rem"><label for="co-email" class="field-label">Email</label><input id="co-email" type="email" aria-label="Email" class="field-input" required autocomplete="email" /></div>' +
        '<div style="margin-top:1rem"><label for="co-phone" class="field-label">Phone number</label><input id="co-phone" aria-label="Phone number" class="field-input" required autocomplete="tel" inputmode="tel" /></div>' +
        '<div style="margin-top:1rem"><label for="co-address" class="field-label">Address</label><textarea id="co-address" aria-label="Address" class="field-input" required rows="3" autocomplete="street-address"></textarea></div>' +
        '<div style="margin-top:1rem"><label for="co-city" class="field-label">City</label><input id="co-city" aria-label="City" class="field-input" required autocomplete="address-level2" /></div>' +
        '<div style="margin-top:1rem"><label for="co-notes" class="field-label">Order notes, optional</label><input id="co-notes" aria-label="Order notes, optional" class="field-input" /></div>' +
        '<div style="margin-top:1rem"><span class="field-label">Payment method</span>' +
          '<label style="display:block;margin-top:0.5rem;font-size:14px"><input type="radio" name="payment" value="Cash on Delivery" checked /> Cash on Delivery</label>' +
          '<label style="display:block;margin-top:0.5rem;font-size:14px"><input type="radio" name="payment" value="Bank Transfer" /> Bank Transfer</label></div>' +
        '<p id="co-error" class="form-error" role="alert" style="margin:1rem 0 0;display:none"></p>' +
      '</section>' +
      '<aside aria-label="Order summary" class="panel" style="padding:1.5rem 1.25rem;height:fit-content">' +
        '<h2 class="font-display" style="font-size:24px;font-weight:600;margin:0;text-transform:uppercase">Order Summary</h2>' +
        '<ul style="margin:0.25rem 0 0;padding:0;list-style:none">' + summary + '</ul>' +
        '<div style="margin-top:1rem;border-top:1px solid var(--border);padding-top:0.75rem;display:flex;align-items:center;justify-content:space-between;font-size:13px;color:var(--dim)"><span>Subtotal</span><span>' + formatPrice(subtotal) + '</span></div>' +
        '<div style="margin-top:0.5rem;display:flex;align-items:center;justify-content:space-between;font-size:13px;color:var(--dim)"><span>Delivery</span><span>' + (shipping === 0 ? "Free" : formatPrice(shipping)) + '</span></div>' +
        '<div style="margin-top:0.5rem;display:flex;align-items:center;justify-content:space-between;font-size:17px"><span style="letter-spacing:0.06em">Total</span><span style="font-weight:700;color:var(--volt)">' + formatPrice(total) + '</span></div>' +
        '<p style="margin:0.5rem 0 0;font-size:13px;color:var(--dim)">Cash on delivery. Pay when your order arrives.</p>' +
        '<button type="submit" class="btn-primary btn-block" style="margin-top:1.25rem;padding:0.875rem 2rem">Place Order</button>' +
      '</aside>' +
    '</form></main>';
}

function confirmationPage() {
  var inner;
  if (lastOrder) {
    inner = '<p style="margin:0.75rem 0 0;font-size:15px;color:var(--dim)">Your order number is <span style="font-weight:600;color:var(--text)">' + esc(lastOrder.orderNumber) + '</span>.</p>' +
      '<p style="margin:0.25rem 0 0;font-size:15px;color:var(--dim)">Total to pay on delivery: <span style="font-weight:600;color:var(--text)">' + formatPrice(lastOrder.total) + '</span></p>' +
      '<p style="margin:0.75rem 0 0;font-size:14px;line-height:1.6;color:var(--dim)">We will call your phone number to confirm before dispatch. Please keep your order number safe for any questions.</p>';
  } else {
    inner = '<p style="margin:0.75rem 0 0;font-size:15px;color:var(--dim)">There is no recent order to show. If you just placed one and this page reloaded, your order is still confirmed on this visit.</p>';
  }
  return '<main class="container-form" style="padding-top:3rem">' +
    '<div class="panel" style="padding:2.5rem 1.5rem;text-align:center">' +
      '<div style="display:flex;justify-content:center">' + logoMark(44) + '</div>' +
      '<h1 class="font-display" style="margin:1rem 0 0;font-size:36px;font-weight:600">Thank you for your order</h1>' +
      inner +
      '<button type="button" class="btn-primary" style="margin-top:1.5rem;padding:0.75rem 2rem;font-size:12px" data-nav="shop">Continue Shopping</button>' +
    '</div></main>';
}

function aboutPage() {
  return '<main class="container-mid" style="padding-top:2rem">' +
    '<h1 class="font-display" style="font-size:40px;font-weight:600;letter-spacing:0.1em;text-align:center;text-transform:uppercase;margin:0">WE FORGE THE BEST</h1>' +
    '<p style="margin:0.75rem auto 0;max-width:42rem;text-align:center;font-size:15px;line-height:1.75;color:var(--dim)">FitGear is a gym and fitness equipment store built around one idea: good equipment makes good training possible. We choose equipment for strength, cardio and free weights, then make it easy to buy and use at home.</p>' +
    '<img src="/images/about.jpg" alt="Barbell under spotlights in a dark gym" style="display:block;width:100%;max-height:22rem;object-fit:cover;margin-top:2rem;border:1px solid var(--volt)" />' +
    '<div class="split-2" style="margin-top:2.25rem;align-items:start">' +
      '<div class="panel" style="padding:2rem 1.5rem"><h2 class="font-display" style="font-size:24px;font-weight:600;margin:0;text-transform:uppercase">Our Mission</h2>' +
      '<p style="margin:0.75rem 0 0;font-size:15px;line-height:1.75;color:var(--dim)">To put reliable gym equipment within reach of everyone who trains, at home or in the gym, with clear prices and honest descriptions.</p></div>' +
      '<div class="panel" style="padding:2rem 1.5rem"><h2 class="font-display" style="font-size:24px;font-weight:600;margin:0;text-transform:uppercase">Our Values</h2>' +
      '<p style="margin:0.75rem 0 0;font-size:15px;line-height:1.75;color:var(--dim)">Train hard, train honestly, and use equipment that lasts. Every product in the shop is chosen to be used often and to keep working.</p></div>' +
    '</div>' +
    '<section class="panel" style="margin-top:3rem;padding:2rem 1.5rem">' +
      '<h2 class="font-display" style="font-size:32px;font-weight:600;letter-spacing:0.06em;text-align:center;margin:0;text-transform:uppercase">Train With FitGear</h2>' +
      '<div class="volt-rule"></div>' +
      '<div style="margin:1.25rem auto 0;max-width:42rem;font-size:15px;line-height:1.75;color:var(--dim)">' +
        '<p style="margin:0">Strength, cardio and free weights, all in one shop. Power racks and barbells for strength days, treadmills and rowers for cardio days, and dumbbells, kettlebells and plates for everything in between.</p>' +
        '<p style="margin:1rem 0 0">Thank you for visiting FitGear. We hope you find the equipment that fits your training.</p>' +
      '</div>' +
      '<div style="margin-top:1.75rem;text-align:center"><button type="button" class="btn-primary" style="padding:0.75rem 2rem;font-size:12px" data-nav="shop">Shop Equipment</button></div>' +
    '</section></main>';
}

function contactPage() {
  var formHtml;
  if (contactSent) {
    var first = contactName.split(" ")[0] || "friend";
    formHtml = '<div role="status">' +
      '<h2 class="font-display" style="font-size:24px;font-weight:600;margin:0">Message sent</h2>' +
      '<p style="margin:0.5rem 0 0;font-size:14px;line-height:1.6;color:var(--dim)">Thank you, ' + esc(first) + '. Your message is with us and we will get back to you soon.</p>' +
      '<button type="button" class="btn-card-outline" style="margin-top:1rem;padding:0.5rem 1.25rem;flex:none" id="contact-again">Write another message</button></div>';
  } else {
    formHtml = '<form id="contact-form" novalidate>' +
      '<div><label for="ct-name" class="field-label">Name</label><input id="ct-name" aria-label="Name" class="field-input" required autocomplete="name" /></div>' +
      '<div style="margin-top:1rem"><label for="ct-subject" class="field-label">Subject</label><input id="ct-subject" aria-label="Subject" class="field-input" required /></div>' +
      '<div style="margin-top:1rem"><label for="ct-message" class="field-label">Message</label><textarea id="ct-message" aria-label="Message" class="field-input" required rows="5"></textarea></div>' +
      '<p id="ct-error" class="form-error" role="alert" style="margin:0.75rem 0 0;display:none"></p>' +
      '<button type="submit" class="btn-primary btn-block" style="margin-top:1.25rem;padding:0.875rem 2rem">Submit</button></form>';
  }
  return '<main class="container-mid" style="padding-top:2rem">' +
    '<h1 class="font-display" style="font-size:40px;font-weight:600;letter-spacing:0.1em;text-align:center;text-transform:uppercase;margin:0">Contact Us</h1>' +
    '<p style="margin:0.75rem auto 0;max-width:36rem;text-align:center;font-size:15px;line-height:1.75;color:var(--dim)">Questions about a product, an order or delivery? Write to us here and we will reply as soon as we can.</p>' +
    '<div class="split-2-top" style="margin-top:2.25rem">' +
      '<div class="panel" style="padding:1.5rem 1.25rem">' + formHtml +
        '<div style="margin-top:1.5rem;border-top:1px solid var(--border);padding-top:1rem;font-size:14px;line-height:1.6;color:var(--dim)">' +
          '<p style="margin:0"><span style="color:var(--text);font-weight:500">Email:</span> to be added soon (placeholder)</p>' +
          '<p style="margin:0"><span style="color:var(--text);font-weight:500">Phone:</span> to be added soon (placeholder)</p>' +
          '<p style="margin:0"><span style="color:var(--text);font-weight:500">Store address:</span> to be added soon (placeholder)</p>' +
        '</div>' +
      '</div>' +
      '<div class="panel" style="padding:1.5rem 1.25rem">' +
        '<h2 class="font-display" style="font-size:24px;font-weight:600;margin:0;text-transform:uppercase">Store Location</h2>' +
        '<p style="margin:0.5rem 0 0;font-size:14px;line-height:1.6;color:var(--dim)">Store location to be added soon (placeholder).</p>' +
      '</div>' +
    '</div></main>';
}

/* Header and footer */
function headerHtml() {
  var count = cartCount();
  var catLinks = CATEGORIES.map(function (c) {
    return '<button type="button" class="nav-btn" data-nav-shop-cat="' + c + '">' + c + '</button>';
  }).join("");
  var mobileLinks = catLinks +
    '<button type="button" class="nav-btn" data-nav="shop">Shop All</button>' +
    '<button type="button" class="nav-btn" data-nav="about">About</button>' +
    '<button type="button" class="nav-btn" data-nav="contact">Contact</button>';
  var searchDrop = "";
  if (searchOpen) {
    var results = headerQuery ? searchResults(headerQuery).slice(0, 5) : [];
    var items = results.map(function (p) {
      return '<button type="button" data-suggest-product="' + p.id + '">' + esc(p.name) + ' ' + formatPrice(p.price) + '</button>';
    }).join("");
    searchDrop = '<div class="search-drop" role="listbox">' +
      '<input id="header-search-input" type="search" class="search-input" placeholder="Search equipment" value="' + esc(headerQuery) + '" aria-label="Search products" />' +
      (headerQuery ? items + '<button type="button" data-suggest-all>See all ' + searchResults(headerQuery).length + ' results</button>' : '<p style="margin:0.5rem;font-size:13px;color:var(--dim)">Try dumbbells, treadmill or plates.</p>') +
      '</div>';
  }
  return '<header class="site-header"><div class="header-inner">' +
    '<div class="header-row">' +
      '<button type="button" class="menu-btn" id="menu-btn" aria-label="' + (menuOpen ? "Close menu" : "Open menu") + '" aria-expanded="' + menuOpen + '"><span aria-hidden="true">' + (menuOpen ? "x" : "menu") + '</span></button>' +
      '<nav class="header-nav-left" aria-label="Categories">' + catLinks + '</nav>' +
      '<button type="button" class="logo-btn" data-nav="home" aria-label="FitGear home">' + logoMark(34) + '<span class="logo-word">FIT<b>GEAR</b></span></button>' +
      '<div class="header-nav-right">' +
        '<button type="button" class="nav-btn desktop-only" data-nav="shop">Shop</button>' +
        '<button type="button" class="nav-btn desktop-only" data-nav="about">About</button>' +
        '<button type="button" class="nav-btn desktop-only" data-nav="contact">Contact</button>' +
        '<div class="search-wrap">' +
          '<button type="button" class="icon-btn" id="search-btn" aria-label="Search" aria-expanded="' + searchOpen + '">Search</button>' +
          searchDrop +
        '</div>' +
        '<a href="/admin.html" class="icon-btn" style="text-decoration:none;display:inline-flex;align-items:center" aria-label="Account and Admin Panel">Account</a>' +
        '<button type="button" class="nav-btn bag-btn" data-nav="cart" aria-label="Your bag, ' + count + ' items">Bag' +
          (count > 0 ? '<span class="bag-count">' + count + '</span>' : '') + '</button>' +
      '</div>' +
    '</div>' +
    (menuOpen ? '<nav class="mobile-menu menu-in" aria-label="Menu">' + mobileLinks + '</nav>' : '') +
    '</div><div class="header-rule"></div></header>';
}

function footerHtml() {
  var links = CATEGORIES.map(function (c) {
    return '<button type="button" class="footer-link" data-nav-shop-cat="' + c + '">' + c + '</button>';
  }).join("") +
    '<button type="button" class="footer-link" data-nav="about">About</button>' +
    '<button type="button" class="footer-link" data-nav="contact">Contact Us</button>' +
    '<a class="footer-link" href="/admin.html">Admin Panel</a>';
  var news;
  if (subscribed) {
    news = '<p style="margin:0.75rem 0 0;font-size:14px;font-weight:500;color:var(--volt)" role="status">Thank you, you are on the list.</p>';
  } else {
    news = '<form class="newsletter-form" id="newsletter-form" novalidate>' +
      '<label class="sr-only" for="newsletter-email">Email address</label>' +
      '<input id="newsletter-email" type="email" required placeholder="Your email address" class="newsletter-input" />' +
      '<button type="submit" class="newsletter-btn">Join</button></form>' +
      '<p id="newsletter-error" class="form-error" role="alert" style="margin:0.5rem 0 0;display:none"></p>';
  }
  return '<footer class="site-footer"><div class="footer-grid">' +
    '<div><div style="display:flex;align-items:center;gap:0.625rem">' + logoMark(30) +
      '<span class="font-display" style="font-size:22px;font-weight:700;letter-spacing:0.12em">FIT<b style="color:var(--volt)">GEAR</b></span></div>' +
      '<p style="margin:0.75rem 0 0;font-size:14px;line-height:1.6;color:var(--dim)">Gym and fitness equipment for strength, cardio and free weights.</p></div>' +
    '<nav aria-label="Footer"><p style="margin:0 0 0.5rem;font-size:12px;letter-spacing:0.22em;text-transform:uppercase;color:var(--dim)">Explore</p>' + links + '</nav>' +
    '<div><p style="margin:0 0 0.5rem;font-size:12px;letter-spacing:0.22em;text-transform:uppercase;color:var(--dim)">Newsletter</p>' +
      '<p style="margin:0;font-size:14px;line-height:1.6;color:var(--dim)">New equipment and training notes, sent occasionally.</p>' + news + '</div>' +
    '</div>' +
    '<div style="border-top:1px solid var(--border);padding:1rem 0;text-align:center"><p class="font-display" style="margin:0;font-size:15px;letter-spacing:0.2em;color:var(--dim)">FITGEAR, BY INTERLINKZ</p></div>' +
  '</footer>';
}

function renderHeader() {
  var el = document.getElementById("site-header");
  if (el) { el.innerHTML = headerHtml(); wireHeader(); }
}

function render() {
  var pageHtml;
  if (!PRODUCTS_LOADED) {
    pageHtml = '<main class="container-form" style="padding:4rem 1rem;text-align:center"><p style="font-size:15px;color:var(--dim)">' + (PRODUCTS_ERROR ? "Products could not be loaded. Please refresh the page." : "Loading FitGear.") + '</p></main>';
  } else if (route.page === "home") pageHtml = homePage();
  else if (route.page === "shop") pageHtml = shopPage();
  else if (route.page === "product") {
    var p = byId(route.id);
    if (p) pageHtml = productPage(p);
    else pageHtml = '<main class="container-form" style="padding:4rem 1rem;text-align:center"><p class="font-display" style="font-size:30px;font-weight:600;margin:0">This product is not in the shop</p><p style="margin:0.5rem 0 0;font-size:14px;color:var(--dim)">It may have sold out or the link may be old.</p><button type="button" class="btn-primary" style="margin-top:1.25rem;padding:0.625rem 1.5rem;font-size:12px" data-nav="shop">Back to Shop</button></main>';
  }
  else if (route.page === "cart") pageHtml = cartPage();
  else if (route.page === "checkout") pageHtml = checkoutPage();
  else if (route.page === "confirmation") pageHtml = confirmationPage();
  else if (route.page === "about") pageHtml = aboutPage();
  else if (route.page === "contact") pageHtml = contactPage();
  else pageHtml = homePage();
  document.getElementById("app").innerHTML =
    '<div id="site-header">' + headerHtml() + '</div>' +
    '<div>' + pageHtml + '</div>' + footerHtml();
  wire();
}

function wireNavIn(rootEl) {
  if (!rootEl) return;
  rootEl.querySelectorAll("[data-nav]").forEach(function (el) {
    el.addEventListener("click", function () { navigate({ page: el.getAttribute("data-nav") }); });
  });
  rootEl.querySelectorAll("[data-nav-shop-cat]").forEach(function (el) {
    el.addEventListener("click", function () {
      navigate({ page: "shop" }, "?category=" + encodeURIComponent(el.getAttribute("data-nav-shop-cat")));
    });
  });
  rootEl.querySelectorAll("[data-nav-product]").forEach(function (el) {
    el.addEventListener("click", function () { navigate({ page: "product", id: el.getAttribute("data-nav-product") }); });
  });
}

function wireHeader() {
  var headerEl = document.getElementById("site-header");
  wireNavIn(headerEl);
  var menuBtn = document.getElementById("menu-btn");
  if (menuBtn) menuBtn.addEventListener("click", function () { menuOpen = !menuOpen; renderHeader(); });
  var searchBtn = document.getElementById("search-btn");
  if (searchBtn) searchBtn.addEventListener("click", function () {
    searchOpen = !searchOpen;
    renderHeader();
    var input = document.getElementById("header-search-input");
    if (input) input.focus();
  });
  var input = document.getElementById("header-search-input");
  if (input) input.addEventListener("input", function () { headerQuery = input.value; renderHeader(); var again = document.getElementById("header-search-input"); if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); } });
  if (input) input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      var q = input.value.trim();
      searchOpen = false;
      navigate({ page: "shop" }, q ? "?search=" + encodeURIComponent(q) : "");
    }
    if (e.key === "Escape") { searchOpen = false; headerQuery = ""; renderHeader(); }
  });
  headerEl.querySelectorAll("[data-suggest-product]").forEach(function (el) {
    el.addEventListener("click", function () { searchOpen = false; headerQuery = ""; navigate({ page: "product", id: el.getAttribute("data-suggest-product") }); });
  });
  headerEl.querySelectorAll("[data-suggest-all]").forEach(function (el) {
    el.addEventListener("click", function () {
      var q = headerQuery.trim();
      searchOpen = false; headerQuery = "";
      navigate({ page: "shop" }, q ? "?search=" + encodeURIComponent(q) : "");
    });
  });
}

function wire() {
  wireHeader();
  document.querySelectorAll("[data-nav]").forEach(function (el) {
    if (el.closest("#site-header")) return;
    el.addEventListener("click", function () { navigate({ page: el.getAttribute("data-nav") }); });
  });
  document.querySelectorAll("[data-nav-shop-cat]").forEach(function (el) {
    if (el.closest("#site-header")) return;
    el.addEventListener("click", function () {
      navigate({ page: "shop" }, "?category=" + encodeURIComponent(el.getAttribute("data-nav-shop-cat")));
    });
  });
  document.querySelectorAll("[data-nav-product]").forEach(function (el) {
    if (el.closest("#site-header")) return;
    el.addEventListener("click", function () { navigate({ page: "product", id: el.getAttribute("data-nav-product") }); });
  });
  document.querySelectorAll("[data-quick-add]").forEach(function (el) {
    el.addEventListener("click", function () {
      var p = byId(el.getAttribute("data-quick-add"));
      if (p) addToCart(p, 1);
    });
  });
  /* Shop search, category and sort */
  var shopSearch = document.getElementById("shop-search");
  if (shopSearch) shopSearch.addEventListener("input", function () {
    shopState.search = shopSearch.value;
    shopState.category = "All";
    shopState.showAllMatches = false;
    render();
    var again = document.getElementById("shop-search");
    if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
  });
  document.querySelectorAll("[data-category]").forEach(function (el) {
    el.addEventListener("click", function () { shopState.category = el.getAttribute("data-category"); shopState.showAllMatches = false; render(); });
  });
  var sortSel = document.getElementById("sort-select");
  if (sortSel) sortSel.addEventListener("change", function () { shopState.sort = sortSel.value; render(); });
  var showAllCats = document.getElementById("show-all-cats");
  if (showAllCats) showAllCats.addEventListener("click", function () { shopState.showAllMatches = true; render(); });
  var showAllEmpty = document.getElementById("show-all-empty");
  if (showAllEmpty) showAllEmpty.addEventListener("click", function () { shopState = { category: "All", search: "", sort: shopState.sort, showAllMatches: false }; render(); });
  /* Product detail */
  var qm = document.getElementById("qty-minus");
  if (qm) qm.addEventListener("click", function () { productState.qty = Math.max(1, productState.qty - 1); render(); });
  var qp = document.getElementById("qty-plus");
  if (qp) qp.addEventListener("click", function () { productState.qty = Math.min(50, productState.qty + 1); render(); });
  var atc = document.getElementById("add-to-cart");
  if (atc) atc.addEventListener("click", function () {
    var p = byId(route.id);
    if (p) addToCart(p, productState.qty);
  });
  var buyNow = document.getElementById("buy-now");
  if (buyNow) buyNow.addEventListener("click", function () {
    var p = byId(route.id);
    if (p) { addToCart(p, productState.qty); navigate({ page: "checkout" }); }
  });
  /* Cart lines */
  document.querySelectorAll("[data-inc]").forEach(function (el) {
    el.addEventListener("click", function () {
      var line = null;
      cart.forEach(function (i) { if (i.productId === el.getAttribute("data-inc")) line = i; });
      if (line) setLineQty(line.productId, line.qty + 1);
    });
  });
  document.querySelectorAll("[data-dec]").forEach(function (el) {
    el.addEventListener("click", function () {
      var line = null;
      cart.forEach(function (i) { if (i.productId === el.getAttribute("data-dec")) line = i; });
      if (line) setLineQty(line.productId, line.qty - 1);
    });
  });
  document.querySelectorAll("[data-remove]").forEach(function (el) {
    el.addEventListener("click", function () { removeLine(el.getAttribute("data-remove")); });
  });
  /* Checkout */
  var coForm = document.getElementById("checkout-form");
  if (coForm) coForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var name = document.getElementById("co-name").value.trim();
    var email = document.getElementById("co-email").value.trim();
    var phone = document.getElementById("co-phone").value.trim();
    var address = document.getElementById("co-address").value.trim();
    var city = document.getElementById("co-city").value.trim();
    var err = document.getElementById("co-error");
    function fail(msg) { err.textContent = msg; err.style.display = "block"; }
    if (name.length < 2) return fail("Please enter your full name.");
    if (email.indexOf("@") < 1) return fail("Please enter a valid email address.");
    if (phone.length < 7) return fail("Please enter a phone number we can reach you on.");
    if (address.length < 5) return fail("Please enter your full shipping address.");
    if (city.length < 2) return fail("Please enter your city.");
    err.style.display = "none";
    var lines = cartLines();
    var payment = "Cash on Delivery";
    var checked = coForm.querySelector('input[name="payment"]:checked');
    if (checked) payment = checked.value;
    var notes = document.getElementById("co-notes").value.trim();
    var items = lines.map(function (l) { return { productId: l.productId, variant: "Standard", qty: l.qty }; });
    fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customerName: name, email: email, phone: phone, address: address, city: city, notes: notes, paymentMethod: payment, items: items }) })
      .then(function (r) { if (!r.ok) throw new Error("order"); return r.json(); })
      .then(function (saved) {
        lastOrder = { orderNumber: saved.orderNumber, total: saved.total };
        try { storageSet("fitgear-last-order", JSON.stringify(lastOrder)); } catch (err2) {}
        cart = [];
        navigate({ page: "confirmation" });
      })
      .catch(function () { fail("Your order could not be placed. Please try again."); });
  });
  /* Contact */
  var ctForm = document.getElementById("contact-form");
  if (ctForm) ctForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var name = document.getElementById("ct-name").value.trim();
    var subject = document.getElementById("ct-subject").value.trim();
    var message = document.getElementById("ct-message").value.trim();
    var err = document.getElementById("ct-error");
    function fail(msg) { err.textContent = msg; err.style.display = "block"; }
    if (name.length < 2) return fail("Please enter your name.");
    if (subject.length < 2) return fail("Please enter a subject.");
    if (message.length < 5) return fail("Please write a short message.");
    err.style.display = "none";
    fetch("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name, subject: subject, message: message }) })
      .then(function (r) { if (!r.ok) throw new Error("contact"); return r.json(); })
      .then(function () { contactSent = true; contactName = name; render(); })
      .catch(function () { fail("Your message could not be sent. Please try again."); });
  });
  var contactAgain = document.getElementById("contact-again");
  if (contactAgain) contactAgain.addEventListener("click", function () { contactSent = false; contactName = ""; render(); });
  /* Newsletter */
  var nlForm = document.getElementById("newsletter-form");
  if (nlForm) nlForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var email = document.getElementById("newsletter-email").value.trim();
    var err = document.getElementById("newsletter-error");
    if (email.indexOf("@") < 1) { err.textContent = "Please enter a valid email address."; err.style.display = "block"; return; }
    fetch("/api/newsletter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email }) })
      .then(function (r) { if (!r.ok) throw new Error("newsletter"); return r.json(); })
      .then(function () { subscribed = true; render(); })
      .catch(function () { err.textContent = "Could not subscribe. Please try again."; err.style.display = "block"; });
  });
}

/* Intro overlay. Shows once per session, closes on Skip, on any tap,
   on a timer, and by a CSS animation failsafe, so the page never
   sticks on a black screen. */
function showIntro() {
  if (storageGet("fitgear-intro-seen")) { introDone = true; return; }
  var root = document.getElementById("intro-root");
  root.innerHTML = '<div class="intro-overlay" id="intro-overlay" role="dialog" aria-label="FitGear intro">' +
    '<div class="intro-box">' +
      '<div style="display:flex;justify-content:center">' + logoMark(48) + '</div>' +
      '<p class="intro-word" style="margin-top:1rem"><span class="intro-letter" style="animation-delay:0.1s">F</span><span class="intro-letter" style="animation-delay:0.2s">I</span><span class="intro-letter" style="animation-delay:0.3s">T</span><span class="intro-letter" style="animation-delay:0.4s">G</span><span class="intro-letter" style="animation-delay:0.5s">E</span><span class="intro-letter" style="animation-delay:0.6s">A</span><span class="intro-letter" style="animation-delay:0.7s">R</span></p>' +
      '<div class="intro-line intro-line-anim"></div>' +
      '<p class="intro-tagline intro-tagline-anim">RISE AND GRIND</p>' +
      '<button type="button" class="intro-skip" id="intro-skip">Skip intro</button>' +
    '</div></div>';
  var closed = false;
  function close() {
    if (closed) return;
    closed = true;
    introDone = true;
    storageSet("fitgear-intro-seen", "1");
    var overlay = document.getElementById("intro-overlay");
    if (overlay) {
      overlay.classList.add("intro-leaving");
      window.setTimeout(function () { root.innerHTML = ""; }, 700);
    } else {
      root.innerHTML = "";
    }
  }
  document.getElementById("intro-skip").addEventListener("click", function (e) { e.stopPropagation(); close(); });
  root.addEventListener("click", close);
  window.setTimeout(close, 2500);
  window.setTimeout(close, 4000);
}

/* Load products from the API, then render. */
function loadProducts() {
  render();
  fetch("/api/products")
    .then(function (r) { if (!r.ok) throw new Error("products"); return r.json(); })
    .then(function (data) {
      PRODUCTS = data;
      PRODUCTS_LOADED = true;
      render();
    })
    .catch(function () {
      PRODUCTS_ERROR = true;
      render();
    });
}

try {
  var savedOrder = storageGet("fitgear-last-order");
  if (savedOrder) lastOrder = JSON.parse(savedOrder);
} catch (e) {}
showIntro();
loadProducts();
