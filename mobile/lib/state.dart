import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:http/http.dart' as http;
import 'strings.dart';

typedef Json = Map<String, dynamic>;

class ApiError implements Exception {
  final String message;
  final String code;
  ApiError(this.message, [this.code = 'ERROR']);
  @override
  String toString() => message;
}

class OfflineError extends ApiError {
  OfflineError([String? message])
    : super(message ?? tr('offlineDetail'), 'OFFLINE');
}

abstract class Persistence {
  Future<String?> serverUrl();
  Future<void> saveServerUrl(String value);
  Future<String?> session();
  Future<void> saveSession(String? value);
  Future<Json?> cached(String account);
  Future<void> cache(String account, Json value);
  Future<void> clear();
}

class DevicePersistence implements Persistence {
  final FlutterSecureStorage secure;
  final Box<String> box;
  DevicePersistence(this.box)
    : secure = const FlutterSecureStorage(
        aOptions: AndroidOptions(encryptedSharedPreferences: true),
      );
  @override
  Future<String?> serverUrl() => secure.read(key: 'server_url');
  @override
  Future<void> saveServerUrl(String value) =>
      secure.write(key: 'server_url', value: value);
  @override
  Future<String?> session() => secure.read(key: 'session');
  @override
  Future<void> saveSession(String? value) => value == null
      ? secure.delete(key: 'session')
      : secure.write(key: 'session', value: value);
  @override
  Future<Json?> cached(String account) async => box.get(account) == null
      ? null
      : Map<String, dynamic>.from(jsonDecode(box.get(account)!));
  @override
  Future<void> cache(String account, Json value) =>
      box.put(account, jsonEncode(value));
  @override
  Future<void> clear() async {
    await box.clear();
    await secure.delete(key: 'session');
  }
}

class AppState extends ChangeNotifier {
  final Persistence persistence;
  final http.Client client;
  String _baseUrl;
  String get baseUrl => _baseUrl;
  Json? user;
  String? token;
  bool offline = false;
  bool ready = false;
  bool pushAvailable = false;
  String? lastUpdated;
  String? sessionMessage;
  AppState({
    required this.persistence,
    http.Client? client,
    String baseUrl = const String.fromEnvironment(
      'API_URL',
      defaultValue: 'http://10.0.2.2:3000',
    ),
  }) : _baseUrl = baseUrl,
       client = client ?? http.Client();
  String get role => user?['role'] ?? '';
  bool get approved => user?['status'] == 'APPROVED';
  void updatePushAvailability(bool available) {
    pushAvailable = available;
    notifyListeners();
  }

  static String normalizeServerUrl(String input) {
    try {
      final uri = Uri.tryParse(input.trim());
      if (uri == null ||
          !['http', 'https'].contains(uri.scheme) ||
          !uri.hasAuthority ||
          uri.host.isEmpty ||
          uri.userInfo.isNotEmpty ||
          uri.hasQuery ||
          uri.hasFragment ||
          (uri.path.isNotEmpty && uri.path != '/') ||
          uri.port < 1 ||
          uri.port > 65535) {
        throw ApiError(tr('invalidServerUrl'), 'INVALID_SERVER');
      }
      if (kReleaseMode && uri.scheme != 'https') {
        throw ApiError(tr('serverHttpsRequired'), 'INVALID_SERVER');
      }
      return uri.replace(path: '').toString();
    } on FormatException {
      throw ApiError(tr('invalidServerUrl'), 'INVALID_SERVER');
    }
  }

  String connectionError(String address) =>
      '${tr('cannotConnect')} $address. ${tr('connectionHelp')}';
  OfflineError networkError() =>
      OfflineError(user == null ? connectionError(baseUrl) : null);

  Future<void> testServerConnection(String address) async {
    final normalized = normalizeServerUrl(address);
    try {
      // Health checks never send a password, session token or redirect it elsewhere.
      final req = http.Request('GET', Uri.parse('$normalized/health'))
        ..followRedirects = false;
      final result = await client
          .send(req)
          .then(http.Response.fromStream)
          .timeout(const Duration(seconds: 8));
      if (result.statusCode != 200) {
        throw ApiError(tr('serverResponseInvalid'), 'INVALID_SERVER');
      }
      final decoded = jsonDecode(result.body);
      if (decoded is! Map ||
          decoded['data'] is! Map ||
          decoded['data']['status'] != 'ok') {
        throw ApiError(tr('serverResponseInvalid'), 'INVALID_SERVER');
      }
    } on SocketException {
      throw OfflineError(connectionError(normalized));
    } on TimeoutException {
      throw OfflineError(connectionError(normalized));
    } on http.ClientException {
      throw OfflineError(connectionError(normalized));
    } on FormatException {
      throw ApiError(tr('serverResponseInvalid'), 'INVALID_SERVER');
    }
  }

  Future<void> connectToServer(String address) async {
    final normalized = normalizeServerUrl(address);
    await testServerConnection(normalized);
    if (normalized != baseUrl) {
      // Bind sessions and cached accounts to one server. Never forward an old JWT.
      await persistence.clear();
      token = null;
      user = null;
      pushAvailable = false;
      lastUpdated = null;
    }
    await persistence.saveServerUrl(normalized);
    _baseUrl = normalized;
    offline = false;
    sessionMessage = null;
    notifyListeners();
  }

  Future<void> restore() async {
    try {
      final savedServer = await persistence.serverUrl();
      if (savedServer != null) _baseUrl = normalizeServerUrl(savedServer);
      final raw = await persistence.session();
      if (raw != null) {
        final saved = jsonDecode(raw);
        if (saved['server_url'] != null && saved['server_url'] != baseUrl) {
          throw ApiError(tr('expired'), 'SESSION_EXPIRED');
        }
        token = saved['token'];
        user = Map<String, dynamic>.from(saved['user']);
        final payload = jsonDecode(
          utf8.decode(
            base64Url.decode(base64Url.normalize(token!.split('.')[1])),
          ),
        );
        if ((payload['exp'] as num) * 1000 <=
            DateTime.now().millisecondsSinceEpoch) {
          await expire();
        } else {
          try {
            await refreshUser();
          } on OfflineError {
            offline = true;
          }
        }
      }
    } catch (_) {
      await expire();
    }
    ready = true;
    notifyListeners();
  }

  Future<dynamic> request(
    String path, {
    String method = 'GET',
    Json? body,
    Json? headers,
  }) async {
    if (offline && method != 'GET' && !path.startsWith('/auth/')) {
      throw networkError();
    }
    try {
      final req = http.Request(method, Uri.parse('$baseUrl$path'));
      req.headers.addAll({
        'Content-Type': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
        ...?headers?.map((k, v) => MapEntry(k, v.toString())),
      });
      if (body != null) req.body = jsonEncode(body);
      final response = await client
          .send(req)
          .then(http.Response.fromStream)
          .timeout(const Duration(seconds: 15));
      if (response.statusCode == 401 && !path.startsWith('/auth/')) {
        await expire();
        throw ApiError(tr('expired'), 'SESSION_EXPIRED');
      }
      Json decoded;
      try {
        decoded = Map<String, dynamic>.from(jsonDecode(response.body));
      } on FormatException {
        throw ApiError(tr('error'));
      } on TypeError {
        throw ApiError(tr('error'));
      }
      if (response.statusCode >= 400) {
        final error =
            decoded['error'] as Map? ??
            {'message': tr('error'), 'code': 'ERROR'};
        final details = error['details'] as List?;
        throw ApiError(
          details?.isNotEmpty == true
              ? '${error['message']}: ${details!.first['message']}'
              : error['message'],
          error['code'],
        );
      }
      if (offline) {
        offline = false;
        notifyListeners();
      }
      return decoded['data'];
    } on SocketException {
      offline = true;
      notifyListeners();
      throw networkError();
    } on TimeoutException {
      offline = true;
      notifyListeners();
      throw networkError();
    } on http.ClientException {
      offline = true;
      notifyListeners();
      throw networkError();
    }
  }

  Future<void> authenticate(Json data, bool register) async {
    final server = baseUrl;
    final out = await request(
      '/auth/${register ? 'register' : 'login'}',
      method: 'POST',
      body: data,
    );
    if (server != baseUrl) {
      throw ApiError(tr('serverChanged'), 'SERVER_CHANGED');
    }
    token = out['token'];
    user = Map<String, dynamic>.from(out['user']);
    sessionMessage = null;
    offline = false;
    await persist();
    notifyListeners();
  }

  Future<void> persist() => persistence.saveSession(
    jsonEncode({'token': token, 'user': user, 'server_url': baseUrl}),
  );
  Future<void> refreshUser() async {
    user = Map<String, dynamic>.from(await request('/me'));
    await persist();
    notifyListeners();
  }

  Future<void> expire() async {
    token = null;
    user = null;
    sessionMessage = tr('expired');
    await persistence.clear();
    notifyListeners();
  }

  Future<void> logout() async {
    try {
      if (!offline) await request('/auth/logout', method: 'POST');
    } catch (_) {
      /* Local credentials must still be removed. */
    }
    token = null;
    user = null;
    offline = false;
    sessionMessage = null;
    await persistence.clear();
    notifyListeners();
  }

  static Json summary(Json t) => {
    for (final key in [
      'id',
      'status',
      'pickup',
      'destination',
      'starts_at',
      'ends_at',
      'vehicle_type',
      'passengers',
      'updated_at',
      'agent_id',
      'agency_name',
    ])
      key: t[key],
  };
  Future<List<Json>> tours() async {
    final account = user?['id'] as String?;
    if (account == null) return [];
    try {
      final rows = (await request('/tours') as List)
          .map((x) => Map<String, dynamic>.from(x))
          .toList();
      lastUpdated = DateTime.now().toIso8601String();
      await persistence.cache(account, {
        'updated': lastUpdated,
        'tours': rows.map(summary).toList(),
      });
      return rows;
    } on OfflineError {
      final saved = await persistence.cached(account);
      lastUpdated = saved?['updated'];
      return ((saved?['tours'] ?? []) as List)
          .map((x) => Map<String, dynamic>.from(x))
          .toList();
    }
  }

  Future<void> upload(String path, String kind, {String? vehicle}) async {
    if (offline) throw OfflineError();
    final req = http.MultipartRequest('POST', Uri.parse('$baseUrl/media'));
    req.headers['Authorization'] = 'Bearer $token';
    req.fields['kind'] = kind;
    if (vehicle != null) req.fields['vehicle_id'] = vehicle;
    req.files.add(await http.MultipartFile.fromPath('file', path));
    try {
      final res = await http.Response.fromStream(
        await client.send(req).timeout(const Duration(seconds: 45)),
      );
      final out = jsonDecode(res.body);
      if (res.statusCode == 401) {
        await expire();
        throw ApiError(tr('expired'));
      }
      if (res.statusCode >= 400) throw ApiError(out['error']['message']);
    } on SocketException {
      throw OfflineError();
    } on TimeoutException {
      throw OfflineError();
    }
  }

  @override
  void dispose() {
    client.close();
    super.dispose();
  }
}
