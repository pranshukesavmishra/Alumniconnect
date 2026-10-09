# Android app (Trusted Web Activity)

The Android app is the same website, wrapped as a **Trusted Web Activity (TWA)**: Chrome runs it full screen with no
address bar, sign-in with Google and LinkedIn works (it would be blocked inside a normal embedded web view), and
notifications, offline entry pass and updates all come from the website itself, so there is nothing to keep in sync.

You need: the live HTTPS site (see SETUP.md), a Google Play developer account (one-time US$25), and a computer with
Node 18+ and Java 17.

## 1. Build the package with Bubblewrap

```bash
npm i -g @bubblewrap/cli
mkdir jec-android && cd jec-android
bubblewrap init --manifest https://YOUR-SITE/manifest.webmanifest
```

Answer the questions (suggested): package name `in.ac.jecjabalpur.alumni` (it can never change later), app name
"JEC Alumni Connect", launcher name "JEC Alumni", start URL `/`, theme colour `#0b4a37`, background `#f6f5f1`.
Let Bubblewrap create a signing key and **back up `android.keystore` and its passwords somewhere safe and separate from
Drive and GitHub**: losing it means you can never update the app.

```bash
bubblewrap build        # creates app-release-bundle.aab (upload to Play) and app-release-signed.apk (test on a phone)
bubblewrap fingerprint  # prints the SHA-256 fingerprint of your signing key
```

## 2. Tell Android the site and the app belong together (removes the address bar)

Create `public/.well-known/assetlinks.json` in this repository, with the package name and the fingerprint from above
(if Play App Signing is on, also add the *Play* fingerprint from Play Console → Setup → App signing), then deploy:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "in.ac.jecjabalpur.alumni",
    "sha256_cert_fingerprints": ["AA:BB:...:FF"]
  }
}]
```

Check it opens at `https://YOUR-SITE/.well-known/assetlinks.json`. Install the `.apk` on a phone: if a thin address bar
shows, the file or fingerprint is wrong.

## 3. Publish in stages (never straight to everyone)

1. **Internal testing** (up to 100 testers, instant): upload the `.aab`, add the committee's Google accounts.
2. **Closed testing** with 20-50 real alumni across different phones (Android versions, low-end and flagship), for at least a
   week before the meet. Use the checklist in docs/TEST_PLAN.md and fix what they find.
3. Only then **production**, or a staged rollout (10% → 50% → 100%) so a problem reaches few people first.

Within each stage confirm sign-in, notifications and the entry pass, then promote. Prepare: 512×512 icon (`public/pwa-512.png`),
a feature graphic (1024×500), at least 2 phone screenshots, a short and full description, and the privacy policy link
`https://YOUR-SITE/privacy`. Under "Data safety" declare: name, email, phone, photos, messages and purchase info are
collected, encrypted in transit, and deletable on request.

## Notes

* Updates to the website reach the app immediately. You only rebuild the `.aab` to change the icon, package settings or
  to raise the target Android version when Play asks (about once a year).
* Push notifications use the website's Web Push, which Chrome-based TWAs support.
* iPhone users install from Safari: Share → Add to Home Screen (see the app's Install page). A native iOS app is not needed.
