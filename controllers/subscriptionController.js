const Subscription = require('../models/Subscription');
const Payment = require('../models/Payment');
const User = require('../models/User');
const GridBot = require('../models/GridBot');
const cryptomusService = require('../services/cryptomusService');
const { getUserBotUsage } = require('../middleware/subscriptionAuth');

// Get current subscription status
const getSubscriptionStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get subscription info (already attached by middleware)
    const subscription = req.subscription;
    const planLimits = req.planLimits;
    
    // Get current usage
    const usage = await getUserBotUsage(userId);
    
    res.json({
      success: true,
      data: {
        subscription: {
          planType: subscription.planType,
          status: subscription.status,
          isActive: subscription.isActive(),
          startDate: subscription.startDate,
          endDate: subscription.endDate,
          autoRenew: subscription.autoRenew
        },
        limits: planLimits,
        usage,
        canUpgrade: subscription.planType === 'free'
      }
    });
  } catch (error) {
    console.error('Get subscription status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get subscription status'
    });
  }
};

// Get available subscription plans
const getSubscriptionPlans = async (req, res) => {
  try {
    const plans = {
      free: {
        name: 'Free Plan',
        price: 0,
        currency: 'USD',
        duration: 'Lifetime',
        features: {
          maxBots: 1,
          maxInvestmentPerBot: 100,
          support: 'Community',
          analytics: 'Basic'
        },
        limitations: [
          'Limited to 1 trading bot',
          'Maximum $100 investment per bot',
          'Basic analytics only',
          'Community support'
        ]
      },
      premium: {
        name: 'Premium Plan',
        price: 1,
        currency: 'USD',
        duration: '30 days',
        features: {
          maxBots: 3,
          maxInvestmentPerBot: 1000,
          support: 'Priority',
          analytics: 'Advanced'
        },
        benefits: [
          'Up to 3 trading bots',
          'Maximum $1,000 investment per bot',
          'Advanced analytics and insights',
          'Priority customer support',
          'Early access to new features'
        ]
      }
    };
    
    res.json({
      success: true,
      data: { plans }
    });
  } catch (error) {
    console.error('Get subscription plans error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get subscription plans'
    });
  }
};

// Create premium subscription payment
const createPremiumSubscription = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = req.user;
    
    // Check if user already has premium subscription
    if (req.subscription.planType === 'premium' && req.subscription.isActive()) {
      return res.status(400).json({
        success: false,
        message: 'You already have an active premium subscription'
      });
    }
    
    // Get premium plan details
    const premiumLimits = Subscription.getPlanLimits('premium');
    const amount = premiumLimits.price;
    
    // Generate unique order ID
    const orderId = cryptomusService.generateOrderId(userId);
    
    // Create payment record
    const payment = new Payment({
      userId,
      subscriptionId: req.subscription._id,
      cryptomusOrderId: orderId,
      cryptomusUuid: '', // Will be set after Cryptomus response
      amount,
      currency: 'USD',
      planType: 'premium',
      planDuration: 30
    });
    
    // Create payment with Cryptomus
    const paymentResult = await cryptomusService.createPayment({
      orderId,
      amount,
      currency: 'USD',
      userEmail: user.email,
      userName: user.name,
      description: 'Premium Subscription - 30 Days'
    });
    
    if (!paymentResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Failed to create payment',
        error: paymentResult.error
      });
    }
    
    // Update payment with Cryptomus data
    payment.cryptomusUuid = paymentResult.data.uuid;
    payment.paymentUrl = paymentResult.data.paymentUrl;
    payment.expiresAt = paymentResult.data.expiresAt;
    
    await payment.save();
    
    res.json({
      success: true,
      message: 'Payment created successfully',
      data: {
        paymentId: payment._id,
        orderId: payment.cryptomusOrderId,
        amount: payment.amount,
        currency: payment.currency,
        paymentUrl: payment.paymentUrl,
        expiresAt: payment.expiresAt
      }
    });
  } catch (error) {
    console.error('Create premium subscription error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create premium subscription'
    });
  }
};

// Get payment status
const getPaymentStatus = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const userId = req.user.id;
    
    const payment = await Payment.findOne({ _id: paymentId, userId });
    
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }
    
    // Check payment status with Cryptomus if still pending
    if (['pending', 'processing'].includes(payment.status) && !payment.isExpired()) {
      const statusResult = await cryptomusService.getPaymentStatus(
        payment.cryptomusUuid,
        payment.cryptomusOrderId
      );
      
      if (statusResult.success) {
        const newStatus = cryptomusService.getPaymentStatusFromWebhook(statusResult.data);
        
        if (newStatus !== payment.status) {
          payment.status = newStatus;
          
          if (newStatus === 'paid') {
            payment.paidAt = new Date();
            payment.paymentAmount = statusResult.data.paymentAmount;
            payment.paymentCurrency = statusResult.data.paymentCurrency;
            payment.transactionHash = statusResult.data.txid;
            payment.network = statusResult.data.network;
            
            // Upgrade user subscription
            await upgradeUserSubscription(userId, payment);
          }
          
          await payment.save();
        }
      }
    }
    
    res.json({
      success: true,
      data: {
        paymentId: payment._id,
        orderId: payment.cryptomusOrderId,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        paymentUrl: payment.paymentUrl,
        paidAt: payment.paidAt,
        expiresAt: payment.expiresAt,
        isExpired: payment.isExpired()
      }
    });
  } catch (error) {
    console.error('Get payment status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payment status'
    });
  }
};

// Get payment history
const getPaymentHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10 } = req.query;
    
    const payments = await Payment.find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select('-webhookData -errorMessage');
    
    const total = await Payment.countDocuments({ userId });
    
    res.json({
      success: true,
      data: {
        payments,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get payment history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payment history'
    });
  }
};

// Cancel subscription (downgrade to free)
const cancelSubscription = async (req, res) => {
  try {
    const userId = req.user.id;
    const subscription = req.subscription;
    
    if (subscription.planType === 'free') {
      return res.status(400).json({
        success: false,
        message: 'You are already on the free plan'
      });
    }
    
    // Update subscription
    subscription.status = 'cancelled';
    subscription.autoRenew = false;
    await subscription.save();
    
    res.json({
      success: true,
      message: 'Subscription cancelled successfully. You will be downgraded to the free plan when your current subscription expires.'
    });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel subscription'
    });
  }
};

// Helper function to upgrade user subscription
const upgradeUserSubscription = async (userId, payment) => {
  try {
    const subscription = await Subscription.findOne({ userId });
    
    if (subscription) {
      subscription.planType = 'premium';
      subscription.status = 'active';
      subscription.startDate = new Date();
      subscription.endDate = new Date(Date.now() + payment.planDuration * 24 * 60 * 60 * 1000);
      subscription.paymentId = payment.cryptomusOrderId;
      subscription.autoRenew = false;
      
      await subscription.save();
    }
  } catch (error) {
    console.error('Upgrade user subscription error:', error);
    throw error;
  }
};

module.exports = {
  getSubscriptionStatus,
  getSubscriptionPlans,
  createPremiumSubscription,
  getPaymentStatus,
  getPaymentHistory,
  cancelSubscription
};