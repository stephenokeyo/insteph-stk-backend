const express = require('express');
const axios = require('axios');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors()); // Allows your frontend interface to securely communicate with this backend

// MIDDLEWARE: Generates Safaricom OAuth Access Token on-the-fly
const generateMpesaToken = async (req, res, next) => {
    const consumerKey = process.env.MPESA_CONSUMER_KEY;
const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
    const url = `${process.env.MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`;

    try {
        const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
        const response = await axios.get(url, {
            headers: {
                Authorization: `Basic ${auth}`
            }
        });
        
        req.mpesaToken = response.data.access_token;
        next();
    } catch (error) {
        console.error("Error generating Safaricom access token:", error.response ? error.response.data : error.message);
        return res.status(500).json({
            ResponseDescription: "Failed to authenticate with Safaricom Daraja systems. Check your Consumer Key/Secret Configuration."
        });
    }
};

// POST ENDPOINT: Initiates the STK Push safely
app.post('/api/stkpush', generateMpesaToken, async (req, res) => {
    let { phone, amount } = req.body;

    if (!phone || !amount) {
        return res.status(400).json({ ResponseDescription: "Missing phone number or transaction amount parameters." });
    }

    // 1. Clean up phone formats cleanly (e.g., 0797508993 to 254797508993)
    phone = phone.trim().replace(/\s+/g, '');
    if (phone.startsWith('0')) {
        phone = '254' + phone.substring(1);
    } else if (phone.startsWith('+')) {
        phone = phone.substring(1);
    }

    // 2. CRITICAL FIX: Convert decimal amounts (like 1219.00) to clean integers (1219)
    // Safaricom Sandbox throws an 'undefined' gateway error if it encounters a decimal point
    const cleanAmount = Math.round(parseFloat(amount));

    const shortCode = process.env.MPESA_SHORTCODE;
    const passkey = process.env.MPESA_PASSKEY;
    const baseUrl = process.env.MPESA_BASE_URL;

    // Generate accurate timestamp (YYYYMMDDHHmmss)
    const date = new Date();
    const timestamp = date.getFullYear() +
        String(date.getMonth() + 1).padStart(2, '0') +
        String(date.getDate()).padStart(2, '0') +
        String(date.getHours()).padStart(2, '0') +
        String(date.getMinutes()).padStart(2, '0') +
        String(date.getSeconds()).padStart(2, '0');

    // Create security password signature hash
    const password = Buffer.from(`${shortCode}${passkey}${timestamp}`).toString('base64');

    const stkPushPayload = {
        BusinessShortCode: shortCode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline", 
        Amount: cleanAmount, // Encodes clean, rounded digit string
        PartyA: phone, 
        PartyB: shortCode,
        PhoneNumber: phone,
        CallBackURL: process.env.MPESA_CALLBACK_URL || "https://INSTEPHCOM/callback",
        AccountReference: "INSTEPH ONLINE",
        TransactionDesc: "Payment for Goods Portfolio Delivery"
    };

    try {
        const response = await axios.post(
            `${baseUrl}/mpesa/stkpush/v1/processrequest`,
            stkPushPayload,
            {
                headers: {
                    Authorization: `Bearer ${req.mpesaToken}`
                }
            }
        );

        // Forward Safaricom's success parameters back to the front-end application
        return res.status(200).json(response.data);

    } catch (error) {
        // Detailed log tracking inside terminal console to catch empty response objects
        console.error("=== SAFARICOM EDGE ROUTER ERROR ===");
        console.error(error.response ? error.response.data : error.message);
        
        const errorDetail = error.response?.data?.errorMessage || 
                            error.response?.data?.ResponseDescription || 
                            "Safaricom payment hub rejected routing request layout.";
                            
        return res.status(500).json({
            ResponseDescription: errorDetail
        });
    }
});

// Callback endpoint to capture payment updates sent by Safaricom
app.post('/api/callback', (req, res) => {
    console.log("=== M-PESA PAYMENT CALLBACK RECEIVED ===");
    console.log(JSON.stringify(req.body, null, 2));
    return res.status(200).json({ ResultCode: 0, ResultDesc: "Callback processed successfully." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[INSTEPH BACKEND NODE RUNNING ON PORT ${PORT}]`);
    console.log(`Listening for checkout requests arriving from your web interface...`);
});