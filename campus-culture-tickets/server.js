require('dotenv').config();
const express = require('express');
const path = require('path');
const { customAlphabet } = require('nanoid');
const { pool, init } = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const genRef = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8);

// ---- Ticket catalogue (from the event poster) ----
const TICKETS = {
  early_bird: { label: 'Early Bird', amount: 300 },
  regular:    { label: 'Regular',    amount: 400 },
  vip:        { label: 'VIP',        amount: 1000 },
};

function earlyBirdOpen() {
  const cutoff = process.env.EARLY_BIRD_CUTOFF ? new Date(process.env.EARLY_BIRD_CUTOFF) : null;
  if (!cutoff || isNaN(cutoff)) return true;
  return new Date() < cutoff;
}

// Tell the frontend which tickets are currently on sale + the cutoff time
app.get('/api/tickets', (req, res) => {
  const open = earlyBirdOpen();
  res.json({
    tickets: {
      ...(open ? { early_bird: TICKETS.early_bird } : {}),
      regular: TICKETS.regular,
      vip: TICKETS.vip,
    },
    early_bird_open: open,
    early_bird_cutoff: process.env.EARLY_BIRD_CUTOFF || null,
  });
});

// Normalise a Kenyan phone number to 2547XXXXXXXX / 2541XXXXXXXX for PayHero
function normalisePhone(raw) {
  let p = String(raw).replace(/\s+/g, '').replace(/^\+/, '');
  if (p.startsWith('0')) p = '254' + p.slice(1);
  if (p.startsWith('7') || p.startsWith('1')) p = '254' + p;
  return p;
}

function payheroAuthHeader() {
  const token = Buffer.from(
    `${process.env.PAYHERO_USERNAME}:${process.env.PAYHERO_PASSWORD}`
  ).toString('base64');
  return `Basic ${token}`;
}

// ---- Start checkout: create order row, trigger PayHero STK push ----
app.post('/api/checkout', async (req, res) => {
  try {
    const { ticket_type, buyer_name, phone_number } = req.body;
    const ticket = TICKETS[ticket_type];

    if (!ticket) return res.status(400).json({ error: 'Unknown ticket type.' });
    if (ticket_type === 'early_bird' && !earlyBirdOpen()) {
      return res.status(400).json({ error: 'Early Bird tickets have closed.' });
    }
    if (!buyer_name || !phone_number) {
      return res.status(400).json({ error: 'Name and phone number are required.' });
    }

    const phone = normalisePhone(phone_number);
    const reference = `CC-${genRef()}`;

    await pool.query(
      `INSERT INTO orders (reference, ticket_type, amount, buyer_name, phone_number, status)
       VALUES ($1,$2,$3,$4,$5,'PENDING')`,
      [reference, ticket_type, ticket.amount, buyer_name, phone]
    );

    const payload = {
      amount: ticket.amount,
      phone_number: phone,
      channel_id: Number(process.env.PAYHERO_CHANNEL_ID),
      provider: 'm-pesa',
      external_reference: reference,
      customer_name: buyer_name,
      callback_url: `${process.env.PUBLIC_URL}/api/payhero/callback`,
    };

    const phRes = await fetch('https://backend.payhero.co.ke/api/v2/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: payheroAuthHeader(),
      },
      body: JSON.stringify(payload),
    });

    const phData = await phRes.json();

    if (!phRes.ok || phData.success === false) {
      await pool.query(`UPDATE orders SET status='FAILED', updated_at=now() WHERE reference=$1`, [reference]);
      return res.status(502).json({ error: 'Could not start M-Pesa prompt.', detail: phData });
    }

    await pool.query(
      `UPDATE orders SET checkout_id=$1, updated_at=now() WHERE reference=$2`,
      [phData.CheckoutRequestID || null, reference]
    );

    res.json({ reference, status: 'QUEUED' });
  } catch (err) {
    console.error('checkout error', err);
    res.status(500).json({ error: 'Server error starting checkout.' });
  }
});

// ---- PayHero calls this when the customer completes/cancels the M-Pesa prompt ----
app.post('/api/payhero/callback', async (req, res) => {
  try {
    const body = req.body || {};
    // PayHero nests the result; support both flat and nested shapes defensively
    const data = body.response || body;
    const reference = data.external_reference || data.ExternalReference || data.reference;
    const success =
      data.status === 'SUCCESS' ||
      data.ResultCode === 0 ||
      data.success === true;
    const mpesaReceipt = data.mpesa_receipt || data.MpesaReceiptNumber || null;

    if (reference) {
      await pool.query(
        `UPDATE orders SET status=$1, mpesa_receipt=$2, updated_at=now() WHERE reference=$3`,
        [success ? 'SUCCESS' : 'FAILED', mpesaReceipt, reference]
      );
    }
    res.status(200).json({ received: true });
  } catch (err) {
    console.error('callback error', err);
    res.status(200).json({ received: true }); // still ack so PayHero doesn't retry into a black hole
  }
});

// ---- Frontend polls this to find out if payment succeeded ----
app.get('/api/order/:reference', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT reference, ticket_type, amount, status, mpesa_receipt FROM orders WHERE reference=$1`,
    [req.params.reference]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

// ---- Simple sales dashboard, protected by ADMIN_KEY ----
app.get('/api/orders', async (req, res) => {
  if (req.query.key !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  const { rows } = await pool.query(`SELECT * FROM orders ORDER BY created_at DESC LIMIT 500`);
  res.json(rows);
});

const PORT = process.env.PORT || 3000;
init()
  .then(() => {
    app.listen(PORT, () => console.log(`Campus Culture ticket server running on :${PORT}`));
  })
  .catch((err) => {
    console.error('Failed to init DB', err);
    process.exit(1);
  });
