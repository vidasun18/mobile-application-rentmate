# Use a phone as the RentMate server

Built on 19 October 2026. Android 8.0 or newer is required. This testing build passed native compilation and automated tests; actual phone hosting still needs the checks below.

1. Copy `deliverables/RentMate-server-debug.apk` to the phone that will host the database and install **RentMate Server**. The universal APK is about 302 MB.
2. Install `deliverables/RentMate-phone-debug.apk` (the normal RentMate client, version 0.1.1) on each phone that will use the app. Both apps can be installed on the host phone.
3. Connect all phones to the same Wi-Fi, or enable the host phone's hotspot and connect the other phones to it.
4. Open **RentMate Server**, allow notifications and tap **Start server**. Wait for **Server running**. Keep its running notification visible.
5. In the normal RentMate client, open **Server connection**. On the host phone, enter `http://127.0.0.1:3000`. On other phones, enter a Wi-Fi/hotspot address displayed by RentMate Server. Tap **Test connection**, then **Save connection**.
6. Tap **Show administrator login** in RentMate Server. Sign in to the client using the displayed `admin@rentmate.local` email and generated password. Other users register in the client; the administrator approves drivers and agents.

The phone creates its own persistent database. Laptop accounts/bookings are separate and are not copied automatically. Once installed, the laptop is not needed for hosting.

## Check hosting

* From another phone's browser, open the displayed address with `/health` added. Expect JSON containing `status: ok`.
* Register a test user, stop/start the server and confirm that login still works.
* With the host phone's screen off, test health and login from the other phone. Check the host app's battery settings if Android restricts background operation. Force-stop or reboot requires opening RentMate Server and tapping Start again.
* After switching Wi-Fi/hotspot, use the newly displayed server address in the clients.

Keep the host phone powered while hosting. If a network prevents devices from communicating, try the host phone's hotspot. Stop the server before using **Export backup**, uninstalling or clearing its app data.
