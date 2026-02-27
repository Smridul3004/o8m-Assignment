const mongoose = require('mongoose');

// Mirror of User Service's Profile schema (read-only access)
const profileSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true },
    role: { type: String, enum: ['CALLER', 'HOST'], required: true },
    displayName: { type: String, default: '' },
    bio: { type: String, default: '' },
    avatarUrl: { type: String, default: '' },
    ratePerMinute: { type: Number, default: 0 },
    audioRate: { type: Number, default: 0 },
    videoRate: { type: Number, default: 0 },
    messageRate: { type: Number, default: 1.0 },
    expertise: { type: [String], default: [] },
    isAvailable: { type: Boolean, default: false },
    availabilityStatus: { type: String, enum: ['ONLINE', 'BUSY', 'OFFLINE', 'IN_CALL'], default: 'OFFLINE' },
    totalCalls: { type: Number, default: 0 },
    totalMinutes: { type: Number, default: 0 },
    averageRating: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('Profile', profileSchema);
