require('dotenv').config();
const express = require('express'), fs = require('fs'), path = require('path');
const multer = require('multer');
const app = express();
const port = Number(process.env.PORT) || 3000;
const defaultWhatsapp = (process.env.WHATSAPP_NUMBER || '919876543210').replace(/\D/g, '');
const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `review-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'image/gif'];
    cb(allowed.includes(file.mimetype) ? null : new Error('Only image uploads are allowed.'), allowed.includes(file.mimetype));
  }
});

app.use(express.json());
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/cart', (req, res) => res.sendFile(path.join(__dirname, 'cart.html')));
app.get('/third-design', (req, res) => res.sendFile(path.join(__dirname, 'third-design.html')));
app.get('/reviews', (req, res) => res.sendFile(path.join(__dirname, 'reviews.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
const DB = path.join(__dirname, 'data.json');
const seed = {
  settings: { shopName: "Amma's Pantry", deliveryFee: 50, freeAbove: 600, areaFees: { "560001": 30 }, whatsappNumber: defaultWhatsapp },
  products: [
    { id: 'p1', name: 'Raw Mango Pickle', category: 'Pickles', unit: '250 g', price: 180, available: true, desc: 'Sun-cured, cold-pressed sesame oil.' },
    { id: 'p2', name: 'Garlic Pickle', category: 'Pickles', unit: '250 g', price: 210, available: true, desc: 'Whole cloves, slow-cooked with red chilli.' },
    { id: 'p3', name: 'Lemon Pickle', category: 'Pickles', unit: '250 g', price: 170, available: true, desc: 'Aged 21 days in glass jars.' },
    { id: 's1', name: 'Butter Murukku', category: 'Snacks', unit: '200 g', price: 120, available: true, desc: 'Rice flour, hand-pressed, fried fresh.' },
    { id: 's2', name: 'Banana Chips', category: 'Snacks', unit: '250 g', price: 140, available: true, desc: 'Coconut oil, sea salt.' },
    { id: 's3', name: 'Kara Boondi', category: 'Snacks', unit: '200 g', price: 100, available: true, desc: 'Spicy, with curry leaves and peanuts.' }
  ],
  orders: [],
  reviews: []
};
const load = () => {
  try {
    const raw = JSON.parse(fs.readFileSync(DB));
    const merged = {
      ...seed,
      ...raw,
      settings: { ...seed.settings, ...(raw.settings || {}) },
      products: Array.isArray(raw.products) ? raw.products : seed.products,
      orders: Array.isArray(raw.orders) ? raw.orders : [],
      reviews: Array.isArray(raw.reviews) ? raw.reviews : []
    };
    if (!merged.settings.whatsappNumber) merged.settings.whatsappNumber = defaultWhatsapp;
    return merged;
  } catch {
    fs.writeFileSync(DB, JSON.stringify(seed, null, 2));
    return JSON.parse(JSON.stringify(seed));
  }
};
const save = d => fs.writeFileSync(DB, JSON.stringify(d, null, 2));

// Prices are always recalculated on the server from the admin-set values.
function quote(db, items, pin) {
  if (!Array.isArray(items) || !items.length) throw new Error('Your cart is empty.');
  let sub = 0; const lines = [];
  for (const it of items) {
    const p = db.products.find(x => x.id === it.id && x.available), q = Math.floor(Number(it.qty));
    if (!p || !(q >= 1 && q <= 50)) throw new Error('An item in your cart is unavailable.');
    sub += p.price * q; lines.push({ id: p.id, name: p.name, unit: p.unit, price: p.price, qty: q });
  }
  const s = db.settings;
  let fee = s.areaFees[pin] !== undefined ? s.areaFees[pin] : s.deliveryFee;
  if (s.freeAbove > 0 && sub >= s.freeAbove) fee = 0;
  return { lines, sub, fee, total: sub + fee };
}

app.get('/api/products', (req, res) => {
  const d = load();
  res.json({ products: d.products.filter(p => p.available), settings: d.settings });
});

app.get('/api/pickle-bottle-image', (req, res) => {
  const filename = ['pickle-bottle.png', 'pickle-bottle.jpg', 'pickle-bottle.webp']
    .find(name => fs.existsSync(path.join(__dirname, 'images', 'products', name)));
  res.json({ src: filename ? `/images/products/${filename}` : null });
});

const auth = (req, res, next) =>
  process.env.ADMIN_PASSWORD && req.get('x-admin-key') === process.env.ADMIN_PASSWORD ? next() : res.status(401).json({ error: 'Wrong password.' });

app.get('/api/reviews', (req, res) => {
  const d = load();
  res.json({ reviews: d.reviews.slice(0, 50) });
});

app.delete('/api/admin/reviews/:id', auth, (req, res) => {
  const d = load();
  const idx = d.reviews.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Review not found.' });
  const review = d.reviews[idx];
  if (review.image && review.image.startsWith('/uploads/')) {
    const filePath = path.resolve(uploadsDir, path.basename(review.image));
    if (filePath.startsWith(uploadsDir + path.sep) && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  d.reviews.splice(idx, 1);
  save(d);
  res.json({ ok: true });
});

app.post('/api/reviews', upload.single('imageFile'), (req, res) => {
  try {
    const d = load();
    const name = String(req.body.name || '').trim();
    const phone = String(req.body.phone || '').replace(/\D/g, '');
    const rating = Math.min(5, Math.max(1, Number(req.body.rating) || 5));
    const message = String(req.body.message || req.body.review || '').trim();
    const image = req.file ? `/uploads/${req.file.filename}` : String(req.body.image || '').trim();

    if (!name || !/^(?:\+\d{1,3})?\d{10}$/.test(phone)) throw new Error('Please enter a valid name and 10-digit phone number.');
    if (!message) throw new Error('Please write a short review.');

    const review = {
      id: 'rv-' + Date.now(),
      name,
      phone,
      rating,
      message,
      image: image || '',
      created: new Date().toISOString()
    };

    d.reviews.unshift(review);
    save(d);
    res.json({ ok: true, review });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save review.' });
  }
});

app.get('/api/admin/data', auth, (req, res) => res.json(load()));
app.put('/api/admin/data', auth, (req, res) => {
  const d = load(), { products, settings } = req.body, n = v => Math.max(0, Number(v) || 0);
  d.products = products.map((p, i) => ({ id: p.id || 'p' + Date.now() + i, name: String(p.name).slice(0, 80), category: p.category === 'Snacks' ? 'Snacks' : 'Pickles',
    unit: String(p.unit).slice(0, 20), price: n(p.price), available: !!p.available, desc: String(p.desc || '').slice(0, 160) }));
  const fees = {}; for (const k in settings.areaFees || {}) if (/^\d{6}$/.test(k)) fees[k] = n(settings.areaFees[k]);
  const whatsapp = String(settings.whatsappNumber || defaultWhatsapp).replace(/\D/g, '');
  d.settings = { shopName: String(settings.shopName).slice(0, 40), deliveryFee: n(settings.deliveryFee), freeAbove: n(settings.freeAbove), areaFees: fees, whatsappNumber: whatsapp || defaultWhatsapp };
  save(d); res.json({ ok: true });
});
app.patch('/api/admin/orders/:id', auth, (req, res) => {
  const d = load(), o = d.orders.find(x => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  o.status = req.body.status; save(d); res.json({ ok: true });
});

app.listen(port, () => console.log('Shop running on http://localhost:' + port));
