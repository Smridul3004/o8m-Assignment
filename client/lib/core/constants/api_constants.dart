// ignore_for_file: avoid_web_libraries_in_flutter
import 'dart:js_interop';

@JS('window.location.hostname')
external String get _jsHostname;

/// Returns the hostname that the Flutter app is served from.
/// On localhost this returns 'localhost'; when accessed via LAN IP
/// it returns that IP, so backend calls go to the same machine.
String get _host {
  try {
    final h = _jsHostname;
    return (h.isNotEmpty) ? h : 'localhost';
  } catch (_) {
    return 'localhost';
  }
}

class ApiConstants {
  // Auth Service
  static String get authBase => 'http://$_host:3001';
  static String get register => '$authBase/register';
  static String get login => '$authBase/login';
  static String get refresh => '$authBase/refresh';
  static String get me => '$authBase/me';

  // User Service
  static String get userBase => 'http://$_host:3002';
  static String get profileEnsure => '$userBase/profile/ensure';
  static String get profile => '$userBase/profile';
  static String get profileRate => '$userBase/profile/rate';

  // Discovery Service
  static String get discoveryBase => 'http://$_host:3003';
  static String get hosts => '$discoveryBase/hosts';

  // Billing Service
  static String get billingBase => 'http://$_host:3006';
  static String get wallet => '$billingBase/wallet';
  static String get walletPurchase => '$billingBase/wallet/purchase';
  static String get walletTransactions => '$billingBase/wallet/transactions';

  // Chat Service
  static String get chatBase => 'http://$_host:3004';
  static String get chatSocket => 'http://$_host:3004';
  static String get conversations => '$chatBase/conversations';
  static String conversationMessages(String id) =>
      '$chatBase/conversations/$id/messages';

  // Call Service
  static String get callBase => 'http://$_host:3005';
  static String get callSocket => 'http://$_host:3005';
  static String get callsActive => '$callBase/calls/active';
  static String callSession(String id) => '$callBase/calls/$id';
}
