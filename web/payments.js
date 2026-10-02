// payments.js — iyzico ödeme entegrasyonu (Checkout Form).
// Env: IYZICO_API_KEY, IYZICO_SECRET_KEY, IYZICO_BASE_URL (sandbox: https://sandbox-api.iyzipay.com)
const Iyzipay = require('iyzipay');

function configured() { return !!(process.env.IYZICO_API_KEY && process.env.IYZICO_SECRET_KEY); }
function client() {
  return new Iyzipay({
    apiKey: process.env.IYZICO_API_KEY,
    secretKey: process.env.IYZICO_SECRET_KEY,
    uri: process.env.IYZICO_BASE_URL || 'https://sandbox-api.iyzipay.com',
  });
}

function addr(buyer) {
  return {
    contactName: buyer.name + ' ' + buyer.surname,
    city: buyer.city || 'Istanbul',
    country: 'Turkey',
    address: buyer.address || 'Belirtilmedi',
    zipCode: buyer.zip || '34000',
  };
}

function initCheckoutForm({ orderId, price, currency, buyer, callbackUrl }) {
  return new Promise((resolve, reject) => {
    const req = {
      locale: 'tr',
      conversationId: 'order-' + orderId,
      price: String(price),
      paidPrice: String(price),
      currency: currency || 'TRY',
      basketId: 'HARLEY-' + orderId,
      paymentGroup: 'PRODUCT',
      callbackUrl,
      enabledInstallments: [1, 2, 3, 6],
      buyer: {
        id: 'U' + buyer.id,
        name: buyer.name,
        surname: buyer.surname,
        gsmNumber: buyer.gsm,
        email: buyer.email,
        identityNumber: buyer.identityNumber,
        registrationAddress: buyer.address || 'Belirtilmedi',
        city: buyer.city || 'Istanbul',
        country: 'Turkey',
        zipCode: buyer.zip || '34000',
        ip: buyer.ip || '85.34.78.112',
      },
      shippingAddress: addr(buyer),
      billingAddress: addr(buyer),
      basketItems: [{ id: 'premium', name: 'Harley Premium', category1: 'Yazılım', itemType: 'VIRTUAL', price: String(price) }],
    };
    client().checkoutFormInitialize.create(req, (err, result) => { if (err) return reject(err); resolve(result); });
  });
}

function retrieve(token) {
  return new Promise((resolve) => {
    client().checkoutForm.retrieve({ locale: 'tr', token }, (err, result) => resolve(err ? { status: 'failure', errorMessage: err.message } : result));
  });
}

module.exports = { configured, initCheckoutForm, retrieve };
