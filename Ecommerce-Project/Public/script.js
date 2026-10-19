// ==================== STATE ====================
let state = {
  products: [],
  cart: JSON.parse(localStorage.getItem("aurelia_cart") || "[]"),
  currentFilter: "all",
  currentAdminSection: "overview",
  editingProductId: null,
  adminToken: localStorage.getItem("adminToken") || null,
  dateRange: { type: "today" }, // today, week, month, year, custom
};

const socket = io();

// ==================== SOCKET ====================
socket.on("statsUpdate", (data) => {
  const liveEl = document.getElementById("liveCount");
  if (liveEl) liveEl.textContent = data.liveCartCount;
});
socket.on("notification", (data) => {
  showToast(`${data.emoji} ${data.message}`);
});
socket.on("productsChanged", () => queueRealtimeRefresh());
socket.on("ordersChanged", () => queueRealtimeRefresh());

let realtimeRefreshTimer = null;

function isViewActive(id) {
  return document.getElementById(id)?.classList.contains("active");
}

function queueRealtimeRefresh() {
  clearTimeout(realtimeRefreshTimer);
  realtimeRefreshTimer = setTimeout(refreshRealtimeData, 200);
}

async function refreshRealtimeData() {
  const allProductsRes = await apiCall("/api/products");
  if (allProductsRes.success) {
    syncCartWithProducts(allProductsRes.data);
    if (isViewActive("view-shop")) await loadProducts(state.currentFilter);
  }

  if (isViewActive("view-admin")) {
    if (state.currentAdminSection === "overview") renderAdminOverview();
    if (state.currentAdminSection === "products") renderAdminProducts();
    if (state.currentAdminSection === "orders") renderAdminOrders();
  }
}

function syncCartWithProducts(products) {
  const productMap = new Map(products.map((p) => [p._id, p]));
  let changed = false;
  state.cart = state.cart.reduce((cart, item) => {
    const freshProduct = productMap.get(item._id);
    if (!freshProduct || freshProduct.stock <= 0) {
      changed = true;
      return cart;
    }
    const qty = Math.min(item.qty || 1, freshProduct.stock);
    if (qty !== (item.qty || 1)) changed = true;
    cart.push({ ...freshProduct, qty });
    return cart;
  }, []);
  if (changed) {
    saveCart();
    updateCartBadge();
    renderCartPanel();
    if (isViewActive("view-checkout")) renderCheckoutPage();
    showToast("Cart updated with latest stock");
  }
}

// ==================== API HELPER ====================
async function apiCall(url, options = {}) {
  try {
    const headers = options.headers || {};
    if (state.adminToken && !url.includes("/admin/login")) {
      headers["x-admin-token"] = state.adminToken;
    }
    const res = await fetch(url, { ...options, headers });
    return await res.json();
  } catch (err) {
    showToast("Network error");
    return { success: false };
  }
}

// ==================== ADMIN AUTH ====================
async function adminLogin() {
  const password = document.getElementById("adminPassword").value;
  if (!password) {
    showToast("Enter password");
    return;
  }
  const res = await fetch("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const data = await res.json();
  if (data.success) {
    state.adminToken = data.token;
    localStorage.setItem("adminToken", data.token);
    closeLoginModal();
    showToast("Logged in as Admin");
    document
      .querySelectorAll(".view")
      .forEach((v) => v.classList.remove("active"));
    document.getElementById("view-admin").classList.add("active");
    document
      .querySelector('.nav-link[data-view="admin"]')
      .classList.add("active");
    renderAdminOverview();
  } else {
    showToast("Invalid password");
  }
}

function adminLogout() {
  state.adminToken = null;
  localStorage.removeItem("adminToken");
  showToast("Logged out");
  showView("shop");
}

function showLoginModal() {
  document.getElementById("loginModal").classList.add("open");
  document.getElementById("adminPassword").value = "";
}
function closeLoginModal() {
  document.getElementById("loginModal").classList.remove("open");
}

// ==================== PRODUCTS ====================
async function loadProducts(category = "all") {
  const grid = document.getElementById("productsGrid");
  if (!grid) return;
  grid.innerHTML =
    '<div class="loading-products">✨ Curating the collection...</div>';
  const query = category !== "all" ? `?category=${category}` : "";
  const res = await apiCall(`/api/products${query}`);
  if (res.success) {
    state.products = res.data;
    renderProductGrid(res.data);
  } else {
    grid.innerHTML = '<div class="empty-state">Unable to load products</div>';
  }
}

function renderProductGrid(products) {
  const grid = document.getElementById("productsGrid");
  if (!grid) return;
  if (!products.length) {
    grid.innerHTML =
      '<div class="empty-state">No products in this realm yet.</div>';
    return;
  }
  grid.innerHTML = products
    .map((p) => {
      const bgColor = getCategoryColor(p.category);
      const badgeHtml =
        p.badge === "new"
          ? '<span class="badge badge-new">New</span>'
          : p.badge === "sale"
            ? '<span class="badge badge-sale">Sale</span>'
            : "";
      const imgContent = p.image
        ? `<img src="/uploads/${p.image}" alt="${p.name}">`
        : `<span style="font-size:60px">${p.emoji || "✦"}</span>`;
      return `
      <div class="product-card" data-id="${p._id}">
        ${badgeHtml}
        <div class="product-img-wrap"><div class="card-img-inner" style="background:${bgColor}">${imgContent}</div></div>
        <div class="card-overlay">
          <button class="btn-add-cart" onclick="event.stopPropagation(); addToCart('${p._id}')">Add to Selection</button>
          <button class="btn-ai" onclick="event.stopPropagation(); openProductModal('${p._id}')">AI Description ✦</button>
        </div>
        <div class="card-body">
          <div class="card-cat">${p.category}</div>
          <div class="card-name">${escapeHtml(p.name)}</div>
          <div class="card-price">$${Number(p.price).toLocaleString()}</div>
        </div>
      </div>`;
    })
    .join("");
}

function getCategoryColor(cat) {
  const colors = {
    electronics: "#0a1a2e",
    fashion: "#2e1a2e",
    creative: "#1a2e2e",
    beauty: "#2e1a1a",
    home: "#1a2e1a",
    sports: "#2e2e1a",
    books: "#1a1a3e",
    kids: "#3e1a2e",
    pets: "#2e1a0a",
    automotive: "#1a1a1a",
    gifts: "#2e1a0a",
  };
  return colors[cat] || "#111115";
}

function filterProducts(category, btn) {
  state.currentFilter = category;
  document
    .querySelectorAll(".filter-btn")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  loadProducts(category);
}

// ==================== CART ====================
function addToCart(productId) {
  const product = state.products.find((p) => p._id === productId);
  if (!product) return;
  const existingItem = state.cart.find((i) => i._id === productId);
  const currentQtyInCart = existingItem ? existingItem.qty || 1 : 0;
  const requestedQty = currentQtyInCart + 1;
  if (requestedQty > (product.stock || 0)) {
    showToast(`❌ Only ${product.stock} left in stock. Cannot add more.`);
    return;
  }
  if (existingItem) existingItem.qty = requestedQty;
  else state.cart.push({ ...product, qty: 1 });
  saveCart();
  updateCartBadge();
  renderCartPanel();
  const newTotal = state.cart.reduce((s, i) => s + i.price * (i.qty || 1), 0);
  showToast(`${product.name} added | Total: $${newTotal.toLocaleString()}`);
  socket.emit("cartAdd", { delta: 1, name: product.name });
}
function removeFromCart(productId) {
  const item = state.cart.find((i) => i._id === productId);
  const qty = item?.qty || 1;
  state.cart = state.cart.filter((i) => i._id !== productId);
  saveCart();
  renderCartPanel();
  updateCartBadge();
  const newTotal = state.cart.reduce((s, i) => s + i.price * (i.qty || 1), 0);
  showToast(`Removed | Total: $${newTotal.toLocaleString()}`);
  socket.emit("cartRemove", { delta: qty });
}
function changeQty(productId, delta) {
  const item = state.cart.find((i) => i._id === productId);
  if (!item) return;
  const product = state.products.find((p) => p._id === productId);
  if (!product) return;
  const newQty = (item.qty || 1) + delta;
  if (newQty <= 0) {
    removeFromCart(productId);
    return;
  }
  if (newQty > product.stock) {
    showToast(`❌ Only ${product.stock} left in stock.`);
    return;
  }
  item.qty = newQty;
  saveCart();
  renderCartPanel();
  updateCartBadge();
  const newTotal = state.cart.reduce((s, i) => s + i.price * (i.qty || 1), 0);
  showToast(`Cart total: $${newTotal.toLocaleString()}`);
  if (delta > 0) socket.emit("cartAdd", { delta: 1, name: item.name });
  if (delta < 0) socket.emit("cartRemove", { delta: 1 });
}
function saveCart() {
  localStorage.setItem("aurelia_cart", JSON.stringify(state.cart));
}
function updateCartBadge() {
  const total = state.cart.reduce((s, i) => s + (i.qty || 1), 0);
  document
    .querySelectorAll(".cart-badge")
    .forEach((el) => (el.textContent = total));
}
function toggleCart() {
  document.getElementById("cartPanel").classList.toggle("open");
  document.getElementById("cartBackdrop").classList.toggle("open");
  renderCartPanel();
}
function closeCart() {
  document.getElementById("cartPanel").classList.remove("open");
  document.getElementById("cartBackdrop").classList.remove("open");
}
function renderCartPanel() {
  const body = document.getElementById("cartBody");
  const foot = document.getElementById("cartFoot");
  if (!body) return;
  if (!state.cart.length) {
    body.innerHTML =
      '<div class="empty-state">Your selection is empty.<br>Discover our collection.</div>';
    foot.innerHTML = "";
    return;
  }
  body.innerHTML = state.cart
    .map((item) => {
      const imgContent = item.image
        ? `<img src="/uploads/${item.image}" alt="${item.name}">`
        : `<span>${item.emoji || "✦"}</span>`;
      return `<div class="cart-item"><div class="cart-item-img" style="background:${getCategoryColor(item.category)}">${imgContent}</div><div class="cart-item-info"><div class="cart-item-name">${escapeHtml(item.name)}</div><div class="cart-item-price">$${(item.price * (item.qty || 1)).toLocaleString()}</div><div class="cart-qty"><button class="qty-btn" onclick="changeQty('${item._id}',-1)">−</button><span>${item.qty || 1}</span><button class="qty-btn" onclick="changeQty('${item._id}',1)">+</button></div></div><button class="cart-del" onclick="removeFromCart('${item._id}')">×</button></div>`;
    })
    .join("");
  const total = state.cart.reduce((s, i) => s + i.price * (i.qty || 1), 0);
  foot.innerHTML = `<div class="cart-total-row"><span>Total</span><span>$${total.toLocaleString()}</span></div><button class="checkout-btn" onclick="goToCheckout()">Proceed to Checkout</button>`;
}

// ==================== CHECKOUT ====================
function goToCheckout() {
  closeCart();
  let checkoutView = document.getElementById("view-checkout");
  if (!checkoutView) {
    checkoutView = document.createElement("div");
    checkoutView.id = "view-checkout";
    checkoutView.className = "view";
    document.body.appendChild(checkoutView);
  }
  renderCheckoutPage();
  document
    .querySelectorAll(".view")
    .forEach((v) => v.classList.remove("active"));
  checkoutView.classList.add("active");
}
function renderCheckoutPage() {
  const container = document.getElementById("view-checkout");
  if (!container) return;
  if (!state.cart.length) {
    container.innerHTML = `<div class="container" style="text-align:center"><div class="empty-state">Your cart is empty</div><button class="btn-primary" onclick="showView('shop')">Return to Shop</button></div>`;
    return;
  }
  const total = state.cart.reduce((s, i) => s + i.price * (i.qty || 1), 0);
  container.innerHTML = `<div class="container"><button class="filter-btn" onclick="showView('shop')" style="margin-bottom:2rem">← Back to Shop</button><div style="display:grid; grid-template-columns:1fr 0.8fr; gap:2rem;"><div><div style="background:var(--surface); padding:1.5rem; border-radius:20px;"><h3>Contact Information</h3><div class="form-group"><input id="chkFirstName" class="form-input" placeholder="First Name"></div><div class="form-group"><input id="chkLastName" class="form-input" placeholder="Last Name"></div><div class="form-group"><input id="chkEmail" class="form-input" type="email" placeholder="Email"></div><div class="form-group"><input id="chkMobile" class="form-input" type="tel" placeholder="Mobile Number (for SMS)"></div><div class="form-group"><input id="chkAddress" class="form-input" placeholder="Address"></div><div class="form-group"><input id="chkCity" class="form-input" placeholder="City"></div><div class="form-group"><input id="chkCountry" class="form-input" placeholder="Country"></div></div><div style="background:var(--surface); padding:1.5rem; border-radius:20px; margin-top:1.5rem;"><h3>Payment Method</h3><div style="display:flex; flex-wrap:wrap; gap:1rem;"><label><input type="radio" name="paymentMethod" value="bKash" checked> bKash</label><label><input type="radio" name="paymentMethod" value="Nagad"> Nagad</label><label><input type="radio" name="paymentMethod" value="Rocket"> Rocket</label><label><input type="radio" name="paymentMethod" value="Upay"> Upay</label><label><input type="radio" name="paymentMethod" value="Visa Card"> Visa Card</label></div><div class="form-group"><input type="text" id="paymentNumber" class="form-input" placeholder="Mobile / Card Number"></div></div></div><div><div style="background:var(--surface); padding:1.5rem; border-radius:20px;"><h3>Your Selection</h3>${state.cart.map((i) => `<div style="display:flex; justify-content:space-between; margin:1rem 0"><span>${i.name} × ${i.qty || 1}</span><span>$${(i.price * (i.qty || 1)).toLocaleString()}</span></div>`).join("")}<div style="border-top:1px solid var(--border); margin:1rem 0; padding-top:1rem; font-weight:700; display:flex; justify-content:space-between"><span>Total</span><span style="color:var(--accent-gold); font-size:1.3rem;">$${total.toLocaleString()}</span></div><button class="checkout-btn" onclick="placeOrder()">Complete Order & Pay</button></div></div></div></div>`;
}
async function placeOrder() {
  const firstName = document.getElementById("chkFirstName")?.value,
    lastName = document.getElementById("chkLastName")?.value,
    email = document.getElementById("chkEmail")?.value,
    mobile = document.getElementById("chkMobile")?.value;
  if (!firstName || !lastName || !email) {
    showToast("Please fill in your details");
    return;
  }
  if (!mobile) {
    showToast("Please enter mobile number for SMS");
    return;
  }
  const selectedPayment = document.querySelector(
    'input[name="paymentMethod"]:checked',
  )?.value;
  const paymentNumber = document.getElementById("paymentNumber")?.value;
  if (!selectedPayment || !paymentNumber) {
    showToast("Please select payment method and enter number");
    return;
  }
  showToast(`Processing payment via ${selectedPayment}...`);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const orderData = {
    customer: { name: `${firstName} ${lastName}`, email, mobile },
    address: {
      line1: document.getElementById("chkAddress")?.value || "",
      city: document.getElementById("chkCity")?.value || "",
      country: document.getElementById("chkCountry")?.value || "",
    },
    items: state.cart.map((i) => ({
      product: i._id,
      name: i.name,
      price: i.price,
      qty: i.qty || 1,
      emoji: i.emoji,
    })),
    total: state.cart.reduce((s, i) => s + i.price * (i.qty || 1), 0),
    paymentMethod: selectedPayment,
    paymentNumber,
  };
  const res = await apiCall("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(orderData),
  });
  if (res.success) {
    await fetch("/api/send-sms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mobile,
        orderId: res.data.orderId,
        items: orderData.items,
        total: orderData.total,
      }),
    });
    state.cart = [];
    saveCart();
    updateCartBadge();
    showToast(
      `✅ Payment successful! Order placed! ✨ ${res.data.orderId}\nSMS sent to ${mobile}`,
    );
    loadProducts(state.currentFilter);
    showView("shop");
    renderCartPanel();
  } else {
    showToast(res.message || "Order failed");
  }
}

// ==================== PRODUCT MODAL ====================
async function openProductModal(productId) {
  const product = state.products.find((p) => p._id === productId);
  if (!product) return;
  const bgColor = getCategoryColor(product.category);
  const imgContent = product.image
    ? `<img src="/uploads/${product.image}" style="width:100%;height:100%;object-fit:cover;">`
    : `<span style="font-size:60px">${product.emoji || "✦"}</span>`;
  document.getElementById("modalImg").style.background = bgColor;
  document.getElementById("modalImg").innerHTML = imgContent;
  document.getElementById("modalTag").textContent =
    product.category.toUpperCase();
  document.getElementById("modalName").textContent = product.name;
  document.getElementById("modalPrice").textContent =
    `$${Number(product.price).toLocaleString()}`;
  document.getElementById("modalDesc").innerHTML =
    '<div class="loading-products">✨ AI composing description...</div>';
  document.getElementById("modalAddBtn").onclick = () => {
    addToCart(product._id);
    closeProductModal();
  };
  document.getElementById("productModal").classList.add("open");
  const res = await apiCall("/api/ai/description", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: product.name,
      category: product.category,
      price: product.price,
    }),
  });
  document.getElementById("modalDesc").innerHTML =
    res.description || "A masterpiece.";
}
function closeProductModal() {
  document.getElementById("productModal").classList.remove("open");
}

// ==================== ADMIN PANEL (with date filters) ====================
function getInventoryStats(products) {
  let totalValue = 0,
    lowStockItems = [];
  for (const p of products) {
    totalValue += (p.price || 0) * (p.stock || 0);
    if (p.stock < 10 && p.stock > 0)
      lowStockItems.push({ name: p.name, stock: p.stock });
  }
  return { totalValue, lowStockItems };
}

// ডেট ফিল্টার ফাংশন
function setDateRange(type, startDate = null, endDate = null) {
  state.dateRange = { type, startDate, endDate };
  renderAdminOverview();
}

async function renderAdminOverview() {
  const main = document.getElementById("adminMain");
  if (!main) return;
  // build date filter UI
  const filterHtml = `
    <div style="background:var(--surface); border-radius:20px; padding:1rem; margin-bottom:1.5rem;">
      <strong>Sales Period:</strong>
      <button class="filter-btn" style="padding:0.3rem 0.8rem;" onclick="setDateRange('today')">Today</button>
      <button class="filter-btn" style="padding:0.3rem 0.8rem;" onclick="setDateRange('week')">This Week</button>
      <button class="filter-btn" style="padding:0.3rem 0.8rem;" onclick="setDateRange('month')">This Month</button>
      <button class="filter-btn" style="padding:0.3rem 0.8rem;" onclick="setDateRange('year')">This Year</button>
      <span style="margin:0 0.5rem">or</span>
      <input type="date" id="customStart" style="background:var(--surface); border:1px solid var(--border); padding:0.3rem; border-radius:8px; color:white;">
      <span> to </span>
      <input type="date" id="customEnd" style="background:var(--surface); border:1px solid var(--border); padding:0.3rem; border-radius:8px; color:white;">
      <button class="filter-btn" style="padding:0.3rem 0.8rem;" onclick="applyCustomDate()">Apply</button>
    </div>
  `;
  // fetch stats with date parameters
  let url = "/api/stats";
  const { type, startDate, endDate } = state.dateRange;
  if (type === "today") url += "?period=today";
  else if (type === "week") url += "?period=week";
  else if (type === "month") url += "?period=month";
  else if (type === "year") url += "?period=year";
  else if (type === "custom" && startDate && endDate)
    url += `?start=${startDate}&end=${endDate}`;
  const statsRes = await apiCall(url);
  const stats = statsRes.data || {
    revenue: 0,
    orders: 0,
    products: 0,
    liveCartCount: 0,
    todayRevenue: 0,
  };
  // products for inventory
  const productsRes = await apiCall("/api/products");
  const products = productsRes.success ? productsRes.data : [];
  const { totalValue, lowStockItems } = getInventoryStats(products);
  let lowStockHtml = "";
  if (lowStockItems.length > 0)
    lowStockHtml = `<div style="background:rgba(224,90,90,0.2); border-left:4px solid var(--danger); padding:1rem; margin-bottom:1.5rem;"><strong style="color:var(--danger);">⚠️ Low Stock Alert</strong><br>${lowStockItems.map((item) => `${item.name} (only ${item.stock} left)`).join(" • ")}</div>`;
  main.innerHTML =
    filterHtml +
    `
    <div class="admin-stats">
      <div class="stat-card"><div class="stat-label">Revenue (Filtered)</div><div class="stat-value">$${stats.revenue?.toLocaleString() || 0}</div></div>
      <div class="stat-card"><div class="stat-label">Orders</div><div class="stat-value">${stats.orders || 0}</div></div>
      <div class="stat-card"><div class="stat-label">Products</div><div class="stat-value">${stats.products || 0}</div></div>
      <div class="stat-card"><div class="stat-label">Inventory Value</div><div class="stat-value">$${totalValue.toLocaleString()}</div></div>
      <div class="stat-card"><div class="stat-label">Live Carts</div><div class="stat-value" id="liveCount">${stats.liveCartCount || 0}</div></div>
    </div>
    ${lowStockHtml}
    <div style="background:var(--surface); border-radius:20px; padding:1rem;"><h3>Recent Products</h3>${
      products.length
        ? `<table class="data-table"><thead><tr><th>Product</th><th>Price</th><th>Stock</th></tr></thead><tbody>${products
            .slice(0, 5)
            .map(
              (p) =>
                `<tr><td>${p.name}</td><td>$${p.price}</td><td>${p.stock ?? "—"}</td></tr>`,
            )
            .join("")}</tbody></table>`
        : '<div class="empty-state">No products</div>'
    }</div>`;
}

function applyCustomDate() {
  const start = document.getElementById("customStart").value;
  const end = document.getElementById("customEnd").value;
  if (start && end) {
    state.dateRange = { type: "custom", startDate: start, endDate: end };
    renderAdminOverview();
  } else showToast("Select both start and end date");
}

async function renderAdminProducts() {
  const main = document.getElementById("adminMain");
  if (!main) return;
  const res = await apiCall("/api/products");
  const products = res.success ? res.data : [];
  const { totalValue, lowStockItems } = getInventoryStats(products);
  let lowStockHtml = lowStockItems.length
    ? `<div style="background:rgba(224,90,90,0.2); border-left:4px solid var(--danger); padding:1rem; margin-bottom:1.5rem;"><strong>⚠️ Low Stock Alert</strong><br>${lowStockItems.map((i) => `${i.name} (only ${i.stock} left)`).join(" • ")}</div>`
    : "";
  main.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center;"><h3>Product Catalog</h3><div><strong>Total Inventory Value: $${totalValue.toLocaleString()}</strong></div></div>${lowStockHtml}<div style="text-align:right; margin-bottom:1rem;"><button class="btn-primary" onclick="openAddProductModal()">+ Add Product</button></div><div style="background:var(--surface); border-radius:20px; overflow-x:auto;">${products.length ? `<table class="data-table"><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Actions</th></tr></thead><tbody>${products.map((p) => `<tr><td>${p.name}</td><td>${p.category}</td><td>$${p.price}</td><td style="${p.stock < 10 ? "color:var(--danger);font-weight:bold" : ""}">${p.stock ?? 0}</td><td><button class="filter-btn" style="padding:0.3rem 0.8rem;" onclick="editProduct('${p._id}')">Edit</button> <button class="filter-btn" style="background:var(--danger);" onclick="deleteProduct('${p._id}')">Delete</button></td></tr>`).join("")}</tbody></table>` : '<div class="empty-state">No products</div>'}</div>`;
}
function switchAdminSection(section, btn) {
  state.currentAdminSection = section;
  document
    .querySelectorAll(".admin-nav")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  if (section === "overview") renderAdminOverview();
  if (section === "products") renderAdminProducts();
  if (section === "orders") renderAdminOrders();
}
async function renderAdminOrders() {
  const main = document.getElementById("adminMain");
  if (!main) return;
  const res = await apiCall("/api/orders");
  main.innerHTML = `<h3>Orders</h3><div style="background:var(--surface); border-radius:20px; overflow-x:auto;">${res.success && res.data.length ? `<table class="data-table"><thead><tr><th>Order ID</th><th>Customer</th><th>Mobile</th><th>Total</th><th>Payment</th><th>Status</th><th>Update</th></tr></thead><tbody>${res.data.map((o) => `<tr><td>${o.orderId}</td><td>${o.customer?.name || "—"}</td><td>${o.customer?.mobile || ""}</td><td>$${o.total}</td><td>${o.paymentMethod || "N/A"}<br><small>${o.paymentNumber || ""}</small></td><td><span style="color:var(--accent-gold)">${o.status}</span></td><td><select class="form-select" style="padding:0.3rem;" onchange="updateOrderStatus('${o.orderId}', this.value)"><option value="pending">pending</option><option value="processing">processing</option><option value="shipped">shipped</option><option value="delivered">delivered</option><option value="cancelled">cancelled</option></select></td></tr>`).join("")}</tbody></table>` : '<div class="empty-state">No orders yet</div>'}</div>`;
}
async function updateOrderStatus(orderId, status) {
  await apiCall(`/api/orders/${orderId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  showToast(`Order ${orderId} updated to ${status}`);
  renderAdminOrders();
  loadProducts(state.currentFilter);
}
function openAddProductModal(product = null) {
  state.editingProductId = product?._id || null;
  document.getElementById("addModalTitle").textContent = product
    ? "Edit Product"
    : "Add Product";
  document.getElementById("addModalSubmit").textContent = product
    ? "Save Changes"
    : "Add to Catalog";
  if (product) {
    document.getElementById("newName").value = product.name;
    document.getElementById("newPrice").value = product.price;
    document.getElementById("newCategory").value = product.category;
    document.getElementById("newBadge").value = product.badge || "";
    document.getElementById("newEmoji").value = product.emoji || "✦";
    document.getElementById("newStock").value = product.stock || 100;
  } else {
    document.getElementById("productForm").reset();
  }
  document.getElementById("addProductModal").classList.add("open");
}
function closeAddProductModal() {
  document.getElementById("addProductModal").classList.remove("open");
  state.editingProductId = null;
}
async function submitProduct() {
  const formData = new FormData();
  formData.append("name", document.getElementById("newName").value);
  formData.append("price", document.getElementById("newPrice").value);
  formData.append("category", document.getElementById("newCategory").value);
  formData.append("badge", document.getElementById("newBadge").value);
  formData.append("emoji", document.getElementById("newEmoji").value);
  formData.append("stock", document.getElementById("newStock").value);
  const imageFile = document.getElementById("newImage").files[0];
  if (imageFile) formData.append("image", imageFile);
  const url = state.editingProductId
    ? `/api/products/${state.editingProductId}`
    : "/api/products";
  const method = state.editingProductId ? "PUT" : "POST";
  const token = state.adminToken;
  const res = await fetch(url, {
    method,
    body: formData,
    headers: token ? { "x-admin-token": token } : {},
  });
  const data = await res.json();
  if (data.success) {
    showToast(state.editingProductId ? "Product updated" : "Product added");
    closeAddProductModal();
    renderAdminProducts();
    loadProducts(state.currentFilter);
  } else showToast("Error saving product");
}
async function deleteProduct(id) {
  if (!confirm("Delete this product?")) return;
  const res = await apiCall(`/api/products/${id}`, { method: "DELETE" });
  if (res.success) {
    showToast("Product deleted");
    renderAdminProducts();
    loadProducts(state.currentFilter);
  }
}
async function editProduct(id) {
  const res = await apiCall(`/api/products/${id}`);
  if (res.success) openAddProductModal(res.data);
}
function showView(view) {
  if (view === "admin") {
    if (state.adminToken) {
      document
        .querySelectorAll(".view")
        .forEach((v) => v.classList.remove("active"));
      document.getElementById("view-admin").classList.add("active");
      document
        .querySelector('.nav-link[data-view="admin"]')
        .classList.add("active");
      renderAdminOverview();
    } else showLoginModal();
    return;
  }
  document
    .querySelectorAll(".view")
    .forEach((v) => v.classList.remove("active"));
  if (view === "shop") {
    document.getElementById("view-shop").classList.add("active");
    document
      .querySelector('.nav-link[data-view="shop"]')
      .classList.add("active");
    loadProducts(state.currentFilter);
  } else if (view === "checkout") goToCheckout();
  document
    .querySelector('.nav-link[data-view="admin"]')
    ?.classList.remove("active");
}
function escapeHtml(str) {
  if (!str) return "";
  return str.replace(
    /[&<>]/g,
    (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[m],
  );
}
function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2500);
}
document.addEventListener("DOMContentLoaded", () => {
  updateCartBadge();
  loadProducts();
  renderCartPanel();
});
