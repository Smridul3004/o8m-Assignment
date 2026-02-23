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
  final _expertiseController = TextEditingController();

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
        final expertiseList = profile['expertise'] as List<dynamic>? ?? [];
        _expertiseController.text = expertiseList.join(', ');
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

    // If host, also set rate
    if (_profile?['role'] == 'HOST') {
      final rate = double.tryParse(_rateController.text) ?? 0;
      await ProfileService.setRate(rate);
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
                const Text(
                  'Rate per Minute (credits)',
                  style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
                ),
                const SizedBox(height: 6),
                TextFormField(
                  controller: _rateController,
                  style: const TextStyle(color: AppTheme.textPrimary),
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    hintText: '0.00',
                    prefixIcon: Icon(
                      Icons.monetization_on,
                      color: AppTheme.textSecondary,
                    ),
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
