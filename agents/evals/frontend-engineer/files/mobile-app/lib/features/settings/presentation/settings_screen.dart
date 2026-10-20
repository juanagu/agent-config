import 'package:flutter/material.dart';
import 'package:notes_app/application/i18n/app_strings.dart';
import 'package:notes_app/application/theme/app_spacing.dart';
import 'package:notes_app/application/ui/app_list_tile.dart';
import 'package:notes_app/application/ui/page_shell.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({
    super.key,
    required this.onOpenLanguage,
    required this.onOpenPrivacy,
  });

  final VoidCallback onOpenLanguage;
  final VoidCallback onOpenPrivacy;

  @override
  Widget build(BuildContext context) {
    final strings = AppStrings.of(context);
    return PageShell(
      title: strings.settingsTitle,
      child: ListView(
        padding: const EdgeInsets.all(AppSpacing.md),
        children: [
          AppListTile(
            label: strings.settingsLanguage,
            onTap: onOpenLanguage,
          ),
          AppListTile(
            label: strings.settingsPrivacy,
            onTap: onOpenPrivacy,
          ),
        ],
      ),
    );
  }
}
