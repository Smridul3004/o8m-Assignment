import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:o8m_marketplace/core/providers/auth_provider.dart';
import 'package:o8m_marketplace/core/theme/app_theme.dart';
import 'package:o8m_marketplace/core/storage/token_storage.dart';
import 'package:o8m_marketplace/features/profile/presentation/pages/profile_page.dart';
import 'package:o8m_marketplace/features/discovery/presentation/pages/discovery_page.dart';
import 'package:o8m_marketplace/features/billing/presentation/pages/wallet_page.dart';
import 'package:o8m_marketplace/features/chat/presentation/pages/conversations_page.dart';
import 'package:o8m_marketplace/features/call/data/call_socket_service.dart';
import 'package:o8m_marketplace/features/call/data/call_service.dart';
import 'package:o8m_marketplace/features/call/presentation/pages/incoming_call_page.dart';
import 'package:o8m_marketplace/features/call/presentation/pages/in_call_page.dart';
import 'package:o8m_marketplace/features/profile/data/profile_service.dart';

class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  int _currentTab = 0;

  @override
  void initState() {
    super.initState();
    _initCallSocket();
  }

  Future<void> _initCallSocket() async {
    final user = await TokenStorage.getUser();
    final userId = user['id'];
    if (userId == null || userId.isEmpty) return;

    // Run profile ensure and active session check in parallel for faster init
    final results = await Future.wait([
      ProfileService.ensureProfile(),
      CallService.checkActiveSession(),
    ]);

    // Connect call socket (profile now exists)
    CallSocketService.instance.connect(userId);

    // Global incoming call listener
    CallSocketService.instance.onIncomingCall((data) {
      if (!mounted) return;
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => IncomingCallPage(
            sessionId: data['sessionId'] ?? '',
            callerId: data['callerId'] ?? '',
            callerName: data['callerName'] ?? 'Unknown',
            callType: data['callType'] ?? 'AUDIO',
            ratePerMinute: (data['ratePerMinute'] as num?)?.toDouble() ?? 1.0,
          ),
        ),
      );
    });

    // Crash recovery — check for active session (from parallel result)
    final active = results[1] as Map<String, dynamic>;
    if (active['hasActiveSession'] == true && active['session'] != null) {
      final session = active['session'] as Map<String, dynamic>;
      if (mounted && session['state'] == 'ACTIVE') {
        final isCaller = session['callerId'] == userId;
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => InCallPage(
              sessionId: session['sessionId'] ?? '',
              otherUserId: isCaller
                  ? session['hostId'] ?? ''
                  : session['callerId'] ?? '',
              otherUserName: 'Reconnected',
              ratePerMinute:
                  (session['ratePerMinute'] as num?)?.toDouble() ?? 1.0,
              isCaller: isCaller,
              answeredAt:
                  session['answeredAt'] ?? DateTime.now().toIso8601String(),
              agoraToken: '',
              agoraAppId: '',
              callType: session['callType'] ?? 'AUDIO',
            ),
          ),
        );
      }
    }
  }

  @override
  void dispose() {
    CallSocketService.instance.offIncomingCall();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final isHost = auth.userRole == 'HOST';

    return Scaffold(
      body: SafeArea(
        child: IndexedStack(
          index: _currentTab,
          children: [
            // Tab 0 — Dashboard
            _DashboardTab(auth: auth, isHost: isHost),
            // Tab 1 — Discover (callers browse hosts)
            const DiscoveryPage(),
            // Tab 2 — Messages
            const ConversationsPage(),
            // Tab 3 — Wallet
            const WalletPage(),
          ],
        ),
      ),
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          color: AppTheme.surface,
          border: Border(
            top: BorderSide(
              color: AppTheme.textSecondary.withValues(alpha: 0.1),
            ),
          ),
        ),
        child: BottomNavigationBar(
          currentIndex: _currentTab,
          onTap: (i) => setState(() => _currentTab = i),
          backgroundColor: Colors.transparent,
          elevation: 0,
          selectedItemColor: isHost ? AppTheme.hostColor : AppTheme.callerColor,
          unselectedItemColor: AppTheme.textSecondary,
          items: const [
            BottomNavigationBarItem(icon: Icon(Icons.home), label: 'Home'),
            BottomNavigationBarItem(
              icon: Icon(Icons.explore),
              label: 'Discover',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.chat_bubble_outline),
              label: 'Messages',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.account_balance_wallet),
              label: 'Wallet',
            ),
          ],
        ),
      ),
    );
  }
}

// ---------- Dashboard Tab (original Home content) ----------
class _DashboardTab extends StatelessWidget {
  final AuthProvider auth;
  final bool isHost;

  const _DashboardTab({required this.auth, required this.isHost});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) => RefreshIndicator(
        onRefresh: () async {
          // Data flows live from AuthProvider — nothing to reload,
          // but the gesture confirms the UI is responsive on mobile.
        },
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: constraints.maxHeight),
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
          // Header
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Welcome! 👋',
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    auth.userEmail ?? '',
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                ],
              ),
              IconButton(
                onPressed: () => auth.logout(),
                icon: const Icon(Icons.logout, color: AppTheme.textSecondary),
                tooltip: 'Logout',
              ),
            ],
          ),
          const SizedBox(height: 24),

          // Role badge
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: isHost
                    ? [
                        AppTheme.hostColor.withValues(alpha: 0.2),
                        AppTheme.hostColor.withValues(alpha: 0.1),
                      ]
                    : [
                        AppTheme.callerColor.withValues(alpha: 0.2),
                        AppTheme.callerColor.withValues(alpha: 0.1),
                      ],
              ),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: isHost
                    ? AppTheme.hostColor.withValues(alpha: 0.3)
                    : AppTheme.callerColor.withValues(alpha: 0.3),
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  isHost ? Icons.headset_mic : Icons.phone_in_talk,
                  color: isHost ? AppTheme.hostColor : AppTheme.callerColor,
                  size: 20,
                ),
                const SizedBox(width: 8),
                Text(
                  isHost ? 'Host Account' : 'Caller Account',
                  style: TextStyle(
                    color: isHost ? AppTheme.hostColor : AppTheme.callerColor,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 32),

          // User ID card
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: AppTheme.surfaceLight,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Your User ID',
                  style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
                ),
                const SizedBox(height: 8),
                Text(
                  auth.userId ?? 'N/A',
                  style: const TextStyle(
                    color: AppTheme.textPrimary,
                    fontSize: 14,
                    fontFamily: 'monospace',
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // Edit Profile card
          GestureDetector(
            onTap: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const ProfilePage()),
              );
            },
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: AppTheme.surfaceLight,
                borderRadius: BorderRadius.circular(16),
              ),
              child: Row(
                children: [
                  Icon(
                    Icons.person_outline,
                    color: isHost ? AppTheme.hostColor : AppTheme.callerColor,
                    size: 24,
                  ),
                  const SizedBox(width: 12),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Edit Profile',
                          style: TextStyle(
                            color: AppTheme.textPrimary,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        SizedBox(height: 2),
                        Text(
                          'Set up your name, bio & expertise',
                          style: TextStyle(
                            color: AppTheme.textSecondary,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const Icon(
                    Icons.chevron_right,
                    color: AppTheme.textSecondary,
                  ),
                ],
              ),
            ),
          ),

          const SizedBox(height: 32),

          // Logout
          SizedBox(
            width: double.infinity,
            height: 52,
            child: OutlinedButton.icon(
              onPressed: () => auth.logout(),
              icon: const Icon(Icons.logout),
              label: const Text('Sign Out'),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppTheme.error,
                side: BorderSide(color: AppTheme.error.withValues(alpha: 0.5)),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
            ),
          ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
