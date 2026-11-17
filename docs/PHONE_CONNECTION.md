# Physical phone connection — 19 October 2026

The original debug APK was compiled for an Android emulator at `http://10.0.2.2:3000`. A physical phone cannot use that address to reach the laptop. Its login request failed before the API could check the password, and the app incorrectly displayed its saved-trip/offline description on the Sign in form.

Diagnosis in this session:

* The existing laptop API is healthy and listening on `0.0.0.0:3000`.
* The laptop's current Wi-Fi IPv4 address is `10.55.155.44`.
* The user confirmed the phone browser can open `http://10.55.155.44:3000/health` and receive `status: ok`.
* The generated administrator credentials successfully logged in through the running API. The password was not printed or reset.
* No firewall changes or database changes were needed. No USB debugging device was connected.

## Install and sign in

1. Keep the laptop terminal running `npm.cmd run local`.
2. Transfer the new **`deliverables/RentMate-phone-debug.apk`**, version **0.1.1 (2)**, to the phone and install it over the previous debug app. The older `RentMate-debug.apk` is the original emulator build.
3. Open RentMate → **Server connection**. Set `http://10.55.155.44:3000`, tap **Test connection**, then **Save connection**. Do not append `/health` in the app. This build already uses that address as its initial default.
4. Choose **Administrator** and sign in with `admin@rentmate.example.test` and its existing generated password from `.local/demo-accounts.json`.

If the laptop joins another network or receives a new address, use its current Wi-Fi IPv4 address from `ipconfig`. Confirm `/health` in the phone browser, then update Server connection. `127.0.0.1` on the phone refers to the phone itself; `10.0.2.2` is an emulator bridge.

## Implemented fix and verification

The welcome and Sign in/Create account pages now provide a persistent server setting and an unauthenticated health test. Failed sign-in connections identify the attempted address and explain how to reconnect. Changing servers clears the old session and cached account data. Sessions record their server address; health probes never send credentials, and a delayed old-server login cannot complete after switching servers. The connection setting survives sign-out and app restart. Release settings require HTTPS.

Seven new regression tests cover this behavior, including a widget journey from Sign in → change server → administrator login. The full Flutter suite passes **24 tests**. The phone browser result verifies network reachability; installation and login in the rebuilt app still require the user's on-phone check.
