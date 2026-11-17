import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:rentmate/main.dart';
import 'package:rentmate/home.dart';
import 'package:rentmate/state.dart';
import 'package:rentmate/strings.dart';
import 'package:rentmate/ui.dart';
import 'package:rentmate/tour.dart';

class MemoryPersistence implements Persistence {
  String? server;
  @override
  Future<String?> serverUrl() async => server;
  @override
  Future<void> saveServerUrl(String value) async {
    server = value;
  }

  String? saved;
  final Map<String, Json> rows = {};
  @override
  Future<String?> session() async => saved;
  @override
  Future<void> saveSession(String? value) async {
    saved = value;
  }

  @override
  Future<Json?> cached(String account) async => rows[account];
  @override
  Future<void> cache(String account, Json value) async {
    rows[account] = value;
  }

  @override
  Future<void> clear() async {
    rows.clear();
    saved = null;
  }
}

const user = {
  'id': 'user-one',
  'name': 'Anna',
  'email': 'anna@example.test',
  'phone': '0771234567',
  'role': 'TOURIST',
  'status': 'APPROVED',
};
const trip = {
  'id': 'trip-one',
  'pickup': 'Mirissa',
  'destination': 'Ella',
  'starts_at': '2027-01-12T06:00:00+05:30',
  'ends_at': '2027-01-12T10:00:00+05:30',
  'status': 'OPEN',
  'vehicle_type': 'VAN',
  'passengers': 3,
};
AppState stateWith(
  Future<http.Response> Function(http.Request) handle, {
  Json account = user,
  MemoryPersistence? persistence,
}) {
  final api = AppState(
    persistence: persistence ?? MemoryPersistence(),
    client: MockClient(handle),
  );
  api.ready = true;
  api.user = {...account};
  api.token = 'test-token';
  return api;
}

http.Response response(dynamic data, {int status = 200}) =>
    http.Response(jsonEncode({'data': data}), status);
Future<void> show(WidgetTester tester, AppState api, Widget page) async {
  await tester.pumpWidget(
    ChangeNotifierProvider.value(
      value: api,
      child: MaterialApp(theme: ThemeData(useMaterial3: true), home: page),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(Strings.load);
  test('money input uses exact minor units', () {
    expect(parseMinor('150.09'), 15009);
    expect(parseMinor('0.1'), 10);
    expect(() => parseMinor('1.001'), throwsFormatException);
  });
  test('offline cache strips contacts, documents and financial data', () async {
    final store = MemoryPersistence();
    bool online = true;
    final api = stateWith((r) async {
      if (!online) throw const SocketException('offline');
      return response([
        {
          ...trip,
          'tourist_phone': 'private',
          'commission_minor': '999',
          'notes': 'private note',
          'driver_card': {'phone': 'private'},
        },
      ]);
    }, persistence: store);
    await api.tours();
    final encoded = jsonEncode(store.rows);
    expect(encoded, isNot(contains('private')));
    expect(encoded, isNot(contains('commission')));
    online = false;
    final cached = await api.tours();
    expect(api.offline, true);
    expect(cached.single['destination'], 'Ella');
    expect(await store.cached('another-account'), null);
    await api.logout();
    expect(store.rows, isEmpty);
    expect(api.token, null);
  });
  test('401 clears stored session and cache', () async {
    final store = MemoryPersistence();
    store.saved = 'session';
    store.rows['user-one'] = {'tours': []};
    final api = stateWith(
      (r) async => http.Response(
        jsonEncode({
          'error': {'message': 'Expired', 'code': 'SESSION_EXPIRED'},
        }),
        401,
      ),
      persistence: store,
    );
    await expectLater(api.request('/me'), throwsA(isA<ApiError>()));
    expect(api.user, null);
    expect(store.rows, isEmpty);
    expect(store.saved, null);
  });
  testWidgets('welcome supports role choice and validates login fields', (
    tester,
  ) async {
    final api = stateWith((r) async => response(null));
    api.user = null;
    api.token = null;
    await tester.pumpWidget(
      ChangeNotifierProvider.value(value: api, child: const RentMateApp()),
    );
    await tester.pumpAndSettle();
    expect(find.text(tr('tourist')), findsOneWidget);
    await tester.tap(find.text(tr('driver')));
    await tester.pumpAndSettle();
    await tester.tap(find.text(tr('login')).first);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, tr('login')));
    await tester.pumpAndSettle();
    expect(find.text(tr('required')), findsNWidgets(2));
  });
  testWidgets('role navigation routes tourist, agent, driver and admin', (
    tester,
  ) async {
    for (final entry in {
      'TOURIST': 'agents',
      'AGENT': 'dashboard',
      'DRIVER': 'feed',
      'ADMIN': 'verification',
    }.entries) {
      final api = stateWith(
        (r) async => response([]),
        account: {...user, 'role': entry.key},
      );
      await show(tester, api, HomeShell(key: ValueKey(entry.key)));
      expect(find.text(tr(entry.value)), findsWidgets);
      expect(find.byType(NavigationBar), findsOneWidget);
    }
  });
  testWidgets('pending driver sees approval state and profile route', (
    tester,
  ) async {
    final api = stateWith(
      (r) async => response([]),
      account: {...user, 'role': 'DRIVER', 'status': 'PENDING'},
    );
    await show(tester, api, const HomeShell());
    expect(find.text(tr('pendingTitle')), findsOneWidget);
    expect(find.text(tr('pendingBody')), findsOneWidget);
    expect(find.text(tr('profile')), findsWidgets);
  });
  testWidgets(
    'agent browsing shows real response and request form submits to API',
    (tester) async {
      Json? submitted;
      final api = stateWith((r) async {
        if (r.method == 'POST') {
          submitted = jsonDecode(r.body);
          return response(trip, status: 201);
        }
        return response([
          {
            'id': 'agent-one',
            'name': 'Agent',
            'agency_name': 'Ceylon Trails',
            'location': 'Galle',
            'verified': true,
            'completed_trips': 7,
          },
        ]);
      });
      await show(tester, api, const Scaffold(body: AgentsPage()));
      expect(find.text('Ceylon Trails'), findsOneWidget);
      await tester.tap(find.text(tr('requestTour')));
      await tester.pumpAndSettle();
      final fields = find.byType(TextFormField);
      await tester.enterText(fields.at(0), 'Mirissa');
      await tester.enterText(fields.at(1), 'Ella');
      for (final name in ['starts_at', 'ends_at']) {
        final field = find.byKey(ValueKey('field_$name'));
        await tester.ensureVisible(field);
        await tester.pumpAndSettle();
        await tester.tap(field);
        await tester.pumpAndSettle();
        expect(find.byType(DatePickerDialog), findsOneWidget);
        await tester.tap(find.text('OK', skipOffstage: false).last);
        await tester.pumpAndSettle();
        await tester.tap(find.text('OK', skipOffstage: false).last);
        await tester.pumpAndSettle();
      }
      final submit = find.widgetWithText(FilledButton, tr('sendRequest'));
      await tester.ensureVisible(submit);
      await tester.tap(submit);
      await tester.pumpAndSettle();
      expect(submitted?['pickup'], 'Mirissa');
      expect(submitted?['agent_id'], 'agent-one');
    },
  );
  testWidgets('tour list shows status and route; offline banner is visible', (
    tester,
  ) async {
    final store = MemoryPersistence();
    store.rows['user-one'] = {
      'updated': '2026-10-17T10:00:00Z',
      'tours': [trip],
    };
    final api = stateWith(
      (r) async => throw const SocketException('offline'),
      persistence: store,
    );
    await show(
      tester,
      api,
      const Scaffold(
        body: Column(
          children: [
            OfflineBanner(),
            Expanded(child: ToursPage()),
          ],
        ),
      ),
    );
    expect(find.text('Mirissa → Ella'), findsOneWidget);
    expect(find.textContaining(tr('offline')), findsOneWidget);
    await tester.tap(find.text('Mirissa → Ella'));
    await tester.pumpAndSettle();
    expect(find.text(tr('offlineDetail')), findsOneWidget);
  });
  testWidgets('driver selection posts selected driver and returns', (
    tester,
  ) async {
    Json? body;
    final api = stateWith((r) async {
      if (r.method == 'POST') {
        body = jsonDecode(r.body);
        return response({'assignment_id': 'a'});
      }
      return response([
        {
          'driver_id': 'driver-one',
          'card': {'name': 'Dilshan', 'completed_trips': 4, 'cancellations': 0},
        },
      ]);
    }, account: {...user, 'role': 'AGENT'});
    await show(tester, api, const DriverSelection(id: 'trip-one'));
    expect(find.text('Dilshan'), findsOneWidget);
    await tester.tap(find.text(tr('select')));
    await tester.pumpAndSettle();
    expect(body?['driver_id'], 'driver-one');
  });
  testWidgets('loading and server error states offer retry', (tester) async {
    bool broken = true;
    final api = stateWith((r) async {
      await Future<void>.delayed(const Duration(milliseconds: 100));
      if (broken) {
        return http.Response(
          jsonEncode({
            'error': {'message': 'Service unavailable', 'code': 'UNAVAILABLE'},
          }),
          503,
        );
      }
      return response([]);
    });
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: api,
        child: const MaterialApp(home: Scaffold(body: AgentsPage())),
      ),
    );
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    await tester.pumpAndSettle();
    expect(find.text('Service unavailable'), findsOneWidget);
    broken = false;
    await tester.tap(find.text(tr('retry')));
    await tester.pumpAndSettle();
    expect(find.text(tr('emptyAgents')), findsOneWidget);
  });
}
