# Open Card

A free, offline collection of classic card games played with a standard 52-card deck, built as an Android app. It has no ads and no accounts, and every game comes with a step-by-step tutorial.

## Games

| Solitaire | Casino | Versus Computer |
|---|---|---|
| Klondike (draw 1 / draw 3) | Blackjack (with basic-strategy hints) | Texas Hold'em (you + 3 players) |
| FreeCell | Video Poker (Jacks or Better) | Hearts (you + 3 players) |
| Spider (1, 2 or 4 suits) | | Crazy Eights (1–3 opponents) |
| Pyramid | | Go Fish (1–3 opponents) |
| Golf | | War |
| | | Tong-its (you + 2 players) |

Features:
- **How to play** tutorials for every game, available from the menu or the **?** button in a game
- Drag-and-drop or tap-to-move for solitaire games, plus unlimited **Undo** and **Hint**
- Statistics per game (played, won, streaks)
- Pixel (8-bit) look throughout: blocky cards, pixel-art suits and retro fonts
- Original 8-bit background music, synthesised on the device. The ♪ button on every screen toggles it, and the volume is in Settings
- Settings: card back, table colour, four-colour suits, solitaire auto-play, computer speed
- Works fully offline

## Installing on Android

1. On your Android device, open the repository's **Releases** page:
   `https://github.com/JimTheFatJam/claude-open-card/releases/latest`
2. Tap **OpenCard.apk** to download it.
3. Open the downloaded file. If Android asks, allow your browser or file manager to **install unknown apps**.
4. Tap **Install**, then open **Open Card**.

New versions install over the old one, and your statistics are kept.

## Credits

The pixel style uses the *Press Start 2P* and *VT323* fonts, both under the SIL Open Font License (see `app/src/main/assets/www/fonts/`).

## How it's built

- `app/src/main/assets/www/` holds the whole game in plain HTML, CSS and JavaScript, with no build step.
  - `js/core.js` is the card model, table renderer, touch/drag input, dialogs, storage and poker hand evaluator.
  - `js/music.js` is the chiptune background music (Web Audio pulse/triangle/noise channels).
  - `js/app.js` is the menu, game screen, settings, statistics and back-button handling.
  - `js/solitaire.js` is the shared undo/timer/hint base for the solitaire games.
  - `js/games/*.js` has one file per game, with its rules engine, computer AI and tutorial.
- `app/src/main/java/com/opencard/app/MainActivity.java` is a small full-screen WebView wrapper.
- `tools/make_icon.py` generates the pixel-art launcher icon and home-screen logo.
- `.github/workflows/build-apk.yml` builds a signed APK on every push and publishes it as a GitHub Release.

### Try it in a browser

```sh
cd app/src/main/assets/www
python3 -m http.server 8000
# open http://localhost:8000
```

### Build the APK yourself

Requires JDK 17+ and the Android SDK:

```sh
./gradlew assembleRelease
# output: app/build/outputs/apk/release/app-release.apk
```

### Signing

Release builds are signed in GitHub Actions. The signing key is **never stored in the repository**.

- **Permanent key (recommended):** add three repository secrets under *Settings → Secrets and variables → Actions*:
  - `OPENCARD_KEYSTORE_B64` holds the release keystore, base64-encoded.
  - `OPENCARD_KEYSTORE_PASSWORD` holds the keystore and key password.
  - `OPENCARD_KEY_ALIAS` holds the key alias (`opencard`).

  The workflow checks them before building and fails with a clear error if one is wrong. Keep a private backup of the keystore file and password. Without them, future updates can't install over the app.
- **Fallback:** with no secrets, the workflow generates a temporary key and keeps it in the GitHub Actions cache. GitHub deletes cache entries unused for 7 days, which would change the signature.

Each build log prints the signing certificate's SHA-256 fingerprint, so you can confirm which key was used. Switching keys changes the app's signature, so the app must be uninstalled once (clearing its stats) before the new build will install.
