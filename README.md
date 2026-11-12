# Tiny Tribes Kids Camp website

A fast static website built with three languages only: **HTML**, **CSS** and **JavaScript**. No frameworks and no build step.

## Pages
- `index.html`: home page with the camp activities, Winter Camp details, pricing, about and contact
- `register.html`: registration form (parent details, one or more children, camp option, live price summary)
- `payment.html`: payment page with order summary (demo mode, no money is charged yet)

## Folders
- `css/style.css`: all styling, with the brand colors as variables at the top
- `js/main.js`: all behaviour; camp dates, prices and age groups are in the `CAMP` settings at the top
- `assets/img/`: photos and logos
- `assets/fonts/`: put the Wonky Font file here as `WonkyFont.woff2`, `.otf` or `.ttf` and headings will use it automatically

## Run it locally
Open the folder in VS Code, install the recommended **Live Server** extension, then right-click `index.html` and choose **Open with Live Server**.

## Still to connect
- **Payment:** `payment.html` is a mock-up. Connecting KNET or cards needs a payment provider (for example Tap or MyFatoorah) and a small server to create the payment securely. The spot to change is marked `DEMO ONLY` in `js/main.js`.
- **Registrations:** right now they are only kept in the visitor's browser. They need to be sent somewhere (email, Google Sheet or a database).

## Hosting on GitHub Pages
Push this folder to a GitHub repository, then go to the repository's **Settings → Pages** and pick the `main` branch and the `/ (root)` folder.
