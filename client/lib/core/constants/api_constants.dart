class ApiConstants {
  // For web: localhost works directly
  // For Android emulator: use 10.0.2.2 instead of localhost
  // For iOS simulator: use localhost
  static const String baseUrl = 'http://localhost:3001';

  // Auth endpoints
  static const String register = '$baseUrl/register';
  static const String login = '$baseUrl/login';
  static const String refresh = '$baseUrl/refresh';
  static const String me = '$baseUrl/me';
}
