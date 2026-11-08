import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nddev_opennetwork_design_system/opennetwork_design_system.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    final loader = FontLoader(
      'packages/nddev_opennetwork_design_system/IBM Plex Sans',
    );
    for (final weight in ['Regular', 'Medium', 'SemiBold']) {
      loader.addFont(rootBundle.load('fonts/IBMPlexSans-$weight.ttf'));
    }
    await loader.load();
  });
  test('reduced motion and script-aware platform bindings', () {
    expect(
      OpenNetworkTheme.darkContrast(reduceMotion: true)
          .filledButtonTheme
          .style!
          .animationDuration,
      Duration.zero,
    );
    expect(NDDurations.durationUi(NDMotion.reduced), Duration.zero);
    final arabic = NDTextStyle.resolve(
      NDTypeRole.body,
      NDPlatform.android,
      NDScript.arabic,
    );
    expect(arabic.tracking, 0);
    expect(arabic.uppercase, isFalse);
    expect(arabic.family, NDFontFamily.sansAr);
  });
  for (final name in ['dark', 'light', 'dark-contrast', 'light-contrast']) {
    final theme = switch (name) {
      'dark' => OpenNetworkTheme.dark(),
      'light' => OpenNetworkTheme.light(),
      'dark-contrast' => OpenNetworkTheme.darkContrast(),
      _ => OpenNetworkTheme.lightContrast(),
    };
    final c = switch (name) {
      'dark' => OpenNetworkColors.dark,
      'light' => OpenNetworkColors.light,
      'dark-contrast' => OpenNetworkColors.darkContrast,
      _ => OpenNetworkColors.lightContrast,
    };
    test('$name keeps OpenNetwork roles and complete control states', () {
      expect(
        theme.extension<NDColorsExtension>()!.colors.textPrimary,
        c.textPrimary,
      );
      expect(
        theme.extension<NDColorsExtension>()!.colors.accentFill,
        c.accentFill,
      );
      expect(theme.extension<NDMetricsExtension>(), isNotNull);
      expect(theme.colorScheme.primary, c.accentText);
      expect(theme.scaffoldBackgroundColor, c.surfaceBase);
      expect(theme.textTheme.bodyMedium!.fontFamily, contains('IBM Plex Sans'));
      expect(theme.textTheme.headlineSmall!.fontWeight, FontWeight.w400);
      final button = theme.filledButtonTheme.style!;
      expect(button.backgroundColor!.resolve({}), c.accentFill);
      expect(
        button.backgroundColor!.resolve({WidgetState.hovered}),
        c.accentFillHover,
      );
      expect(
        button.backgroundColor!.resolve({WidgetState.pressed}),
        c.accentFillActive,
      );
      expect(
        button.backgroundColor!.resolve({WidgetState.disabled}),
        Colors.transparent,
      );
      expect(button.side!.resolve({WidgetState.focused})!.color, c.focusRing);
      expect(
        theme.outlinedButtonTheme.style!.foregroundColor!.resolve({}),
        c.textPrimary,
      );
      final input =
          theme.inputDecorationTheme.focusedBorder! as OutlineInputBorder;
      expect(input.borderSide.color, c.accentBorder);
      expect(input.borderRadius.topLeft.x, OpenNetworkRadii.lg);
      expect(theme.cardTheme.surfaceTintColor, Colors.transparent);
    });
    test('$name retains text and focus contrast across every surface', () {
      for (final surface in [
        c.surfaceBase,
        c.surfaceRaised,
        c.surfaceSunken,
        c.surfaceOverlay,
      ]) {
        for (final text in [
          c.textPrimary,
          c.textSecondary,
          c.textTertiary,
          c.accentText,
          c.statusDangerText,
          c.statusSuccessText,
          c.statusWarningText,
          c.statusInfoText,
        ]) {
          expect(contrast(text, surface), greaterThanOrEqualTo(4.5));
        }
        for (final line in [c.focusRing, c.borderControl, c.accentOutline]) {
          expect(contrast(line, surface), greaterThanOrEqualTo(3));
        }
      }
      for (final fill in [
        c.accentFill,
        c.accentFillHover,
        c.accentFillActive,
      ]) {
        expect(contrast(c.accentOnFill, fill), greaterThanOrEqualTo(4.5));
      }
      expect(
        contrast(theme.colorScheme.primary, theme.colorScheme.onPrimary),
        greaterThanOrEqualTo(4.5),
      );
    });
    for (final language in ['en', 'ru']) {
      testWidgets(
        '$name/$language: native controls reflow and expose disabled semantics at 200%',
        (tester) async {
          tester.view.physicalSize = const Size(320, 1000);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          final ru = language == 'ru';
          final imageKey = GlobalKey();
          await tester.pumpWidget(
            MaterialApp(
              theme: theme,
              builder: (context, child) => MediaQuery(
                data: MediaQuery.of(context)
                    .copyWith(textScaler: const TextScaler.linear(2)),
                child: child!,
              ),
              home: RepaintBoundary(
                key: imageKey,
                child: Scaffold(
                  appBar: AppBar(
                    title: const OpenNetworkBrand(),
                    toolbarHeight: 104,
                  ),
                  body: SingleChildScrollView(
                    padding: const EdgeInsets.all(OpenNetworkSpacing.four),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          ru ? 'Подключение к NDS' : 'Connect to NDS',
                          style: theme.textTheme.headlineSmall,
                        ),
                        const SizedBox(height: OpenNetworkSpacing.six),
                        TextField(
                          decoration: InputDecoration(
                            labelText: ru ? 'Адрес сервера' : 'Server address',
                          ),
                        ),
                        const SizedBox(height: OpenNetworkSpacing.four),
                        FilledButton(
                          onPressed: () {},
                          child: Text(ru ? 'Подключиться' : 'Connect'),
                        ),
                        const SizedBox(height: OpenNetworkSpacing.two),
                        OutlinedButton(
                          onPressed: () {},
                          child: Text(
                            ru ? 'Проверить сессию' : 'Revalidate session',
                          ),
                        ),
                        const SizedBox(height: OpenNetworkSpacing.two),
                        FilledButton(
                          onPressed: null,
                          child: Text(ru ? 'Недоступно' : 'Unavailable'),
                        ),
                        TextButton(
                          onPressed: () {},
                          child: const Text('nddev.ai'),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          );
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          expect(
            tester.getSize(find.byType(FilledButton).first).height,
            greaterThanOrEqualTo(48),
          );
          final semantics = tester.ensureSemantics();
          expect(
            tester.getSemantics(find.byType(FilledButton).last),
            matchesSemantics(
              isButton: true,
              hasEnabledState: true,
              isEnabled: false,
              label: ru ? 'Недоступно' : 'Unavailable',
              isFocusable: false,
            ),
          );
          semantics.dispose();
          final directory = Platform.environment['NDS_REVIEW_SHOTS'];
          if (directory != null) {
            await tester.runAsync(() async {
              final boundary =
                  imageKey.currentContext!.findRenderObject()!
                      as RenderRepaintBoundary;
              final image = await boundary.toImage();
              final data = await image.toByteData(
                format: ui.ImageByteFormat.png,
              );
              await File('$directory/kit-$name-$language.png')
                  .writeAsBytes(data!.buffer.asUint8List());
              image.dispose();
            });
          }
          await tester.tap(find.byType(TextField));
          await tester.pump();
          expect(tester.takeException(), isNull);
        },
      );
    }
  }
}

double contrast(Color a, Color b) {
  final luminance = [a.computeLuminance(), b.computeLuminance()]..sort();
  return (luminance.last + 0.05) / (luminance.first + 0.05);
}
