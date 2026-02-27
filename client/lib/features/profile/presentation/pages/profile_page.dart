import 'package:flutter/material.dart';
import 'package:o8m_marketplace/core/theme/app_theme.dart';
import 'package:o8m_marketplace/features/profile/data/profile_service.dart';

class ProfilePage extends StatefulWidget {
  const ProfilePage({super.key});

  @override
  State<ProfilePage> createState() => _ProfilePageState();
}

class _ProfilePageState extends State<ProfilePage> {
  Map<String, dynamic>? _profile;
  bool _isLoading = true;
  bool _isSaving = false;
  final _displayNameController = TextEditingController();
  final _bioController = TextEditingController();
  final _rateController = TextEditingController();
  final _audioRateController = TextEditingController();
  final _videoRateController = TextEditingController();
  final _messageRateController = TextEditingController();
  final _expertiseController = TextEditingController();
  String _availabilityStatus = 'OFFLINE';

  @override
  void initState() {
    super.initState();
    _loadProfile();
  }

  @override
  void dispose() {
    _displayNameController.dispose();
    _bioController.dispose();
    _rateController.dispose();
    _audioRateController.dispose();
    _videoRateController.dispose();
    _messageRateController.dispose();
    _expertiseController.dispose();
    super.dispose();
  }

  Future<void> _loadProfile() async {
    // Ensure profile exists then fetch it
    await ProfileService.ensureProfile();
    final profile = await ProfileService.getProfile();
    if (!mounted) return;
    setState(() {
      _profile = profile;
      _isLoading = false;
      if (profile != null) {
        _displayNameController.text = profile['displayName'] ?? '';
        _bioController.text = profile['bio'] ?? '';
        _rateController.text = (profile['ratePerMinute'] ?? 0).toString();
        _audioRateController.text =
            (profile['audioRate'] ?? profile['ratePerMinute'] ?? 0).toString();
        _videoRateController.text = (profile['videoRate'] ?? 0).toString();
        _messageRateController.text = (profile['messageRate'] ?? 1.0)
            .toString();
        final expertiseList = profile['expertise'] as List<dynamic>? ?? [];
        _expertiseController.text = expertiseList.join(', ');
        _availabilityStatus = profile['availabilityStatus'] ?? 'OFFLINE';
      }
    });
  }

  Future<void> _saveProfile() async {
    setState(() => _isSaving = true);

    final expertise = _expertiseController.text
        .split(',')
        .map((e) => e.trim())
        .where((e) => e.isNotEmpty)
        .toList();

    await ProfileService.updateProfile(
      displayName: _displayNameController.text.trim(),
      bio: _bioController.text.trim(),
      expertise: expertise,
    );

    // If host, also set rates
    if (_profile?['role'] == 'HOST') {
      final audioRate = double.tryParse(_audioRateController.text) ?? 0;
      final videoRate = double.tryParse(_videoRateController.text) ?? 0;
      final messageRate = double.tryParse(_messageRateController.text) ?? 1.0;
      await ProfileService.setRate(
        audioRate,
        audioRate: audioRate,
        videoRate: videoRate > 0 ? videoRate : audioRate * 1.5,
        messageRate: messageRate,
      );
    }

    if (!mounted) return;
    setState(() => _isSaving = false);

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: const Text('Profile saved!'),
        backgroundColor: AppTheme.success,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
    );

    _loadProfile();
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator(color: AppTheme.primary)),
      );
    }

    if (_profile == null) {
      return Scaffold(
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, color: AppTheme.error, size: 48),
              const SizedBox(height: 16),
              const Text(
                'Could not load profile',
                style: TextStyle(color: AppTheme.textPrimary),
              ),
              const SizedBox(height: 8),
              ElevatedButton(
                onPressed: () {
                  setState(() => _isLoading = true);
                  _loadProfile();
                },
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
      );
    }

    final isHost = _profile!['role'] == 'HOST';

    return Scaffold(
      appBar: AppBar(
        title: const Text('Edit Profile'),
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios, color: AppTheme.textPrimary),
          onPressed: () => Navigator.pop(context),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 480),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Avatar circle
              Center(
                child: Container(
                  width: 80,
                  height: 80,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: LinearGradient(
                      colors: isHost
                          ? [
                              AppTheme.hostColor,
                              AppTheme.hostColor.withValues(alpha: 0.6),
                            ]
                          : [
                              AppTheme.callerColor,
                              AppTheme.callerColor.withValues(alpha: 0.6),
                            ],
                    ),
                  ),
                  child: Center(
                    child: Text(
                      (_displayNameController.text.isNotEmpty
                              ? _displayNameController.text[0]
                              : '?')
                          .toUpperCase(),
                      style: const TextStyle(
                        fontSize: 32,
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Center(
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: (isHost ? AppTheme.hostColor : AppTheme.callerColor)
                        .withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    isHost ? 'HOST' : 'CALLER',
                    style: TextStyle(
                      color: isHost ? AppTheme.hostColor : AppTheme.callerColor,
                      fontWeight: FontWeight.w600,
                      fontSize: 12,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 28),

              // Display Name
              const Text(
                'Display Name',
                style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
              ),
              const SizedBox(height: 6),
              TextFormField(
                controller: _displayNameController,
                style: const TextStyle(color: AppTheme.textPrimary),
                decoration: const InputDecoration(
                  hintText: 'Your display name',
                ),
              ),
              const SizedBox(height: 20),

              // Bio
              const Text(
                'Bio',
                style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
              ),
              const SizedBox(height: 6),
              TextFormField(
                controller: _bioController,
                style: const TextStyle(color: AppTheme.textPrimary),
                maxLines: 3,
                maxLength: 500,
                decoration: const InputDecoration(
                  hintText: 'Tell others about yourself...',
                  counterStyle: TextStyle(color: AppTheme.textSecondary),
                ),
              ),
              const SizedBox(height: 20),

              // Host-only fields
              if (isHost) ...[
                // Availability status toggle
                const Text(
                  'Availability Status',
                  style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
                ),
                const SizedBox(height: 6),
                Row(
                  children: ['ONLINE', 'BUSY', 'OFFLINE'].map((status) {
                    final isSelected = _availabilityStatus == status;
                    return Expanded(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 2),
                        child: ChoiceChip(
                          label: Text(
                            status,
                            style: TextStyle(
                              fontSize: 11,
                              color: isSelected
                                  ? Colors.white
                                  : AppTheme.textSecondary,
                            ),
                          ),
                          selected: isSelected,
                          selectedColor: status == 'ONLINE'
                              ? AppTheme.success
                              : status == 'BUSY'
                              ? Colors.orange
                              : AppTheme.textSecondary,
                          onSelected: (_) async {
                            setState(() => _availabilityStatus = status);
                            await ProfileService.setAvailability(status);
                          },
                        ),
                      ),
                    );
                  }).toList(),
                ),
                const SizedBox(height: 20),

                const Text(
                  'Audio Rate per Minute (credits)',
                  style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
                ),
                const SizedBox(height: 6),
                TextFormField(
                  controller: _audioRateController,
                  style: const TextStyle(color: AppTheme.textPrimary),
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    hintText: '0.00',
                    prefixIcon: Icon(Icons.mic, color: AppTheme.textSecondary),
                  ),
                ),
                const SizedBox(height: 20),

                const Text(
                  'Video Rate per Minute (credits)',
                  style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
                ),
                const SizedBox(height: 6),
                TextFormField(
                  controller: _videoRateController,
                  style: const TextStyle(color: AppTheme.textPrimary),
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    hintText: 'Must be higher than audio rate',
                    prefixIcon: Icon(
                      Icons.videocam,
                      color: AppTheme.textSecondary,
                    ),
                  ),
                ),
                const SizedBox(height: 20),

                const Text(
                  'Message Rate (credits per message)',
                  style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
                ),
                const SizedBox(height: 6),
                TextFormField(
                  controller: _messageRateController,
                  style: const TextStyle(color: AppTheme.textPrimary),
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    hintText: '1.00',
                    prefixIcon: Icon(Icons.chat, color: AppTheme.textSecondary),
                  ),
                ),
                const SizedBox(height: 20),

                const Text(
                  'Expertise (comma-separated)',
                  style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
                ),
                const SizedBox(height: 6),
                TextFormField(
                  controller: _expertiseController,
                  style: const TextStyle(color: AppTheme.textPrimary),
                  decoration: const InputDecoration(
                    hintText: 'tech, coding, design',
                    prefixIcon: Icon(Icons.star, color: AppTheme.textSecondary),
                  ),
                ),
                const SizedBox(height: 20),
              ],

              // Save button
              SizedBox(
                height: 56,
                child: ElevatedButton(
                  onPressed: _isSaving ? null : _saveProfile,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: isHost
                        ? AppTheme.hostColor
                        : AppTheme.callerColor,
                  ),
                  child: _isSaving
                      ? const SizedBox(
                          width: 24,
                          height: 24,
                          child: CircularProgressIndicator(
                            color: Colors.white,
                            strokeWidth: 2,
                          ),
                        )
                      : const Text('Save Profile'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
