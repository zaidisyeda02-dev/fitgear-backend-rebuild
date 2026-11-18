# FitGear Backend Rebuild

Portable Node.js rebuild of the canonical FitGear gym and fitness
equipment store (Design 08: Matte Black and Volt, matte black
background, bright volt green accent lines and buttons, thin volt
outlines, flat dark panels, modern geometric sans-serif, night gym
look). This is step 1 of the backend rebuild project: a source
project that can be deployed to Hostinger as a Node Web App with
MySQL. It is not live yet. No Hostinger change was made to build it,
and no existing live site was touched.

## What it is

- Express app, entry file `server.js`, start command `node server.js`.
  No build step is needed. The frontend is plain files in `public/`.
- The shop frontend follows the canonical FitGear build v4, Design 08:
  same palette, same FitGear logo mark, same opening animation with
  Skip intro, same 7 pages (Homepage, Shop and Category, Product
  Detail, Cart Your Cart, Checkout, About We Forge The Best, Contact
  Contact Us), same copy, same filters, sort and search behaviour,
  same cart and checkout flow. The only changes are that products
  now load from the API, orders, newsletter signups and contact
  messages are saved to the database, and the footer links to the
  Admin Panel.
- 12 products, 4 Strength, 4 Cardio, 4 Free Weights, with the exact
  PKR prices from the canonical build v4, verified by an artifact
  inspection of the canonical catalog (inspection ID
  42a71bbc-1139-40d5-a00b-cd3e84384903). No product name or price was
  invented. The full list is in `db/seed-products.json`.
- Product photos: the 12 product photos plus the hero and about
  photos are files in `public/images/` (14 files, 1.9 MB total),
  taken from the fitgear-live static export of the canonical build
  v4 (`workspace/your_files/fitgear-live/fitgear-live.html`, 3.4 MB,
  14 inlined assets, 0 unresolved). Each photo was opened and checked
  visually: it shows the correct equipment for its product. The dark
  name panel stays only as a fallback if a photo fails to load. No
  stock photo was hotlinked as a product photo. All metadata was
  stripped from the extracted files (EXIF in about, hex dumbbell and
  treadmill photos; C2PA/JUMBF in hero and cable photos; ICC text,
  EXIF and orientation chunks in the kettlebell PNG) and a byte scan
  after stripping found no EXIF, IPTC, XMP or C2PA metadata in any
  of the 14 files. Two honest notes: the cable crossover photo shows
  a MATRIX brand mark on the machine itself, and the rower photo
  shows a person using the machine. The static copy photos are the
  builder reproduction of canonical v4; they could not be byte
  compared against the fullstack artifact internals, because reading
  artifact source directly is not allowed.
- Facts come only from the Resources PDF
  (`workspace/your_files/fitgear-resources-v1/fitgear-resources-v1.pdf`).
  Contact details are placeholders, Not provided yet, shown on the
  Contact page as "to be added soon (placeholder)". No reviews,
  ratings, prices or client details were invented.
- No colour, layout or wording was redesigned. The palette is matte
  black with volt green, thin volt outlines, the hero is RISE AND
  GRIND, EQUIP YOUR DRIVE, with SHOP NOW, and the 7 pages and 12
  products are exactly as picked in Design 08.

## Products

Canonical FitGear products have no size or variant options. Each
product is one fixed configuration at one fixed PKR price, with a
quantity stepper from 1 to 50, Add to Cart and Buy Now, and a
Specifications list. The rebuild uses one valid variant per product,
"Standard", and the server validates it.

| Product | Category | Price (PKR) |
|---|---|---|
| Volt Adjustable Dumbbell 24 kg | Free Weights | 58,500 |
| Stride Treadmill T900 | Cardio | 189,000 |
| Forge Power Rack Pro | Strength | 145,000 |
| Hex Dumbbell Pair 10 kg | Free Weights | 18,500 |
| Olympic Barbell 20 kg | Strength | 42,500 |
| Cast Iron Kettlebell Set 4 to 24 kg | Free Weights | 32,900 |
| Flex Adjustable Bench | Strength | 38,500 |
| Air Rower Glide Pro | Cardio | 98,500 |
| Volt Spin Bike S2 | Cardio | 74,500 |
| Colour Bumper Plate Set 150 kg | Free Weights | 89,500 |
| Cable Crossover Home Station | Strength | 165,000 |
| Glide Elliptical Cross Trainer | Cardio | 112,000 |

Tags from the canonical build: Volt Adjustable Dumbbell 24 kg is
Best Seller, Stride Treadmill T900 is New. Featured products are
those two plus Forge Power Rack Pro and Hex Dumbbell Pair 10 kg.
Short lines and descriptions in the seed file only restate the
product name and category, except for three specification details
that came from the canonical inspection: the adjustable dumbbell
covers 2.5 kg to 24 kg in 10 settings, the kettlebell set contains
4, 8, 10, 16, 20 and 24 kg bells, and the bumper plate set contains
pairs of 5, 10, 15, 20 and 25 kg.

## Backend

- MySQL only, through the `mysql2` driver. Tables in `db/schema.sql`:
  products, orders, order_items, subscribers, messages, admins, sessions.
  The tables are created automatically on first start, and the 12
  products are seeded from `db/seed-products.json` when the products
  table is empty. Orders, subscribers, messages and admins start empty
  in production.
- Order placement: the server reads prices from the database and
  computes the total itself. A price sent by the browser is ignored.
  Order numbers are FG-1001, FG-1002 and so on.
- Shipping: PKR 1,500, free on orders of PKR 50,000 or more. This
  rule is an assumption, not a verified canonical fact. The canonical
  probe showed free shipping on an order of PKR 98,500 and PKR 1,500
  shipping on an order of PKR 32,900. The exact free shipping
  threshold was not recorded, so this rebuild uses PKR 50,000.
- Newsletter and contact messages are saved to the database.
- Admin Panel at `/admin.html`, linked from the site footer and the
  account icon. First use the owner sets her own admin email and
  password (minimum 8 characters). Passwords are salted with scrypt,
  never stored in plain text. Sign in returns a session token that
  lives for 30 days. Wrong passwords are rejected. The panel shows
  live stats (Orders, Revenue, Messages, Subscribers) and Orders,
  Messages and Subscribers tabs. Order status (New, Confirmed,
  Dispatched, Delivered, Cancelled) and message status (New, Read,
  Replied) can be changed and the change persists.

## API

- `GET /api/health`
- `GET /api/products` and `GET /api/products/:id`
- `POST /api/orders` with customerName, email, phone, address, city,
  notes, paymentMethod and items (productId, variant, qty). Returns
  orderNumber, subtotal, shipping and total.
- `POST /api/newsletter` with email.
- `POST /api/contact` with name, subject and message.
- `GET /api/admin/status`, `POST /api/admin/setup`, `POST /api/admin/signin`,
  `POST /api/admin/signout`
- `GET /api/admin/data` (Bearer token), `PATCH /api/admin/orders/:id`,
  `PATCH /api/admin/messages/:id` (Bearer token)

## Environment variables

No credential is hardcoded anywhere. Set these in the environment:

| Variable | Value |
|---|---|
| PORT | Port to listen on. Hostinger sets this. Local default 3000. |
| DB_HOST | MySQL host. On Hostinger use 127.0.0.1, not localhost. |
| DB_PORT | MySQL port. 3306. |
| DB_USER | MySQL user. |
| DB_PASSWORD | MySQL password. |
| DB_NAME | MySQL database name. |

Copy `.env.example` to `.env` for local runs and fill in real values.
Never commit `.env`.

## Run locally

1. Install Node 18 or newer, and MySQL or MariaDB.
2. Create the database and a user, for example:
   `CREATE DATABASE fitgear;`
   `CREATE USER 'fitgear'@'127.0.0.1' IDENTIFIED BY 'a-strong-password';`
   `GRANT ALL PRIVILEGES ON fitgear.* TO 'fitgear'@'127.0.0.1';`
3. `npm install`
4. Set the environment variables in `.env` or the shell.
5. `node server.js`, then open http://127.0.0.1:3000
6. `node scripts/verify.js` runs the end to end API check. It needs
   the server running.
7. `node scripts/dom-check.js` runs the DOM execution check with
   jsdom against the running server. It needs jsdom installed
   locally (`npm install jsdom --no-save`).

## Deploy to Hostinger (next step, not done yet)

1. Push this folder to a GitHub repository named
   `fitgear-backend-rebuild`. Never commit `.env`. Note: the Muse
   GitHub App cannot create a repository in a personal user account
   (403 Resource not accessible by integration, seen on the
   Threadora deploy). The Owner must create the empty public repo
   under zaidisyeda02-dev first (no README, .gitignore or license
   at creation) and grant the Muse GitHub App access at
   https://github.com/apps/meta-muse-ai/installations/new, then the
   push can go ahead.
2. In Hostinger hPanel create a new Web App website on a new temp domain.
   Do not overwrite any existing live site. Use Node version 22.
3. Deploy from the GitHub repository. Build command: `npm install`.
   Entry file: `server.js`. Start command: `node server.js`.
4. In hPanel create a MySQL database and user, then create the tables
   with `db/schema.sql` (the app also creates them on first start).
5. Set the environment variables in the Web App settings: DB_HOST
   127.0.0.1, DB_PORT 3306, DB_USER, DB_PASSWORD, DB_NAME, and PORT
   if Hostinger asks for it. Never put credentials in the code.
6. Restart the app, open the live URL and verify every page, a full
   order, newsletter, contact, admin setup and sign in, at desktop and
   phone widths, before sending any link.

## Verification, done locally on 18 and 19 November 2026

- API check `node scripts/verify.js`: 50 checks, 0 failed, including
  all 12 product photos and the hero and about photos serving 200.
- DOM execution check `node scripts/dom-check.js` (jsdom, real
  app.js against the running server): 32 checks, 0 failed, including
  the hero photo, 12 product photos on shop cards and the Forge photo
  on its detail page.
- Real rendered browser check `node scripts/browser-check.js`
  (Chrome for Testing 158 over CDP, 8 pages at 390px and 1280px):
  16 page checks, 0 failed. scrollWidth equals the viewport on
  every page at both widths, zero console errors and zero failed
  requests except Google Fonts, which the sandbox proxy blocks
  (expected; fallback fonts render). Screenshots and results.json
  in `browser-check-2026-11-18/`. The 390px home and Forge detail
  screenshots were opened and checked: the hero photo shows behind
  the hero text, the Forge photo fills the detail page, and the
  featured cards show the Volt dumbbell and treadmill photos.
- Photo step, done 19 November 2026: the fitgear-live static copy
  (artifact fitgear-live) was built as an exact static copy of
  canonical v4 and exported to
  `workspace/your_files/fitgear-live/fitgear-live.html`. Its 14
  photos were extracted into `public/images/`, wired into
  `db/seed-products.json` and `public/app.js` (shop cards, detail
  pages, cart thumbnails, hero background, About photo), and the
  checks above were re-run with the photos in place.
- Test sequencing note: each check script assumes a clean database.
  Running dom-check.js after verify.js on the same database fails at
  the admin dashboard step, because verify.js already created an
  admin account and first use setup is then refused. That is a test
  sequencing issue, not a product defect. Each script was re-run on
  a freshly created database for the counts above.
- Two real defects were found and fixed during verification, both
  in `public/styles.css` only, no colour, layout or wording change:
  product grids used `1fr` tracks, which made the 2-column grid
  2px too wide at 390px (now `minmax(0, 1fr)`, cards `min-width: 0`,
  card buttons stack full width below 480px); the header row was
  451px wide at 390px and pushed the Bag button off screen (now
  tightened on phones only, all five header controls stay visible).
- After verification all local test data was cleared: local database
  holds 12 products and 0 orders, 0 subscribers, 0 messages and
  0 admins, admin status hasAdmin false. No `.env` is left in the
  project folder.

## Known items

- One image is over about 500 KB: `cast-iron-kettlebell-set-4-to-24kg.png`
  (533,656 bytes after metadata stripping). It is the photo from the
  fitgear-live export, kept as is. It is worth compressing in a later
  optimisation pass.
- The shop cart is kept in the browser for the visit only, as in the
  canonical build. Orders are saved to the database at checkout.
- The free shipping threshold of PKR 50,000 is a rebuild choice,
  not a verified canonical fact. See the shipping note above.
- No live backend exists yet. This project has only been run and
  verified locally.
