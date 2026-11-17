import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:rentmate/home.dart';
import 'package:rentmate/history.dart';
import 'package:rentmate/strings.dart';
import 'package:rentmate/state.dart';
import 'package:rentmate/tour.dart';
import 'app_test.dart' as fixtures;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(Strings.load);
  testWidgets(
    'driver expresses interest directly from feed with one matching vehicle',
    (tester) async {
      var interested = false;
      var posts = 0;
      final api = fixtures.stateWith((r) async {
        if (r.url.path == '/vehicles') {
          return fixtures.response([
            {'id': 'vehicle-one', 'type': 'KDH', 'seats': 9, 'approved': true},
          ]);
        }
        if (r.method == 'POST') {
          posts++;
          expect(jsonDecode(r.body)['vehicle_id'], 'vehicle-one');
          interested = true;
          return fixtures.response({'interested': true});
        }
        return fixtures.response([
          {
            ...fixtures.trip,
            'interested': interested,
            'agent_id': 'agent-one',
            'agency_name': 'Ceylon Trails',
          },
        ]);
      }, account: {...fixtures.user, 'role': 'DRIVER'});
      await fixtures.show(tester, api, const Scaffold(body: ToursPage()));
      final button = find.widgetWithText(FilledButton, tr('interested'));
      await tester.ensureVisible(button);
      await tester.tap(button);
      await tester.pumpAndSettle();
      expect(posts, 1);
      expect(find.text(tr('interestSent')), findsWidgets);
      expect(find.byType(TourPage), findsNothing);
    },
  );
  testWidgets('Send shows private money summary and sends phone sharing off', (
    tester,
  ) async {
    Json? sent;
    final api = fixtures.stateWith((r) async {
      if (r.method == 'POST') {
        sent = jsonDecode(r.body);
        expect(r.headers['Idempotency-Key'], isNotEmpty);
        return fixtures.response({'sent': true});
      }
      return fixtures.response({
        'tourist_card': {
          'name': 'Dilshan',
          'verified': true,
          'completed_trips': 5,
        },
        'driver_card': {
          ...fixtures.trip,
          'payout_minor': '1200000',
          'tourist_first_name': 'Anna',
          'phone_if_authorized': 'private',
          'instructions': 'At reception',
        },
        'money': {
          'total_minor': '2000000',
          'deposit_minor': '500000',
          'payout_minor': '1200000',
          'commission_minor': '800000',
          'collector': 'DRIVER',
          'collection_minor': '1500000',
        },
      });
    }, account: {...fixtures.user, 'role': 'AGENT'});
    await fixtures.show(tester, api, const SendPage(id: 'trip-one'));
    await tester.scrollUntilVisible(
      find.text(tr('moneySummary')),
      250,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('8,000.00'), findsOneWidget);
    expect(
      tester.widget<SwitchListTile>(find.byType(SwitchListTile)).value,
      false,
    );
    final send = find.widgetWithText(FilledButton, tr('confirmSend'));
    await tester.ensureVisible(send);
    await tester.pumpAndSettle();
    await tester.tap(send);
    await tester.pumpAndSettle();
    expect(sent?['release_phone'], false);
  });
  testWidgets('agency application displays public vehicle and accepts driver', (
    tester,
  ) async {
    var accepted = false;
    final api = fixtures.stateWith((r) async {
      if (r.method == 'PATCH') {
        accepted = true;
        return fixtures.response({'saved': true});
      }
      return fixtures.response([
        {
          'id': 'membership',
          'status': accepted ? 'ACCEPTED' : 'PENDING',
          'profile': {
            'name': 'Dilshan',
            'vehicles': [
              {
                'model': 'Toyota KDH',
                'registration': 'ABC-123',
                'seats': 9,
                'approved': true,
                'photos': [],
              },
            ],
          },
        },
      ]);
    }, account: {...fixtures.user, 'role': 'AGENT'});
    await fixtures.show(tester, api, const Scaffold(body: MembershipPage()));
    expect(find.textContaining('Toyota KDH'), findsOneWidget);
    await tester.tap(find.text(tr('accept')));
    await tester.pumpAndSettle();
    expect(accepted, true);
    expect(find.text(tr('remove')), findsOneWidget);
  });
  testWidgets('history shows ended assignment and recorded withdrawal reason', (
    tester,
  ) async {
    final api = fixtures.stateWith((r) async {
      expect(r.url.path, '/me/history');
      return fixtures.response([
        {
          ...fixtures.trip,
          'outcome': 'WITHDRAWN',
          'withdrawal_reason': 'Vehicle repair',
        },
      ]);
    }, account: {...fixtures.user, 'role': 'DRIVER'});
    await fixtures.show(tester, api, const HistoryPage());
    expect(find.text('Vehicle repair'), findsOneWidget);
    expect(find.text(tr('WITHDRAWN')), findsOneWidget);
  });
  testWidgets('inbox opens its tour after marking the notification read', (
    tester,
  ) async {
    var read = false;
    final api = fixtures.stateWith((r) async {
      if (r.method == 'PATCH') {
        read = true;
        return fixtures.response({'read': true});
      }
      if (r.url.path.startsWith('/tours/')) {
        return fixtures.response(fixtures.trip);
      }
      return fixtures.response([
        {
          'id': 'notification',
          'title': 'Quote ready',
          'resource_kind': 'TOUR',
          'resource_id': 'trip-one',
        },
      ]);
    });
    await fixtures.show(tester, api, const Scaffold(body: NotificationsPage()));
    await tester.tap(find.text('Quote ready'));
    await tester.pumpAndSettle();
    expect(read, true);
    expect(find.byType(TourPage), findsOneWidget);
  });
  test(
    'non-JSON server errors are readable and an empty 401 still clears the session',
    () async {
      final api = fixtures.stateWith(
        (r) async => http.Response('<html>Unavailable</html>', 503),
      );
      await expectLater(
        api.request('/me'),
        throwsA(
          isA<ApiError>().having((e) => e.message, 'message', tr('error')),
        ),
      );
      final expired = fixtures.stateWith((r) async => http.Response('', 401));
      await expectLater(expired.request('/me'), throwsA(isA<ApiError>()));
      expect(expired.user, isNull);
    },
  );
}
