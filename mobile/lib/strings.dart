import 'dart:convert';
import 'package:flutter/services.dart';

class Strings {
  static Map<String, dynamic> values = {};
  static Future<void> load() async {
    values = jsonDecode(await rootBundle.loadString('assets/strings.json'));
  }

  static String t(String key) => values[key]?.toString() ?? key;
}

String tr(String key) => Strings.t(key);
