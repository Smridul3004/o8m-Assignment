import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'core/providers/auth_provider.dart';
import 'core/theme/app_theme.dart';
import 'features/auth/presentation/pages/login_page.dart';
import 'features/home/presentation/pages/home_page.dart';

void main() {
  runApp(
    ChangeNotifierProvider(
      create: (_) => AuthProvider()..checkAuth(),
      child: const O8mApp(),
    ),
  );
}

class O8mApp extends StatelessWidget {
  const O8mApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'o8m Marketplace',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.darkTheme,
      home: Consumer<AuthProvider>(
        builder: (context, auth, _) {
          // Show loading while checking stored tokens
          if (auth.isLoading) {
            return const Scaffold(
              body: Center(
                child: CircularProgressIndicator(color: AppTheme.primary),
              ),
            );
          }

          // Show Home if logged in, Login if not
          return auth.isLoggedIn ? const HomePage() : const LoginPage();
        },
      ),
    );
  }
}
