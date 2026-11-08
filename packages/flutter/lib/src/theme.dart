import 'package:flutter/material.dart';

import 'tokens.dart';
import 'nd_theme.dart';
import 'nd_tokens.dart';
import 'licenses.dart';

/// Native controls using the platform OpenNetwork kit, without seed-derived hues.
abstract final class OpenNetworkTheme {
  static ThemeData dark({
    double width = OpenNetworkTypography.viewportMin,
    bool reduceMotion = false,
  }) => _theme(Brightness.dark, width, reduceMotion: reduceMotion);
  static ThemeData light({
    double width = OpenNetworkTypography.viewportMin,
    bool reduceMotion = false,
  }) => _theme(Brightness.light, width, reduceMotion: reduceMotion);

  static ThemeData darkContrast({
    double width = OpenNetworkTypography.viewportMin,
    bool reduceMotion = false,
  }) => _theme(
    Brightness.dark,
    width,
    contrast: true,
    reduceMotion: reduceMotion,
  );
  static ThemeData lightContrast({
    double width = OpenNetworkTypography.viewportMin,
    bool reduceMotion = false,
  }) => _theme(
    Brightness.light,
    width,
    contrast: true,
    reduceMotion: reduceMotion,
  );

  static ThemeData _theme(
    Brightness brightness,
    double width, {
    bool contrast = false,
    bool reduceMotion = false,
  }) {
    registerOpenNetworkFontLicenses();
    final dark = brightness == Brightness.dark;
    final contextTheme = dark
        ? (contrast ? NDTheme.darkContrast : NDTheme.dark)
        : (contrast ? NDTheme.lightContrast : NDTheme.light);
    final c = dark
        ? (contrast ? OpenNetworkColors.darkContrast : OpenNetworkColors.dark)
        : (contrast
              ? OpenNetworkColors.lightContrast
              : OpenNetworkColors.light);
    final inverse = dark ? OpenNetworkColors.light : OpenNetworkColors.dark;
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(OpenNetworkRadii.lg),
    );
    TextStyle type(String role, double leading) => TextStyle(
      fontFamily: OpenNetworkTypography.fontFamily.first,
      package: 'nddev_opennetwork_design_system',
      fontSize: OpenNetworkTypography.sizeAt(role, width),
      height: leading,
      fontWeight: FontWeight.w400,
      color: c.textPrimary,
    );
    final body = type('body', OpenNetworkTypography.bodyLeading);
    final label = type('label', OpenNetworkTypography.labelLeading);
    final caption = type('caption', OpenNetworkTypography.captionLeading);
    final text = TextTheme(
      displayLarge: type('display', OpenNetworkTypography.displayLeading),
      headlineLarge: type('h1', OpenNetworkTypography.h1Leading),
      headlineMedium: type('h2', OpenNetworkTypography.h2Leading),
      headlineSmall: type('h3', OpenNetworkTypography.h3Leading),
      titleLarge: type('h4', OpenNetworkTypography.h4Leading),
      titleMedium: body,
      titleSmall: label,
      bodyLarge: type('bodyLg', OpenNetworkTypography.bodyLgLeading),
      bodyMedium: body,
      bodySmall: caption.copyWith(color: c.textSecondary),
      labelLarge: body,
      labelMedium: label,
      labelSmall: caption,
    );
    final scheme = ColorScheme(
      brightness: brightness,
      primary: c.accentText,
      onPrimary: c.surfaceBase,
      primaryContainer: c.accentSubtle,
      onPrimaryContainer: c.accentText,
      secondary: c.accentText,
      onSecondary: c.surfaceBase,
      secondaryContainer: c.accentSubtle,
      onSecondaryContainer: c.accentText,
      tertiary: c.accentText,
      onTertiary: c.surfaceBase,
      tertiaryContainer: c.accentSubtle,
      onTertiaryContainer: c.accentText,
      error: c.statusDangerText,
      onError: c.surfaceBase,
      errorContainer: c.statusDangerSubtle,
      onErrorContainer: c.statusDangerText,
      surface: c.surfaceBase,
      onSurface: c.textPrimary,
      onSurfaceVariant: c.textSecondary,
      surfaceContainerLowest: c.surfaceBase,
      surfaceContainerLow: c.surfaceRaised,
      surfaceContainer: c.surfaceRaised,
      surfaceContainerHigh: c.surfaceSunken,
      surfaceContainerHighest: c.surfaceOverlay,
      surfaceDim: c.surfaceSunken,
      surfaceBright: c.surfaceOverlay,
      surfaceTint: Colors.transparent,
      outline: c.borderControl,
      outlineVariant: c.borderSubtle,
      inverseSurface: inverse.surfaceBase,
      onInverseSurface: inverse.textPrimary,
      inversePrimary: inverse.accentText,
      primaryFixed: c.accentBrand,
      primaryFixedDim: c.accentFill,
      onPrimaryFixed: c.accentOnFill,
      onPrimaryFixedVariant: c.accentOnFill,
      secondaryFixed: c.accentBrand,
      secondaryFixedDim: c.accentFill,
      onSecondaryFixed: c.accentOnFill,
      onSecondaryFixedVariant: c.accentOnFill,
      tertiaryFixed: c.accentBrand,
      tertiaryFixedDim: c.accentFill,
      onTertiaryFixed: c.accentOnFill,
      onTertiaryFixedVariant: c.accentOnFill,
    );
    ButtonStyle button({bool outlined = false, bool quiet = false}) =>
        ButtonStyle(
          minimumSize: const WidgetStatePropertyAll(
            Size(0, OpenNetworkSizes.controlMd),
          ),
          padding: const WidgetStatePropertyAll(
            EdgeInsets.symmetric(
              horizontal: OpenNetworkSpacing.six,
              vertical: OpenNetworkSpacing.two,
            ),
          ),
          shape: WidgetStatePropertyAll(shape),
          elevation: const WidgetStatePropertyAll(0),
          animationDuration: Duration(
            milliseconds: reduceMotion ? 0 : OpenNetworkMotion.uiFast.toInt(),
          ),
          textStyle: WidgetStatePropertyAll(
            quiet ? body.copyWith(decoration: TextDecoration.underline) : body,
          ),
          foregroundColor: WidgetStateProperty.resolveWith(
            (states) => states.contains(WidgetState.disabled)
                ? c.textTertiary
                : quiet
                ? c.accentText
                : outlined
                ? c.textPrimary
                : c.accentOnFill,
          ),
          backgroundColor: WidgetStateProperty.resolveWith((states) {
            if (states.contains(WidgetState.disabled))
              return Colors.transparent;
            if (outlined || quiet) {
              return states.any(
                    (s) => s == WidgetState.hovered || s == WidgetState.pressed,
                  )
                  ? c.accentSubtle
                  : Colors.transparent;
            }
            if (states.contains(WidgetState.pressed)) return c.accentFillActive;
            if (states.contains(WidgetState.hovered)) return c.accentFillHover;
            return c.accentFill;
          }),
          overlayColor: const WidgetStatePropertyAll(Colors.transparent),
          side: WidgetStateProperty.resolveWith(
            (states) => BorderSide(
              color: states.contains(WidgetState.focused)
                  ? c.focusRing
                  : states.contains(WidgetState.disabled)
                  ? c.borderControl
                  : outlined
                  ? c.accentOutline
                  : quiet
                  ? Colors.transparent
                  : c.accentFill,
              width: states.contains(WidgetState.focused) ? 2 : 1,
            ),
          ),
        );
    OutlineInputBorder border(Color color, [double width = 1]) =>
        OutlineInputBorder(
          borderRadius: BorderRadius.circular(OpenNetworkRadii.lg),
          borderSide: BorderSide(color: color, width: width),
        );
    return ThemeData(
      useMaterial3: true,
      extensions: [
        NDColorsExtension(NDColors.resolve(contextTheme, NDDirection.on)),
        NDMetricsExtension(
          NDMetrics.resolve(NDPlatform.android, NDDensity.comfortable),
        ),
      ],
      colorScheme: scheme,
      scaffoldBackgroundColor: c.surfaceBase,
      canvasColor: c.surfaceBase,
      cardColor: c.surfaceRaised,
      disabledColor: c.textTertiary,
      dividerColor: c.borderSubtle,
      focusColor: c.accentSubtle,
      hoverColor: c.accentSubtle,
      fontFamily: OpenNetworkTypography.fontFamily.first,
      package: 'nddev_opennetwork_design_system',
      textTheme: text,
      primaryTextTheme: text,
      iconTheme: IconThemeData(
        color: c.textPrimary,
        size: OpenNetworkSizes.icon,
      ),
      appBarTheme: AppBarThemeData(
        backgroundColor: c.surfaceBase,
        foregroundColor: c.textPrimary,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        titleTextStyle: text.titleLarge,
      ),
      filledButtonTheme: FilledButtonThemeData(style: button()),
      elevatedButtonTheme: ElevatedButtonThemeData(style: button()),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: button(outlined: true),
      ),
      textButtonTheme: TextButtonThemeData(style: button(quiet: true)),
      inputDecorationTheme: InputDecorationThemeData(
        filled: true,
        fillColor: c.surfaceRaised,
        hoverColor: c.surfaceRaised,
        constraints: const BoxConstraints(minHeight: OpenNetworkSizes.field),
        border: border(c.borderControl),
        enabledBorder: border(c.borderControl),
        disabledBorder: border(c.borderControl),
        focusedBorder: border(c.accentBorder, 2),
        errorBorder: border(c.statusDangerBorder, 2),
        focusedErrorBorder: border(c.statusDangerBorder, 2),
        labelStyle: label.copyWith(color: c.textSecondary),
        floatingLabelStyle: label.copyWith(color: c.accentText),
        hintStyle: body.copyWith(color: c.textTertiary),
        helperStyle: label.copyWith(color: c.textSecondary),
        errorStyle: label.copyWith(color: c.statusDangerText),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: OpenNetworkSpacing.six,
          vertical: OpenNetworkSpacing.three,
        ),
      ),
      cardTheme: CardThemeData(
        color: c.surfaceRaised,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(OpenNetworkRadii.xl),
          side: BorderSide(color: c.borderSubtle),
        ),
      ),
      popupMenuTheme: PopupMenuThemeData(
        color: c.surfaceOverlay,
        surfaceTintColor: Colors.transparent,
        textStyle: body,
        shape: shape.copyWith(side: BorderSide(color: c.borderControl)),
      ),
      dropdownMenuTheme: DropdownMenuThemeData(textStyle: body),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: c.surfaceBase,
        surfaceTintColor: Colors.transparent,
        indicatorColor: c.accentSubtle,
        indicatorShape: shape,
        labelTextStyle: WidgetStateProperty.resolveWith(
          (states) => label.copyWith(
            color: states.contains(WidgetState.selected)
                ? c.accentText
                : c.textSecondary,
          ),
        ),
        iconTheme: WidgetStateProperty.resolveWith(
          (states) => IconThemeData(
            color: states.contains(WidgetState.selected)
                ? c.accentText
                : c.textSecondary,
          ),
        ),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: c.surfaceRaised,
        selectedColor: c.accentSubtle,
        disabledColor: Colors.transparent,
        labelStyle: label,
        side: BorderSide(color: c.borderControl),
        shape: shape,
        checkmarkColor: c.accentText,
        padding: const EdgeInsets.all(OpenNetworkSpacing.two),
      ),
      dividerTheme: DividerThemeData(color: c.borderSubtle),
      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: c.accentText,
        linearTrackColor: c.accentSubtle,
        circularTrackColor: c.accentSubtle,
      ),
      textSelectionTheme: TextSelectionThemeData(
        cursorColor: c.accentText,
        selectionColor: c.accentSubtle,
        selectionHandleColor: c.accentText,
      ),
    );
  }
}
