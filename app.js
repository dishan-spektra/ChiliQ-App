/* ===================== SHARED STATE (no external database) =====================
   All orders live as one JSON array in localStorage. Any open tab on this same
   site (customer or staff) reads/writes the same key, and the browser's native
   'storage' event notifies every OTHER open tab the instant something changes —
   that's what makes "Accept order" on the staff dashboard instantly update the
   customer's ticket in a different tab, with no server or database involved. */

const ORDERS_KEY = 'qs_orders_v3';
const COUNTER_KEY = 'qs_order_counter_v3';

let MENU = null;
let cart = {};
let activeCat = null;
let orderMode = 'dinein'; // 'dinein' | 'pickup' | 'delivery'
let tableNumber = null;
let currentTimeSlots = [];
let selectedTimeIndex = 0;
let selectedPaymentMethod = null;
let selectedDiningOption = 'takeaway'; // 'takeaway' | 'dinein' — only relevant for pickup mode
let currentOrderId = null;

const DINEIN_FLOW = ['new', 'accepted', 'preparing', 'ready', 'completed'];
const PICKUP_FLOW = ['new', 'accepted', 'preparing', 'ready', 'picked_up'];
const DELIVERY_FLOW = ['new', 'accepted', 'preparing', 'out_for_delivery', 'delivered'];

const STATUS_LABEL = {
  new: 'New order',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready: 'Ready',
  completed: 'Served',
  picked_up: 'Picked up',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
};

const PAYMENT_METHODS = [
  { key: 'upi', label: 'UPI' },
  { key: 'card', label: 'Card' },
];
const DINING_OPTIONS = [
  { key: 'takeaway', label: 'Grab & go' },
  { key: 'dinein', label: 'Sit & eat here' },
];

/* ---------------- storage helpers ---------------- */
function loadOrders() {
  try { return JSON.parse(localStorage.getItem(ORDERS_KEY)) || []; } catch { return []; }
}
function saveOrders(orders) {
  localStorage.setItem(ORDERS_KEY, JSON.stringify(orders.slice(0, 200)));
}
function getOrder(id) { return loadOrders().find(o => o.id === id); }
function upsertOrder(order) {
  const orders = loadOrders();
  const idx = orders.findIndex(o => o.id === order.id);
  if (idx === -1) orders.unshift(order); else orders[idx] = order;
  saveOrders(orders);
}
function flowForMode(mode) {
  return mode === 'dinein' ? DINEIN_FLOW : mode === 'pickup' ? PICKUP_FLOW : DELIVERY_FLOW;
}

/* ---------------- init ---------------- */
async function init() {
  const res = await fetch('menu.json');
  MENU = await res.json();
  activeCat = MENU.categories[0].key;

  window.addEventListener('storage', (e) => {
    if (e.key !== ORDERS_KEY) return;
    if (document.getElementById('adminApp').style.display !== 'none') renderAdmin();
    if (currentOrderId) refreshCustomerTicket();
  });

  const params = new URLSearchParams(location.search);
  if (params.get('staff') === '1') openStaffView();
  else showView('landing');
}

function allItems() { return MENU.categories.flatMap(c => c.items); }
function findItem(id) { return allItems().find(i => i.id === id); }
function findCategory(key) { return MENU.categories.find(c => c.key === key); }
function categoryOfItem(id) { return MENU.categories.find(c => c.items.some(i => i.id === id))?.key; }

/* ===================== VIEW SWITCHING (customer <-> admin) ===================== */
function openStaffView() {
  document.getElementById('customerApp').style.display = 'none';
  document.getElementById('adminApp').style.display = 'flex';
  document.getElementById('callStaffFab').style.display = 'none';
  renderAdmin();
}
function openCustomerView() {
  document.getElementById('adminApp').style.display = 'none';
  document.getElementById('customerApp').style.display = 'flex';
  showView('landing');
}
function launchStaffTab() { window.open(location.pathname + '?staff=1', '_blank'); }

function chooseMode(mode) {
  orderMode = mode;
  cart = {};
  selectedPaymentMethod = null;
  selectedDiningOption = 'takeaway';
  if (mode === 'dinein') { tableNumber = null; showView('table'); }
  else { showView('menu'); }
}

function showView(name) {
  document.querySelectorAll('#customerApp .view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.getElementById('callStaffFab').style.display = (name === 'landing') ? 'none' : 'flex';
  if (name === 'table') renderTableGrid();
  if (name === 'menu') renderMenu();
  if (name === 'cart') renderCart();
  if (name === 'address') renderTimeSlots();
  if (name === 'pickup') renderPickupScreen();
}

/* ===================== LANDING / TABLE PICK ===================== */
function renderTableGrid() {
  const grid = document.getElementById('tableGrid');
  const nums = Array.from({ length: 8 }, (_, i) => i + 1);
  grid.innerHTML = nums.map(n =>
    `<button class="table-btn ${tableNumber === n ? 'selected' : ''}" onclick="selectTable(${n})">${n}</button>`
  ).join('');
}
function selectTable(n) {
  tableNumber = n;
  document.getElementById('customTable').value = '';
  renderTableGrid();
  showView('menu');
}
function confirmCustomTable() {
  const input = document.getElementById('customTable');
  const field = input.closest('.field');
  const val = parseInt(input.value, 10);
  if (!val || val < 1 || val > 200) { field.classList.add('invalid'); return; }
  field.classList.remove('invalid');
  tableNumber = val;
  showView('menu');
}

/* ===================== MENU ===================== */
function renderCatTabs() {
  const tabs = document.getElementById('catTabs');
  tabs.innerHTML = MENU.categories.map(cat =>
    `<button class="cat-tab ${cat.key === activeCat ? 'active' : ''}" onclick="setCat('${cat.key}')">${cat.label}</button>`
  ).join('');
}
function setCat(key) { activeCat = key; renderMenu(); }
function goBackFromMenu() { showView(orderMode === 'dinein' ? 'table' : 'landing'); }

function menuTitleForMode() {
  if (orderMode === 'dinein') return `Today's menu · Table ${tableNumber}`;
  if (orderMode === 'pickup') return 'Order ahead for pickup';
  return 'Order for delivery';
}

function renderMenu() {
  document.getElementById('menuTitle').textContent = menuTitleForMode();
  renderCatTabs();
  const list = document.getElementById('menuList');
  const items = findCategory(activeCat).items;
  list.innerHTML = items.map(item => {
    const qty = cart[item.id] || 0;
    return `
    <div class="item-card">
      <div class="item-swatch" style="background:${item.tint}">${item.emoji}</div>
      <div class="item-body">
        <h3>${item.name}</h3>
        <div class="item-meta">
          <span class="price">${MENU.currency}${item.price}</span>
          <span class="express-tag" ${activeCat !== 'express' ? 'style="color:var(--ink-soft);background:var(--cream-2)"' : ''}>
            ${activeCat === 'express' ? 'Ready in ' + item.ready + ' min' : item.ready + ' min prep'}
          </span>
        </div>
        <div class="add-row">
          ${qty === 0
            ? `<button class="add-btn" onclick="addItem('${item.id}')" aria-label="Add ${item.name}">+</button>`
            : `<div class="qty-stepper">
                 <button onclick="changeQty('${item.id}', -1)" aria-label="Remove one">−</button>
                 <span>${qty}</span>
                 <button onclick="changeQty('${item.id}', 1)" aria-label="Add one">+</button>
               </div>`
          }
        </div>
      </div>
    </div>`;
  }).join('');
  updateCartBar();
}

function addItem(id) { cart[id] = (cart[id] || 0) + 1; renderMenu(); }
function changeQty(id, delta) {
  cart[id] = (cart[id] || 0) + delta;
  if (cart[id] <= 0) delete cart[id];
  renderMenu();
}
function cartTotal() { return Object.entries(cart).reduce((sum, [id, qty]) => sum + findItem(id).price * qty, 0); }
function cartCount() { return Object.values(cart).reduce((a, b) => a + b, 0); }

function updateCartBar() {
  const bar = document.getElementById('cartBar');
  const count = cartCount();
  if (count > 0) {
    bar.classList.add('show');
    document.getElementById('cbCount').textContent = count + (count === 1 ? ' item' : ' items');
    document.getElementById('cbTotal').textContent = MENU.currency + cartTotal();
  } else {
    bar.classList.remove('show');
  }
}

function feeForMode() {
  if (orderMode === 'dinein') return MENU.dineinServiceFee;
  if (orderMode === 'pickup') return selectedDiningOption === 'dinein' ? MENU.dineinServiceFee : MENU.packagingFee;
  return MENU.deliveryFee;
}
function feeLabelForMode() {
  if (orderMode === 'dinein') return 'Service fee';
  if (orderMode === 'pickup') return selectedDiningOption === 'dinein' ? 'Service fee' : 'Packaging fee';
  return 'Delivery fee';
}

/* ===================== WAIT-TIME ESTIMATOR =====================
   Ties directly back to the "reduce peak-hour wait" problem: the estimate
   isn't just the slowest dish's prep time — it also factors in how many
   orders are currently active in the kitchen right now (the real queue),
   and gives Express-only orders a shorter queue penalty since they're
   meant to skip the main line. */
const QUEUE_PENALTY_MAIN = 3;
const QUEUE_PENALTY_EXPRESS = 1.5;
const DELIVERY_TRAVEL_MIN = 18;

function activeKitchenOrders() {
  return loadOrders().filter(o => o.status === 'accepted' || o.status === 'preparing').length;
}
function estimateWait(entries) {
  const items = entries.map(([id, qty]) => ({ item: findItem(id), qty }));
  const maxReady = Math.max(...items.map(x => x.item.ready));
  const isExpressOnly = items.every(x => categoryOfItem(x.item.id) === 'express');
  const queueCount = activeKitchenOrders();
  const penalty = isExpressOnly ? QUEUE_PENALTY_EXPRESS : QUEUE_PENALTY_MAIN;
  const queueWait = Math.round(queueCount * penalty);
  return { maxReady, queueWait, queueCount, isExpressOnly, total: maxReady + queueWait };
}
function waitSummaryHTML(entries) {
  const est = estimateWait(entries);
  const lane = est.isExpressOnly ? `Express lane · skips most of the queue`
    : `${est.queueCount} order${est.queueCount === 1 ? '' : 's'} ahead in the kitchen`;
  return `
    <div class="wait-card">
      <div class="wait-top">
        <span class="wait-clock">⏱️ ~${est.total} min</span>
        <span class="wait-lane">${lane}</span>
      </div>
      <div class="wait-breakdown">${est.maxReady} min cooking${est.queueWait > 0 ? ` + ${est.queueWait} min queue buffer` : ''}</div>
    </div>`;
}

/* ===================== CART ===================== */
function renderCart() {
  const content = document.getElementById('cartContent');
  const entries = Object.entries(cart);
  if (entries.length === 0) {
    content.innerHTML = `<div class="empty-state">
      <div style="font-size:2.2rem">🧺</div>
      <p>Your cart is empty.<br>Head back to the menu to add something.</p>
      <button class="btn-ghost" style="max-width:220px" onclick="showView('menu')">Browse menu</button>
    </div>`;
    return;
  }
  const rows = entries.map(([id, qty]) => {
    const item = findItem(id);
    return `<div class="cart-row">
      <div class="item-swatch" style="background:${item.tint};width:44px;height:44px;font-size:1.2rem">${item.emoji}</div>
      <div class="cr-name">${item.name}</div>
      <div class="qty-stepper">
        <button onclick="changeQty('${id}',-1); renderCart();">−</button>
        <span>${qty}</span>
        <button onclick="changeQty('${id}',1); renderCart();">+</button>
      </div>
      <div class="cr-price">${MENU.currency}${item.price * qty}</div>
    </div>`;
  }).join('');

  const subtotal = cartTotal();
  const nextLabel = orderMode === 'dinein' ? 'Place order'
    : orderMode === 'pickup' ? 'Continue to payment' : 'Continue to address';
  const nextAction = orderMode === 'dinein' ? 'placeOrder()'
    : orderMode === 'pickup' ? "showView('pickup')" : "showView('address')";

  // For pickup, the fee depends on a choice (takeaway vs. sit & eat) made on the
  // NEXT screen — so we don't commit to a fee number here, just the subtotal.
  const feeRowsHTML = orderMode === 'pickup'
    ? `<div class="summary-row"><span>Packaging / service fee</span><span>Confirmed next step</span></div>`
    : `<div class="summary-row"><span>${feeLabelForMode()}</span><span>${MENU.currency}${feeForMode()}</span></div>`;
  const totalLabel = orderMode === 'pickup' ? 'Subtotal' : 'Total';
  const totalValue = orderMode === 'pickup' ? subtotal : subtotal + feeForMode();

  content.innerHTML = `
    <div class="cart-list">${rows}</div>
    ${waitSummaryHTML(entries)}
    <div class="summary">
      <div class="summary-row"><span>Subtotal</span><span>${MENU.currency}${subtotal}</span></div>
      ${feeRowsHTML}
      <div class="summary-row total"><span>${totalLabel}</span><span>${MENU.currency}${totalValue}</span></div>
      <button class="btn-primary saffron" onclick="${nextAction}">${nextLabel}</button>
    </div>
  `;
}

/* ===================== TIME SLOTS (shared by pickup + delivery) ===================== */
function formatClockTime(date) { return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
function buildTimeSlots() {
  const now = new Date();
  const roundUpMins = 15 - (now.getMinutes() % 15 || 15);
  const base = new Date(now.getTime() + roundUpMins * 60000);
  const slots = [{ key: 'asap', label: 'ASAP', asap: true }];
  [15, 30, 45, 60].forEach((off) => {
    const t = new Date(base.getTime() + off * 60000);
    slots.push({ key: String(off), label: formatClockTime(t), asap: false, offsetMin: off });
  });
  return slots;
}
function renderTimeSlots() {
  currentTimeSlots = buildTimeSlots();
  selectedTimeIndex = 0;
  paintTimeChips('timeChips');
}
function paintTimeChips(containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = currentTimeSlots.map((s, i) =>
    `<button type="button" class="time-chip ${s.asap ? 'asap' : ''} ${i === selectedTimeIndex ? 'selected' : ''}" onclick="pickTimeSlot(${i}, '${containerId}')">${s.label}</button>`
  ).join('');
}
function pickTimeSlot(i, containerId) { selectedTimeIndex = i; paintTimeChips(containerId); }

/* ===================== PICKUP (pre-order, prepaid) ===================== */
function renderPickupScreen() {
  currentTimeSlots = buildTimeSlots();
  selectedTimeIndex = 0;
  paintTimeChips('pickupTimeChips');
  renderDiningOptionChips();
  renderPaymentChips();
  updatePickupPaySummary();
}
function renderDiningOptionChips() {
  const container = document.getElementById('diningOptionChips');
  container.innerHTML = DINING_OPTIONS.map(o =>
    `<button type="button" class="time-chip ${selectedDiningOption === o.key ? 'selected' : ''}" onclick="pickDiningOption('${o.key}')">${o.label}</button>`
  ).join('');
}
function pickDiningOption(key) {
  selectedDiningOption = key;
  renderDiningOptionChips();
  updatePickupPaySummary();
}
function renderPaymentChips() {
  const container = document.getElementById('paymentChips');
  container.innerHTML = PAYMENT_METHODS.map(p =>
    `<button type="button" class="time-chip ${selectedPaymentMethod === p.key ? 'selected' : ''}" onclick="pickPaymentMethod('${p.key}')">${p.label}</button>`
  ).join('');
}
function pickPaymentMethod(key) { selectedPaymentMethod = key; renderPaymentChips(); }
function updatePickupPaySummary() {
  const subtotal = cartTotal();
  const fee = feeForMode();
  const total = subtotal + fee;
  document.getElementById('pickupPaySummary').innerHTML = `
    <div class="summary-row"><span>Subtotal</span><span>${MENU.currency}${subtotal}</span></div>
    <div class="summary-row"><span>${feeLabelForMode()}</span><span>${MENU.currency}${fee}</span></div>
    <div class="summary-row total"><span>Total to pay</span><span>${MENU.currency}${total}</span></div>
  `;
}

function submitPickupAndPay() {
  if (!selectedPaymentMethod) {
    const toast = document.getElementById('toast');
    toast.textContent = 'Pick a payment method to continue.';
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2200);
    return;
  }
  const pickupInfo = {
    arrival: currentTimeSlots[selectedTimeIndex],
    paymentMethod: selectedPaymentMethod,
    diningOption: selectedDiningOption,
  };
  placeOrder(null, pickupInfo);
}

/* ===================== DELIVERY ADDRESS FORM ===================== */
function validateAddressForm() {
  const fields = ['dName', 'dPhone', 'dAddress'];
  let valid = true;
  fields.forEach(id => {
    const input = document.getElementById(id);
    const wrap = input.closest('.field');
    const empty = input.value.trim().length === 0;
    const phoneBad = id === 'dPhone' && !/^\d{7,15}$/.test(input.value.trim());
    if (empty || phoneBad) { wrap.classList.add('invalid'); valid = false; }
    else { wrap.classList.remove('invalid'); }
  });
  return valid;
}
function submitAddressAndPlaceOrder() {
  if (!validateAddressForm()) return;
  const address = {
    name: document.getElementById('dName').value.trim(),
    phone: document.getElementById('dPhone').value.trim(),
    address: document.getElementById('dAddress').value.trim(),
    notes: document.getElementById('dNotes').value.trim(),
    timeSlot: currentTimeSlots[selectedTimeIndex],
  };
  placeOrder(address, null);
}

/* ===================== PLACE ORDER ===================== */
function placeOrder(deliveryInfo, pickupInfo) {
  if (cartCount() === 0) return;
  let counter = Number(localStorage.getItem(COUNTER_KEY) || 42);
  counter += 1;
  localStorage.setItem(COUNTER_KEY, String(counter));
  const id = '#' + String(counter).padStart(3, '0');

  const entries = Object.entries(cart);
  const subtotal = cartTotal();
  const fee = feeForMode();
  const total = subtotal + fee;
  const wait = estimateWait(entries);

  const order = {
    id,
    mode: orderMode,
    table: orderMode === 'dinein' ? tableNumber : null,
    items: entries.map(([itemId, qty]) => {
      const it = findItem(itemId);
      return { name: it.name, qty, price: it.price };
    }),
    subtotal, fee, total,
    wait,
    delivery: deliveryInfo || null,
    pickup: pickupInfo || null,
    payment: orderMode === 'pickup'
      ? { prepaid: true, method: pickupInfo.paymentMethod, paidAt: new Date().toISOString() }
      : { prepaid: false },
    status: 'new',
    createdAt: new Date().toISOString(),
    history: [{ status: 'new', at: new Date().toISOString() }],
  };
  upsertOrder(order);
  currentOrderId = id;
  cart = {};
  selectedPaymentMethod = null;
  showView('status');
  refreshCustomerTicket();
}

/* ===================== CUSTOMER STATUS TICKET (live) ===================== */
function refreshCustomerTicket() {
  const order = getOrder(currentOrderId);
  if (!order) return;

  document.getElementById('orderNum').textContent = order.id;

  let modeSub = '';
  if (order.mode === 'dinein') {
    modeSub = `Dine-in · Table ${order.table}`;
  } else if (order.mode === 'pickup') {
    const arrival = order.pickup.arrival;
    const methodLabel = PAYMENT_METHODS.find(p => p.key === order.pickup.paymentMethod)?.label || 'card';
    const arrivalText = arrival.asap ? 'Arriving ASAP' : 'Arriving ' + arrival.label;
    modeSub = order.pickup.diningOption === 'dinein'
      ? `Pre-order · Dine-in when you arrive · Prepaid via ${methodLabel} · ${arrivalText}`
      : `Pre-order · Takeaway · Prepaid via ${methodLabel} · ${arrivalText}`;
  } else {
    modeSub = `Delivery · ${order.delivery.name} · ${order.delivery.timeSlot.asap ? 'ASAP' : 'Scheduled ' + order.delivery.timeSlot.label}`;
  }
  document.getElementById('ticketSub').textContent = modeSub;

  document.getElementById('ticketItems').innerHTML = order.items.map(it =>
    `<div class="ticket-item-row"><span>${it.qty} × ${it.name}</span><span>${MENU.currency}${it.price * it.qty}</span></div>`
  ).join('');
  document.getElementById('ticketTotal').textContent = MENU.currency + order.total;

  const etaLine = document.getElementById('ticketEta');
  if (order.mode === 'delivery') {
    const arrival = order.wait.total + DELIVERY_TRAVEL_MIN;
    etaLine.textContent = order.delivery.timeSlot.asap
      ? `Estimated delivery: ~${arrival} min (${order.wait.total} min kitchen + ${DELIVERY_TRAVEL_MIN} min ride)`
      : `Timed to arrive around ${order.delivery.timeSlot.label}`;
  } else if (order.mode === 'pickup') {
    etaLine.textContent = order.pickup.arrival.asap
      ? `Kitchen will have it ready in ~${order.wait.total} min — time your arrival to that.`
      : `Kitchen will time this to be ready exactly when you arrive, around ${order.pickup.arrival.label}.`;
  } else {
    etaLine.textContent = order.wait.isExpressOnly
      ? `Express lane — estimated ${order.wait.total} min`
      : `Estimated ${order.wait.total} min (kitchen queue included)`;
  }

  const paidBadge = document.getElementById('paidBadge');
  if (order.payment && order.payment.prepaid) {
    paidBadge.style.display = 'inline-flex';
    paidBadge.textContent = '✓ Paid';
  } else {
    paidBadge.style.display = 'none';
  }

  const flow = flowForMode(order.mode);
  const stepMeta = buildStepMeta(order);
  const activeIndex = flow.indexOf(order.status);
  renderStepper(flow.map(k => stepMeta[k]), activeIndex);
}

function buildStepMeta(order) {
  const base = {
    new: { title: 'Order received', desc: 'Waiting for the kitchen to accept it.' },
    accepted: { title: 'Accepted', desc: 'The kitchen has your order.' },
    preparing: { title: 'Preparing', desc: `About ${order.wait.total} min.` },
  };
  if (order.mode === 'dinein') {
    return { ...base,
      ready: { title: 'Ready for pickup', desc: `We\u2019ll bring it to Table ${order.table}.` },
      completed: { title: 'Served', desc: 'Enjoy your meal!' },
    };
  }
  if (order.mode === 'pickup') {
    const isDinein = order.pickup.diningOption === 'dinein';
    return { ...base,
      ready: isDinein
        ? { title: 'Ready — take your seat', desc: 'Sit anywhere available; we\u2019ll bring it over.' }
        : { title: 'Ready at the counter', desc: 'Prepaid — just grab it and go.' },
      picked_up: isDinein
        ? { title: 'Served', desc: 'Enjoy your meal!' }
        : { title: 'Picked up', desc: 'Thanks for ordering ahead!' },
    };
  }
  return { ...base,
    out_for_delivery: { title: 'Out for delivery', desc: 'On the way to your address.' },
    delivered: { title: 'Delivered', desc: 'Enjoy your meal!' },
  };
}

function renderStepper(steps, activeIndex) {
  const el = document.getElementById('stepper');
  el.innerHTML = steps.map((s, i) => {
    const state = i < activeIndex ? 'done' : (i === activeIndex ? 'active' : '');
    const icon = i < activeIndex ? '✓' : (i + 1);
    const isLast = i === steps.length - 1;
    return `<div class="step ${state}">
      <div class="step-dot-col">
        <div class="step-dot">${icon}</div>
        ${!isLast ? '<div class="step-line"></div>' : ''}
      </div>
      <div class="step-text"><h4>${s.title}</h4><p>${s.desc}</p></div>
    </div>`;
  }).join('');
}

function resetOrder() {
  currentOrderId = null;
  tableNumber = null;
  selectedPaymentMethod = null;
  document.getElementById('dName').value = '';
  document.getElementById('dPhone').value = '';
  document.getElementById('dAddress').value = '';
  document.getElementById('dNotes').value = '';
  showView('landing');
}

function callStaff() {
  const toast = document.getElementById('toast');
  toast.textContent = orderMode === 'dinein'
    ? `Staff notified — someone's on their way to Table ${tableNumber}.`
    : "Support notified — we'll message you shortly.";
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2600);
}

/* ===================== ADMIN / STAFF DASHBOARD ===================== */
const ADMIN_COLUMNS = [
  { key: 'new', title: 'New orders', statuses: ['new'] },
  { key: 'kitchen', title: 'In the kitchen', statuses: ['accepted', 'preparing'] },
  { key: 'handoff', title: 'Ready / out for delivery', statuses: ['ready', 'out_for_delivery'] },
  { key: 'done', title: 'Completed', statuses: ['completed', 'delivered', 'picked_up'] },
];

function nextAdminAction(order) {
  const flow = flowForMode(order.mode);
  const idx = flow.indexOf(order.status);
  if (idx === -1 || idx === flow.length - 1) return null;
  const nextStatus = flow[idx + 1];
  const labels = {
    accepted: 'Accept order', preparing: 'Start preparing', ready: 'Mark ready',
    out_for_delivery: 'Send for delivery', completed: 'Mark served',
    delivered: 'Mark delivered',
    picked_up: order.mode === 'pickup' && order.pickup.diningOption === 'dinein' ? 'Mark served' : 'Mark picked up',
  };
  return { nextStatus, label: labels[nextStatus] };
}

function advanceOrder(id) {
  const order = getOrder(id);
  if (!order) return;
  const next = nextAdminAction(order);
  if (!next) return;
  order.status = next.nextStatus;
  order.history.push({ status: next.nextStatus, at: new Date().toISOString() });
  upsertOrder(order);
  renderAdmin();
}

function orderDetailHTML(order) {
  const itemsLine = order.items.map(it => `${it.qty}× ${it.name}`).join(', ');
  const placedAt = new Date(order.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  let modeBadge = '';
  let extraBlock = '';
  if (order.mode === 'dinein') {
    modeBadge = `🍽️ Table ${order.table}`;
  } else if (order.mode === 'pickup') {
    const methodLabel = PAYMENT_METHODS.find(p => p.key === order.pickup.paymentMethod)?.label || '';
    const isDinein = order.pickup.diningOption === 'dinein';
    modeBadge = `${isDinein ? '🍽️' : '🥡'} Pre-order · ${isDinein ? 'Dine-in' : 'Takeaway'}${order.pickup.arrival.asap ? ' · ASAP' : ' · ' + order.pickup.arrival.label}`;
    extraBlock = `<div class="ord-address">Prepaid via ${methodLabel} · ${MENU.currency}${order.total}</div>`;
  } else {
    modeBadge = `🛵 Delivery${order.delivery.timeSlot.asap ? '' : ' · ' + order.delivery.timeSlot.label}`;
    extraBlock = `
      <div class="ord-address">
        <div><strong>${order.delivery.name}</strong> · ${order.delivery.phone}</div>
        <div>${order.delivery.address}</div>
        ${order.delivery.notes ? `<div class="ord-notes">Note: ${order.delivery.notes}</div>` : ''}
      </div>`;
  }
  const next = nextAdminAction(order);

  return `
    <div class="order-card">
      <div class="ord-top">
        <span class="ord-id">${order.id}</span>
        <span class="ord-badge">${modeBadge}</span>
      </div>
      <div class="ord-items">${itemsLine}</div>
      ${extraBlock}
      <div class="ord-meta-row">
        <span>Placed ${placedAt}</span>
        <span>${MENU.currency}${order.total}</span>
        <span>~${order.wait.total} min</span>
      </div>
      <div class="ord-status-tag status-${order.status}">${STATUS_LABEL[order.status]}</div>
      ${next ? `<button class="btn-primary saffron ord-action" onclick="advanceOrder('${order.id}')">${next.label}</button>` : ''}
    </div>`;
}

function renderAdmin() {
  const orders = loadOrders();
  const board = document.getElementById('adminBoard');
  document.getElementById('adminCount').textContent =
    orders.filter(o => !['completed', 'delivered', 'picked_up'].includes(o.status)).length + ' active';

  board.innerHTML = ADMIN_COLUMNS.map(col => {
    const colOrders = orders.filter(o => col.statuses.includes(o.status));
    const sorted = colOrders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return `
      <div class="admin-col">
        <div class="admin-col-head"><h3>${col.title}</h3><span>${sorted.length}</span></div>
        <div class="admin-col-body">
          ${sorted.length ? sorted.map(orderDetailHTML).join('') : '<p class="admin-empty">No orders</p>'}
        </div>
      </div>`;
  }).join('');
}

init();
