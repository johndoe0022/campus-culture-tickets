CREATE TABLE IF NOT EXISTS orders (
  id              SERIAL PRIMARY KEY,
  reference       TEXT UNIQUE NOT NULL,     -- our external_reference, shown to buyer
  checkout_id     TEXT,                      -- PayHero CheckoutRequestID
  ticket_type     TEXT NOT NULL,             -- 'early_bird' | 'regular' | 'vip'
  amount          INTEGER NOT NULL,
  buyer_name      TEXT NOT NULL,
  phone_number    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | SUCCESS | FAILED
  mpesa_receipt   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_reference ON orders (reference);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
