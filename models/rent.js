const mongoose = require('mongoose');
const { PAYMENT_STATUS_ENUM } = require('../utils/constants/enums');

const RentSchema = new mongoose.Schema({
    lease: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lease',
        required: true
    },
    // Changed from direct User reference to PropertyUser reference
    tenantPropertyUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PropertyUser',
        required: true
    },
    property: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Property',
        required: true
    },
    unit: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Unit',
        required: true
    },
    billingPeriod: {
        type: String,
        required: true
    },
    amountDue: {
        type: Number,
        required: true,
        min: 0
    },
    dueDate: {
        type: Date,
        required: true
    },
    amountPaid: {
        type: Number,
        default: 0,
        min: 0
    },
    paymentDate: Date,
    status: {
        type: String,
        enum: PAYMENT_STATUS_ENUM,
        default: 'due'
    },
    paymentMethod: {
        type: String,
        trim: true
    },
    transactionId: {
        type: String,
        trim: true
    },
    paymentProof: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Media',
        default: null
    },
    notes: {
        type: String,
        trim: true
    },
    reminderSent: {
        type: Boolean,
        default: false
    },
    lastReminderDate: Date,
}, {
    timestamps: true
});

// Virtual to get tenant User directly
RentSchema.virtual('tenant').get(async function() {
    if (!this.populated('tenantPropertyUser')) {
        await this.populate('tenantPropertyUser');
    }
    return this.tenantPropertyUser ? this.tenantPropertyUser.user : null;
});

// Utility method to calculate if rent is overdue
RentSchema.methods.isOverdue = function() {
    return this.status === 'due' && new Date() > this.dueDate;
};

// Method to calculate days overdue
RentSchema.methods.daysOverdue = function() {
    if (this.status !== 'due' || new Date() <= this.dueDate) {
        return 0;
    }
    
    const today = new Date();
    const dueDate = new Date(this.dueDate);
    const diffTime = Math.abs(today - dueDate);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

// Indexes for efficient querying
RentSchema.index({ lease: 1 });
RentSchema.index({ tenantPropertyUser: 1 });
RentSchema.index({ property: 1 });
RentSchema.index({ unit: 1 });
RentSchema.index({ dueDate: 1, status: 1 });

module.exports = mongoose.models.Rent || mongoose.model('Rent', RentSchema);