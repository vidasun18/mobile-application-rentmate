import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/testing.dart';
import 'package:http/http.dart' as http;
import 'package:provider/provider.dart';
import 'package:rentmate/main.dart';
import 'package:rentmate/state.dart';
import 'package:rentmate/strings.dart';
import 'app_test.dart' show MemoryPersistence;

void main() {
  setUpAll(() async {
    // Use the SDK's real fonts so the review image contains readable text/icons.
    // flutter_tester lives inside the SDK on both developer machines and CI.
    var directory = File(Platform.resolvedExecutable).parent;
    while (directory.parent.path != directory.path) {
      final fonts = Directory(
        '${directory.path}/bin/cache/artifacts/material_fonts',
      );
      final roboto = File('${fonts.path}/roboto-regular.ttf');
      if (await roboto.exists()) {
        for (final entry in {
          'Roboto': roboto,
          'MaterialIcons': File('${fonts.path}/materialicons-regular.otf'),
        }.entries) {
          final loader = FontLoader(entry.key);
          loader.addFont(
            Future.value(ByteData.sublistView(await entry.value.readAsBytes())),
          );
          await loader.load();
        }
        return;
      }
      directory = directory.parent;
    }
    throw StateError('Flutter SDK review fonts were not found');
  });
  testWidgets(
    'welcome fits small phone, standard phone and tablet without overflow',
    (tester) async {
      await Strings.load();
      final api = AppState(
        persistence: MemoryPersistence(),
        client: MockClient((r) async => http.Response('{}', 503)),
      )..ready = true;
      const key = ValueKey('visual-boundary');
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      tester.view.devicePixelRatio = 1;
      for (final width in [320.0, 432.0, 800.0]) {
        tester.view.physicalSize = Size(width, 960);
        await tester.pumpWidget(
          ChangeNotifierProvider.value(
            value: api,
            child: RepaintBoundary(key: key, child: const RentMateApp()),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        expect(find.text(tr('appName')), findsOneWidget);
        if (width == 432) {
          final boundary = tester.renderObject<RenderRepaintBoundary>(
            find.byKey(key),
          );
          await tester.runAsync(() async {
            final shot = await boundary.toImage(pixelRatio: 1);
            final bytes = await shot.toByteData(format: ui.ImageByteFormat.png);
            final file = File('../docs/screenshots/welcome-widget.png');
            await file.parent.create(recursive: true);
            await file.writeAsBytes(bytes!.buffer.asUint8List());
            shot.dispose();
          });
        }
      }
    },
  );
}
