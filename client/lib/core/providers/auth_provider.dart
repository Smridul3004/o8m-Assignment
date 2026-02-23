import 'package:flutter/material.dart';
import 'package:o8m_marketplace/core/storage/token_storage.dart';
import 'package:o8m_marketplace/features/auth/data/auth_service.dart';

class AuthProvider extends ChangeNotifier {
  bool _isLoggedIn = false;
  bool _isLoading = true;
  String? _userId;
  String? _userEmail;
  String? _userRole;

  bool get isLoggedIn => _isLoggedIn;
  bool get isLoading => _isLoading;
  String? get userId => _userId;
  String? get userEmail => _userEmail;
  String? get userRole => _userRole;

  Future<void> checkAuth() async {
    _isLoading = true;
    notifyListeners();

    final loggedIn = await TokenStorage.isLoggedIn();
    if (loggedIn) {
      final user = await TokenStorage.getUser();
      _userId = user['id'];
      _userEmail = user['email'];
      _userRole = user['role'];
      _isLoggedIn = true;
    }

    _isLoading = false;
    notifyListeners();
  }

  void setLoggedIn(Map<String, dynamic> user) {
    _userId = user['id'];
    _userEmail = user['email'];
    _userRole = user['role'];
    _isLoggedIn = true;
    notifyListeners();
  }

  Future<void> logout() async {
    await AuthService.logout();
    _isLoggedIn = false;
    _userId = null;
    _userEmail = null;
    _userRole = null;
    notifyListeners();
  }
}
