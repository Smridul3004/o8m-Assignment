const mongoose = require('mongoose');

const profileSchema = new mongoose.Schema({
    // Links to auth-service user UUID
    userId: {
        type: String,
        required: true,
        unique: true,
        index: true,
    },
    email: {
        type: String,
        required: true,
    },
    role: {
        type: String,
        enum: ['CALLER', 'HOST'],
        required: true,
    },
    displayName: {
        type: String,
        default: '',
    },
    bio: {
        type: String,
        default: '',
        maxlength: 500,
    },
    avatarUrl: {
        type: String,
        default: '',
    },
    // Host-specific fields — separate rates for audio, video, message
    ratePerMinute: {
        type: Number,
        default: 0,
        min: 0,
    },
    audioRate: {
        type: Number,
        default: 0,
        min: 0,
    },
    videoRate: {
        type: Number,
        default: 0,
        min: 0,
    },
    messageRate: {
        type: Number,
        default: 1.0,
        min: 0,
    },
    expertise: {
        type: [String],
        default: [],
    },
    isAvailable: {
        type: Boolean,
        default: false,
    },
    availabilityStatus: {
        type: String,
        enum: ['ONLINE', 'BUSY', 'OFFLINE', 'IN_CALL'],
        default: 'OFFLINE',
    },
    // Stats
    totalCalls: {
        type: Number,
        default: 0,
    },
    totalMinutes: {
        type: Number,
        default: 0,
    },
    averageRating: {
        type: Number,
        default: 0,
        min: 0,
        max: 5,
    },
    // Caller-specific
    creditBalance: {
        type: Number,
        default: 0,
        min: 0,
    },
}, {
    timestamps: true,
});

module.exports = mongoose.model('Profile', profileSchema);
