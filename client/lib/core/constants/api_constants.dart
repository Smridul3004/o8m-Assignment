// ignore_for_file: avoid_web_libraries_in_flutter
import 'dart:js_interop';

@JS('window.location.hostname')
external String get _jsHostname;

/// Build-time environment variables (set via --dart-define)
const String _envAuthUrl = String.fromEnvironment('AUTH_URL', defaultValue: '');
const String _envUserUrl = String.fromEnvironment('USER_URL', defaultValue: '');
const String _envDiscoveryUrl = String.fromEnvironment(
  'DISCOVERY_URL',
  defaultValue: '',
);
const String _envChatUrl = String.fromEnvironment('CHAT_URL', defaultValue: '');
const String _envCallUrl = String.fromEnvironment('CALL_URL', defaultValue: '');
const String _envBillingUrl = String.fromEnvironment(
  'BILLING_URL',
  defaultValue: '',
);

/// Returns the base URL for local development
String _localUrl(int port) {
  try {
    final host = _jsHostname;
    final h = (host.isNotEmpty) ? host : 'localhost';
    return 'http://$h:$port';
  } catch (_) {
    return 'http://localhost:$port';
  }
}

class ApiConstants {
  // Auth Service
  static String get authBase =>
      _envAuthUrl.isNotEmpty ? _envAuthUrl : _localUrl(3001);
  static String get register => '$authBase/register';
  static String get login => '$authBase/login';
  static String get refresh => '$authBase/refresh';
  static String get me => '$authBase/me';

  // User Service
  static String get userBase =>
      _envUserUrl.isNotEmpty ? _envUserUrl : _localUrl(3002);
  static String get profileEnsure => '$userBase/profile/ensure';
  static String get profile => '$userBase/profile';
  static String get profileRate => '$userBase/profile/rate';

  // Discovery Service
  static String get discoveryBase =>
      _envDiscoveryUrl.isNotEmpty ? _envDiscoveryUrl : _localUrl(3003);
  static String get hosts => '$discoveryBase/hosts';

  // Billing Service
  static String get billingBase =>
      _envBillingUrl.isNotEmpty ? _envBillingUrl : _localUrl(3006);
  static String get wallet => '$billingBase/wallet';
  static String get walletPurchase => '$billingBase/wallet/purchase';
  static String get walletTransactions => '$billingBase/wallet/transactions';

  // Chat Service
  static String get chatBase =>
      _envChatUrl.isNotEmpty ? _envChatUrl : _localUrl(3004);
  static String get chatSocket => chatBase;
  static String get conversations => '$chatBase/conversations';
  static String conversationMessages(String id) =>
      '$chatBase/conversations/$id/messages';

  // Call Service
  static String get callBase =>
      _envCallUrl.isNotEmpty ? _envCallUrl : _localUrl(3005);
  static String get callSocket => callBase;
  static String get callsActive => '$callBase/calls/active';
  static String callSession(String id) => '$callBase/calls/$id';
}
