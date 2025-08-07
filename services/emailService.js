const brevo = require('@getbrevo/brevo');
const { BREVO_API_KEY, SENDER_EMAIL, SENDER_NAME } = require('../config/env');

let defaultClient = brevo.ApiClient.instance;
let apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = BREVO_API_KEY;

let apiInstance = new brevo.TransactionalEmailsApi();

const sendOTPEmail = async (email, name, otp) => {
  try {
    let sendSmtpEmail = new brevo.SendSmtpEmail();
    
    sendSmtpEmail.subject = "Password Reset OTP - GetFork";
    sendSmtpEmail.htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Reset OTP</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 28px;">GetFork</h1>
          <p style="color: #f0f0f0; margin: 10px 0 0 0;">Password Reset Request</p>
        </div>
        
        <div style="background: #ffffff; padding: 30px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 10px 10px;">
          <h2 style="color: #333; margin-top: 0;">Hello ${name}!</h2>
          
          <p>We received a request to reset your password. Use the following OTP to complete your password reset:</p>
          
          <div style="background: #f8f9fa; border: 2px dashed #667eea; border-radius: 8px; padding: 20px; text-align: center; margin: 25px 0;">
            <h3 style="color: #667eea; font-size: 32px; margin: 0; letter-spacing: 5px; font-weight: bold;">${otp}</h3>
          </div>
          
          <div style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 5px; padding: 15px; margin: 20px 0;">
            <p style="margin: 0; color: #856404;"><strong>⚠️ Important:</strong></p>
            <ul style="margin: 5px 0 0 0; color: #856404;">
              <li>This OTP will expire in <strong>10 minutes</strong></li>
              <li>Don't share this code with anyone</li>
              <li>If you didn't request this, please ignore this email</li>
            </ul>
          </div>
          
          <p style="margin-top: 25px;">If you have any questions or concerns, please don't hesitate to contact our support team.</p>
          
          <hr style="border: none; border-top: 1px solid #eee; margin: 25px 0;">
          
          <p style="font-size: 14px; color: #666; text-align: center; margin: 0;">
            © 2024 GetFork. All rights reserved.<br>
            This is an automated email, please do not reply.
          </p>
        </div>
      </body>
      </html>
    `;
    
    sendSmtpEmail.sender = {
      name: SENDER_NAME,
      email: SENDER_EMAIL
    };
    
    sendSmtpEmail.to = [{
      email: email,
      name: name
    }];

    const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log('OTP email sent successfully:', result.messageId);
    return { success: true, messageId: result.messageId };
    
  } catch (error) {
    console.error('Error sending OTP email:', error);
    throw new Error('Failed to send OTP email');
  }
};

const sendWelcomeEmail = async (email, name) => {
  try {
    let sendSmtpEmail = new brevo.SendSmtpEmail();
    
    sendSmtpEmail.subject = "Welcome to GetFork! 🎉";
    sendSmtpEmail.htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to GetFork</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 28px;">🎉 Welcome to GetFork!</h1>
          <p style="color: #f0f0f0; margin: 10px 0 0 0;">Your account has been created successfully</p>
        </div>
        
        <div style="background: #ffffff; padding: 30px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 10px 10px;">
          <h2 style="color: #333; margin-top: 0;">Hello ${name}!</h2>
          
          <p>Welcome to GetFork! We're excited to have you on board. Your account has been successfully created and you're ready to start your journey with us.</p>
          
          <div style="background: #d4edda; border: 1px solid #c3e6cb; border-radius: 5px; padding: 15px; margin: 20px 0;">
            <p style="margin: 0; color: #155724;"><strong>✅ Account Details:</strong></p>
            <ul style="margin: 5px 0 0 0; color: #155724;">
              <li>Email: ${email}</li>
              <li>Registration Date: ${new Date().toLocaleDateString()}</li>
              <li>Account Status: Active</li>
            </ul>
          </div>
          
          <p>Here's what you can do next:</p>
          <ul>
            <li>Explore our platform features</li>
            <li>Complete your profile setup</li>
            <li>Connect with other users</li>
            <li>Start using our services</li>
          </ul>
          
          <p style="margin-top: 25px;">If you have any questions or need assistance, our support team is here to help!</p>
          
          <hr style="border: none; border-top: 1px solid #eee; margin: 25px 0;">
          
          <p style="font-size: 14px; color: #666; text-align: center; margin: 0;">
            © 2024 GetFork. All rights reserved.<br>
            This is an automated email, please do not reply.
          </p>
        </div>
      </body>
      </html>
    `;
    
    sendSmtpEmail.sender = {
      name: SENDER_NAME,
      email: SENDER_EMAIL
    };
    
    sendSmtpEmail.to = [{
      email: email,
      name: name
    }];

    const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log('Welcome email sent successfully:', result.messageId);
    return { success: true, messageId: result.messageId };
    
  } catch (error) {
    console.error('Error sending welcome email:', error);
    throw new Error('Failed to send welcome email');
  }
};

module.exports = {
  sendOTPEmail,
  sendWelcomeEmail
};