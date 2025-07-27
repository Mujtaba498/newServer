import axios from 'axios';

class EmailService {
  constructor() {
    this.apiKey = process.env.BREVO_API_KEY;
    this.senderEmail = process.env.SENDER_EMAIL;
    this.senderName = process.env.SENDER_NAME;
    this.baseURL = 'https://api.brevo.com/v3';
  }

  async sendOTP(email, otp, userName = 'User') {
    try {
      const emailData = {
        sender: {
          name: this.senderName,
          email: this.senderEmail,
        },
        to: [
          {
            email: email,
            name: userName,
          },
        ],
        subject: 'Your OTP Code - Crective',
        htmlContent: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #f8f9fa; padding: 30px; border-radius: 10px; text-align: center;">
              <h1 style="color: #333; margin-bottom: 20px;">Your OTP Code</h1>
              <p style="color: #666; font-size: 16px; margin-bottom: 30px;">
                Hello ${userName},<br>
                Use the following OTP code to complete your authentication:
              </p>
              <div style="background-color: #007bff; color: white; padding: 15px 30px; border-radius: 5px; font-size: 24px; font-weight: bold; letter-spacing: 3px; margin: 20px 0;">
                ${otp}
              </div>
              <p style="color: #666; font-size: 14px; margin-top: 30px;">
                This code will expire in 10 minutes for security reasons.
              </p>
              <p style="color: #999; font-size: 12px; margin-top: 20px;">
                If you didn't request this code, please ignore this email.
              </p>
            </div>
          </div>
        `,
      };

      const response = await axios.post(`${this.baseURL}/smtp/email`, emailData, {
        headers: {
          'api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
      });

      return {
        success: true,
        messageId: response.data.messageId,
      };
    } catch (error) {
      throw new Error('Failed to send email');
    }
  }

  async sendWelcomeEmail(email, userName = 'User') {
    try {
      const emailData = {
        sender: {
          name: this.senderName,
          email: this.senderEmail,
        },
        to: [
          {
            email: email,
            name: userName,
          },
        ],
        subject: 'Welcome to Crective!',
        htmlContent: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #f8f9fa; padding: 30px; border-radius: 10px; text-align: center;">
              <h1 style="color: #333; margin-bottom: 20px;">Welcome to Crective!</h1>
              <p style="color: #666; font-size: 16px; margin-bottom: 30px;">
                Hello ${userName},<br>
                Your account has been successfully created. Welcome to our platform!
              </p>
              <p style="color: #666; font-size: 14px;">
                You can now access all our features and services.
              </p>
            </div>
          </div>
        `,
      };

      const response = await axios.post(`${this.baseURL}/smtp/email`, emailData, {
        headers: {
          'api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
      });

      return {
        success: true,
        messageId: response.data.messageId,
      };
    } catch (error) {
      // Don't throw error for welcome email failure
      return { success: false };
    }
  }
}

export default new EmailService(); 