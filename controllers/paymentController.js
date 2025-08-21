const Payment = require('../models/Payment');
const Subscription = require('../models/Subscription');
const cryptomusService = require('../services/cryptomusService');

// Handle Cryptomus webhook
const handleCryptomusWebhook = async (req, res) => {
  try {
    const webhookData = req.body;
    const signature = req.headers['sign'] || req.headers['signature'];
    
    console.log('Received Cryptomus webhook:', {
      orderId: webhookData.order_id,
      status: webhookData.payment_status,
      amount: webhookData.amount
    });
    
    // Verify webhook signature
    if (!cryptomusService.verifyWebhookSignature(webhookData, signature)) {
      console.error('Invalid webhook signature');
      return res.status(400).json({
        success: false,
        message: 'Invalid signature'
      });
    }
    
    // Validate webhook data
    if (!cryptomusService.validateWebhookData(webhookData)) {
      console.error('Invalid webhook data:', webhookData);
      return res.status(400).json({
        success: false,
        message: 'Invalid webhook data'
      });
    }
    
    // Find payment by order ID
    const payment = await Payment.findByOrderId(webhookData.order_id);
    
    if (!payment) {
      console.error('Payment not found for order ID:', webhookData.order_id);
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }
    
    // Get payment status from webhook
    const newStatus = cryptomusService.getPaymentStatusFromWebhook(webhookData);
    
    console.log('Processing payment status change:', {
      paymentId: payment._id,
      oldStatus: payment.status,
      newStatus,
      webhookStatus: webhookData.payment_status
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
      await upgradeUserSubscription(payment.userId, payment);
      
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
    console.error('Cryptomus webhook error:', error);
    res.status(500).json({
      success: false,
      message: 'Webhook processing failed'
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
    const subscription = await Subscription.findOne({ userId });
    
    if (!subscription) {
      console.error('Subscription not found for user:', userId);
      return;
    }
    
    // Calculate end date based on payment duration
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + payment.planDuration);
    
    // Update subscription
    subscription.planType = payment.planType;
    subscription.status = 'active';
    subscription.startDate = new Date();
    subscription.endDate = endDate;
    subscription.paymentId = payment.cryptomusOrderId;
    subscription.autoRenew = false;
    
    await subscription.save();
    
    console.log('Subscription upgraded successfully:', {
      userId,
      planType: subscription.planType,
      endDate: subscription.endDate
    });
    
  } catch (error) {
    console.error('Upgrade user subscription error:', error);
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