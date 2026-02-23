class ApiConstants {
  // Auth Service
  static const String authBase = 'http://localhost:3001';
  static const String register = '$authBase/register';
  static const String login = '$authBase/login';
  static const String refresh = '$authBase/refresh';
  static const String me = '$authBase/me';

  // User Service
  static const String userBase = 'http://localhost:3002';
  static const String profileEnsure = '$userBase/profile/ensure';
  static const String profile = '$userBase/profile';
  static const String profileRate = '$userBase/profile/rate';

  // Discovery Service
  static const String discoveryBase = 'http://localhost:3003';
  static const String hosts = '$discoveryBase/hosts';

  // Billing Service
  static const String billingBase = 'http://localhost:3006';
  static const String wallet = '$billingBase/wallet';
  static const String walletPurchase = '$billingBase/wallet/purchase';
  static const String walletTransactions = '$billingBase/wallet/transactions';
}
