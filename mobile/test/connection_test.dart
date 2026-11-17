import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:rentmate/main.dart';
import 'package:rentmate/state.dart';
import 'package:rentmate/strings.dart';
import 'app_test.dart' as fixtures;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(Strings.load);
  test(
    'signed-out network failures identify the server instead of describing cached trips',
    () async {
      final api = AppState(
        persistence: fixtures.MemoryPersistence(),
        client: MockClient(
          (_) async => throw const SocketException('unreachable'),
        ),
      );
      await expectLater(
        api.authenticate({
          'email': 'admin@example.test',
          'password': 'test-only-password',
        }, false),
        throwsA(
          isA<OfflineError>()
              .having(
                (e) => e.message,
                'message',
                contains('http://10.0.2.2:3000'),
              )
              .having(
                (e) => e.message,
                'message',
                isNot(contains(tr('offlineDetail'))),
              ),
        ),
      );
    },
  );
  test(
    'changing servers checks health without credentials, removes old state and persists across logout/restart',
    () async {
      final store = fixtures.MemoryPersistence()..saved = 'old-session';
      store.rows['user-one'] = {
        'tours': [fixtures.trip],
      };
      final api = fixtures.stateWith((r) async {
        expect(r.url.toString(), 'http://192.168.1.20:3000/health');
        expect(r.headers.containsKey('Authorization'), false);
        expect(r.body, isEmpty);
        return fixtures.response({'status': 'ok'});
      }, persistence: store);
      await api.connectToServer(' http://192.168.1.20:3000/ ');
      expect(api.baseUrl, 'http://192.168.1.20:3000');
      expect(api.user, null);
      expect(api.token, null);
      expect(store.rows, isEmpty);
      expect(store.saved, null);
      api.offline = true;
      await api.logout();
      final restored = AppState(
        persistence: store,
        client: MockClient(
          (_) async => throw StateError('No session should be sent'),
        ),
      );
      await restored.restore();
      expect(restored.baseUrl, 'http://192.168.1.20:3000');
      expect(restored.user, null);
    },
  );
  test(
    'failed server health checks preserve the current connection and account',
    () async {
      final store = fixtures.MemoryPersistence()..saved = 'preserved';
      final api = fixtures.stateWith((r) async {
        expect(r.headers.containsKey('Authorization'), false);
        expect(r.followRedirects, false);
        return http.Response('<html>another service</html>', 200);
      }, persistence: store);
      await expectLater(
        api.connectToServer('http://192.168.1.20:3000'),
        throwsA(isA<ApiError>()),
      );
      expect(api.baseUrl, 'http://10.0.2.2:3000');
      expect(api.token, 'test-token');
      expect(store.saved, 'preserved');
      expect(store.server, null);
    },
  );
  test(
    'server addresses reject credentials, extra paths, malformed ports and non-HTTP schemes',
    () {
      for (final value in [
        '192.168.1.20:3000',
        'file:///tmp/test',
        'http://user:password@host:3000',
        'http://host:3000/health',
        'http://host:3000?token=private',
        'http://host:3000/#fragment',
        'http://host:abc',
        'http://host:70000',
      ]) {
        expect(
          () => AppState.normalizeServerUrl(value),
          throwsA(isA<ApiError>()),
          reason: value,
        );
      }
      expect(
        AppState.normalizeServerUrl(' https://rentmate.example.test/ '),
        'https://rentmate.example.test',
      );
    },
  );
  test(
    'a saved session from another server is cleared before making any request',
    () async {
      final store = fixtures.MemoryPersistence()
        ..server = 'http://192.168.1.20:3000';
      store.saved = jsonEncode({
        'token': 'old-token',
        'user': fixtures.user,
        'server_url': 'http://other-host:3000',
      });
      final api = AppState(
        persistence: store,
        client: MockClient(
          (_) async => throw StateError('Cross-server request'),
        ),
      );
      await api.restore();
      expect(api.user, null);
      expect(api.token, null);
      expect(store.saved, null);
      expect(store.server, 'http://192.168.1.20:3000');
    },
  );
  test(
    'a delayed login to the old server cannot sign in after changing servers',
    () async {
      final login = Completer<http.Response>();
      final api = AppState(
        persistence: fixtures.MemoryPersistence(),
        client: MockClient(
          (r) async => r.url.path == '/health'
              ? fixtures.response({'status': 'ok'})
              : login.future,
        ),
      );
      final pending = api.authenticate({
        'email': 'admin@example.test',
        'password': 'test-only-password',
      }, false);
      final rejected = expectLater(
        pending,
        throwsA(
          isA<ApiError>().having((e) => e.code, 'code', 'SERVER_CHANGED'),
        ),
      );
      await api.connectToServer('http://192.168.1.20:3000');
      login.complete(
        fixtures.response({'token': 'old-server-token', 'user': fixtures.user}),
      );
      await rejected;
      expect(api.user, null);
      expect(api.token, null);
    },
  );
  testWidgets(
    'phone user changes the server from Sign in then logs in as administrator',
    (tester) async {
      final api = AppState(
        persistence: fixtures.MemoryPersistence(),
        client: MockClient((r) async {
          if (r.url.path == '/health') {
            expect(r.headers.containsKey('Authorization'), false);
            return fixtures.response({'status': 'ok'});
          }
          if (r.url.path == '/auth/login') {
            expect(r.url.host, '192.168.1.20');
            return fixtures.response({
              'token': 'test-only-token',
              'user': {...fixtures.user, 'role': 'ADMIN'},
            });
          }
          return fixtures.response([]);
        }),
      )..ready = true;
      await tester.pumpWidget(
        ChangeNotifierProvider.value(value: api, child: const RentMateApp()),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text(tr('admin')));
      await tester.tap(find.text(tr('login')));
      await tester.pumpAndSettle();
      await tester.tap(find.text(tr('serverConnection')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('server_address')),
        'http://192.168.1.20:3000',
      );
      await tester.tap(find.text(tr('testConnection')));
      await tester.pumpAndSettle();
      expect(find.text(tr('serverConnected')), findsOneWidget);
      await tester.tap(find.text(tr('saveConnection')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('field_email')),
        'admin@example.test',
      );
      await tester.enterText(
        find.byKey(const ValueKey('field_password')),
        'test-only-password',
      );
      final submit = find.widgetWithText(FilledButton, tr('login'));
      await tester.ensureVisible(submit);
      await tester.tap(submit);
      await tester.pumpAndSettle();
      expect(api.role, 'ADMIN');
      expect(find.text(tr('verification')), findsWidgets);
      expect(tester.takeException(), null);
    },
  );
}
