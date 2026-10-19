const express = require("express");
const mongoose = require("mongoose");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const path = require("path");
const fs = require("fs-extra");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use("/uploads", express.static(path.join(__dirname, "public", "uploads")));
fs.ensureDirSync("./public/uploads");

mongoose
  .connect("mongodb://localhost:27017/kenaketa_ecommerce")
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// ========== MODELS ==========
const validCategories = [
  "electronics",
  "fashion",
  "creative",
  "beauty",
  "home",
  "sports",
  "books",
  "kids",
  "pets",
  "automotive",
  "gifts",
];
const productSchema = new mongoose.Schema({
  name: String,
  price: Number,
  image: String,
  category: { type: String, enum: validCategories, default: "electronics" },
  badge: { type: String, enum: ["new", "sale", ""], default: "" },
  emoji: { type: String, default: "✦" },
  stock: { type: Number, default: 100 },
  createdAt: { type: Date, default: Date.now },
});
const Product = mongoose.model("Product", productSchema);

const orderSchema = new mongoose.Schema({
  orderId: { type: String, unique: true },
  customer: { name: String, email: String, mobile: String },
  address: { line1: String, city: String, country: String },
  items: [
    {
      product: mongoose.Schema.Types.ObjectId,
      name: String,
      price: Number,
      qty: Number,
      emoji: String,
    },
  ],
  total: Number,
  paymentMethod: String,
  paymentNumber: String,
  status: {
    type: String,
    enum: ["pending", "processing", "shipped", "delivered", "cancelled"],
    default: "pending",
  },
  createdAt: { type: Date, default: Date.now },
});
const Order = mongoose.model("Order", orderSchema);

// ========== MULTER ==========
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "./public/uploads"),
  filename: (req, file, cb) =>
    cb(
      null,
      Date.now() +
        "-" +
        Math.round(Math.random() * 1e9) +
        path.extname(file.originalname),
    ),
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// ========== ADMIN AUTH ==========
const adminTokens = new Map();
const ADMIN_PASSWORD = "admin123";
function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"];
  if (!token || !adminTokens.has(token))
    return res.status(401).json({ success: false, message: "Unauthorized" });
  next();
}
app.post("/api/admin/login", (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    const token = uuidv4();
    adminTokens.set(token, true);
    res.json({ success: true, token });
  } else res.status(401).json({ success: false });
});

// ========== SOCKET ==========
let liveCartTotal = 0;
async function emitStatsUpdate() {
  const productCount = await Product.countDocuments();
  const orderCount = await Order.countDocuments();
  io.emit("statsUpdate", {
    liveCartCount: liveCartTotal,
    productCount,
    orderCount,
  });
}

async function emitProductsChanged(action, product = null, extra = {}) {
  const productCount = await Product.countDocuments();
  io.emit("productsChanged", {
    action,
    product,
    productId: product?._id || extra.productId || null,
    productCount,
    ...extra,
  });
  await emitStatsUpdate();
}
io.on("connection", (socket) => {
  Product.countDocuments()
    .then((productCount) => {
      socket.emit("statsUpdate", {
        liveCartCount: liveCartTotal,
        productCount,
      });
    })
    .catch(() => socket.emit("statsUpdate", { liveCartCount: liveCartTotal }));
  socket.on("cartAdd", (data) => {
    liveCartTotal += data.delta || 1;
    emitStatsUpdate().catch(console.error);
    io.emit("notification", {
      emoji: "✨",
      message: `${data.name || "Item"} added to cart`,
    });
  });
  socket.on("cartRemove", (data) => {
    liveCartTotal = Math.max(0, liveCartTotal - (data.delta || 1));
    emitStatsUpdate().catch(console.error);
  });
});

// ========== PUBLIC ROUTES ==========
app.get("/api/products", async (req, res) => {
  try {
    const filter =
      req.query.category && req.query.category !== "all"
        ? { category: req.query.category }
        : {};
    const products = await Product.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: products });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});
app.get("/api/products/:id", async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    product
      ? res.json({ success: true, data: product })
      : res.status(404).json({ success: false });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// ========== ADMIN PRODUCT ROUTES ==========
app.post(
  "/api/products",
  requireAdmin,
  upload.single("image"),
  async (req, res) => {
    try {
      const product = new Product({
        name: req.body.name,
        price: Number(req.body.price),
        category: req.body.category || "electronics",
        badge: req.body.badge || "",
        emoji: req.body.emoji || "✦",
        stock: Number(req.body.stock) || 100,
        image: req.file ? req.file.filename : "",
      });
      await product.save();
      await emitProductsChanged("created", product);
      io.emit("notification", {
        emoji: "new",
        message: `${product.name} is now live in the catalog`,
      });
      res.json({ success: true, data: product });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
);
app.put(
  "/api/products/:id",
  requireAdmin,
  upload.single("image"),
  async (req, res) => {
    try {
      const update = {
        ...req.body,
        price: Number(req.body.price),
        stock: Number(req.body.stock),
      };
      if (req.file) update.image = req.file.filename;
      const product = await Product.findByIdAndUpdate(req.params.id, update, {
        new: true,
      });
      if (!product) return res.status(404).json({ success: false });
      await emitProductsChanged("updated", product);
      io.emit("notification", {
        emoji: "updated",
        message: `${product.name} was updated`,
      });
      res.json({ success: true, data: product });
    } catch (err) {
      res.status(500).json({ success: false });
    }
  },
);
app.delete("/api/products/:id", requireAdmin, async (req, res) => {
  const product = await Product.findByIdAndDelete(req.params.id);
  if (!product) return res.status(404).json({ success: false });
  await emitProductsChanged("deleted", null, {
    productId: req.params.id,
    productName: product.name,
  });
  io.emit("notification", {
    emoji: "removed",
    message: `${product.name} was removed from the catalog`,
  });
  res.json({ success: true });
});

// ========== ORDER ROUTES ==========
app.get("/api/orders", requireAdmin, async (req, res) => {
  const orders = await Order.find().sort({ createdAt: -1 });
  res.json({ success: true, data: orders });
});
app.post("/api/orders", async (req, res) => {
  try {
    const { customer, address, items, total, paymentMethod, paymentNumber } =
      req.body;
    for (const item of items) {
      const product = await Product.findById(item.product);
      if (!product)
        return res
          .status(400)
          .json({ success: false, message: `Product ${item.name} not found` });
      if (product.stock < item.qty)
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${product.name}. Only ${product.stock} left.`,
        });
    }
    for (const item of items)
      await Product.findByIdAndUpdate(item.product, {
        $inc: { stock: -item.qty },
      });
    const orderId = "ORD-" + uuidv4().slice(0, 8).toUpperCase();
    const order = new Order({
      customer,
      address,
      items,
      total,
      paymentMethod,
      paymentNumber,
      orderId,
      status: "pending",
    });
    await order.save();
    liveCartTotal = Math.max(
      0,
      liveCartTotal - items.reduce((sum, item) => sum + (item.qty || 1), 0),
    );
    const changedProducts = await Product.find({
      _id: { $in: items.map((item) => item.product) },
    });
    await emitProductsChanged("stock-updated", null, {
      products: changedProducts,
    });
    io.emit("ordersChanged", { action: "created", order });
    io.emit("notification", {
      emoji: "order",
      message: `New order #${orderId} for $${total}`,
    });
    res.json({ success: true, data: { orderId, order } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
app.patch("/api/orders/:orderId/status", requireAdmin, async (req, res) => {
  const order = await Order.findOne({ orderId: req.params.orderId });
  if (!order) return res.status(404).json({ success: false });
  if (order.status !== "cancelled" && req.body.status === "cancelled") {
    for (const item of order.items)
      await Product.findByIdAndUpdate(item.product, {
        $inc: { stock: item.qty },
      });
  }
  order.status = req.body.status;
  await order.save();
  const changedProducts = await Product.find({
    _id: { $in: order.items.map((item) => item.product) },
  });
  await emitProductsChanged("stock-updated", null, {
    products: changedProducts,
  });
  io.emit("ordersChanged", { action: "status-updated", order });
  io.emit("notification", {
    emoji: "order",
    message: `Order #${order.orderId} is now ${order.status}`,
  });
  res.json({ success: true, data: order });
});

// ========== STATS with date filtering ==========
app.get("/api/stats", requireAdmin, async (req, res) => {
  try {
    let startDate, endDate;
    const { period, start, end } = req.query;
    const now = new Date();
    if (period === "today") {
      startDate = new Date(now.setHours(0, 0, 0, 0));
      endDate = new Date(now.setHours(23, 59, 59, 999));
    } else if (period === "week") {
      const day = now.getDay();
      startDate = new Date(now);
      startDate.setDate(now.getDate() - day);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 6);
      endDate.setHours(23, 59, 59, 999);
    } else if (period === "month") {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      endDate.setHours(23, 59, 59, 999);
    } else if (period === "year") {
      startDate = new Date(now.getFullYear(), 0, 1);
      endDate = new Date(now.getFullYear(), 11, 31);
      endDate.setHours(23, 59, 59, 999);
    } else if (start && end) {
      startDate = new Date(start);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(end);
      endDate.setHours(23, 59, 59, 999);
    } else {
      // default all time
      startDate = null;
      endDate = null;
    }
    const filter = {};
    if (startDate && endDate)
      filter.createdAt = { $gte: startDate, $lte: endDate };
    const orders = await Order.find(filter);
    const revenue = orders.reduce((s, o) => s + o.total, 0);
    const productCount = await Product.countDocuments();
    res.json({
      success: true,
      data: {
        revenue,
        orders: orders.length,
        products: productCount,
        liveCartCount: liveCartTotal,
        todayRevenue: revenue,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ========== AI DESCRIPTION ==========
app.post("/api/ai/description", (req, res) => {
  const { name, category } = req.body;
  const descs = [
    `Crafted for the discerning connoisseur, this ${name} embodies elegance.`,
    `The ${name} redefines ${category} with an ethereal touch.`,
    `A ${category} masterpiece that sparks joy and wonder.`,
  ];
  res.json({ description: descs[Math.floor(Math.random() * descs.length)] });
});

// ========== SMS SIMULATION ==========
app.post("/api/send-sms", (req, res) => {
  const { mobile, orderId, items, total } = req.body;
  const productList = items
    .map((i) => `${i.name} (ID:${i.product}) x${i.qty} = $${i.price * i.qty}`)
    .join(", ");
  console.log(
    `\n📱 SMS to ${mobile}: Welcome to KENAKETA! Your order ${orderId} placed successfully. Items: ${productList}. Total: $${total}. Thank you.\n`,
  );
  res.json({ success: true });
});

// Serve frontend
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(
    `🚀 Server running on http://localhost:${PORT}\n✨ Admin password: ${ADMIN_PASSWORD}`,
  ),
);
