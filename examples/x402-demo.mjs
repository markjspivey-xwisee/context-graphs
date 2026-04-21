// x402 protocol demo — the Coinbase-popularized HTTP-402 payment
// flow, using our existing wallet primitives.
//
// Protocol shape (self-contained for this demo; Coinbase's
// x402.org facilitator on Base USDC is the production version):
//
//   1. Client:  GET /protected
//   2. Server:  402 Payment Required
//               x402-amount: 0.05
//               x402-asset: USDC
//               x402-recipient: 0xRECIPIENT
//               x402-nonce: <bytes>
//               x402-expiration: <unix>
//   3. Client:  signs EIP-191 authorization
//               GET /protected
//               X-Payment: <json{amount,asset,recipient,nonce,expiration,signer,signature}>
//   4. Server:  verifies signature recovers to signer ∧ nonce unused ∧
//               not expired ∧ amount meets requirement →
//               serve 200 with content + x402-tx-hash header
//
// In production the facilitator submits a USDC transferWithAuthorization
// on Base and returns the tx hash. Here we stub settlement — signatures
// are real, nonce bookkeeping is real, only the on-chain transfer is
// skipped. That's the demo-vs-production line: protocol is fully live,
// settlement requires a funded wallet on Base.

import { createServer } from 'node:http';
import { ethers } from 'ethers';

// Wallet creation — real secp256k1 keypair via ethers directly. Our
// core library wraps this with metadata storage but for the demo the
// raw wallet is sufficient. Signing uses personal_sign (EIP-191).
function createWallet(label) {
  const w = ethers.Wallet.createRandom();
  return { address: w.address, privateKey: w.privateKey, signer: w, label };
}
async function signText(wallet, text) {
  return await wallet.signer.signMessage(text);
}
function verifyText(text, signature, expectedSigner) {
  try {
    const recovered = ethers.verifyMessage(text, signature);
    return { valid: recovered.toLowerCase() === expectedSigner.toLowerCase(), recovered };
  } catch (err) { return { valid: false, reason: err.message }; }
}

const PORT = 4020;
const RESOURCE_PRICE_USDC = '0.05';
const FACILITATOR_ADDRESS = '0xFac11ita70r0000000000000000000000000000';

// Server's nonce store so replays are caught.
const usedNonces = new Set();

// ── x402 server ──────────────────────────────────────────────

function buildPaymentChallenge() {
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(8))).toString('hex');
  const expiration = Math.floor(Date.now() / 1000) + 300; // 5 min
  return { nonce, expiration };
}

// Canonical message the client signs — must match client-side format
// exactly. This is the EIP-191 personal_sign path; production x402
// uses EIP-712 typed data for USDC transferWithAuthorization.
function paymentMessage({ amount, asset, recipient, nonce, expiration }) {
  return `x402 Payment Authorization
Amount: ${amount} ${asset}
Recipient: ${recipient}
Nonce: ${nonce}
Expiration: ${expiration}`;
}

async function handleRequest(req, res) {
  if (req.url !== '/protected') { res.writeHead(404); return res.end('not found'); }

  const paymentHeader = req.headers['x-payment'];

  // No payment yet — return 402.
  if (!paymentHeader) {
    const challenge = buildPaymentChallenge();
    res.writeHead(402, {
      'x402-amount': RESOURCE_PRICE_USDC,
      'x402-asset': 'USDC',
      'x402-recipient': FACILITATOR_ADDRESS,
      'x402-nonce': challenge.nonce,
      'x402-expiration': String(challenge.expiration),
      'content-type': 'text/plain',
    });
    return res.end(`Payment required: ${RESOURCE_PRICE_USDC} USDC → ${FACILITATOR_ADDRESS}`);
  }

  // Validate payment.
  let parsed;
  try { parsed = JSON.parse(paymentHeader); }
  catch { res.writeHead(400); return res.end('malformed X-Payment'); }

  const { amount, asset, recipient, nonce, expiration, signer, signature } = parsed;

  if (usedNonces.has(nonce)) { res.writeHead(402); return res.end('nonce replay'); }
  if (parseFloat(amount) < parseFloat(RESOURCE_PRICE_USDC)) { res.writeHead(402); return res.end('underpaid'); }
  if (Math.floor(Date.now() / 1000) > parseInt(expiration, 10)) { res.writeHead(402); return res.end('expired'); }
  if (recipient !== FACILITATOR_ADDRESS) { res.writeHead(402); return res.end('wrong recipient'); }
  if (asset !== 'USDC') { res.writeHead(402); return res.end('wrong asset'); }

  // Verify signature recovers to the claimed signer.
  const msg = paymentMessage({ amount, asset, recipient, nonce, expiration });
  const verified = verifyText(msg, signature, signer);
  if (!verified.valid) {
    res.writeHead(402);
    return res.end(`bad signature: ${verified.reason ?? 'recovered != claimed'}`);
  }

  usedNonces.add(nonce);

  // In production: facilitator submits USDC transferWithAuthorization on
  // Base. Here we stub the tx hash — the SIGNATURE is real cryptographic
  // work; settlement is mocked.
  const fakeTxHash = '0x' + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');

  res.writeHead(200, {
    'content-type': 'text/plain',
    'x402-tx-hash': fakeTxHash,
    'x402-settlement': 'stubbed',
  });
  res.end(`Protected content. Paid ${amount} ${asset} by ${signer}. tx: ${fakeTxHash}`);
}

// ── x402 client ──────────────────────────────────────────────

async function fetchWithPayment(url, wallet) {
  let r = await fetch(url);
  if (r.status !== 402) {
    return { status: r.status, body: await r.text(), paid: false };
  }

  const amount = r.headers.get('x402-amount');
  const asset = r.headers.get('x402-asset');
  const recipient = r.headers.get('x402-recipient');
  const nonce = r.headers.get('x402-nonce');
  const expiration = r.headers.get('x402-expiration');

  if (!amount || !recipient || !nonce) {
    throw new Error('server returned 402 but x402 headers missing');
  }

  const msg = paymentMessage({ amount, asset, recipient, nonce, expiration });
  const signature = await signText(wallet, msg);

  const paymentPayload = {
    amount, asset, recipient, nonce, expiration,
    signer: wallet.address,
    signature,
  };

  r = await fetch(url, {
    headers: { 'X-Payment': JSON.stringify(paymentPayload) },
  });
  return {
    status: r.status,
    body: await r.text(),
    paid: true,
    txHash: r.headers.get('x402-tx-hash'),
    settlement: r.headers.get('x402-settlement'),
    paymentPayload,  // expose so callers can test replay
  };
}

// ── Run the demo ─────────────────────────────────────────────

console.log('=== x402 demo ===\n');

const server = createServer(handleRequest);
await new Promise(res => server.listen(PORT, res));
console.log(`1. x402 server listening on :${PORT}`);
console.log(`   protected resource price: ${RESOURCE_PRICE_USDC} USDC → ${FACILITATOR_ADDRESS}\n`);

const wallet = createWallet('x402-client');
console.log(`2. Client wallet: ${wallet.address}\n`);

// Unpaid attempt (should return 402).
console.log('3. Unpaid GET (expect 402):');
const unpaid = await fetch(`http://127.0.0.1:${PORT}/protected`);
console.log(`   status: ${unpaid.status}`);
console.log(`   x402-amount: ${unpaid.headers.get('x402-amount')} ${unpaid.headers.get('x402-asset')}`);
console.log(`   x402-nonce:  ${unpaid.headers.get('x402-nonce')}\n`);

// Paid attempt.
console.log('4. Paid GET (signs challenge + retries):');
const paid = await fetchWithPayment(`http://127.0.0.1:${PORT}/protected`, wallet);
console.log(`   status: ${paid.status}`);
console.log(`   paid:   ${paid.paid}`);
console.log(`   tx:     ${paid.txHash}`);
console.log(`   settlement: ${paid.settlement}`);
console.log(`   body:   ${paid.body}\n`);

// Replay attack — reuse the EXACT payment payload that was accepted in step 4.
console.log('5. Replay attack (reusing step 4\'s accepted payment payload):');
const replay = await fetch(`http://127.0.0.1:${PORT}/protected`, {
  headers: { 'X-Payment': JSON.stringify(paid.paymentPayload) },
});
console.log(`   status: ${replay.status}  (402 = correctly rejected as replay)`);
console.log(`   reason: ${await replay.text()}\n`);

server.close();
console.log('── x402 protocol demonstrated:');
console.log('   Real EIP-191 signature (ethers.js secp256k1)');
console.log('   Real nonce enforcement, replay detection');
console.log('   Stubbed settlement — production facilitator settles USDC on Base');
console.log('   Integration path: swap paymentMessage() for EIP-712 transferWithAuthorization');
console.log('   and call the x402.org facilitator instead of our stub.');
