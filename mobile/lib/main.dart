import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'strings.dart';
import 'state.dart';
import 'ui.dart';
import 'home.dart';
import 'connection.dart';

@pragma('vm:entry-point')
Future<void> backgroundMessage(RemoteMessage message) async {
  await initializeFirebase();
}

Future<FirebaseApp> initializeFirebase() {
  const key = String.fromEnvironment('FIREBASE_API_KEY');
  if (key.isEmpty) return Firebase.initializeApp();
  return Firebase.initializeApp(
    options: const FirebaseOptions(
      apiKey: key,
      appId: String.fromEnvironment('FIREBASE_APP_ID'),
      messagingSenderId: String.fromEnvironment('FIREBASE_SENDER_ID'),
      projectId: String.fromEnvironment('FIREBASE_PROJECT_ID'),
    ),
  );
}

final appNavigator = GlobalKey<NavigatorState>();
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Strings.load();
  await Hive.initFlutter();
  final state = AppState(
    persistence: DevicePersistence(
      await Hive.openBox<String>('trip_summaries'),
    ),
  );
  await state.restore();
  runApp(
    ChangeNotifierProvider.value(value: state, child: const RentMateApp()),
  );
}

class RentMateApp extends StatelessWidget {
  const RentMateApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    navigatorKey: appNavigator,
    title: tr('appName'),
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(seedColor: teal),
      scaffoldBackgroundColor: const Color(0xFFF3F7F8),
      appBarTheme: const AppBarTheme(
        backgroundColor: Color(0xFFF3F7F8),
        centerTitle: false,
      ),
      cardTheme: CardThemeData(
        color: Colors.white,
        elevation: 0,
        margin: const EdgeInsets.symmetric(vertical: 7),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: Colors.white,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xFFDCE4E7)),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: teal,
          minimumSize: const Size(48, 50),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(48, 48),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
    ),
    home: const SessionRoot(),
  );
}

class SessionRoot extends StatefulWidget {
  const SessionRoot({super.key});
  @override
  State<SessionRoot> createState() => _SessionRootState();
}

class _SessionRootState extends State<SessionRoot> {
  bool firebaseTried = false;
  String? configuredUser;
  StreamSubscription<RemoteMessage>? messages;
  StreamSubscription<String>? tokenRefresh;
  StreamSubscription<RemoteMessage>? openedMessages;
  void openPush(AppState state, RemoteMessage message) {
    final context = appNavigator.currentContext;
    if (context != null && state.user != null) {
      unawaited(
        openNotification(context, Map<String, dynamic>.from(message.data)),
      );
    }
  }

  void configurePush(AppState state) {
    final account = state.user?['id'] as String?;
    if (configuredUser != account) {
      configuredUser = account;
      firebaseTried = false;
      messages?.cancel();
      tokenRefresh?.cancel();
      openedMessages?.cancel();
      state.pushAvailable = false;
    }
    if (firebaseTried || state.token == null) return;
    firebaseTried = true;
    unawaited(() async {
      try {
        await initializeFirebase();
        FirebaseMessaging.onBackgroundMessage(backgroundMessage);
        final permission = await FirebaseMessaging.instance.requestPermission();
        if (![
          AuthorizationStatus.authorized,
          AuthorizationStatus.provisional,
        ].contains(permission.authorizationStatus)) {
          if (account == state.user?['id']) state.updatePushAvailability(false);
          return;
        }
        final token = await FirebaseMessaging.instance.getToken();
        if (account != state.user?['id']) return;
        if (token != null && state.token != null) {
          await state.request(
            '/notifications/push-token',
            method: 'POST',
            body: {'token': token},
          );
        }
        state.updatePushAvailability(token != null);
        openedMessages = FirebaseMessaging.onMessageOpenedApp.listen((message) {
          if (account == state.user?['id']) openPush(state, message);
        });
        final initial = await FirebaseMessaging.instance.getInitialMessage();
        if (initial != null && account == state.user?['id']) {
          openPush(state, initial);
        }
        tokenRefresh = FirebaseMessaging.instance.onTokenRefresh.listen((
          token,
        ) {
          if (state.token != null) {
            unawaited(
              state
                  .request(
                    '/notifications/push-token',
                    method: 'POST',
                    body: {'token': token},
                  )
                  .catchError((_) => null),
            );
          }
        });
        messages = FirebaseMessaging.onMessage.listen((message) {
          if (mounted && state.token != null) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(message.notification?.body ?? tr('alerts')),
                action: SnackBarAction(
                  label: tr('view'),
                  onPressed: () => openPush(state, message),
                ),
              ),
            );
          }
        });
      } catch (_) {
        if (account == state.user?['id']) state.updatePushAvailability(false);
      }
    }());
  }

  @override
  void dispose() {
    messages?.cancel();
    tokenRefresh?.cancel();
    openedMessages?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    configurePush(state);
    if (!state.ready) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (state.user == null) {
      if (state.sessionMessage != null) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          appNavigator.currentState?.popUntil((route) => route.isFirst);
        });
      }
      return const AuthPage();
    }
    return HomeShell(key: ValueKey(state.user!['id']));
  }
}

class AuthPage extends StatefulWidget {
  const AuthPage({super.key});
  @override
  State<AuthPage> createState() => _AuthPageState();
}

class _AuthPageState extends State<AuthPage> {
  String role = 'TOURIST';
  bool register = false;
  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 650),
            child: ListView(
              padding: const EdgeInsets.all(24),
              children: [
                HeroPanel(tr('appName'), subtitle: tr('tagline')),
                const SizedBox(height: 18),
                Text(tr('intro')),
                const SizedBox(height: 24),
                Text(
                  tr('continueAs'),
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 10,
                  runSpacing: 10,
                  children: [
                    for (final r in ['TOURIST', 'AGENT', 'DRIVER', 'ADMIN'])
                      ChoiceChip(
                        label: Text(tr(r.toLowerCase())),
                        selected: role == r,
                        onSelected: (_) => setState(() {
                          role = r;
                          if (role == 'ADMIN') register = false;
                        }),
                      ),
                  ],
                ),
                const SizedBox(height: 24),
                if (state.sessionMessage != null)
                  Text(
                    state.sessionMessage!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                FilledButton.icon(
                  onPressed: () async {
                    await formPage(
                      context,
                      tr(register ? 'register' : 'login'),
                      [
                        if (register) const FieldSpec('name', 'name'),
                        const FieldSpec('email', 'email', type: 'email'),
                        const FieldSpec(
                          'password',
                          'password',
                          type: 'password',
                        ),
                        if (register) const FieldSpec('phone', 'phone'),
                        if (register && role == 'AGENT')
                          const FieldSpec('agency_name', 'agencyName'),
                      ],
                      header: const ServerConnectionLink(),
                      submit: (b) => state.authenticate({
                        ...b,
                        if (register) 'role': role,
                      }, register),
                    );
                  },
                  icon: const Icon(Icons.login),
                  label: Text(tr(register ? 'register' : 'login')),
                ),
                if (role != 'ADMIN')
                  TextButton(
                    onPressed: () => setState(() => register = !register),
                    child: Text(tr(register ? 'login' : 'register')),
                  ),
                const ServerConnectionLink(),
                const SizedBox(height: 24),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(Icons.lock_outline, size: 18, color: teal),
                    const SizedBox(width: 10),
                    Expanded(child: Text(tr('agentControl'))),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
