import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

bool _fontLicensesRegistered = false;

/// Register the bundled font notices once, whichever public theme API is used.
void registerOpenNetworkFontLicenses() {
  if (_fontLicensesRegistered) return;
  _fontLicensesRegistered = true;
  LicenseRegistry.addLicense(() async* {
    yield LicenseEntryWithLineBreaks(
      ['IBM Plex Sans', 'IBM Plex Sans Arabic'],
      await rootBundle.loadString(
        'packages/nddev_opennetwork_design_system/fonts/OFL-IBM-Plex.txt',
      ),
    );
  });
}
