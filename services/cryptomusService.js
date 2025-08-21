const crypto = require('crypto');
const axios = require('axios');

class CryptomusService {
  constructor() {
    this.baseURL = process.env.CRYPTOMUS_BASE_URL || 'https://api.cryptomus.com/v1';
    this.paymentKey = process.env.CRYPTOMUS_PAYMENT_KEY;
    this.payoutKey = process.env.CRYPTOMUS_PAYOUT_KEY;
    this.merchantId = process.env.CRYPTOMUS_MERCHANT_ID;
    this.webhookSecret = process.env.CRYPTOMUS_WEBHOOK_SECRET;
    this.webhookUrl = process.env.CRYPTOMUS_WEBHOOK_URL;
    this.successUrl = process.env.CRYPTOMUS_SUCCESS_URL;
    
    if (!this.paymentKey || !this.merchantId || !this.webhookSecret) {
      throw new Error('Missing required Cryptomus configuration');
    }
  }

  // Generate signature for API requests
  generateSignature(data, apiKey) {
    const jsonString = JSON.stringify(data);
    const encodedData = Buffer.from(jsonString).toString('base64');
    return crypto.createHash('md5').update(encodedData + apiKey).digest('hex');
  }

  // Verify webhook signature
  verifyWebhookSignature(data, signature) {
    const jsonString = JSON.stringify(data);
    const encodedData = Buffer.from(jsonString).toString('base64');
    const expectedSignature = crypto.createHash('md5').update(encodedData + this.webhookSecret).digest('hex');
    return expectedSignature === signature;
  }

  // Create payment invoice
  async createPayment({
    orderId,
    amount,
    currency = 'USD',
    userEmail,
    userName,
    description = 'Premium Subscription'
  }) {
    try {
      const data = {
        amount: amount.toString(),
        currency,
        order_id: orderId,
        url_return: this.successUrl,
        url_callback: this.webhookUrl,
        is_payment_multiple: false,
        lifetime: 7200, // 2 hours in seconds
        to_currency: '', // Let user choose crypto
        subtract: 100, // Fees paid by merchant
        accuracy_payment_percent: 1,
        additional_data: JSON.stringify({
          user_email: userEmail,
          user_name: userName,
          description
        })
      };

      const signature = this.generateSignature(data, this.paymentKey);
      
      const response = await axios.post(`${this.baseURL}/payment`, data, {
        headers: {
          'Content-Type': 'application/json',
          'merchant': this.merchantId,
          'sign': signature
        },
        timeout: 30000
      });

      if (response.data.state === 0) {
        return {
          success: true,
          data: {
            uuid: response.data.result.uuid,
            orderId: response.data.result.order_id,
            amount: response.data.result.amount,
            currency: response.data.result.currency,
            paymentUrl: response.data.result.url,
            status: response.data.result.payment_status,
            expiresAt: new Date(Date.now() + 7200 * 1000) // 2 hours
          }
        };
      } else {
        throw new Error(response.data.message || 'Payment creation failed');
      }
    } catch (error) {
      console.error('Cryptomus payment creation error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message || 'Payment creation failed'
      };
    }
  }

  // Get payment status
  async getPaymentStatus(uuid, orderId) {
    try {
      const data = {
        uuid,
        order_id: orderId
      };

      const signature = this.generateSignature(data, this.paymentKey);
      
      const response = await axios.post(`${this.baseURL}/payment/info`, data, {
        headers: {
          'Content-Type': 'application/json',
          'merchant': this.merchantId,
          'sign': signature
        },
        timeout: 15000
      });

      if (response.data.state === 0) {
        const result = response.data.result;
        return {
          success: true,
          data: {
            uuid: result.uuid,
            orderId: result.order_id,
            amount: result.amount,
            paymentAmount: result.payment_amount,
            paymentCurrency: result.payer_currency,
            currency: result.currency,
            status: result.payment_status,
            txid: result.txid,
            network: result.network,
            createdAt: result.created_at,
            updatedAt: result.updated_at
          }
        };
      } else {
        throw new Error(response.data.message || 'Failed to get payment status');
      }
    } catch (error) {
      console.error('Cryptomus payment status error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message || 'Failed to get payment status'
      };
    }
  }

  // Get list of available cryptocurrencies
  async getCurrencies() {
    try {
      const data = {};
      const signature = this.generateSignature(data, this.paymentKey);
      
      const response = await axios.post(`${this.baseURL}/payment/services`, data, {
        headers: {
          'Content-Type': 'application/json',
          'merchant': this.merchantId,
          'sign': signature
        },
        timeout: 15000
      });

      if (response.data.state === 0) {
        return {
          success: true,
          data: response.data.result
        };
      } else {
        throw new Error(response.data.message || 'Failed to get currencies');
      }
    } catch (error) {
      console.error('Cryptomus currencies error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message || 'Failed to get currencies'
      };
    }
  }

  // Resend webhook (if needed)
  async resendWebhook(uuid, orderId) {
    try {
      const data = {
        uuid,
        order_id: orderId
      };

      const signature = this.generateSignature(data, this.paymentKey);
      
      const response = await axios.post(`${this.baseURL}/payment/resend`, data, {
        headers: {
          'Content-Type': 'application/json',
          'merchant': this.merchantId,
          'sign': signature
        },
        timeout: 15000
      });

      return {
        success: response.data.state === 0,
        message: response.data.message
      };
    } catch (error) {
      console.error('Cryptomus resend webhook error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message || 'Failed to resend webhook'
      };
    }
  }

  // Generate unique order ID
  generateOrderId(userId, timestamp = Date.now()) {
    return `sub_${userId}_${timestamp}`;
  }

  // Validate webhook data
  validateWebhookData(data) {
    const requiredFields = ['uuid', 'order_id', 'amount', 'payment_status'];
    return requiredFields.every(field => data.hasOwnProperty(field));
  }

  // Get payment status from webhook
  getPaymentStatusFromWebhook(webhookData) {
    const statusMap = {
      'paid': 'paid',
      'paid_over': 'paid',
      'fail': 'failed',
      'cancel': 'cancelled',
      'system_fail': 'failed',
      'refund_process': 'refunded',
      'refund_fail': 'failed',
      'refund_paid': 'refunded',
      'process': 'processing',
      'confirm_check': 'processing',
      'wrong_amount': 'failed',
      'wrong_amount_waiting': 'processing',
      'check': 'processing'
    };

    return statusMap[webhookData.payment_status] || 'pending';
  }
}

module.exports = new CryptomusService();