# RentMate Android

See the repository root README for the one-command local SQLite/file-storage API (`npm.cmd run local` in `backend`). PostgreSQL is optional. Requires Flutter stable and Android SDK/JDK 21. Android minimum: API 26.

```powershell
flutter pub get
flutter run --dart-define=API_URL=http://10.0.2.2:3000
flutter analyze
flutter test
flutter build apk --debug
```

All screens use the REST API. Fictional demo accounts are generated into the real local database on first launch; passwords are in the ignored `.local/demo-accounts.json`. Product strings are in `assets/strings.json`. Provider holds session state; tokens use flutter_secure_storage. Hive stores account-scoped route/status summaries with a read-only offline detail view. Writes require a connection. See the root README for optional Firebase and release HTTPS/keystore requirements.

On a physical phone, open **Server connection** before signing in and save the laptop's reachable Wi-Fi address, e.g. `http://192.168.1.10:3000`. First test `http://192.168.1.10:3000/health` in the phone browser. `10.0.2.2` is for emulators only. The connection page tests health without sending account credentials. Changing servers clears the old session/cache; saved sessions include their server address to prevent token reuse across servers.
