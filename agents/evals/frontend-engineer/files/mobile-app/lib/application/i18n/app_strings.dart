import 'package:flutter/widgets.dart';

class AppStrings {
  const AppStrings({
    required this.settingsTitle,
    required this.settingsLanguage,
    required this.settingsPrivacy,
  });

  final String settingsTitle;
  final String settingsLanguage;
  final String settingsPrivacy;

  static AppStrings of(BuildContext context) =>
      throw UnimplementedError('resolved from the active locale');
}
