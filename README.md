# ChiliQ

A restaurant ordering prototype with three customer modes and a staff dashboard:
- **Dine-in**: pick any table number, order, and track a live "New → Accepted → Preparing → Ready" ticket.
- **Pre-order for pickup**: order while you're on your way — pick your arrival time, pay upfront (mock payment), and the kitchen times it to be ready exactly when you walk in. No address needed; this is takeaway, not delivery.
- **Delivery**: enter your address, choose ASAP or a scheduled time slot, and track "New → Accepted → Preparing → Out for delivery → Delivered".
- **Staff dashboard**: a kanban-style board where staff accept new orders and advance them stage by stage — for any of the three modes. Accepting/advancing an order updates the customer's ticket live.

No backend, no external database. The menu lives in `menu.json` (plain data file).
All orders are stored as one JSON array in the browser's `localStorage` — and the
browser's built-in `storage` event is what makes the staff dashboard and the
customer's ticket sync live across two open tabs, with zero server involved.

## How the "accept order" flow works
1. A customer places an order → it's saved with status `new`.
2. Open the staff dashboard — once hosted (see below), just visit `yoursite.com/admin/`,
   or use the "Restaurant staff? Open dashboard →" link on the customer landing screen →
   the order appears in the **New orders** column.
3. Staff clicks **Accept order** → it moves to **In the kitchen**, and the customer's ticket screen (in the other tab) instantly updates to "Accepted" — no refresh needed.
4. Staff advances it again (**Start preparing → Mark ready / Send for delivery → Mark served/picked up/delivered**) — each click updates both views live.

This works because both tabs are the same site reading/writing the same `localStorage`
key; the "storage" event is a standard browser feature, not anything Claude- or
server-specific — the same trick works once this is hosted on GitHub Pages too.

**Note:** this sync only works between tabs on the same browser/device (that's the
trade-off of having no real backend). For a real multi-device restaurant, staff on a
different phone/laptop than the customer would need an actual server — this prototype
demonstrates the workflow and UX, which is exactly what the lab asks for.

## Estimated wait time
The wait shown on the cart and ticket isn't just the slowest dish's cook time — it also
factors in how many orders are currently active in the kitchen (a real "queue"), and
gives **Express-only** orders a much smaller queue penalty, since the whole point of the
Express menu is to skip most of the line during peak hours. This directly demonstrates
the original design challenge: *"How might we reduce perceived and actual waiting time
during peak hours?"*

## File structure
```
index.html      → both the customer app and the staff dashboard (all screens)
style.css        → styling for both
app.js           → all app logic (customer flow, wait estimator, admin board)
menu.json        → menu data — 5 categories, 18 items total; edit here to change items/prices
manifest.json    → makes the customer app installable (PWA)
sw.js            → offline caching (required for install + APK packaging)
icons/           → app icons
admin/index.html → tiny redirector so staff can just visit yoursite.com/admin/
```

## 1. Run it locally first
Because it uses `fetch('menu.json')`, opening `index.html` directly from disk will fail in
some browsers (CORS on `file://`). Instead run a tiny local server from this folder:
```bash
python3 -m http.server 8000
```
Then open `http://localhost:8000` in your browser (customer app), and
`http://localhost:8000?staff=1` in a second tab (staff dashboard) to see the live sync.

## 2. Host it free on GitHub Pages
1. Create a new GitHub repository (e.g. `quickserve-app`).
2. Push all these files to the repo's `main` branch (root of the repo, not a subfolder).
3. On GitHub: **Settings → Pages → Source → Deploy from branch → main → / (root) → Save**.
4. After a minute, your app is live at:
   `https://<your-username>.github.io/<repo-name>/`
5. Staff can now go straight to `https://<your-username>.github.io/<repo-name>/admin/`
   to open the dashboard — no query string to remember. Add `?staff=1` in a second tab
   anytime you want the same view manually.
6. On your phone, your browser should offer **"Add to Home Screen" / "Install app"**
   for the customer app — no APK needed for this step.

## 3. Turn it into a real `.apk`
Building a native Android package needs Android Studio's SDK and Gradle, which isn't
something this chat environment has. The standard way to get an APK from a hosted PWA
**without installing that toolchain yourself** is [PWABuilder](https://www.pwabuilder.com)
(a free, official Microsoft tool built exactly for this):

1. Go to **pwabuilder.com**.
2. Paste your GitHub Pages URL from step 2 and click **Start**.
3. It will validate your manifest and service worker (already included here) — you should
   see green checks for "Installable" and "Service Worker".
4. Click **Package for stores → Android**.
5. Choose **Signing** → "Create a new signing key" if you don't have one yet (keep the
   generated `.keystore` file safe — you'll need it for future updates).
6. Download the generated `.apk` (or `.aab` if you plan to publish to the Play Store).
7. Install the `.apk` on an Android phone (enable "Install from unknown sources" if asked)
   to demo it as a real installed app.

This gives you a genuine installable Android app backed by the same code, with zero native
build setup on your end. (The staff dashboard is meant to be opened in a mobile/desktop
browser tab by restaurant staff — it isn't part of the customer-facing installed app.)

## Customizing for your lab presentation
- Edit `menu.json` to match your team's chosen restaurant concept/name, or add more items.
- Change the palette in `style.css` (`:root` variables at the top) if you want a different look.
- Adjust `QUEUE_PENALTY_MAIN`, `QUEUE_PENALTY_EXPRESS`, and `DELIVERY_TRAVEL_MIN` in
  `app.js` if you want the wait-time math to feel different.
- The full flow (dine-in ticket, delivery stepper, staff accept/advance) is your
  "Prototype" — test it with real people first, then note what you changed for the
  "Improved Prototype" slide.

