const Payment = require('../models/Payment');
const Subscription = require('../models/Subscription');
const cryptomusService = require('../services/cryptomusService');

// Handle Cryptomus webhook
const handleCryptomusWebhook = async (req, res) => {
  try {
    const webhookData = req.body;
    // Extract signature from request body (not headers)
    const signature = webhookData.sign;
    
    // Enhanced logging for debugging
    console.log('=== CRYPTOMUS WEBHOOK RECEIVED ===');
    console.log('Headers:', {
      'content-type': req.headers['content-type'],
      'user-agent': req.headers['user-agent']
    });
    console.log('Raw Body:', JSON.stringify(req.body, null, 2));
    console.log('Webhook Data:', {
      orderId: webhookData.order_id,
      status: webhookData.payment_status || webhookData.status,
      amount: webhookData.amount,
      uuid: webhookData.uuid,
      allFields: Object.keys(webhookData)
    });
    console.log('Signature received:', signature);
    
    // Create a copy of webhook data without the signature for verification
    const dataForVerification = { ...webhookData };
    delete dataForVerification.sign;
    
    // Verify webhook signature
    const isValidSignature = cryptomusService.verifyWebhookSignature(dataForVerification, signature);
    console.log('Signature verification result:', isValidSignature);
    
    if (!isValidSignature) {
      console.error('=== SIGNATURE VERIFICATION FAILED ===');
      console.error('Data used for verification (without sign):');
      const jsonString = JSON.stringify(dataForVerification);
      const encodedData = Buffer.from(jsonString).toString('base64');
      console.error('JSON String:', jsonString);
      console.error('Base64 Encoded:', encodedData);
      console.error('Webhook Secret:', process.env.CRYPTOMUS_WEBHOOK_SECRET);
      console.error('Received signature:', signature);
      console.error('Expected signature:', require('crypto').createHash('md5').update(encodedData + process.env.CRYPTOMUS_WEBHOOK_SECRET).digest('hex'));
      
      // Also log the original webhook data for comparison
      console.error('Original webhook data (with sign):');
      console.error('Original JSON:', JSON.stringify(webhookData));
      console.error('Original Base64:', Buffer.from(JSON.stringify(webhookData)).toString('base64'));
      
      return res.status(400).json({
        success: false,
        message: 'Invalid signature'
      });
    }
    
    // Validate webhook data (handle both payment_status and status fields)
    const hasRequiredFields = webhookData.uuid && webhookData.order_id && webhookData.amount && 
                             (webhookData.payment_status || webhookData.status);
    
    if (!hasRequiredFields) {
      console.error('Invalid webhook data - missing required fields:', {
        uuid: !!webhookData.uuid,
        order_id: !!webhookData.order_id,
        amount: !!webhookData.amount,
        payment_status: !!webhookData.payment_status,
        status: !!webhookData.status,
        allFields: Object.keys(webhookData)
      });
      return res.status(400).json({
        success: false,
        message: 'Invalid webhook data'
      });
    }
    
    // Find payment by order ID
    console.log('Searching for payment with order ID:', webhookData.order_id);
    const payment = await Payment.findByOrderId(webhookData.order_id);
    
    if (!payment) {
      console.error('=== PAYMENT NOT FOUND ===');
      console.error('Order ID searched:', webhookData.order_id);
      
      // Debug: List recent payments to help identify the issue
      const recentPayments = await Payment.find({}).sort({ createdAt: -1 }).limit(5).select('cryptomusOrderId amount status createdAt');
      console.error('Recent payments in database:', recentPayments);
      
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }
    
    console.log('Payment found:', {
      paymentId: payment._id,
      userId: payment.userId,
      currentStatus: payment.status,
      amount: payment.amount,
      createdAt: payment.createdAt
    });
    
    // Get payment status from webhook
    const newStatus = cryptomusService.getPaymentStatusFromWebhook(webhookData);
    const webhookStatus = webhookData.payment_status || webhookData.status;
    
    console.log('Processing payment status change:', {
      paymentId: payment._id,
      oldStatus: payment.status,
      newStatus,
      webhookStatus,
      rawWebhookStatus: webhookData.payment_status,
      rawStatus: webhookData.status
    });
    
    // Update payment status
    payment.status = newStatus;
    payment.webhookData = webhookData;
    
    // Handle successful payment
    if (newStatus === 'paid') {
      payment.paidAt = new Date();
      
      // Update payment details from webhook
      if (webhookData.payment_amount) {
        payment.paymentAmount = parseFloat(webhookData.payment_amount);
      }
      if (webhookData.payer_currency) {
        payment.paymentCurrency = webhookData.payer_currency;
      }
      if (webhookData.txid) {
        payment.transactionHash = webhookData.txid;
      }
      if (webhookData.network) {
        payment.network = webhookData.network;
      }
      
      // Upgrade user subscription
      console.log('=== UPGRADING USER SUBSCRIPTION ===');
      console.log('User ID:', payment.userId);
      console.log('Payment details:', {
        paymentId: payment._id,
        amount: payment.amount,
        planType: payment.planType,
        planDuration: payment.planDuration
      });
      
      await upgradeUserSubscription(payment.userId, payment);
      
      console.log('=== SUBSCRIPTION UPGRADE COMPLETED ===');
      console.log('Payment completed and subscription upgraded:', {
        userId: payment.userId,
        paymentId: payment._id,
        amount: payment.amount
      });
    }
    
    // Handle failed payment
    if (['failed', 'cancelled'].includes(newStatus)) {
      payment.errorMessage = webhookData.fail_reason || 'Payment failed';
      
      console.log('Payment failed:', {
        paymentId: payment._id,
        reason: payment.errorMessage
      });
    }
    
    await payment.save();
    
    // Respond to webhook
    res.json({
      success: true,
      message: 'Webhook processed successfully'
    });
    
  } catch (error) {
    console.error('=== WEBHOOK PROCESSING ERROR ===');
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      webhookData: req.body,
      headers: {
        'sign': req.headers['sign'],
        'signature': req.headers['signature'],
        'content-type': req.headers['content-type']
      }
    });
    
    // Log specific error types for better debugging
    if (error.name === 'ValidationError') {
      console.error('Validation Error Details:', error.errors);
    } else if (error.name === 'CastError') {
      console.error('Database Cast Error:', error.path, error.value);
    }
    
    res.status(500).json({
      success: false,
      message: 'Webhook processing failed',
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    });
  }
};

// Get payment currencies (for frontend)
const getPaymentCurrencies = async (req, res) => {
  try {
    const result = await cryptomusService.getCurrencies();
    
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Failed to get payment currencies',
        error: result.error
      });
    }
    
    res.json({
      success: true,
      data: result.data
    });
  } catch (error) {
    console.error('Get payment currencies error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payment currencies'
    });
  }
};

// Resend webhook (for debugging)
const resendWebhook = async (req, res) => {
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
    
    const result = await cryptomusService.resendWebhook(
      payment.cryptomusUuid,
      payment.cryptomusOrderId
    );
    
    res.json({
      success: result.success,
      message: result.success ? 'Webhook resent successfully' : 'Failed to resend webhook',
      error: result.error
    });
  } catch (error) {
    console.error('Resend webhook error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resend webhook'
    });
  }
};

// Helper function to upgrade user subscription
const upgradeUserSubscription = async (userId, payment) => {
  try {
    console.log('=== STARTING SUBSCRIPTION UPGRADE ===');
    console.log('Looking for subscription for user:', userId);
    
    const subscription = await Subscription.findOne({ userId });
    
    if (!subscription) {
      console.error('=== SUBSCRIPTION NOT FOUND ===');
      console.error('User ID:', userId);
      
      // Debug: List recent subscriptions
      const recentSubscriptions = await Subscription.find({}).sort({ createdAt: -1 }).limit(5).select('userId planType status createdAt');
      console.error('Recent subscriptions:', recentSubscriptions);
      
      throw new Error('Subscription not found for user');
    }
    
    console.log('Current subscription found:', {
      subscriptionId: subscription._id,
      currentPlanType: subscription.planType,
      currentStatus: subscription.status,
      currentEndDate: subscription.endDate
    });
    
    // Calculate end date based on plan duration (in days)
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + payment.planDuration);
    
    console.log('Updating subscription with:', {
      newPlanType: payment.planType,
      newStatus: 'active',
      startDate,
      endDate,
      paymentId: payment._id
    });
    
    // Update subscription
    subscription.planType = payment.planType;
    subscription.status = 'active';
    subscription.startDate = startDate;
    subscription.endDate = endDate;
    subscription.paymentId = payment._id;
    subscription.autoRenew = false;
    
    const savedSubscription = await subscription.save();
    
    console.log('=== SUBSCRIPTION UPGRADE SUCCESS ===');
    console.log('Subscription upgraded successfully:', {
      userId,
      subscriptionId: savedSubscription._id,
      planType: subscription.planType,
      status: savedSubscription.status,
      endDate: savedSubscription.endDate
    });
    
  } catch (error) {
    console.error('=== SUBSCRIPTION UPGRADE ERROR ===');
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      userId,
      paymentDetails: {
        paymentId: payment._id,
        amount: payment.amount,
        planType: payment.planType,
        planDuration: payment.planDuration
      }
    });
    
    // Log specific error types
    if (error.name === 'ValidationError') {
      console.error('Subscription Validation Error:', error.errors);
    } else if (error.name === 'CastError') {
      console.error('Subscription Cast Error:', error.path, error.value);
    } else if (error.message.includes('not found')) {
      console.error('Subscription not found for user:', userId);
    }
    
    throw error;
  }
};

// Clean up expired payments (utility function)
const cleanupExpiredPayments = async () => {
  try {
    const expiredPayments = await Payment.findExpiredPayments();
    
    for (const payment of expiredPayments) {
      if (['pending', 'processing'].includes(payment.status)) {
        payment.status = 'expired';
        await payment.save();
      }
    }
    
    console.log(`Cleaned up ${expiredPayments.length} expired payments`);
  } catch (error) {
    console.error('Cleanup expired payments error:', error);
  }
};

// Check pending payments (utility function)
const checkPendingPayments = async () => {
  try {
    const pendingPayments = await Payment.findPendingPayments();
    
    for (const payment of pendingPayments) {
      try {
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
              
              await upgradeUserSubscription(payment.userId, payment);
            }
            
            await payment.save();
          }
        }
      } catch (error) {
        console.error(`Error checking payment ${payment._id}:`, error);
      }
    }
    
    console.log(`Checked ${pendingPayments.length} pending payments`);
  } catch (error) {
    console.error('Check pending payments error:', error);
  }
};

module.exports = {
  handleCryptomusWebhook,
  getPaymentCurrencies,
  resendWebhook,
  cleanupExpiredPayments,
  checkPendingPayments
};