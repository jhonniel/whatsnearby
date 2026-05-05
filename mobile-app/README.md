# MyLocation Mobile Wrapper (Expo + EAS)

This is a native app wrapper for the deployed MyLocation web app using `react-native-webview`.

## 1) Configure the hosted web URL

Edit `app.json`:

- `expo.extra.webAppUrl` -> your deployed app URL (example: `https://mylocation.vercel.app`)

## 2) Configure app IDs before store builds

Edit `app.json`:

- `expo.ios.bundleIdentifier` -> e.g. `com.jhanniel.mylocation`
- `expo.android.package` -> e.g. `com.jhanniel.mylocation`

## 3) Run locally

```bash
npm install
npm run start
```

## 4) Build with EAS

```bash
npm run eas:login
npm run eas:build:android
# or
npm run eas:build:ios
```

## Notes

- The app currently loads your web app in a WebView.
- Any updates to your deployed web app appear in mobile without rebuilding, unless native config changes.
