import 'dart:async';
import 'package:flutter/material.dart';
import 'package:o8m_marketplace/core/theme/app_theme.dart';
import 'package:o8m_marketplace/core/storage/token_storage.dart';
import 'package:o8m_marketplace/features/discovery/data/discovery_service.dart';
import 'package:o8m_marketplace/features/chat/data/chat_service.dart';
import 'package:o8m_marketplace/features/chat/presentation/pages/chat_page.dart';
import 'package:o8m_marketplace/features/call/data/call_socket_service.dart';
import 'package:o8m_marketplace/features/call/presentation/pages/outgoing_call_page.dart';

class DiscoveryPage extends StatefulWidget {
  const DiscoveryPage({super.key});

  @override
  State<DiscoveryPage> createState() => _DiscoveryPageState();
}

class _DiscoveryPageState extends State<DiscoveryPage> with WidgetsBindingObserver {
  List<dynamic> _hosts = [];
  bool _isLoading = true;
  final _searchController = TextEditingController();
  Timer? _refreshTimer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _loadHosts();
    // Auto-refresh host statuses every 15 seconds
    _refreshTimer = Timer.periodic(const Duration(seconds: 15), (_) {
      if (mounted) _loadHostsSilent();
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _refreshTimer?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Refresh when app comes to foreground
    if (state == AppLifecycleState.resumed && mounted) {
      _loadHostsSilent();
    }
  }

  Future<void> _loadHosts({String? search}) async {
    setState(() => _isLoading = true);
    final data = await DiscoveryService.getHosts(search: search);
    if (!mounted) return;
    setState(() {
      _hosts = data['hosts'] ?? [];
      _isLoading = false;
    });
  }

  /// Silent refresh without showing loading indicator (preserves UI state)
  Future<void> _loadHostsSilent() async {
    final searchText = _searchController.text.trim();
    final data = await DiscoveryService.getHosts(
      search: searchText.isNotEmpty ? searchText : null,
    );
    if (!mounted) return;
    setState(() {
      _hosts = data['hosts'] ?? [];
    });
  }

  void _showHostDetail(Map<String, dynamic> host) {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppTheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => _HostDetailSheet(
        host: host,
        onStartCall: (callType) {
          Navigator.pop(ctx); // dismiss the bottom sheet
          _initiateCall(host, callType);
        },
        onMessage: () {
          Navigator.pop(ctx); // dismiss the bottom sheet first
          _startMessage(host);
        },
      ),
    );
  }

  /// Start a message conversation using the parent page context (survives bottom sheet pop).
  Future<void> _startMessage(Map<String, dynamic> host) async {
    final hostUserId = host['userId'] as String? ?? '';
    final hostName = (host['displayName'] ?? 'Host').toString();
    if (hostUserId.isEmpty) return;

    final user = await TokenStorage.getUser();
    final convo = await ChatService.createConversation(hostUserId);
    if (convo != null && mounted) {
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => ChatPage(
            conversationId: convo['_id'],
            otherUserId: hostUserId,
            otherUserName: hostName.isNotEmpty ? hostName : 'Host',
            isCaller: user['id'] != hostUserId,
          ),
        ),
      );
    } else if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Failed to start conversation. Please try again.'),
          backgroundColor: Colors.redAccent,
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  /// Initiate a call using the parent page context (survives bottom sheet pop).
  void _initiateCall(Map<String, dynamic> host, String callType) {
    final hostUserId = host['userId'] as String? ?? '';
    final hostName = (host['displayName'] ?? 'Host').toString();
    if (hostUserId.isEmpty) return;

    final rawAudio = (host['audioRate'] as num?)?.toDouble() ?? 0;
    final audioRate = rawAudio > 0
        ? rawAudio
        : (host['ratePerMinute'] as num?)?.toDouble() ?? 1;
    final rawVideo = (host['videoRate'] as num?)?.toDouble() ?? 0;
    final videoRate = rawVideo > 0 ? rawVideo : audioRate;
    final rate = callType == 'VIDEO' ? videoRate : audioRate;
    final socket = CallSocketService.instance;

    socket.onCallInitiated((data) {
      if (!mounted) return;
      socket.offCallInitiated();
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => OutgoingCallPage(
            sessionId: data['sessionId'] ?? '',
            hostId: hostUserId,
            hostName: hostName,
            ratePerMinute: rate,
            callType: callType,
          ),
        ),
      );
    });

    socket.onCallError((data) {
      socket.offCallError();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(data['message'] ?? data['error'] ?? 'Call failed'),
          backgroundColor: Colors.redAccent,
          behavior: SnackBarBehavior.floating,
        ),
      );
    });

    socket.initiateCall(
      hostId: hostUserId,
      hostRate: audioRate,
      callType: callType,
      videoRate: videoRate > 0 ? videoRate : null,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // Search bar
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: TextField(
            controller: _searchController,
            style: const TextStyle(color: AppTheme.textPrimary),
            decoration: InputDecoration(
              hintText: 'Search hosts by name or expertise...',
              prefixIcon: const Icon(
                Icons.search,
                color: AppTheme.textSecondary,
              ),
              suffixIcon: _searchController.text.isNotEmpty
                  ? IconButton(
                      icon: const Icon(
                        Icons.clear,
                        color: AppTheme.textSecondary,
                      ),
                      onPressed: () {
                        _searchController.clear();
                        _loadHosts();
                      },
                    )
                  : null,
            ),
            onSubmitted: (val) => _loadHosts(search: val),
          ),
        ),

        // Results
        Expanded(
          child: _isLoading
              ? const Center(
                  child: CircularProgressIndicator(color: AppTheme.primary),
                )
              : _hosts.isEmpty
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.person_search,
                        size: 64,
                        color: AppTheme.textSecondary.withValues(alpha: 0.5),
                      ),
                      const SizedBox(height: 16),
                      const Text(
                        'No hosts found',
                        style: TextStyle(
                          color: AppTheme.textSecondary,
                          fontSize: 16,
                        ),
                      ),
                      const SizedBox(height: 8),
                      const Text(
                        'Try a different search',
                        style: TextStyle(
                          color: AppTheme.textSecondary,
                          fontSize: 13,
                        ),
                      ),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: () => _loadHosts(search: _searchController.text),
                  child: ListView.builder(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    itemCount: _hosts.length,
                    itemBuilder: (ctx, i) => _HostCard(
                      host: _hosts[i],
                      onTap: () => _showHostDetail(_hosts[i]),
                    ),
                  ),
                ),
        ),
      ],
    );
  }
}

// ---------- Host Card ----------
class _HostCard extends StatelessWidget {
  final Map<String, dynamic> host;
  final VoidCallback onTap;

  const _HostCard({required this.host, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final name = (host['displayName'] ?? '').toString();
    final bio = (host['bio'] ?? '').toString();
    final rate = (host['ratePerMinute'] ?? 0).toDouble();
    final audioRate = (host['audioRate'] ?? rate).toDouble();
    final videoRate = (host['videoRate'] ?? 0).toDouble();
    final rating = (host['averageRating'] ?? 0).toDouble();
    final expertiseList = (host['expertise'] as List<dynamic>?) ?? [];
    final available = host['isAvailable'] == true;
    final availabilityStatus =
        (host['availabilityStatus'] ?? (available ? 'ONLINE' : 'OFFLINE'))
            .toString();

    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppTheme.surfaceLight,
          borderRadius: BorderRadius.circular(16),
          border: available
              ? Border.all(color: AppTheme.hostColor.withValues(alpha: 0.3))
              : null,
        ),
        child: Row(
          children: [
            // Avatar
            Container(
              width: 48,
              height: 48,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: LinearGradient(
                  colors: [
                    AppTheme.hostColor,
                    AppTheme.hostColor.withValues(alpha: 0.6),
                  ],
                ),
              ),
              child: Center(
                child: Text(
                  (name.isNotEmpty ? name[0] : '?').toUpperCase(),
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 14),

            // Info
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          name.isNotEmpty ? name : 'Unnamed Host',
                          style: const TextStyle(
                            color: AppTheme.textPrimary,
                            fontWeight: FontWeight.w600,
                            fontSize: 15,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: availabilityStatus == 'ONLINE'
                              ? AppTheme.success.withValues(alpha: 0.15)
                              : availabilityStatus == 'IN_CALL'
                              ? Colors.orange.withValues(alpha: 0.15)
                              : availabilityStatus == 'BUSY'
                              ? Colors.red.withValues(alpha: 0.15)
                              : AppTheme.textSecondary.withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          availabilityStatus,
                          style: TextStyle(
                            fontSize: 9,
                            fontWeight: FontWeight.w600,
                            color: availabilityStatus == 'ONLINE'
                                ? AppTheme.success
                                : availabilityStatus == 'IN_CALL'
                                ? Colors.orange
                                : availabilityStatus == 'BUSY'
                                ? Colors.red
                                : AppTheme.textSecondary,
                          ),
                        ),
                      ),
                    ],
                  ),
                  if (bio.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      bio,
                      style: const TextStyle(
                        color: AppTheme.textSecondary,
                        fontSize: 12,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      Icon(Icons.star, size: 14, color: Colors.amber.shade400),
                      const SizedBox(width: 2),
                      Text(
                        rating.toStringAsFixed(1),
                        style: const TextStyle(
                          color: AppTheme.textSecondary,
                          fontSize: 12,
                        ),
                      ),
                      const SizedBox(width: 8),
                      const Icon(
                        Icons.mic,
                        size: 14,
                        color: AppTheme.hostColor,
                      ),
                      const SizedBox(width: 2),
                      Text(
                        '${audioRate.toStringAsFixed(1)}/min',
                        style: const TextStyle(
                          color: AppTheme.textSecondary,
                          fontSize: 12,
                        ),
                      ),
                      if (videoRate > 0) ...[
                        const SizedBox(width: 8),
                        const Icon(
                          Icons.videocam,
                          size: 14,
                          color: AppTheme.primary,
                        ),
                        const SizedBox(width: 2),
                        Text(
                          '${videoRate.toStringAsFixed(1)}/min',
                          style: const TextStyle(
                            color: AppTheme.textSecondary,
                            fontSize: 12,
                          ),
                        ),
                      ],
                      if (expertiseList.isNotEmpty) ...[
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            expertiseList.join(', '),
                            style: TextStyle(
                              color: AppTheme.hostColor.withValues(alpha: 0.8),
                              fontSize: 11,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            const Icon(Icons.chevron_right, color: AppTheme.textSecondary),
          ],
        ),
      ),
    );
  }
}

// ---------- Host Detail Bottom Sheet ----------
class _HostDetailSheet extends StatelessWidget {
  final Map<String, dynamic> host;
  final void Function(String callType) onStartCall;
  final VoidCallback onMessage;

  const _HostDetailSheet({
    required this.host,
    required this.onStartCall,
    required this.onMessage,
  });

  @override
  Widget build(BuildContext context) {
    final name = (host['displayName'] ?? '').toString();
    final bio = (host['bio'] ?? '').toString();
    final rawAudioRate = (host['audioRate'] as num?)?.toDouble() ?? 0;
    final audioRate = rawAudioRate > 0
        ? rawAudioRate
        : (host['ratePerMinute'] as num?)?.toDouble() ?? 0;
    final videoRate = ((host['videoRate'] as num?)?.toDouble() ?? 0);
    final messageRate = (host['messageRate'] ?? 0).toDouble();
    final rating = (host['averageRating'] ?? 0).toDouble();
    final calls = host['totalCalls'] ?? 0;
    final expertiseList = (host['expertise'] as List<dynamic>?) ?? [];
    final availabilityStatus = (host['availabilityStatus'] ?? 'OFFLINE')
        .toString();
    final isOnline = availabilityStatus == 'ONLINE';

    Color statusColor;
    switch (availabilityStatus) {
      case 'ONLINE':
        statusColor = AppTheme.success;
        break;
      case 'IN_CALL':
        statusColor = Colors.orange;
        break;
      case 'BUSY':
        statusColor = Colors.red;
        break;
      default:
        statusColor = AppTheme.textSecondary;
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Handle bar
          Container(
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: AppTheme.textSecondary.withValues(alpha: 0.3),
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(height: 20),

          // Avatar
          Container(
            width: 72,
            height: 72,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: LinearGradient(
                colors: [
                  AppTheme.hostColor,
                  AppTheme.hostColor.withValues(alpha: 0.6),
                ],
              ),
            ),
            child: Center(
              child: Text(
                (name.isNotEmpty ? name[0] : '?').toUpperCase(),
                style: const TextStyle(
                  fontSize: 28,
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                ),
              ),
            ),
          ),
          const SizedBox(height: 12),

          // Name + availability
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                name.isNotEmpty ? name : 'Unnamed Host',
                style: const TextStyle(
                  color: AppTheme.textPrimary,
                  fontWeight: FontWeight.bold,
                  fontSize: 20,
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: statusColor.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  availabilityStatus,
                  style: TextStyle(
                    color: statusColor,
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),

          // Bio
          if (bio.isNotEmpty)
            Text(
              bio,
              style: const TextStyle(
                color: AppTheme.textSecondary,
                fontSize: 14,
              ),
              textAlign: TextAlign.center,
            ),
          const SizedBox(height: 16),

          // Stats row
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              _StatChip(
                icon: Icons.star,
                label: rating.toStringAsFixed(1),
                color: Colors.amber.shade400,
              ),
              const SizedBox(width: 16),
              _StatChip(
                icon: Icons.call,
                label: '$calls calls',
                color: AppTheme.primary,
              ),
            ],
          ),
          const SizedBox(height: 12),

          // Rate cards
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              _StatChip(
                icon: Icons.mic,
                label: '\$${audioRate.toStringAsFixed(1)}/min',
                color: AppTheme.hostColor,
              ),
              if (videoRate > 0) ...[
                const SizedBox(width: 12),
                _StatChip(
                  icon: Icons.videocam,
                  label: '\$${videoRate.toStringAsFixed(1)}/min',
                  color: AppTheme.primary,
                ),
              ],
              if (messageRate > 0) ...[
                const SizedBox(width: 12),
                _StatChip(
                  icon: Icons.chat,
                  label: '\$${messageRate.toStringAsFixed(1)}/msg',
                  color: Colors.teal,
                ),
              ],
            ],
          ),
          const SizedBox(height: 16),

          // Expertise chips
          if (expertiseList.isNotEmpty)
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: expertiseList
                  .map(
                    (e) => Chip(
                      label: Text(
                        e.toString(),
                        style: const TextStyle(
                          color: AppTheme.hostColor,
                          fontSize: 12,
                        ),
                      ),
                      backgroundColor: AppTheme.hostColor.withValues(
                        alpha: 0.1,
                      ),
                      side: BorderSide(
                        color: AppTheme.hostColor.withValues(alpha: 0.3),
                      ),
                    ),
                  )
                  .toList(),
            ),
          const SizedBox(height: 20),

          // Audio Call button
          SizedBox(
            width: double.infinity,
            height: 52,
            child: ElevatedButton.icon(
              onPressed: isOnline ? () => onStartCall('AUDIO') : null,
              icon: const Icon(Icons.call),
              label: Text('Audio Call (\$${audioRate.toStringAsFixed(1)}/min)'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.hostColor,
                disabledBackgroundColor: AppTheme.hostColor.withValues(
                  alpha: 0.3,
                ),
              ),
            ),
          ),
          const SizedBox(height: 10),

          // Video Call button
          if (videoRate > 0)
            SizedBox(
              width: double.infinity,
              height: 52,
              child: ElevatedButton.icon(
                onPressed: isOnline ? () => onStartCall('VIDEO') : null,
                icon: const Icon(Icons.videocam),
                label: Text(
                  'Video Call (\$${videoRate.toStringAsFixed(1)}/min)',
                ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppTheme.primary,
                  disabledBackgroundColor: AppTheme.primary.withValues(
                    alpha: 0.3,
                  ),
                ),
              ),
            ),
          if (videoRate > 0) const SizedBox(height: 10),

          // Message button
          SizedBox(
            width: double.infinity,
            height: 52,
            child: OutlinedButton.icon(
              onPressed: onMessage,
              icon: const Icon(Icons.chat_bubble_outline),
              label: Text('Message ${name.isNotEmpty ? name : "Host"}'),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppTheme.primary,
                side: BorderSide(
                  color: AppTheme.primary.withValues(alpha: 0.5),
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
            ),
          ),
          const SizedBox(height: 8),
        ],
      ),
    );
  }
}

class _StatChip extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;

  const _StatChip({
    required this.icon,
    required this.label,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 16, color: color),
        const SizedBox(width: 4),
        Text(
          label,
          style: const TextStyle(
            color: AppTheme.textPrimary,
            fontSize: 13,
            fontWeight: FontWeight.w500,
          ),
        ),
      ],
    );
  }
}
