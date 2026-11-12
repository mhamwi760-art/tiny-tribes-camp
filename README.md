# Tiny Tribes Kids Camp website

A fast static website built with three languages only: **HTML**, **CSS** and **JavaScript**. No frameworks and no build step.

## Pages
- `index.html`: home page with activity categories, Winter and Summer program cards, about, and a contact form
- `gallery.html`: photo gallery, filtered by activity (`gallery.html?c=splash-day`), with a swipeable photo viewer
- `program.html`: Winter Camp (interactive falling snow, follows the mouse/finger and phone tilt) and Summer Camp (moving sun)
- `register.html`: registration form (program, parent details, up to 5 children, option, live total)
- `payment.html`: payment page with order summary (demo mode, no money is charged yet)
- `dashboard.html`: staff dashboard for orders, messages, programs and prices, and photos (not linked from the site)

## Folders
- `css/style.css`, `css/dashboard.css`: styling, brand colors as variables at the top
- `js/data.js`: default content (programs, prices, photo lists)
- `js/store.js`: the one place that saves and loads data; swap it for an online database to go live
- `js/main.js`: public page behaviour; `js/effects.js`: snow and sun; `js/dashboard.js`: dashboard
- `assets/img/gallery/`: photos by category
- `assets/fonts/`: put the Wonky Font here as `WonkyFont.woff2`, then uncomment the @font-face block at the top of css/style.css

## Run it locally
Open the folder in VS Code, install the recommended **Live Server** extension, then right-click `index.html` and choose **Open with Live Server**.

## Still to connect
- **Payment:** `payment.html` is a mock-up. Connecting KNET or cards needs a payment provider (for example Tap or MyFatoorah) and a small server to create the payment securely. The spot to change is marked `DEMO ONLY` in `js/main.js`.
- **Dashboard data:** in demo mode orders, messages, prices and photos are saved only in the browser being used. To receive real orders from clients and publish changes for everyone, connect `js/store.js` to an online database with a login (for example Supabase).

## Hosting on GitHub Pages
Push this folder to a GitHub repository, then go to the repository's **Settings → Pages** and pick the `main` branch and the `/ (root)` folder.
