import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'icons.dart';
import 'tokens.dart';

/// The platform's authentic mark and stacked direction lockup.
class OpenNetworkBrand extends StatelessWidget {
  const OpenNetworkBrand({super.key});

  static double heightOf(BuildContext context) {
    final scale = MediaQuery.textScalerOf(context);
    return math.max(
      OpenNetworkSizes.brand,
      scale.scale(OpenNetworkTypography.bodyMin) *
              OpenNetworkTypography.bodyLeading +
          scale.scale(OpenNetworkTypography.captionMin) *
              OpenNetworkTypography.captionLeading,
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      label: 'NDDev OpenNetwork',
      child: ExcludeSemantics(
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox.square(
              dimension: OpenNetworkSizes.brand,
              child: NDVectorIcon(
                NDBrand.mark,
                size: OpenNetworkSizes.brand,
                color: theme.colorScheme.primary,
              ),
            ),
            const SizedBox(width: OpenNetworkSpacing.three),
            Flexible(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'NDDev',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontSize: OpenNetworkTypography.bodyMin,
                    ),
                  ),
                  Text(
                    'OpenNetwork',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.primary,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
